"""Tests for collision-safe ticket short-code generation."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Ticket
from app.repositories.ticket import TicketRepository


def test_next_short_code_uses_highest_existing_number_not_row_count(
    db_session: Session,
) -> None:
    db_session.add(
        Ticket(
            short_code="TKT-010769",
            source_code="zhichi",
            source_ticket_id="existing-1",
            type="Raw",
            status="processing",
        )
    )
    db_session.add(
        Ticket(
            short_code="TKT-CUSTOM",
            source_code="ksm",
            source_ticket_id="existing-2",
            type="Raw",
            status="processing",
        )
    )
    db_session.commit()

    assert TicketRepository(db_session).next_short_code() == "TKT-010770"
