# -*- coding: utf-8 -*-
"""
使用官方 python-docx 库生成规范的《接收大模型答复接.docx》接口文档
兼容所有版本的 Microsoft Word、WPS Office、Mac Pages，避免任何乱码与兼容性问题。
"""

import os
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, color_hex):
    """设置单元格背景颜色"""
    shading_elm = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
    cell._tc.get_or_add_tcPr().append(shading_elm)

def set_cell_margins(cell, top=140, bottom=140, left=180, right=180):
    """设置单元格内边距"""
    tcMar = parse_xml(f'''
        <w:tcMar {nsdecls("w")}>
            <w:top w:w="{top}" w:type="dxa"/>
            <w:bottom w:w="{bottom}" w:type="dxa"/>
            <w:left w:w="{left}" w:type="dxa"/>
            <w:right w:w="{right}" w:type="dxa"/>
        </w:tcMar>
    ''')
    cell._tc.get_or_add_tcPr().append(tcMar)

def set_table_borders(table, color_hex="CBD5E1"):
    """为表格添加精致边框"""
    tblPr = table._tbl.tblPr
    borders = parse_xml(f'''
        <w:tblBorders {nsdecls("w")}>
            <w:top w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>
            <w:bottom w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>
            <w:left w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>
            <w:right w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
        </w:tblBorders>
    ''')
    tblPr.append(borders)

def add_code_block(doc, text):
    """添加高亮代码块"""
    lines = text.strip().split("\n")
    for i, line in enumerate(lines):
        p = doc.add_paragraph()
        p.paragraph_format.line_spacing = 1.15
        p.paragraph_format.space_before = Pt(4) if i == 0 else Pt(0)
        p.paragraph_format.space_after = Pt(4) if i == len(lines) - 1 else Pt(0)
        p.paragraph_format.left_indent = Inches(0.2)
        p.paragraph_format.right_indent = Inches(0.2)
        
        # 加上灰色背景和边框
        pPr = p._p.get_or_add_pPr()
        shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="F8FAFC"/>')
        pPr.append(shd)
        
        run = p.add_run(line if line else " ")
        run.font.name = "Consolas"
        run.font.size = Pt(9.5)
        run.font.color.rgb = RGBColor(15, 23, 42)
        run._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')

def add_callout(doc, title, text):
    """添加提示卡片"""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.left_indent = Inches(0.2)
    p.paragraph_format.right_indent = Inches(0.2)
    
    pPr = p._p.get_or_add_pPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="EFF6FF"/>')
    pPr.append(shd)
    bdr = parse_xml(f'''
        <w:pBdr {nsdecls("w")}>
            <w:left w:val="single" w:sz="24" w:space="12" w:color="2563EB"/>
        </w:pBdr>
    ''')
    pPr.append(bdr)
    
    r_title = p.add_run(f"💡 {title}：")
    r_title.bold = True
    r_title.font.name = "Microsoft YaHei"
    r_title.font.size = Pt(10.5)
    r_title.font.color.rgb = RGBColor(30, 64, 175)
    r_title._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
    
    r_text = p.add_run(text)
    r_text.font.name = "Microsoft YaHei"
    r_text.font.size = Pt(10)
    r_text.font.color.rgb = RGBColor(30, 58, 138)
    r_text._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')

def style_heading_1(p, text):
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.name = "Microsoft YaHei"
    run.font.size = Pt(16)
    run.font.color.rgb = RGBColor(30, 64, 175)
    run._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
    
    # 底部装饰线
    pPr = p._p.get_or_add_pPr()
    bdr = parse_xml(f'''
        <w:pBdr {nsdecls("w")}>
            <w:bottom w:val="single" w:sz="12" w:space="4" w:color="2563EB"/>
        </w:pBdr>
    ''')
    pPr.append(bdr)

def style_heading_2(p, text):
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.name = "Microsoft YaHei"
    run.font.size = Pt(13)
    run.font.color.rgb = RGBColor(37, 99, 235)
    run._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')

def style_heading_3(p, text):
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.name = "Microsoft YaHei"
    run.font.size = Pt(11)
    run.font.color.rgb = RGBColor(15, 23, 42)
    run._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')

