"""Context regressions: readable catalog, complete text, original image links."""

from unittest.mock import Mock, patch

from app.config import Settings
from app.models import Attachment, HubIssue, ProductLine, Source, Ticket
from app.services.ai_cs.context import (
    build_hub_question,
    build_image_context,
    content_text_and_images,
    format_question,
)


def seed(db):
    db.add(Source(code="ksm", name="KSM"))
    db.add(ProductLine(code="PROLINE6055", name="星瀚-开票"))
    db.flush()
    t = Ticket(
        short_code="TKT-context",
        source_code="ksm",
        source_ticket_id="ctx-1",
        type="Raw",
        status="processing",
        title="开票合并失败",
        body="正文",
        product_line_code="PROLINE6055",
    )
    db.add(t)
    db.flush()
    h = HubIssue(
        short_code="HUB-context",
        ticket_id=t.id,
        type="Operation",
        status="created",
        title=t.title,
        canonical_body=t.body,
        product_line_code=t.product_line_code,
    )
    db.add(h)
    db.flush()
    t.hub_issue_id = h.id
    return h, t


def test_catalog_and_title_not_lost(db_session):
    h, _ = seed(db_session)
    q = build_hub_question(db_session, h, settings=Settings())
    assert "产品线：星瀚-开票" in q and "产品编码：PROLINE6055" in q
    assert "【工单标题】\n开票合并失败" in q and "【问题正文】\n正文" in q


def test_missing_title_and_image_only():
    q = format_question(
        body='<img src="https://example.com/a.png">',
        images=['图片1：<img src="https://example.com/a.png">'],
    )
    assert "【工单标题】" not in q and "【问题正文】" not in q
    assert "【补充信息—图片】" in q and '<img src="https://example.com/a.png">' in q
    assert "需要客户补充" in format_question()


def test_html_markdown_plain_links_and_entities():
    content = (
        '<p>金额&lt;100，失败</p><img src="https://example.com/a.png?x=1&amp;y=2">'
        "![截图](https://example.com/a.png?x=1&y=2) https://example.com/b.jpg"
        "<script>hidden text</script>"
    )
    text, urls = content_text_and_images(content)
    assert "金额<100" in text and "hidden text" not in text
    assert urls == ["https://example.com/a.png?x=1&y=2", "https://example.com/b.jpg"]


def test_late_ocr_and_current_ticket_text_included(db_session):
    h, t = seed(db_session)
    t.body = "正文\n客户新补充：数量为2"
    db_session.add(
        Attachment(
            ticket_id=t.id,
            kind="image",
            source_url="https://example.com/a.png",
            vision_status="extracted",
            extracted_text="图中报错：负数无法冲抵",
        )
    )
    db_session.flush()
    q = build_hub_question(db_session, h, settings=Settings())
    assert "客户新补充：数量为2" in q
    assert "图中报错：负数无法冲抵" in q.split("【补充信息—图片】")[1]
    assert '<img src="https://example.com/a.png">' in q
    assert h.canonical_body == "正文"


def test_inline_image_forwarded_without_ocr_or_db_writes(db_session):
    h, t = seed(db_session)
    h.canonical_body = t.body = '<img src="https://example.com/new.png">'
    db_session.commit()
    with patch("app.core.llm_router.vision.VisionClient.from_settings") as vision:
        q = build_hub_question(db_session, h, settings=Settings(vision_enabled=True))
    vision.assert_not_called()
    assert '<img src="https://example.com/new.png">' in q
    assert not db_session.new and not db_session.dirty
    assert db_session.query(Attachment).count() == 0


def test_attachment_link_dedup_and_cached_evidence():
    url = "https://example.com/a.png?x=1&y=2"
    a = Attachment(
        id=1,
        ticket_id=1,
        source_url=url,
        storage_key="http://minio/a.png",
        kind="image",
        extracted_text="截图文字",
    )
    result = build_image_context(attachments=[a], urls=[url, url], settings=Settings())
    assert len(result) == 1 and "截图文字" in result[0]
    assert 'src="https://example.com/a.png?x=1&amp;y=2"' in result[0]


def test_private_or_missing_link_and_limit_are_explicit():
    result = build_image_context(
        attachments=[],
        urls=["http://127.0.0.1/a.png", "https://example.com/b.png"],
        settings=Settings(vision_max_images_per_ticket=1),
    )
    assert "无可供" in result[0] and "上限" in result[1]
    assert "<img" not in "".join(result)


def test_stored_public_link_fallback():
    a = Attachment(id=1, ticket_id=1, kind="image", storage_key="https://files.example.com/a.png")
    result = build_image_context(attachments=[a], urls=[], settings=Settings())
    assert '<img src="https://files.example.com/a.png">' in result[0]


def test_other_subtask_attachment_not_included(db_session):
    h, t = seed(db_session)
    other = HubIssue(short_code="HUB-other", title="其他子问题", type="Operation", status="created")
    db_session.add(other)
    db_session.flush()
    db_session.add(
        Attachment(
            ticket_id=t.id,
            hub_issue_id=other.id,
            kind="image",
            vision_status="extracted",
            extracted_text="其他任务的截图",
        )
    )
    db_session.flush()
    assert "其他任务的截图" not in build_hub_question(db_session, h, settings=Settings())


def test_operation_replay_receives_resolved_context_and_image(db_session):
    from adapters.ai_cs.types import ReplayResult
    from app.services.agents.operation_answer import AnswerRoute, auto_answer_operation

    h, _ = seed(db_session)
    h.canonical_body = '报错截图：<img src="https://example.com/a.png">'
    h.op_status, h.op_handler = "processing", "agent"
    db_session.commit()
    fake = Mock()
    fake.replay.return_value = ReplayResult("请检查开票规则及单据数据。", [], [], "trace")
    with (
        patch("app.services.agents.operation_answer.build_client", return_value=fake),
        patch(
            "app.services.agents.operation_answer._route_answer",
            return_value=AnswerRoute("transfer"),
        ),
    ):
        auto_answer_operation(
            db_session, h.id, settings=Settings(operation_auto_reply_enabled=True)
        )
    q = fake.replay.call_args.kwargs["question"]
    assert "星瀚-开票" in q and "开票合并失败" in q
    assert '<img src="https://example.com/a.png">' in q


def test_public_query_forwards_image_without_separate_vision():
    from adapters.ai_cs.types import ReplayResult
    from app.services.ai_cs.query import AnswerRoute, answer_question

    fake = Mock()
    fake.replay.return_value = ReplayResult("已找到错误。", [], [], "trace")
    with (
        patch("app.services.ai_cs.query.build_client", return_value=fake),
        patch("app.services.ai_cs.query.route_answer", return_value=AnswerRoute("D")),
        patch("app.core.llm_router.vision.VisionClient.from_settings") as vision,
    ):
        answer_question(
            title="",
            content='<img src="https://example.com/a.png">',
            product_category="星瀚-开票",
            settings=Settings(vision_enabled=True),
        )
    q = fake.replay.call_args.kwargs["question"]
    assert "【补充信息—图片】" in q and '<img src="https://example.com/a.png">' in q
    vision.assert_not_called()
    fake.close.assert_called_once()
