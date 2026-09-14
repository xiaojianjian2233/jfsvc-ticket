"""Close the applied July history batch using the workbook's latest update time.

Default mode writes a read-only plan. ``--apply`` requires that plan's digest and
stores complete before-images before committing the transaction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, text, update

from app.db import make_session
from app.models import Ticket

BATCH = "july-2026-conservative-v1"
COMPLETION_BATCH = "july-2026-close-by-latest-update-v1"
BEIJING = timezone(timedelta(hours=8))


def dump(path: str, data: object) -> None:
    target = Path(path)
    with target.open("w") as stream:
        os.chmod(target, 0o600)
        json.dump(data, stream, ensure_ascii=False, default=str, indent=2)
        stream.flush()
        os.fsync(stream.fileno())


def digest(data: object) -> str:
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--import-result", required=True)
    parser.add_argument("--database", required=True, choices=["ticket_hub_sit", "ticket-hub-uat"])
    parser.add_argument("--report", required=True)
    parser.add_argument("--apply", metavar="PLAN_DIGEST")
    args = parser.parse_args()

    result = json.loads(Path(args.import_result).read_text())
    target_ids = sorted(
        {row["id"] for row in result["created_ids"]}
        | {row["id"] for row in result["before"]}
    )
    db = make_session()
    try:
        db.execute(text("SET LOCAL lock_timeout='5s'"))
        db.execute(text("SET LOCAL statement_timeout='120s'"))
        if args.apply:
            db.execute(text("LOCK TABLE tickets IN SHARE ROW EXCLUSIVE MODE"))
        else:
            db.execute(text("SET TRANSACTION READ ONLY"))
        assert db.execute(text("select current_database()")).scalar_one() == args.database
        tickets = list(db.scalars(select(Ticket).where(Ticket.id.in_(target_ids))))
        assert len(tickets) == len(target_ids), "Some imported tickets are missing"

        changes = []
        anomalies = []
        for ticket in tickets:
            payload = dict(ticket.source_payload or {})
            metadata = payload.get("_historical_import")
            if not metadata:
                metadata = (payload.get("_historical_supplements") or {}).get(BATCH)
            assert metadata and metadata.get("batch") == BATCH
            fields = metadata.get("source_fields") or {}
            raw_latest = str(fields.get("最新更新时间") or "").strip()
            assert raw_latest, f"Ticket {ticket.id} has no 最新更新时间"
            resolved_at = datetime.strptime(raw_latest, "%Y-%m-%d %H:%M:%S").replace(tzinfo=BEIJING)
            if ticket.received_at and resolved_at < ticket.received_at:
                anomalies.append(
                    {
                        "id": ticket.id,
                        "fpy": metadata.get("fpy"),
                        "received_at": ticket.received_at,
                        "latest_update": resolved_at,
                    }
                )
            changes.append(
                {
                    "id": ticket.id,
                    "fpy": metadata.get("fpy"),
                    "resolved_at": resolved_at.isoformat(),
                    "source_raw": raw_latest,
                }
            )

        plan = {
            "batch": COMPLETION_BATCH,
            "source_batch": BATCH,
            "database": args.database,
            "target_ids": target_ids,
            "changes": changes,
            "anomalies_latest_before_received": anomalies,
        }
        plan_digest = digest(plan)
        summary = {
            "database": args.database,
            "batch": COMPLETION_BATCH,
            "digest": plan_digest,
            "targets": len(changes),
            "anomalies_latest_before_received": len(anomalies),
            "min_resolved_at": min(row["resolved_at"] for row in changes),
            "max_resolved_at": max(row["resolved_at"] for row in changes),
        }
        if not args.apply:
            dump(args.report, {"summary": summary, "plan": plan})
            print(json.dumps(summary, ensure_ascii=False))
            return

        assert args.apply == plan_digest, "Database or plan changed; rerun the read-only plan"
        before = [
            dict(row)
            for row in db.execute(
                select(Ticket.__table__).where(Ticket.id.in_(target_ids))
            ).mappings()
        ]
        backup = {"summary": summary, "before": before, "state": "prepared"}
        dump(args.report, backup)
        by_id = {ticket.id: ticket for ticket in tickets}
        for change in changes:
            ticket = by_id[change["id"]]
            payload = dict(ticket.source_payload or {})
            payload["_historical_completion"] = {
                "batch": COMPLETION_BATCH,
                "source_field": "最新更新时间",
                "source_raw": change["source_raw"],
                "count_in_daily": True,
            }
            db.execute(
                update(Ticket.__table__)
                .where(Ticket.id == change["id"])
                .values(
                    status="closed",
                    process_stage="完成",
                    actual_resolved_at=datetime.fromisoformat(change["resolved_at"]),
                    source_payload=payload,
                )
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
