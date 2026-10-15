"""Unit tests for Open API Channel sync methods (ask_init, answer_no_stream, end_session)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from adapters.ai_cs import (
    AiCsBusinessError,
    AiCsClient,
    AiCsConfig,
    ChannelAnswerResult,
)


class TestOpenApiChannelSync(unittest.TestCase):
    def setUp(self) -> None:
        self.config = AiCsConfig(
            app_id="test_appid",
            app_key="test_appkey",
            base_url="http://test-server:9090",
        )
        self.client = AiCsClient(self.config)
        # Mock underlying _request and _ensure_token
        self.client._ensure_token = MagicMock(return_value="mock_token_123")  # type: ignore

    def tearDown(self) -> None:
        self.client.close()

    def test_ask_init_success(self) -> None:
        self.client._request = MagicMock(
            return_value={"ai_agent_cid": "cid_abc_123", "biz_type": "AI_AGENT"}
        )  # type: ignore
        cid = self.client.ask_init()
        self.assertEqual(cid, "cid_abc_123")
        self.client._request.assert_called_once_with("GET", "/open-api/ask/ask_init")

    def test_ask_init_missing_cid_raises_error(self) -> None:
        self.client._request = MagicMock(return_value={})  # type: ignore
        with self.assertRaises(AiCsBusinessError):
            self.client.ask_init()

    def test_answer_no_stream_auto_inits_cid_if_omitted(self) -> None:
        self.client.ask_init = MagicMock(return_value="auto_cid_456")  # type: ignore
        mock_response_data = [
            {
                "answer": "您好！我是发票云助手。",
                "transfer_result": "NO_ACTION",
                "ai_agent_cid": "auto_cid_456",
                "robot_answer_type": "QA_DIRECT",
                "robot_answer_message_type": "MESSAGE",
            }
        ]
        self.client._request = MagicMock(return_value=mock_response_data)  # type: ignore

        result = self.client.answer_no_stream("你好")
        self.client.ask_init.assert_called_once()
        self.client._request.assert_called_once_with(
            "POST",
            "/open-api/ask/answer_no_stream",
            json={"question": "你好", "ai_agent_cid": "auto_cid_456", "msg_type": "TEXT"},
        )
        self.assertIsInstance(result, ChannelAnswerResult)
        self.assertEqual(result.answer, "您好！我是发票云助手。")
        self.assertEqual(result.transfer_result, "NO_ACTION")
        self.assertEqual(result.ai_agent_cid, "auto_cid_456")

    def test_answer_no_stream_reuses_provided_cid_and_detects_transfer(self) -> None:
        self.client.ask_init = MagicMock()  # should not be called
        mock_response_data = [
            {
                "answer": "识别到您的问题需要人工客服处理，请稍候...",
                "transfer_result": "TRANSFER",
                "ai_agent_cid": "existing_cid_789",
                "robot_answer_type": "QA_DIRECT",
                "robot_answer_message_type": "MESSAGE",
            }
        ]
        self.client._request = MagicMock(return_value=mock_response_data)  # type: ignore

        result = self.client.answer_no_stream(
            question="这个报错太奇怪了，找人工客服！",
            cid="existing_cid_789",
            skill="customer-service",
            user_name="张经理",
        )
        self.client.ask_init.assert_not_called()
        self.assertEqual(result.transfer_result, "TRANSFER")
        self.assertEqual(result.ai_agent_cid, "existing_cid_789")
        self.assertIn("人工客服", result.answer)

    def test_answer_no_stream_with_images_validation(self) -> None:
        # Invalid URL scheme
        with self.assertRaises(ValueError):
            self.client.answer_no_stream("看图", cid="c1", images=["ftp://invalid/a.png"])

        # Exceeds max 5 images
        with self.assertRaises(ValueError):
            self.client.answer_no_stream("看图", cid="c1", images=["http://a.com/pic.png"] * 6)

    def test_end_session(self) -> None:
        self.client._request = MagicMock(return_value=None)  # type: ignore
        self.client.end_session("cid_to_close")
        self.client._request.assert_called_once_with(
            "POST",
            "/open-api/ask/end_session",
            json={"ai_agent_cid": "cid_to_close"},
        )

        # Calling with empty cid does nothing
        self.client._request.reset_mock()
        self.client.end_session("")
        self.client._request.assert_not_called()

    def test_global_token_caching_and_clearing(self) -> None:
        AiCsClient.clear_token_cache()
        # Mock get_token response
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "errcode": "0000",
            "data": {"token": "cached_tok_999", "expires_in": "3600"},
        }

        mock_http = MagicMock()
        mock_http.get.return_value = mock_resp

        client1 = AiCsClient(self.config, http_client=mock_http)
        tok1 = client1._ensure_token()
        self.assertEqual(tok1, "cached_tok_999")
        self.assertEqual(mock_http.get.call_count, 1)

        # Another client instance with same config must read from global cache without network call
        mock_http2 = MagicMock()
        client2 = AiCsClient(self.config, http_client=mock_http2)
        tok2 = client2._ensure_token()
        self.assertEqual(tok2, "cached_tok_999")
        mock_http2.get.assert_not_called()

        # Clear token cache
        AiCsClient.clear_token_cache()
        client3 = AiCsClient(self.config, http_client=mock_http2)
        mock_http2.get.return_value = mock_resp
        tok3 = client3._ensure_token()
        self.assertEqual(tok3, "cached_tok_999")
        mock_http2.get.assert_called_once()


if __name__ == "__main__":
    unittest.main()
