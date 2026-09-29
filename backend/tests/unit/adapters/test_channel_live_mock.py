"""End-to-end integration test with in-memory HTTP transport simulating Open API Channel."""

from __future__ import annotations

import hashlib
import json
import unittest
import uuid

import httpx

from adapters.ai_cs import AiCsClient, AiCsConfig


def _channel_mock_dispatcher(request: httpx.Request) -> httpx.Response:
    path = request.url.path

    # 1. GET /open-api/get_token
    if path == "/open-api/get_token":
        appid = request.url.params.get("appid", "")
        create_time = request.url.params.get("create_time", "")
        sign = request.url.params.get("sign", "")
        expected = hashlib.md5(f"{appid}{create_time}mock_app_key".encode()).hexdigest()
        if sign != expected:
            return httpx.Response(400, json={"errcode": "100001", "description": "签名失败", "data": None})
        return httpx.Response(
            200,
            json={"errcode": "0000", "description": "操作成功", "data": {"token": "test-tok-999", "expires_in": "86400"}},
        )

    # All other endpoints require token header
    token = request.headers.get("token")
    if token != "test-tok-999":
        return httpx.Response(401, json={"errcode": "100003", "description": "Token 无效", "data": None})

    # 2. GET /open-api/ask/ask_init
    if path == "/open-api/ask/ask_init":
        return httpx.Response(
            200,
            json={"errcode": "0000", "description": "操作成功", "data": {"ai_agent_cid": "cid-test-12345", "biz_type": "AI_AGENT"}},
        )

    # 3. POST /open-api/ask/answer_no_stream
    if path == "/open-api/ask/answer_no_stream":
        body = json.loads(request.content)
        question = body.get("question", "")
        cid = body.get("ai_agent_cid", "")
        images = body.get("images") or []
        transfer_result = "NO_ACTION"
        if "人工" in question:
            transfer_result = "TRANSFER"
            answer = "识别到您需要人工客服协助，已为您触发转人工流程。"
        elif "版本" in question:
            answer = "发票云共有以下版本：标准版、星瀚旗舰版、星空旗舰版、国际版。"
        elif "红字" in question:
            answer = "【红字发票冲红操作指南】请在发票管理模块申请红字信息表。"
        else:
            answer = f"大模型智能答复：{question}"

        return httpx.Response(
            200,
            json={
                "errcode": "0000",
                "description": "操作成功",
                "data": [
                    {
                        "answer": answer,
                        "transfer_result": transfer_result,
                        "ai_agent_cid": cid,
                        "robot_answer_type": "QA_DIRECT",
                        "robot_answer_message_type": "MESSAGE",
                    }
                ],
            },
        )

    # 4. POST /open-api/ask/end_session
    if path == "/open-api/ask/end_session":
        return httpx.Response(200, json={"errcode": "0000", "description": "会话已结束", "data": None})

    return httpx.Response(404, json={"errcode": "400000", "description": f"未找到接口: {path}", "data": None})


class TestChannelLiveMock(unittest.TestCase):
    def setUp(self) -> None:
        self.config = AiCsConfig(
            app_id="mock_app_id",
            app_key="mock_app_key",
            base_url="http://mock-ai-channel.local",
        )
        transport = httpx.MockTransport(_channel_mock_dispatcher)
        http_client = httpx.Client(transport=transport)
        self.client = AiCsClient(self.config, http_client=http_client)

    def tearDown(self) -> None:
        self.client.close()

    def test_live_token_and_ask_flow(self) -> None:
        # 1. 提问第 1 轮：自动触发 MD5 签名换取 token，并自动 ask_init 换取 cid
        res1 = self.client.answer_no_stream("发票云有哪些版本")
        self.assertEqual(res1.ai_agent_cid, "cid-test-12345")
        self.assertEqual(res1.transfer_result, "NO_ACTION")
        self.assertIn("标准版", res1.answer)
        self.assertIn("星瀚旗舰版", res1.answer)

        # 2. 提问第 2 轮：复用已有 cid
        res2 = self.client.answer_no_stream("请问红字怎么开", cid=res1.ai_agent_cid)
        self.assertEqual(res2.ai_agent_cid, "cid-test-12345")
        self.assertEqual(res2.transfer_result, "NO_ACTION")
        self.assertIn("红字发票冲红操作指南", res2.answer)

        # 3. 提问第 3 轮：识别转人工意图
        res3 = self.client.answer_no_stream("帮我找人工客服", cid=res1.ai_agent_cid)
        self.assertEqual(res3.ai_agent_cid, "cid-test-12345")
        self.assertEqual(res3.transfer_result, "TRANSFER")
        self.assertIn("人工客服", res3.answer)

        # 4. 结束会话
        self.client.end_session(res1.ai_agent_cid)


if __name__ == "__main__":
    unittest.main()
