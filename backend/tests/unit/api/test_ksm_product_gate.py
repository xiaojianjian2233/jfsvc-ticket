from unittest.mock import patch

import pytest

from app.services.ingest.ksm_product_gate import accepts_product


@pytest.mark.parametrize("product,expected", [
    ({"number": "C28", "name": "其他"}, True),
    ({"number": "OTHER", "name": "金蝶发票云"}, True),
    ({"number": "C28", "name": "金蝶发票云"}, True),
    ({"number": "C28"}, True),
    ({"name": "金蝶发票云"}, True),
    ({"number": "OTHER", "name": "其他"}, False),
    ({"number": "c28", "name": " 金蝶发票云"}, False),
    ({}, False), (None, False), ("C28", False),
])
def test_original_product_or_gate(product, expected):
    assert accepts_product({"product": product}) is expected


def test_full_payload_rejected_before_ingest(app_client):
    with patch("app.api.webhooks.KSMIngester") as ingest:
        response = app_client.post("/webhook/ksm?access_token=test-token", json={
            "billId": "gate-test", "title": "other", "productLineCode": "C28",
            "product": {"number": "OTHER", "name": "其他"},
        })
        assert response.status_code == 200
        assert response.json() == {"code": 0}
        ingest.assert_not_called()


def test_async_rejected_before_db_or_takeover():
    from app.api.webhooks import _ksm_async_fetch_and_ingest
    from app.services.ksm.notice_store import FakeNoticeStore, NoticeInfo
    store = FakeNoticeStore()
    store.put("gate-test", NoticeInfo("notice", "subscription"))
    with patch("app.api.webhooks._get_notice_store", return_value=store), patch("app.api.webhooks.KSMClient") as client, patch("app.api.webhooks.make_session") as session, patch("app.api.webhooks.run_post_ingest_agents") as agent:
        client.return_value.get_order_detail.return_value = {"billId": "gate-test", "product": {"number": "OTHER"}}
        _ksm_async_fetch_and_ingest("gate-test")
        session.assert_not_called()
        agent.assert_not_called()
        client.return_value.close.assert_called_once()
