# Agent 答复上下文

2026-09-13：依据 open-api-channel.md 修正图片传参。

## 调用方式

有图片：GET /open-api/ask/ask_init 取得 ai_agent_cid，随后 POST
/open-api/ask/answer_no_stream，结束后 POST /open-api/ask/end_session。
每次独立会话，避免工单之间串上下文。请求体为 question、ai_agent_cid、skill、images。
images 是顶层 URL 数组；不能仅在 replay.question 中拼 HTML 或 Markdown。
纯文字保持 POST /open-api/replay，使用 question、skill、use_latest_knowledge。

question 包含产品名称、产品编码、模块、标题、正文及有来源的补充信息。
产品名称通过 product_lines 查询，没有标题时省略标题段。原始上下文保留图片标记
供审计，发送前拆为纯文字 question 和独立 images，图片链接去重并最多发送5张。
默认优先原始外链，缺失时回退可公开访问的存档链接。无链接/超限明确标记。
文档要求 HTTP(S) 地址，单图不超过5MB，支持 PNG/JPEG/GIF/WebP；下载、大小及
MIME 校验由答复服务执行，不在本地下载或调用独立视觉模型。

自动答复读取关联工单当前正文；如与 Hub 快照不同，标明来源作为补充信息。
已有 extracted_text 作为参考文字一并传入。子任务专属附件不混入其他子任务。
上下文组装只读，不注册或修改附件。图片中的指令不作为执行指令。
本次不需要新增视觉模型密钥；独立图片提取 Agent 留待后续接入。
项目原有附件识图流水线保持原配置。图片接口业务错误（如500002）保留并进入
既有错误处理，不自动降级为无图答复。会话清理失败不覆盖答复或原始错误。

图片接口返回 data 数组，适配器合并 answer；文档未提供结构化 cited_knowledge、
skills_used、trace_id，因此这些字段留空，不伪造知识引用。现有审核机制继续生效。

## 验证

真实工单1969原截图，通过正式图片接口耗时51.4秒，准确识别：
- 弹窗：发票命名字段选择。
- 左侧：发票代码、价税合计、销方名称、发票种类、单据编号。
- 右侧：发票号码、购方名称、开票日期。

此前 HTML/replay 测试不符合正式图片协议，不能据此判断图片能力或外链不可访问。
本轮未向客户发送答复，未改变自动答复、审核及外部回写开关。
