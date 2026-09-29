#!/usr/bin/env python3
"""轻量级 Open API Channel 本地联调 Mock 服务。

完全符合 /Users/yanghuili/Downloads/open-api-channel.md 接口规范，
零外部依赖（纯 Python 标准库），用于本地环境开发与联调验证。

支持的接口：
- GET  /open-api/get_token                      (Token 鉴权与获取)
- GET  /open-api/ask/ask_init                   (会话初始化，返回 ai_agent_cid)
- POST /open-api/ask/answer_no_stream           (同步问答，返回 answer + transfer_result，带自然思考延时与深度领域知识库)
- POST /open-api/ask/answer_async               (异步问答，返回 task_id)
- GET  /open-api/ask/answer_async/{task_id}     (查询异步任务结果)
- POST /open-api/ask/end_session                (结束会话释放资源)
- POST /open-api/ask/llm_no_stream              (直连大模型)

运行方式：
    python3 backend/scripts/mock_ai_cs_channel.py --port 9090
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MockAiCsChannel")

DEFAULT_APP_ID = "mock_app_id"
DEFAULT_APP_KEY = "mock_app_key"
MOCK_TOKEN = "mock-channel-token-8888"


def generate_domain_answer(question: str, user_name: str = "客户", images: list | None = None) -> tuple[str, str]:
    """金蝶发票云专业领域知识推理引擎。
    
    返回 (answer_text, transfer_result: 'NO_ACTION' | 'TRANSFER')
    """
    images = images or []
    cleaned_q = question.strip()

    # 1. 处理引用内容：若包含「引用 客服: ...」，分离出客户最新输入内容
    pure_input = re.sub(r"「引用\s+[^:：]+[:：][^」]+」", "", cleaned_q).strip()
    target_text = f"{pure_input} {cleaned_q}".lower()

    # 2. 意图：转人工
    if any(k in target_text for k in ["人工", "转人工", "真人", "坐席", "找客服", "专家", "投诉", "不满意", "人工服务"]):
        answer = (
            f"您好 {user_name}！我已为您识别到需要人工客服协助的需求。\n"
            "系统已为您触发在线人工坐席对接流程，请稍候，或点击下方卡片立即转接人工坐席。"
        )
        return answer, "TRANSFER"

    # 3. 意图：收票 / 进项 / 星瀚收票 / 发票云收票产品功能
    if any(k in target_text for k in [
        "收票", "星瀚收票", "进项", "受票", "收票功能", "收票产品", "产品功能", "发票云收票"
    ]) and not any(k in pure_input for k in ["2、", "2.", "2"]):
        img_tip = f"（已结合您上传的 {len(images)} 张图片凭证）\n\n" if images else ""
        answer = (
            f"【金蝶发票云·星瀚收票产品功能全景】\n\n"
            f"您好 {user_name}！{img_tip}"
            "金蝶发票云「星瀚进项收票」专为大中型集团企业打造，涵盖从发票智能归集、合规查验风控、智能抵扣勾选到业财税一体化协同的进项发票全生命周期数字化管理体系：\n\n"
            "1. 📥 全渠道智能归集与数电乐企采集\n"
            "   • 数电乐企直连：自动同步税局税务数字账户，秒级实时归集数电发票与电子发票底账，告别手工下载导出；\n"
            "   • 多终端便捷采集：支持邮箱发票自动抓取、微信/支付宝发票卡包一键同步、桌面扫码枪/高拍仪极速录入；\n"
            "   • 智能 OCR 图像识别：支持增值税专票/普票、数电发票、火车票、飞机行程单、出租车票等多票种批量高精识别与版式结构化解析。\n\n"
            "2. 🛡️ 智能合规查验与多维风控防重\n"
            "   • 实时税局真伪查验：直连国家税务总局全国增值税发票查验平台，实时核验真伪与开票状态（正常/作废/红冲/失控/异常）；\n"
            "   • 严格防重报销风控：系统从源头自动拦截重复报销、跨期发票、抬头税号不符发票，自动比对异常纳税人黑名单。\n\n"
            "3. 📊 智能抵扣勾选与进项台账统计\n"
            "   • 自动抵扣勾选：根据企业抵扣规则自动执行所属税期发票勾选、不抵扣确认及退税勾选；\n"
            "   • 进项申报台账统计：自动汇总当期有效进项税额、留抵税额与可抵扣明细，一键导出增值税纳税申报表附表数据，提速财务月末关账。\n\n"
            "4. 🔄 业财税一体化协同与自动凭证流转\n"
            "   • 深度集成 ERP：无缝打通金蝶云·星瀚/苍穹/星空费控报销与应付账款，实现「业务单据-发票台账-记账凭证」三单智能匹配；\n"
            "   • 自动化记账凭证：发票入库审核后自动驱动生成财务总账凭证并挂接电子发票原件。\n\n"
            "5. 🗄️ 电子会计档案合规长久归档\n"
            "   • 严格遵循财政部、国家档案局财会〔2020〕6号文件标准；\n"
            "   • XML、OFD 原始凭证防篡改安全存储，支持一键调阅审计与税务稽查穿透。"
        )
        return answer, "NO_ACTION"

    # 4. 意图：星瀚旗舰版 / 2 / 2、星瀚旗舰版
    if (
        "星瀚旗舰" in target_text
        or "星瀚" in target_text
        or pure_input in ("2", "2.", "2、", "2、星瀚旗舰版", "二", "第二个", "第2个")
    ):
        answer = (
            "【金蝶发票云·星瀚旗舰版详细介绍】\n\n"
            "您好！针对您咨询的「星瀚旗舰版」，其专为大型集团企业、央国企及跨国集团设计，核心特性与业务价值如下：\n\n"
            "1. 🏢 集团级多组织多租户集中管控\n"
            "   • 支持集团总部对下属数十家至数百家分子公司、多税号的集中管理；\n"
            "   • 统一配置全集团开票策略、授信额度监控、用票规则与分级审批权限，实现全集团发票资产与税务风险统筹。\n\n"
            "2. ⚡ 数电乐企直连高并发通道\n"
            "   • 官方认证首批乐企服务商，支持数电票乐企直连（开票与受票底账双向拉取）；\n"
            "   • 支持高并发分布式集群部署，峰值开票速度可达 500+ 张/秒，平稳支撑集团大促与月末集中开票。\n\n"
            "3. 🧩 深度中台与异构 ERP 开放集成\n"
            "   • 提供丰富的标准 Open API 与企业服务总线，支持与 SAP、Oracle、金蝶星瀚/苍穹、自建采购商城、CRM 无缝对接；\n"
            "   • 支持复杂的业财票一体化流转，实现业务触发自动开票、自动对账核销。\n\n"
            "4. 🔒 国产信创全栈适配与金融级安全\n"
            "   • 全面适配主流国产化芯片（鲲鹏、飞腾）、国产操作系统（麒麟、统信）及国产数据库（达梦、人大金仓）；\n"
            "   • 支持国密算法加密、数据脱敏、分布式部署与多机房容灾备份，保障集团涉税核心数据资产安全。"
        )
        return answer, "NO_ACTION"

    # 5. 意图：标准版 / 1 / 1、标准版
    if (
        "标准版" in target_text
        or pure_input in ("1", "1.", "1、", "1、标准版", "一", "第一个", "第1个")
    ):
        answer = (
            "【金蝶发票云·标准版详细介绍】\n\n"
            "您好！「标准版」专为中小微及成长型企业量身打造，特点是开箱即用、轻量敏捷：\n\n"
            "1. 极速开票：支持扫码开票、金蝶桌面开票助手、批量导入开票，快速完成增值税专票/普票及数电发票开具；\n"
            "2. 进项受票：支持发票拍照识别、一键查验真伪与抵扣勾选，有效防止重复报销；\n"
            "3. 适用场景：无复杂多组织层级、需要低成本快速合规上线发票数字化管理的中小企业。"
        )
        return answer, "NO_ACTION"

    # 6. 意图：星空旗舰版 / 3 / 3、星空旗舰版
    if (
        "星空旗舰" in target_text
        or "星空" in target_text
        or pure_input in ("3", "3.", "3、", "3、星空旗舰版", "三", "第三个", "第3个")
    ):
        answer = (
            "【金蝶发票云·星空旗舰版详细介绍】\n\n"
            "您好！「星空旗舰版」专为中大型制造、商贸等成长型企业打造，深度打通金蝶云·星空系统：\n\n"
            "1. 业务单据联动：与星空销售出库单、应收结算单实时双向同步，出库自动开票，应收自动对账；\n"
            "2. 供应链协同：进项发票与采购订单、入库单智能三单匹配，自动生成星空采购凭证；\n"
            "3. 适用场景：金蝶云·星空用户企业，实现全链路业财税票自动化流转。"
        )
        return answer, "NO_ACTION"

    # 7. 意图：国际版 / 4 / 4、国际版
    if (
        "国际版" in target_text
        or pure_input in ("4", "4.", "4、", "4、国际版", "四", "第四个", "第4个")
    ):
        answer = (
            "【金蝶发票云·国际版详细介绍】\n\n"
            "您好！「国际版」面向跨国出海企业与海外中资机构：\n\n"
            "1. 支持全球主流电子发票网络（如 PEPPOL）对接；\n"
            "2. 覆盖多国家/地区涉税合规要求，支持多币种结算、海外增值税（VAT）合规管理与跨境电子发票审计。"
        )
        return answer, "NO_ACTION"

    # 8. 意图：发票云版本概述
    if any(k in target_text for k in ["版本", "有哪些版本", "版本介绍", "产品矩阵"]):
        answer = (
            "【金蝶发票云产品版本全景】\n\n"
            "发票云共有以下四大版本，满足不同规模与业务场景需求：\n\n"
            "1. 🔹【标准版】：适合中小企业常规开票、受票及查验抵扣业务，轻量敏捷、开箱即用；\n"
            "2. 🔹【星瀚旗舰版】：面向大型集团企业，支持多组织多租户管控、乐企直连高并发与深度 ERP 集成；\n"
            "3. 🔹【星空旗舰版】：面向中大型成长型企业，深度打通金蝶云·星空财务供应链业务一体化；\n"
            "4. 🔹【国际版】：支持全球电子发票网络（PEPPOL）、多币种结算及跨境涉税管理。\n\n"
            "👉 您可以直接回复对应数字或版本名称（如回复「2」或「星瀚旗舰版」）了解详细方案！"
        )
        return answer, "NO_ACTION"

    # 9. 意图：红字发票冲红
    if any(k in target_text for k in ["红字", "冲红", "红冲", "折让"]):
        answer = (
            "【数电发票红字冲红完整操作指南】\n\n"
            "1. 发起红字确认：登录发票云，进入【发票管理】>【红字发票处理】；\n"
            "2. 录入冲红信息：选择需冲红的原蓝字发票，选择冲红原因（销货退回/开票有误/销售折让等），系统自动调出原票明细；\n"
            "3. 税局确认流转：\n"
            "   • 若原蓝字发票尚未抵扣且由销方开具，销方发起后自动开具红字发票；\n"
            "   • 若原发票已被购买方抵扣勾选，需由购买方在税务数字账户确认红字信息表后，方可完成红字发票开具；\n"
            "4. 自动核销入账：红字发票开具后自动推送入库并核销关联的业务单据。"
        )
        return answer, "NO_ACTION"

    # 10. 意图：开票 / 批量开票
    if any(k in target_text for k in ["开票", "怎么开票", "批量开票", "开具发票"]):
        answer = (
            "【数电发票开具操作指引】\n\n"
            "金蝶发票云支持多种便捷开票模式：\n\n"
            "1. 极速扫码开票：客户扫描收银台动态二维码，自动带出企业抬头并提交开票；\n"
            "2. 业务单据开票：在 ERP/业务系统中生成销售单后，点击「开票」一键自动推送开具；\n"
            "3. 批量导入开票：在【发票云】>【发票开具】页面下载 Excel 模板，批量导入明细后一键批量开具并发送至客户邮箱或手机；\n"
            "4. 乐企直连秒开：乐企对接用户通过 API 自动触发，全流程无需人工干预。"
        )
        return answer, "NO_ACTION"

    # 11. 意图：抵扣 / 勾选 / 认证
    if any(k in target_text for k in ["抵扣", "勾选", "认证", "申报抵扣"]):
        answer = (
            "【进项发票抵扣勾选与认证操作】\n\n"
            "1. 进入【发票管理】>【抵扣勾选】模块；\n"
            "2. 选择当前所属税期，系统自动汇总已采集入库的有效进项发票；\n"
            "3. 可按单张勾选或批量勾选「用于申报抵扣」或「不抵扣」；\n"
            "4. 在征期结束前，进入【抵扣统计】页面，点击「申请统计」并完成「确认签名」，即可锁定当期进项税额供增值税纳税申报使用。"
        )
        return answer, "NO_ACTION"

    # 12. 意图：查验 / 真伪 / 防重
    if any(k in target_text for k in ["查验", "真伪", "防重", "重复报销"]):
        answer = (
            "【发票查验与防伪风控说明】\n\n"
            "金蝶发票云查验功能特点：\n\n"
            "• 直联国家税务总局全国增值税发票查验平台，数据权威实时；\n"
            "• 支持录入发票代码、发票号码、开票日期、校验码/不含税金额进行极速查验；\n"
            "• 支持拍照、PDF批量上传自动 OCR 解析后自动查验；\n"
            "• 查验结果包含发票真实状态（正常/作废/红冲/失控/异常）及明细，并自动完成企业防重报销校验。"
        )
        return answer, "NO_ACTION"

    # 13. 意图：乐企直连
    if any(k in target_text for k in ["乐企", "直连", "专线"]):
        answer = (
            "【数电乐企直连服务说明】\n\n"
            "金蝶作为首批官方认证乐企服务商，为企业提供完整的乐企对接能力：\n\n"
            "1. 资质合规辅导：协助集团向主管税局申请乐企直连试点资质与通道配置；\n"
            "2. 7×24小时高并发通道：支持秒级双向直连总局乐企平台，实现批量开票与底账数据实时同步；\n"
            "3. 安全加密保障：采用税务专用安全数字证书与硬件加密设备，满足总局信息安全要求。"
        )
        return answer, "NO_ACTION"

    # 14. 自由提问智能语义分析兜底
    img_note = f"（已结合您上传的 {len(images)} 张图片信息）\n\n" if images else ""
    answer = (
        f"【智能客服大模型答复】\n\n"
        f"您好 {user_name}！针对您咨询的问题：“{cleaned_q}”{img_note}\n\n"
        "智能大模型已为您检索发票云核心知识库：\n"
        "1. 请确认您在系统中的业务角色权限，并在对应功能模块核实基础信息录入是否完整；\n"
        "2. 若涉及税局接口或乐企通道交互，请检查所属税期开票与受票底账状态；\n"
        "3. 若您需要进一步的技术方案或操作指引，您可以随时继续详细提问，或回复「转人工」由在线专业客服为您协助排查。"
    )
    return answer, "NO_ACTION"


class MockChannelHandler(BaseHTTPRequestHandler):
    sessions: set[str] = set()
    async_tasks: dict[str, dict] = {}

    def _send_json(self, status_code: int, errcode: str, description: str, data: object = None) -> None:
        payload = {
            "errcode": errcode,
            "description": description,
            "data": data,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body_json(self) -> dict | None:
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                return {}
            raw = self.rfile.read(content_length).decode("utf-8")
            return json.loads(raw)
        except Exception as e:
            logger.warning("Failed to parse request JSON: %s", e)
            return None

    def _check_token(self) -> bool:
        token = self.headers.get("token") or self.headers.get("Token")
        if not token:
            self._send_json(401, "100003", "缺少 token 请求头")
            return False
        return True

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # 1. 获取 Token: GET /open-api/get_token
        if path == "/open-api/get_token":
            appid = (params.get("appid") or [""])[0]
            create_time = (params.get("create_time") or [""])[0]
            sign = (params.get("sign") or [""])[0]

            if not appid or not create_time or not sign:
                self._send_json(400, "400000", "缺少必需参数 (appid, create_time, sign)")
                return

            expected_sign = hashlib.md5(f"{appid}{create_time}{DEFAULT_APP_KEY}".encode()).hexdigest()
            logger.info("get_token: appid=%s, create_time=%s, sign=%s (expected=%s)", appid, create_time, sign, expected_sign)

            self._send_json(200, "0000", "操作成功", {
                "token": MOCK_TOKEN,
                "expires_in": "86400",
            })
            return

        # 2. 会话初始化: GET /open-api/ask/ask_init
        if path == "/open-api/ask/ask_init":
            if not self._check_token():
                return
            new_cid = f"mock-cid-{uuid.uuid4().hex[:16]}"
            self.sessions.add(new_cid)
            logger.info("ask_init created session cid=%s", new_cid)
            self._send_json(200, "0000", "操作成功", {
                "ai_agent_cid": new_cid,
                "biz_type": "AI_AGENT",
            })
            return

        # 5. 查询异步任务结果: GET /open-api/ask/answer_async/{task_id}
        if path.startswith("/open-api/ask/answer_async/"):
            if not self._check_token():
                return
            task_id = path.split("/")[-1]
            task = self.async_tasks.get(task_id)
            if not task:
                self._send_json(404, "100002", "任务不存在或已过期")
                return

            elapsed = time.time() - task["created_at"]
            if elapsed < 2.0:
                self._send_json(200, "0000", "操作成功", {
                    "task_id": task_id,
                    "status": "PENDING",
                    "ai_agent_cid": task["cid"],
                    "answer": None,
                    "robot_answer_type": "QA_DIRECT",
                    "transfer_result": None,
                })
            else:
                self._send_json(200, "0000", "操作成功", {
                    "task_id": task_id,
                    "status": "DONE",
                    "ai_agent_cid": task["cid"],
                    "answer": task["answer"],
                    "robot_answer_type": "QA_DIRECT",
                    "transfer_result": task["transfer_result"],
                })
            return

        self._send_json(404, "400000", f"接口不存在: {path}")

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path

        if not self._check_token():
            return

        body = self._read_body_json()
        if body is None:
            self._send_json(400, "400000", "JSON 请求体格式错误")
            return

        # 3. 同步问答: POST /open-api/ask/answer_no_stream
        if path == "/open-api/ask/answer_no_stream":
            question = str(body.get("question") or "").strip()
            cid = str(body.get("ai_agent_cid") or "").strip()
            images = body.get("images") or []
            user_name = body.get("user_name") or "客户"

            if not question:
                self._send_json(400, "400000", "question 不能为空")
                return
            if not cid:
                self._send_json(400, "400000", "ai_agent_cid 不能为空")
                return

            logger.info("answer_no_stream: cid=%s, question=%s, images_count=%d", cid, question, len(images))

            # 模拟大模型自然思考分析延时 2.0 秒（保证前端可稳定展现“问题正常分析中，请耐心等待...”）
            time.sleep(2.0)

            # 智能意图与领域知识推理
            answer, transfer_result = generate_domain_answer(question, user_name, images)

            resp_data = [
                {
                    "answer": answer,
                    "robot_answer_type": "QA_DIRECT",
                    "robot_answer_message_type": "MESSAGE",
                    "ai_agent_cid": cid,
                    "roundid": f"rnd-{uuid.uuid4().hex[:8]}",
                    "transfer_result": transfer_result,
                }
            ]
            self._send_json(200, "0000", "操作成功", resp_data)
            return

        # 4. 异步问答: POST /open-api/ask/answer_async
        if path == "/open-api/ask/answer_async":
            question = str(body.get("question") or "").strip()
            cid = str(body.get("ai_agent_cid") or "").strip()
            images = body.get("images") or []
            user_name = body.get("user_name") or "客户"

            if not question or not cid:
                self._send_json(400, "400000", "question 和 ai_agent_cid 不能为空")
                return

            task_id = uuid.uuid4().hex
            ans, tr = generate_domain_answer(question, user_name, images)
            self.async_tasks[task_id] = {
                "created_at": time.time(),
                "cid": cid,
                "answer": ans,
                "transfer_result": tr,
            }
            logger.info("answer_async created task_id=%s for cid=%s", task_id, cid)
            self._send_json(200, "0000", "操作成功", {
                "task_id": task_id,
                "ai_agent_cid": cid,
                "status": "PENDING",
            })
            return

        # 6. 结束会话: POST /open-api/ask/end_session
        if path == "/open-api/ask/end_session":
            cid = str(body.get("ai_agent_cid") or "")
            self.sessions.discard(cid)
            logger.info("end_session: cid=%s successfully released", cid)
            self._send_json(200, "0000", "会话已结束", None)
            return

        # 7. 直连大模型: POST /open-api/ask/llm_no_stream
        if path == "/open-api/ask/llm_no_stream":
            messages = body.get("messages") or []
            if not messages:
                self._send_json(400, "400000", "messages 不能为空")
                return
            last_msg = messages[-1].get("content") or ""
            resp_data = {
                "id": f"msg_{uuid.uuid4().hex[:12]}",
                "type": "message",
                "role": "assistant",
                "model": body.get("model") or "mock-model",
                "content": [
                    {"type": "text", "text": f"【直连大模型答复】您好，已收到输入：{last_msg}"}
                ],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 20},
            }
            self._send_json(200, "0000", "操作成功", resp_data)
            return

        self._send_json(404, "400000", f"接口不存在: {path}")


def run(port: int = 9090) -> None:
    server = HTTPServer(("0.0.0.0", port), MockChannelHandler)
    logger.info("Mock Open API Channel server listening on http://0.0.0.0:%d", port)
    logger.info("AppID: %s, AppKey: %s", DEFAULT_APP_ID, DEFAULT_APP_KEY)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down Mock server...")
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mock Open API Channel Server")
    parser.add_argument("--port", type=int, default=9090, help="Port to listen on (default: 9090)")
    args = parser.parse_args()
    run(args.port)
