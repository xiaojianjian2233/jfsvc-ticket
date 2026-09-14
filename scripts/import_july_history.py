"""Conservative July 2026 import. Default is read-only plan; --apply requires its digest.

Run inside backend with /app on PYTHONPATH. No ingest, dispatch, event or outbox APIs.
Before-images and created IDs are saved beside the report before transaction commit.
"""

from __future__ import annotations
import argparse
import hashlib
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from sqlalchemy import insert, select, text, update
from app.db import make_session
from app.models import Ticket

BATCH = "july-2026-conservative-v1"
SOURCES = {"KSM": "ksm", "智齿": "zhichi", "多维表格（内部）": "feishu"}
TYPES = {
    "需求": "Demand",
    "BUG": "Bug_fix",
    **dict.fromkeys(
        ["应用咨询", "技术支持", "系统故障", "数据问题", "部署运维"], "Operation"
    ),
}
STATUSES = {
    "处理完成": "closed",
    "处理关闭": "closed",
    "已退回": "transferred_return",
    "退回KSM处理": "transferred_return",
    "处理中": "processing",
    "升级产研处理": "processing",
    "待处理": "received",
}


def norm(v):
    return str(v or "").strip()


def number(v):
    if v is None or str(v).strip() == "":
        return None
    try:
        d = Decimal(str(v))
        return (
            str(d.quantize(Decimal("0.01")))
            if d.is_finite() and 0 <= d < 100000
            else None
        )
    except InvalidOperation:
        return None


def dump(path, data):
    p = Path(path)
    with p.open("w") as f:
        os.chmod(p, 0o600)
        json.dump(data, f, ensure_ascii=False, default=str, indent=2)
        f.flush()
        os.fsync(f.fileno())


