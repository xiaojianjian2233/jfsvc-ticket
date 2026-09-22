"""Backfill KSM ticket received_at from saved subscribeCallback details.

Only rows with a saved ``_subscribe_callback.createDateTime`` are changed.
Rows without KSM details or without a parseable createDateTime are left alone.
"""

from __future__ import annotations

from zoneinfo import ZoneInfo

from app.db import make_session
from app.models import Ticket
from app.services.ingest.ksm_ingester import parse_ksm_create_datetime


def main() -> None:
    db = make_session()
    updated = 0
    skipped_no_detail = 0
    skipped_no_time = 0
    try:
        tickets = db.query(Ticket).filter(Ticket.source_code == "ksm").all()
        for ticket in tickets:
            payload = ticket.source_payload or {}
            callback = payload.get("_subscribe_callback")
            if not isinstance(callback, dict):
                skipped_no_detail += 1
                continue
            received_at = parse_ksm_create_datetime(callback.get("createDateTime"))
            if received_at is None:
                skipped_no_time += 1
                continue
            # A later KSM detail refresh can carry a createDateTime after the
            # ticket first entered ticket-hub. Do not make submit time later
            # than the system creation time in that case.
            ticket_created_at = ticket.created_at
            if ticket_created_at is not None and ticket_created_at.tzinfo is None:
                ticket_created_at = ticket_created_at.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
            if ticket_created_at is not None and received_at > ticket_created_at:
                received_at = ticket_created_at
            if ticket.received_at != received_at:
                ticket.received_at = received_at
                updated += 1
        db.commit()
        print(
            {
                "scanned": len(tickets),
                "updated": updated,
                "skipped_no_detail": skipped_no_detail,
                "skipped_no_time": skipped_no_time,
            }
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
