"""FeishuAiIngester tests — 飞书来源工单入库、字段映射、责任田匹配与自动转产研。"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.models import Attachment, HubIssue, Module, ProductLine, Source, Ticket, User
from app.services.cascade.status_cascade import apply_hub_status
from app.services.ingest.feishu_ai_ingester import (
    FeishuAiIngester,
    auto_transfer_feishu_ticket_to_linear,
    normalize_feishu_predicted_type,
    resolve_feishu_product_and_module,
    resolve_feishu_rd_owner,
)


@pytest.fixture
def world(db_session: Session) -> Session:
    db_session.add(Source(code="feishu_ai", name="飞书AI"))
    db_session.commit()
    return db_session


def _payload(**ov) -> dict:  # type: ignore[type-arg, no-untyped-def]
    base = {
        "session_id": "fa-100",
        "original_question": "数电开票点击开具没反应",
        "ai_answer": "请确认已完成税局认证",
        "dissatisfaction": "认证做了，还是开不了",
        "product_line_code": "cloud-fapiao",
        "module": "数电开票",
        "customer-name": "张三",
        "customer-mobile": "13800000000",
        "customer-email": "zhangsan@example.com",
        "customer": {"erp_uid": "ERP9", "mobile": "13800000000", "name": "张三"},
        "attachments": [{"url": "https://x/err.png", "filename": "err.png"}],
    }
    base.update(ov)
    return base


def test_ingest_creates_feishu_ai_ticket_with_product_module_and_contacts(world: Session) -> None:
    # 预置提单人用户，验证：处理人 = 提单人
    reporter_user = User(
        name="张三",
        mobile="13800000000",
        email="zhangsan@example.com",
        role="assignee",
        is_active=True,
    )
    world.add(reporter_user)
    world.commit()

    res = FeishuAiIngester(world).ingest(_payload())
    world.commit()
    assert not res.deduped
    assert len(res.attachment_ids) == 1

    t = world.get(Ticket, res.ticket_id)
    assert t is not None
    assert t.source_code == "feishu_ai"
    assert t.source_ticket_id == "fa-100"
    assert t.type == "Raw" and t.status == "processing"
    assert t.body == "数电开票点击开具没反应"
    # 1）产品分类=提单产品，问题模块=提单模块
    assert t.product_line_code == "cloud-fapiao"
    assert t.source_product_name == "cloud-fapiao"
    assert t.ksm_reporter_product_line == "cloud-fapiao"
    assert t.module == "数电开票"
    assert t.ksm_reporter_module == "数电开票"
    assert t.source_payload["_original_catalog"] == {
        "product_line_code": "cloud-fapiao",
        "module": "数电开票",
    }
    # 2）处理人=提单人
    assert t.handler_user_id == reporter_user.id
    # 4）提单人=联系人：取飞书工单的 customer-name
    assert t.reporter == "张三"
    assert t.ksm_linkman == "张三"
    # 5）提单人手机=联系人手机：取飞书工单 customer-mobile
    assert t.ksm_contact_mobile == "13800000000"
    # 6）提单人邮箱=联系邮箱：取飞书工单 customer-email
    assert t.ksm_contact_email == "zhangsan@example.com"


@pytest.mark.parametrize(
    "raw_type,expected",
    [
        ("需求", "Demand"),
        ("Demand", "Demand"),
        ("demand", "Demand"),
        ("bug", "Bug_fix"),
        ("Bug", "Bug_fix"),
        ("Bug 修复", "Bug_fix"),
        ("Bug_fix", "Bug_fix"),
    ],
)
def test_predicted_type_mapping_for_feishu_ticket(
    world: Session, raw_type: str, expected: str
) -> None:
    # 3）& 7）predicted_type 工单类型：需求 -> Demand，bug -> Bug_fix
    assert normalize_feishu_predicted_type(raw_type) == expected
    res = FeishuAiIngester(world).ingest(
        _payload(session_id=f"fa-type-{raw_type}", predicted_type=raw_type)
    )
    world.commit()
    t = world.get(Ticket, res.ticket_id)
    assert t is not None
    assert t.predicted_type == expected


def test_rd_owner_matching_and_auto_transfer_to_linear(
    world: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 8）产品分类、问题模块补充完整后，匹配补充产研责任田责任人
    # 9）当研发责任田责任人不为空后，系统自动转产研，将工单转产研传给 linear 处理，将工单的处理环节更新为产研处理
    rd_user = User(
        name="李研发",
        email="lird@example.com",
        role="assignee",
        is_active=True,
    )
    world.add(rd_user)
    world.add(ProductLine(code="cloud-fapiao", name="云票系统", is_active=True))
    world.flush()
    world.add(
        Module(
            code="数电开票",
            name="数电开票",
            product_line_code="cloud-fapiao",
            dev_owners=[{"id": str(rd_user.id), "name": "李研发"}],
            is_active=True,
        )
    )
    world.commit()

    pushed_hub_ids: list[int] = []

    def _fake_push(hub_issue_id: int) -> None:
        pushed_hub_ids.append(hub_issue_id)

    monkeypatch.setattr(
        "app.services.hub_issues.linear_push.push_hub_issue_to_linear", _fake_push
    )

    res = FeishuAiIngester(world).ingest(
        _payload(session_id="fa-auto-rd-1", predicted_type="bug")
    )
    world.commit()

    t = world.get(Ticket, res.ticket_id)
    assert t is not None
    assert t.predicted_type == "Bug_fix"
    assert t.assigned_user_id == rd_user.id
    assert t.hub_issue_id is not None
    assert pushed_hub_ids == [t.hub_issue_id]
    assert t.process_stage == "产研处理"

    hub = world.get(HubIssue, t.hub_issue_id)
    assert hub is not None
    assert hub.type == "Bug_fix"
    assert hub.assigned_user_id == rd_user.id

    # 10）验证产研逆向驳回和正常发版按现有逻辑处理
    apply_hub_status(world, hub, to_status="dev_returned", changed_by="linear:webhook", reason="驳回")
    world.commit()
    world.refresh(t)
    assert t.status == "dev_returned"
    assert t.process_stage == "服务处理"

    apply_hub_status(world, hub, to_status="released", changed_by="linear:sync", reason="正常发版")
    world.commit()
    world.refresh(t)
    assert t.status == "answered"
    assert t.process_stage == "完成"


def test_supplement_product_and_module_matches_rd_owner_and_transfers(
    world: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    rd_user = User(name="王产研", email="wang@example.com", role="assignee", is_active=True)
    world.add(rd_user)
    world.add(ProductLine(code="cloud-fapiao", name="云票系统", is_active=True))
    world.flush()
    world.add(
        Module(
            code="红字发票",
            name="红字发票",
            product_line_code="cloud-fapiao",
            dev_owners=[{"id": str(rd_user.id), "name": "王产研"}],
            is_active=True,
        )
    )
    world.commit()

    pushed_hub_ids: list[int] = []
    monkeypatch.setattr(
        "app.services.hub_issues.linear_push.push_hub_issue_to_linear",
        lambda hid: pushed_hub_ids.append(hid),
    )

    # 入库时未传模块，暂未匹配研发责任人
    res = FeishuAiIngester(world).ingest(
        _payload(session_id="fa-supp-1", product_line_code="cloud-fapiao", module="", predicted_type="需求")
    )
    world.commit()
    t = world.get(Ticket, res.ticket_id)
    assert t is not None
    assert t.predicted_type == "Demand"
    assert t.assigned_user_id is None
    assert pushed_hub_ids == []

    # 补充产品分类、问题模块完整后，匹配补充产研责任田责任人并自动转产研
    plc, src_prod, mod = resolve_feishu_product_and_module(world, "cloud-fapiao", "红字发票")
    t.product_line_code = plc
    t.source_product_name = src_prod
    t.module = mod
    t.ksm_reporter_module = mod
    owner = resolve_feishu_rd_owner(world, t.product_line_code, t.module)
    assert owner is not None and owner.id == rd_user.id
    t.assigned_user_id = owner.id
    hub = auto_transfer_feishu_ticket_to_linear(world, t)
    world.commit()

    assert hub is not None
    assert hub.type == "Demand"
    assert pushed_hub_ids == [hub.id]
    assert t.process_stage == "产研处理"


def test_triple_archived_in_source_payload(world: Session) -> None:
    res = FeishuAiIngester(world).ingest(_payload())
    world.commit()
    t = world.get(Ticket, res.ticket_id)
    assert t is not None
    triple = t.source_payload["ai_cs"]
    assert triple["ai_answer"] == "请确认已完成税局认证"
    assert triple["dissatisfaction"] == "认证做了，还是开不了"


def test_attachment_row_created(world: Session) -> None:
    res = FeishuAiIngester(world).ingest(_payload())
    world.commit()
    att = world.get(Attachment, res.attachment_ids[0])
    assert att is not None
    assert att.source_url == "https://x/err.png"
    assert att.kind == "image" and att.vision_status == "pending"


def test_ingest_dedup_on_session(world: Session) -> None:
    FeishuAiIngester(world).ingest(_payload())
    world.commit()
    again = FeishuAiIngester(world).ingest(_payload())
    world.commit()
    assert again.deduped is True
    assert world.query(Ticket).filter_by(source_code="feishu_ai").count() == 1


def test_long_question_truncated_to_title(world: Session) -> None:
    res = FeishuAiIngester(world).ingest(_payload(original_question="问" * 200))
    world.commit()
    t = world.get(Ticket, res.ticket_id)
    assert t is not None
    assert len(t.title) <= 120
    assert len(t.body) == 200  # body 保留全文