def digest(data):
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument(
        "--database", required=True, choices=["ticket_hub_sit", "ticket-hub-uat"]
    )
    ap.add_argument("--report", required=True)
    ap.add_argument("--apply", metavar="PLAN_DIGEST")
    args = ap.parse_args()
    data = json.loads(Path(args.input).read_text())
    assert data["period"] == "2026-07" and len(data["rows"]) == 2153
    assert len({r["data"]["工单ID"] for r in data["rows"]}) == len(data["rows"])
    db = make_session()
    try:
        db.execute(text("SET LOCAL lock_timeout='5s'"))
        db.execute(text("SET LOCAL statement_timeout='120s'"))
        if args.apply:
            db.execute(text("LOCK TABLE tickets IN SHARE ROW EXCLUSIVE MODE"))
        else:
            db.execute(text("SET TRANSACTION READ ONLY"))
        assert db.execute(text("select current_database()")).scalar() == args.database
        cols = {
            r[0]
            for r in db.execute(
                text(
                    "select column_name from information_schema.columns where table_name='tickets'"
                )
            )
        }
        assert "process_stage" in cols
        existing = [
            dict(r)
            for r in db.execute(
                text("""select id,short_code,source_code,source_ticket_id,source_ticket_number,title,status,received_at,assigned_user_id,handler_user_id,product_line_code,module,sla_standard_hours,handle_hours,deleted_at,
          source_payload -> '_feishu_import' ->> '工单ID' as legacy_fpy,
          source_payload -> '_feishu_import' ->> '工单来源ID' as legacy_sid,
          source_payload -> '_feishu_import' ->> '工单来源编号' as legacy_number,
          source_payload -> '_historical_import' ->> 'fpy' as history_fpy,
          source_payload -> '_historical_supplements' ->> 'july-2026-conservative-v1' as supplement
          from tickets""")
            ).mappings()
        ]
        by_id = {r["id"]: r for r in existing}
        fpys, source_ids, numbers, titles = (defaultdict(set) for _ in range(4))
        for t in existing:
            for f in (t["legacy_fpy"], t["history_fpy"], t["source_ticket_id"]):
                if norm(f).startswith("FPY"):
                    fpys[norm(f)].add(t["id"])
            for f in (t["source_ticket_id"], t["legacy_sid"]):
                if norm(f):
                    source_ids[(t["source_code"], norm(f))].add(t["id"])
            for f in (t["source_ticket_number"], t["legacy_number"]):
                if norm(f):
                    numbers[(t["source_code"], norm(f))].add(t["id"])
            if norm(t["title"]):
                titles[norm(t["title"])].add(t["id"])
        products, users = defaultdict(list), defaultdict(list)
        for code, name in db.execute(
            text("select code,name from product_lines where is_active=true")
        ):
            products[name].append(code)
        for uid, name in db.execute(
            text(
                "select id,name from users where deleted_at is null and is_active=true"
            )
        ):
            users[name].append(uid)
        enabled_sources = set(db.execute(text("select code from sources")).scalars())
        additions, changes, held, skipped = [], [], [], []
        for record in data["rows"]:
            r, row = record["data"], record["row"]
            fpy = norm(r["工单ID"])
            date = datetime.strptime(r["工单创建时间"], "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone(timedelta(hours=8))
            )
            assert date.year == 2026 and date.month == 7
            if not any(norm(r[k]) for k in ["主题", "问题描述", "工单来源"]):
                skipped.append({"row": row, "fpy": fpy, "reason": "empty_record"})
                continue
            source = SOURCES.get(norm(r["工单来源"]))
            if source not in enabled_sources:
                held.append({"row": row, "fpy": fpy, "reason": "unknown_source"})
                continue
            matches = (
                fpys[fpy]
                | source_ids[(source, norm(r["工单来源ID"]))]
                | numbers[(source, norm(r["工单来源编号"]))]
            )
            if len(matches) > 1 or any(by_id[i]["deleted_at"] for i in matches):
                held.append(
                    {
                        "row": row,
                        "fpy": fpy,
                        "reason": "ambiguous_or_deleted_key",
                        "ids": sorted(matches),
                    }
                )
                continue
            meta = {
                "batch": BATCH,
                "fpy": fpy,
                "excel_row": row,
                "file_sha256": data["file_sha256"],
                "source_fields": r,
                "hours_policy": "snapshot_only_unit_unconfirmed",
            }
            if matches:
                t = by_id[next(iter(matches))]
                if t["history_fpy"] == fpy or t["supplement"]:
                    skipped.append(
                        {"row": row, "fpy": fpy, "reason": "already_imported"}
                    )
                    continue
                fields = {}
                if (
                    t["sla_standard_hours"] is None
                    and number(r["处理时长标准"]) is not None
                ):
                    fields["sla_standard_hours"] = number(r["处理时长标准"])
                if not t["source_ticket_number"] and norm(r["工单来源编号"]):
                    fields["source_ticket_number"] = norm(r["工单来源编号"])
                changes.append(
                    {
                        "id": t["id"],
                        "row": row,
                        "fpy": fpy,
                        "fields": fields,
                        "meta": meta,
                        "expected": t,
                    }
                )
                continue
            if titles[norm(r["主题"])]:
                held.append(
                    {
                        "row": row,
                        "fpy": fpy,
                        "reason": "same_title_needs_review",
                        "ids": sorted(titles[norm(r["主题"])]),
                    }
                )
                continue
            name = norm(r["产品分类AI"])
            if name == "其他（非发票云问题）":
                name = "其他非发票云问题"
            pcodes, uids = products[name], users[norm(r["处理人 (人员 )"])]
            sid = norm(r["工单来源ID"]) or norm(r["工单来源编号"]) or fpy
            meta.update(archive_only=True, parent_fpy=norm(r["父记录"]))
            payload = {"_historical_import": meta}
            body = "\n\n".join(
                x
                for x in [
                    norm(r["问题描述"]),
                    ("【历史处理过程】\n" + norm(r["工单处理过程"]))
                    if norm(r["工单处理过程"])
                    else "",
                ]
                if x
            )
            additions.append(
                {
                    "fpy": fpy,
                    "row": row,
                    "values": {
                        "short_code": "HIST-" + fpy,
                        "type": "Raw",
                        "source_code": source,
                        "source_ticket_id": sid,
                        "source_ticket_number": norm(r["工单来源编号"]) or None,
                        "source_payload": payload,
                        "title": norm(r["主题"])[:512] or None,
                        "body": body or None,
                        "status": STATUSES.get(norm(r["工单状态"]), "historical"),
                        "source_status": norm(r["工单状态"]) or None,
                        "process_stage": "历史归档",
                        "product_line_code": pcodes[0] if len(pcodes) == 1 else None,
                        "module": norm(r["产品模块"])[:128] or None,
                        "feature": norm(r["产品问题模块"])[:128] or None,
                        "assigned_user_id": uids[0] if len(uids) == 1 else None,
                        "handler_user_id": uids[0] if len(uids) == 1 else None,
                        "predicted_type": TYPES.get(norm(r["提单类型"])),
                        "sla_standard_hours": number(r["处理时长标准"]),
                        "received_at": date.isoformat(),
                        "created_at": date.isoformat(),
                        "reporter_company": norm(r["客户名称"])[:256] or None,
                        "reporter_tax_no": norm(r["客户税号"])[:64] or None,
                        "reporter_tenant": norm(r["租户名称"])[:256] or None,
                        "service_level": norm(r["服务级别"])[:64] or None,
                        "attachments_synced": True,
                    },
                }
            )
        plan = {
            "batch": BATCH,
            "database": args.database,
            "input_sha": data["file_sha256"],
            "additions": additions,
            "changes": changes,
            "held": held,
            "skipped": skipped,
        }
        plan_digest = digest(plan)
        summary = {
            "database": args.database,
            "batch": BATCH,
            "digest": plan_digest,
            "insert": len(additions),
            "supplement": len(changes),
            "held": len(held),
            "skip": len(skipped),
            "held_reasons": dict(Counter(r["reason"] for r in held)),
            "new_statuses": dict(Counter(r["values"]["status"] for r in additions)),
            "missing_product": sum(
                r["values"]["product_line_code"] is None for r in additions
            ),
            "missing_assignee": sum(
                r["values"]["assigned_user_id"] is None for r in additions
            ),
            "hours_written": 0,
        }
        if not args.apply:
            dump(args.report, {"summary": summary, "plan": plan})
            print(json.dumps(summary, ensure_ascii=False))
            return
        assert args.apply == plan_digest, (
            "Database or plan changed; rerun read-only plan."
        )
        assert "archive_only" in Path("/app/app/repositories/ticket.py").read_text(), (
            "SLA archive guard not deployed"
        )
        before = []
        for c in changes:
            before.append(
                dict(
                    db.execute(select(Ticket.__table__).where(Ticket.id == c["id"]))
                    .mappings()
                    .one()
                )
            )
        backup = {
            "summary": summary,
            "before": before,
            "created_ids": [],
            "held": held,
            "skipped": skipped,
            "state": "prepared",
        }
        dump(args.report, backup)
        for a in additions:
            v = dict(a["values"])
            for k in ("created_at", "received_at"):
                v[k] = datetime.fromisoformat(v[k])
            tid = db.execute(
                insert(Ticket.__table__).values(**v).returning(Ticket.id)
            ).scalar_one()
            backup["created_ids"].append({"id": tid, "fpy": a["fpy"]})
        for c, old in zip(changes, before):
            payload = dict(old["source_payload"] or {})
            supplements = dict(payload.get("_historical_supplements") or {})
            supplements[BATCH] = c["meta"]
            payload["_historical_supplements"] = supplements
            db.execute(
                update(Ticket.__table__)
                .where(Ticket.id == c["id"])
                .values(**c["fields"], source_payload=payload)
            )
        backup["state"] = "ready_to_commit"
        dump(args.report, backup)
        db.commit()
        backup["state"] = "committed"
        dump(args.report, backup)
        print(json.dumps({**summary, "state": "committed"}, ensure_ascii=False))
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