def add_body_p(doc, text, bold_prefix=None):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing = 1.3
    p.paragraph_format.space_after = Pt(6)
    if bold_prefix:
        r_pre = p.add_run(bold_prefix)
        r_pre.bold = True
        r_pre.font.name = "Microsoft YaHei"
        r_pre.font.size = Pt(10.5)
        r_pre.font.color.rgb = RGBColor(15, 23, 42)
        r_pre._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
    
    r = p.add_run(text)
    r.font.name = "Microsoft YaHei"
    r.font.size = Pt(10.5)
    r.font.color.rgb = RGBColor(51, 65, 85)
    r._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
    return p

def add_custom_table(doc, headers, rows, col_widths=None):
    table = doc.add_table(rows=len(rows) + 1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    
    # 格式化表头
    hdr_row = table.rows[0]
    for idx, header_text in enumerate(headers):
        cell = hdr_row.cells[idx]
        set_cell_background(cell, "E2E8F0")
        set_cell_margins(cell, top=140, bottom=140, left=160, right=160)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(header_text)
        r.bold = True
        r.font.name = "Microsoft YaHei"
        r.font.size = Pt(10)
        r.font.color.rgb = RGBColor(15, 23, 42)
        r._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
        if col_widths and idx < len(col_widths):
            cell.width = col_widths[idx]
            
    # 格式化数据行
    for r_idx, row_data in enumerate(rows):
        row = table.rows[r_idx + 1]
        bg_color = "FFFFFF" if r_idx % 2 == 0 else "F8FAFC"
        for c_idx, cell_value in enumerate(row_data):
            cell = row.cells[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=120, bottom=120, left=160, right=160)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.2
            r = p.add_run(cell_value)
            r.font.name = "Microsoft YaHei"
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(51, 65, 85)
            r._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
            if col_widths and c_idx < len(col_widths):
                cell.width = col_widths[c_idx]

    # 表后留白
    p_after = doc.add_paragraph()
    p_after.paragraph_format.space_after = Pt(6)

def generate_document():
    doc = Document()
    
    # 页面边距设置为 2.54 厘米 (1 英寸)
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        
    # 文档大标题
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.space_before = Pt(24)
    p_title.paragraph_format.space_after = Pt(8)
    r_title = p_title.add_run("发票云在线智能接待 — 接收大模型答复接口文档")
    r_title.bold = True
    r_title.font.name = "Microsoft YaHei"
    r_title.font.size = Pt(22)
    r_title.font.color.rgb = RGBColor(30, 64, 175)
    r_title._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
    
    # 副标题
    p_sub = doc.add_paragraph()
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_sub.paragraph_format.space_after = Pt(20)
    r_sub = p_sub.add_run("第三方大模型 / AI Agent 异步回复对接技术规范（含 UAT 环境地址）")
    r_sub.font.name = "Microsoft YaHei"
    r_sub.font.size = Pt(12)
    r_sub.font.color.rgb = RGBColor(100, 116, 139)
    r_sub._r.get_or_add_rPr().set(qn('w:eastAsia'), 'Microsoft YaHei')
    
    # 元数据信息表
    add_custom_table(
        doc,
        ["文档属性", "详情信息", "说明"],
        [
            ["文档版本", "V1.0.0", "正式发布对接规范"],
            ["适用系统", "发票云微系统极简OS（ticket-hub）", "在线咨询接待与智能解答模块"],
            ["接口协议", "HTTP / HTTPS RESTful Webhook", "支持同步与异步推送双模式"],
            ["数据编码", "UTF-8", "传输载荷为 JSON 格式"],
            ["更新日期", "2026-09-24", "发票云架构与研发团队"]
        ],
        [Inches(1.5), Inches(3.2), Inches(1.8)]
    )
    
    # 一、业务背景与交互架构
    p_h1 = doc.add_paragraph()
    style_heading_1(p_h1, "一、业务背景与交互架构")
    add_body_p(
        doc,
        "在发票云在线客户接待系统中，支持配置各专业领域的 AI Agent 智能体（如数电发票专家、纳税申报专家、基础助手等）。"
        "客户在前端（Web端、H5、各端侧边栏）发起咨询提问后，系统将根据产品线与渠道规则精准分流，"
        "并将客户咨询消息实时推送至第三方大模型服务/外部智能体接口。"
    )
    add_body_p(
        doc,
        "第三方大模型在完成知识库检索、语义推理与文本生成后，通过调用本接口（接收大模型答复接口），"
        "将最终回复文本主动推送到发票云客服系统，系统会立即在客户会话窗口中呈现该智能体的专业解答。"
    )
    add_callout(
        doc,
        "双模式设计",
        "模式 A（同步应答）：若大模型可在 5 秒内完成计算，可在出站 Webhook 请求响应中直接返回回复；\n"
        "模式 B（异步回调）：若大模型复杂推理、流式拼接耗时较长，推荐收到提问后先返回 200，计算完成后主动调用本接收接口推送答复，避免 HTTP 长连接超时断开。"
    )
    
    # 二、环境与接口调用地址清单（重点：补充 UAT 环境）
    p_h2 = doc.add_paragraph()
    style_heading_1(p_h2, "二、环境与接口调用地址清单（含 UAT 环境）")
    add_body_p(
        doc,
        "发票云微系统为第三方对接团队提供完整的 UAT 预发环境与 SIT 集成测试环境。"
        "第三方团队联调前请优先选用 UAT 预发环境公网地址："
    )
    add_custom_table(
        doc,
        ["部署环境", "访问基准路径 (Base URL)", "接收答复接口完整地址 (POST)", "环境说明"],
        [
            [
                "UAT 预发环境\n(推荐第三方公网联调)",
                "http://dl.piaozone.com:18025/ticket-hub-uat/",
                "http://dl.piaozone.com:18025/ticket-hub-uat/api/reception/webhook/llm-reply",
                "公网开放域名，端口 18025，支持外网大模型服务直接联调推送"
            ],
            [
                "UAT 备用别名路径",
                "http://dl.piaozone.com:18025/ticket-hub-uat/",
                "http://dl.piaozone.com:18025/ticket-hub-uat/api/reception/agent/external-message",
                "与主接口完全一致，兼容外部系统不同命名规范"
            ],
            [
                "SIT 集成测试环境",
                "http://43.139.250.182/hub-issue/",
                "http://43.139.250.182/hub-issue/api/reception/webhook/llm-reply",
                "SIT 内部集成测试主机，仅限内部网络联调"
            ],
            [
                "本地开发联调环境",
                "http://localhost:8080/",
                "http://localhost:8080/api/reception/webhook/llm-reply",
                "本地微服务直连端口，供容器内或开发单机调试"
            ]
        ],
        [Inches(1.6), Inches(1.8), Inches(2.2), Inches(1.2)]
    )
    
    # 三、核心接口规范：接收大模型答复接口
    p_h3 = doc.add_paragraph()
    style_heading_1(p_h3, "三、核心接口规范：接收大模型答复接口")
    add_body_p(doc, "本接口由发票云系统提供，供第三方大模型服务/外部智能体主动调用，以回传生成的回答文本。")
    
    p_sub31 = doc.add_paragraph()
    style_heading_2(p_sub31, "3.1 请求方式与报文头")
    add_body_p(doc, "POST", "• 请求方法：")
    add_body_p(doc, "application/json; charset=utf-8", "• Content-Type：")
    add_body_p(doc, "免鉴权直接调用（生产环境如需配置 API Key 签名，请与技术对接人确认）", "• 认证方式：")
    
    p_sub32 = doc.add_paragraph()
    style_heading_2(p_sub32, "3.2 请求参数说明（Body JSON）")
    add_custom_table(
        doc,
        ["参数名", "数据类型", "是否必填", "最大长度", "参数说明与示例"],
        [
            ["session_id", "string", "是", "64", "当前接待会话编号，必须与系统推送提问时的 session_id 保持完全一致。\n示例：ZXHH202609240001"],
            ["content", "string", "是", "5000", "大模型生成的回复文本内容，支持换行符 \\n、Markdown 基础语法与 Emoji 表情符号。\n示例：您好！发票冲红请先核对原发票状态..."],
            ["sender_name", "string", "否", "50", "会话窗口展示给客户的气泡发送人昵称。若不传，系统自动使用当前分配的智能体名称或‘智能助手’。\n示例：数电发票专家 Agent"],
            ["agent_code", "string", "否", "32", "智能体业务编号，由系统出站推送时带入。\n示例：AGENT0001"]
        ],
        [Inches(1.2), Inches(0.9), Inches(0.9), Inches(0.9), Inches(2.6)]
    )
    
    p_sub33 = doc.add_paragraph()
    style_heading_2(p_sub33, "3.3 请求报文示例（JSON Payload）")
    req_json = """{
  "session_id": "ZXHH202609240001",
  "content": "您好！关于您咨询的电子发票冲红问题，解决方案如下：\\n1. 请检查原发票开具日期是否处于跨月状态；\\n2. 确认税局端连接状态正常后重新同步发票信息。\\n\\n如需进一步协助，可随时提问或回复‘未解决’为您转接人工坐席。",
  "sender_name": "数电发票专家 Agent",
  "agent_code": "AGENT0001"
}"""
    add_code_block(doc, req_json)
    
    p_sub34 = doc.add_paragraph()
    style_heading_2(p_sub34, "3.4 响应参数说明")
    add_body_p(doc, "接口调用成功时返回 HTTP 200 OK，返回体为 JSON 对象：")
    add_custom_table(
        doc,
        ["返回字段", "数据类型", "说明"],
        [
            ["ok", "boolean", "操作结果标志，成功固定返回 true"],
            ["message_id", "integer", "该条回复在发票云系统中生成的全局唯一消息主键 ID"],
            ["session_id", "string", "本次答复归属的接待会话编号"],
            ["sender_name", "string", "实际写入并在客户会话窗口展示的发送者昵称"],
            ["created_at", "string", "消息入库成功的 UTC 时间戳 (ISO 8601 标准)"]
        ],
        [Inches(1.5), Inches(1.2), Inches(3.8)]
    )
    
    p_sub35 = doc.add_paragraph()
    style_heading_2(p_sub35, "3.5 成功响应报文示例")
    resp_json = """{
  "ok": true,
  "message_id": 10528,
  "session_id": "ZXHH202609240001",
  "sender_name": "数电发票专家 Agent",
  "created_at": "2026-09-24T16:15:30.123456Z"
}"""
    add_code_block(doc, resp_json)
    
    p_sub36 = doc.add_paragraph()
    style_heading_2(p_sub36, "3.6 状态码与异常响应说明")
    add_custom_table(
        doc,
        ["HTTP 状态码", "错误响应体示例", "触发原因", "第三方处理对策"],
        [
            [
                "200 OK",
                "{\"ok\": true, ...}",
                "答复成功写入并展示",
                "正常流程完成"
            ],
            [
                "404 Not Found",
                "{\"detail\": \"会话不存在\"}",
                "session_id 无效或已在数据库清理",
                "检查传入的会话编号是否正确，放弃重试"
            ],
            [
                "400 Bad Request",
                "{\"detail\": \"当前会话已结束，不可追加消息\"}",
                "客户已主动点击【结束服务】、转人工或已结单",
                "业务正常结束，应立即终止后续所有重试"
            ],
            [
                "422 Unprocessable",
                "{\"detail\": [{\"loc\": [\"body\", \"content\"], ...}]}",
                "请求 JSON 缺少必填参数或字段类型错误",
                "检查请求体中 session_id 和 content 是否完整"
            ]
        ],
        [Inches(1.2), Inches(2.0), Inches(1.7), Inches(1.6)]
    )
    
    # 四、前置出站推送参考
    p_h4 = doc.add_paragraph()
    style_heading_1(p_h4, "四、前置：发票云推送客户提问给第三方的格式（出站推送）")
    add_body_p(
        doc,
        "当在发票云【智能体接待配置】抽屉中为智能体配置了【消息推送地址】后，"
        "每当客户在咨询界面发送一条新消息，发票云系统都会自动向该地址发起 HTTP POST 请求，格式如下："
    )
    add_custom_table(
        doc,
        ["推送字段", "数据类型", "说明"],
        [
            ["session_id", "string", "接待会话编号，第三方必须提取并在调用回复接口时原样传回"],
            ["message", "string", "客户发起的原始咨询文本内容"],
            ["agent_code", "string", "当前接待智能体编号（如 AGENT0001）"],
            ["agent_name", "string", "当前智能体名称（如 数电发票专家 Agent）"],
            ["company_name", "string", "客户所在企业名称（已认证企业带出，未认证为空）"],
            ["timestamp", "string", "提问时间戳 (ISO 8601 UTC)"]
        ],
        [Inches(1.5), Inches(1.2), Inches(3.8)]
    )
    out_json = """{
  "session_id": "ZXHH202609240001",
  "message": "请问电子发票冲红提示‘原发票状态不正确’怎么处理？",
  "agent_code": "AGENT0001",
  "agent_name": "数电发票专家 Agent",
  "company_name": "深圳市某某电子商务科技有限公司",
  "timestamp": "2026-09-24T16:15:00.000Z"
}"""
    add_code_block(doc, out_json)
    
    # 五、多语言接入代码示例
    p_h5 = doc.add_paragraph()
    style_heading_1(p_h5, "五、多语言对接代码示例（基于 UAT 环境）")
    
    p_c51 = doc.add_paragraph()
    style_heading_2(p_c51, "5.1 cURL 命令行调试")
    curl_code = """curl -X POST "http://dl.piaozone.com:18025/ticket-hub-uat/api/reception/webhook/llm-reply" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "ZXHH202609240001",
    "content": "您好！这是由第三方大模型推送至发票云客户端的专业解答内容。",
    "sender_name": "数电发票专家 Agent",
    "agent_code": "AGENT0001"
  }'"""
    add_code_block(doc, curl_code)
    
    p_c52 = doc.add_paragraph()
    style_heading_2(p_c52, "5.2 Python (requests) 示例")
    py_code = """import requests

# UAT 预发环境公网接口地址
UAT_URL = "http://dl.piaozone.com:18025/ticket-hub-uat/api/reception/webhook/llm-reply"

def push_llm_reply(session_id: str, reply_content: str, agent_name: str = "AI 专家助手"):
    payload = {
        "session_id": session_id,
        "content": reply_content,
        "sender_name": agent_name
    }
    try:
        response = requests.post(UAT_URL, json=payload, timeout=5.0)
        if response.status_code == 200:
            print("【发票云】答复推送成功:", response.json())
        elif response.status_code == 400:
            print("【发票云】会话已结束或已离线，放弃重试:", response.json())
        else:
            print(f"【发票云】请求异常 [{response.status_code}]:", response.text)
    except requests.RequestException as e:
        print("【发票云】网络请求发生异常:", e)

# 调用测试
if __name__ == "__main__":
    push_llm_reply("ZXHH202609240001", "这是大模型异步计算完毕后回传的回答。")"""
    add_code_block(doc, py_code)
    
    p_c53 = doc.add_paragraph()
    style_heading_2(p_c53, "5.3 Java (OkHttp) 示例")
    java_code = """import okhttp3.*;
import java.io.IOException;

public class FaPiaoYunBotReplyClient {
    private static final OkHttpClient client = new OkHttpClient();
    // UAT 预发环境公网接口地址
    private static final String UAT_URL = 
        "http://dl.piaozone.com:18025/ticket-hub-uat/api/reception/webhook/llm-reply";

    public static void pushReply(String sessionId, String content, String agentName) {
        String jsonBody = String.format("{\\"session_id\\":\\"%s\\",\\"content\\":\\"%s\\",\\"sender_name\\":\\"%s\\"}",
                sessionId, content.replace("\"", "\\\""), agentName);

        RequestBody body = RequestBody.create(jsonBody, MediaType.get("application/json; charset=utf-8"));
        Request request = new Request.Builder().url(UAT_URL).post(body).build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                System.err.println("发票云回调推送网络异常: " + e.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful()) {
                    System.out.println("答复成功推送到发票云: " + response.body().string());
                } else if (response.code() == 400) {
                    System.out.println("会话已结束，不可追加消息，终止重试。");
                } else {
                    System.err.println("推送返回非200状态码: " + response.code());
                }
            }
        });
    }
}"""
    add_code_block(doc, java_code)
    
    p_c54 = doc.add_paragraph()
    style_heading_2(p_c54, "5.4 Node.js / TypeScript (axios) 示例")
    ts_code = """import axios from "axios";

// UAT 预发环境公网接口地址
const UAT_URL = "http://dl.piaozone.com:18025/ticket-hub-uat/api/reception/webhook/llm-reply";

interface LlmReplyPayload {
  session_id: string;
  content: string;
  sender_name?: string;
  agent_code?: string;
}

export async function pushLlmReply(payload: LlmReplyPayload) {
  try {
    const res = await axios.post(UAT_URL, payload, { timeout: 5000 });
    console.log("发票云接收答复成功:", res.data);
    return res.data;
  } catch (error: any) {
    if (error.response?.status === 400) {
      console.warn("发票云会话已结束，停止重试");
    } else {
      console.error("答复推送失败:", error.message);
    }
    throw error;
  }
}"""
    add_code_block(doc, ts_code)
    
    # 六、对接最佳实践与常见问题解答
    p_h6 = doc.add_paragraph()
    style_heading_1(p_h6, "六、对接最佳实践与常见问题解答 (FAQ)")
    
    p_faq1 = doc.add_paragraph()
    style_heading_2(p_faq1, "6.1 会话生命周期与 400 状态码处理")
    add_body_p(
        doc,
        "当在线咨询客户主动关闭浏览器页面、点击【结束服务】或者由人工客服完成结单/转为售后工单时，"
        "该会话的状态将被置为 closed 或 converted。"
        "此时若第三方大模型继续调用接收答复接口，接口将返回 400 Bad Request（{\"detail\": \"当前会话已结束，不可追加消息\"}）。"
        "第三方服务收到 400 状态码时，应视为正常业务边界终止，请立即丢弃当前消息，切勿发起无限重试。"
    )
    
    p_faq2 = doc.add_paragraph()
    style_heading_2(p_faq2, "6.2 转人工引导话术建议")
    add_body_p(
        doc,
        "若大模型在推理过程中发现客户问题超出业务知识边界，或由于置信度过低无法给出准确答复，"
        "建议在回复内容末尾附加如下标准引导提示："
    )
    add_callout(
        doc,
        "推荐引导文案",
        "如上述解答未能完全解决您的问题，您可以随时回复‘未解决’申请转接人工坐席协助处理。"
    )
    add_body_p(
        doc,
        "发票云客户端收到客户回复‘未解决’后，系统将实时触发在岗探针检测（校验人工客服是否在工作时段且有在线坐席），"
        "满足条件时自动为客户无缝转接人工，不满足条件时引导一键提交工单，从而形成完善的服务闭环。"
    )
    
    p_faq3 = doc.add_paragraph()
    style_heading_2(p_faq3, "6.3 内容格式与排版规范")
    add_body_p(
        doc,
        "发票云客户聊天窗口原生支持 UTF-8 字符集、Emoji 表情、自然换行符 \\n 以及基础 Markdown 语法（如加粗 **强调**、有序列表与无序列表等）。"
        "请勿在 content 字段中混入未经处理的复杂 HTML 原生标签或二进制文件流，如需推送图片请以图文说明链接方式呈现。"
    )
    
    p_faq4 = doc.add_paragraph()
    style_heading_2(p_faq4, "6.4 网络重试与幂等建议")
    add_body_p(
        doc,
        "若遇网络闪断或超时，第三方可在 30 秒内进行有限重试（建议最多重试 2 次，采用指数退避策略）。"
        "系统将对每次有效调用生成唯一的 message_id 并记录时间，建议在业务层做好单次提问的消息去重。"
    )
    
    # 保存文档到指定路径
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_files = [
        os.path.join(base_dir, "接收大模型答复接.docx"),
        os.path.join(base_dir, "接收大模型答复接口.docx"),
        os.path.join(base_dir, "docs/spec/接收大模型答复接.docx"),
        os.path.join(base_dir, "docs/spec/接收大模型答复接口.docx"),
    ]
    for path in target_files:
        doc.save(path)
        print(f"Successfully generated official Word docx at: {path}")

if __name__ == "__main__":
    generate_document()
