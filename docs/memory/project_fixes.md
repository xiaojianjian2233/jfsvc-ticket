---
name: project-fixes
description: 已修复的兼容性问题和根因
metadata: 
  node_type: memory
  type: project
  originSessionId: e1d618c3-a67f-419c-9a88-588833782e7f
---

## FastAPI/Starlette 兼容性修复（2026-06-28）

**问题**：pip 装了最新 FastAPI 0.138.1 + Starlette 1.x，导致两个问题：
1. 同步路由 + `Depends(get_session)` 在 async middleware 里报 `can't start new thread`
2. `status_code=204` 路由报 `AssertionError: Status code 204 must not have a response body`

**根因**：Rocky Linux 9 的 Docker seccomp profile 限制了 `clone()` 系统调用，导致容器内完全无法创建线程。FastAPI 在处理同步依赖时需要线程池，于是报错。

**修复**：
- `pyproject.toml` 固定 `fastapi==0.115.14`
- `docker-compose.yml` 加 `security_opt: seccomp=unconfined`
- `auth.py` feishu_callback 改为 `async def` + `make_session()`
- 9 个 DELETE 路由返回显式 `Response(status_code=204)`

**Why**: seccomp 是根本原因，FastAPI 版本固定是防止将来升级再出问题。

## 飞书 SSO 回调 coroutine bug（同次修复）

**问题**：服务器旧代码里 `issue_jwt` 是 `async def` 但调用时没有 `await`，导致 token 变成 `<coroutine object>` 拼入重定向 URL。
**修复**：整体同步化 + 上述 async 改造一并解决。

## PG 连接 no encryption 错误（2026-07-01）

**问题**：容器通过宿主机公网 IP `106.55.57.40` 连 PostgreSQL，pg_hba.conf 用 `scram-sha-256` 要求加密，但 psycopg3 默认非加密，报 `no pg_hba.conf entry for host ... no encryption`。

**修复**：
1. PG_DSN 加 `sslmode=disable`
2. pg_hba.conf 把 `172.16.0.0/12` 和 `106.55.57.40/32` 的认证方式改为 `md5`
3. 用 `pg_reload_conf()` 热重载（psql 路径：`/usr/local/pgsql/bin/psql`）

**Why**: pg_hba.conf `scram-sha-256` 要求 SSL，容器不走 SSL，必须改为 `md5` 或在 DSN 加 `sslmode=require`。

## 工单列表快捷统计口径统一（2026-09-17）

**问题**："绿色战略客户"、"今日新增工单"、"超时未关闭工单"三个快捷入口的数字此前取自前端当前页 50 条记录；超时统计还会把已完成工单算进去，且“今日”前后端时区不一致。

**修复**：新增 `GET /api/tickets/quick-stats`，由后端按当前用户可见范围返回全量统计；“今日”固定按北京时间当天 00:00 至次日 00:00；超时统计与 `quick_filter=overdue` 共用 SLA 判定，排除所有终态工单。

**补充**：快捷标签点击时会清除遗留的 URL 条件、表头本地筛选和选中项，并回到第 1 页；同时显式取消默认处理状态限制，保证快捷标签的徽标和列表使用相同的全量口径。

## 工单列表问题描述为空（2026-09-18）

**问题**：工单详情接口包含 `body`（问题描述），但列表摘要模型未返回该字段；前端列表即使配置了“问题描述”列，也只能显示为空。

**修复**：将 `body` 纳入 `TicketSummary`，使列表和详情共用同一问题描述字段；同步更新 OpenAPI 前端类型，并增加列表接口回归断言。

## PostgreSQL 工单列表统计性能优化（2026-09-18）

**问题**：快捷统计和“超时未关闭”筛选在 PostgreSQL 环境先读取大量记录、再由 Python 逐条计算 SLA，列表筛选时会造成明显等待。

**修复**：PostgreSQL 改由数据库执行 SLA 超时条件和三项快捷统计聚合；SQLite 测试环境保留原有兼容实现。UAT 验证超时筛选从约 1.6 秒降至约 43–53 毫秒，统计口径保持一致。

## 工单产品分类与主产品字段统一（2026-09-18）

**用户要求**：工单列表“产品分类”展示产品线中文名称；所有来源系统都不得把原始产品分类、问题模块直接作为生效值，必须展示系统分析结果；`TicketDetail.product_name` 与 `TicketSummary.product_name` 统一表示“主产品”。

**修复**：
- 列表接口新增 `product_line_name`，由 `product_lines.name` 批量解析，前端“产品分类”只展示中文名称。
- KSM、智齿、Zammad、AI 客服、飞书 AI 入库时不再把来源产品/模块写入 `ticket.product_line_code/module`；原值仅保留在审计载荷或 KSM 原始字段中。
- 产品模块归类链不再使用来源分类做锁线、精确或相似匹配，只采信 AI 对系统有效目录的判断；AI 不确定或不可用时使用系统统一兜底。
- 未经过系统归类且未关联 Hub 任务的历史工单不再展示旧来源分类，归类完成前显示为空。
- `TicketDetail.product_name` 与列表口径统一：KSM 取 `version.mainproductname` 原样值，其它来源留空；详情页不再把该字段作为产品分类编码兜底。

## KSM 异步入库异常日志与短码冲突修复（2026-09-18）

**问题**：KSM 推送已返回成功，但部分工单未入库；根因是短码生成使用 `tickets.count() + 1`，历史短码断档时生成已存在的短码，触发 `tickets_short_code_key` 唯一约束冲突。

**修复**：
- 异步入库异常日志补充 billId、notice、入库阶段、异常类型、消息和完整 traceback。
- 短码生成改为按已有最大数字递增，并在返回前检查占用短码、自动跳过冲突值。
- 增加短码生成回归测试，验证历史短码不连续时仍生成可用短码。

## 工单转派权限与列表分页优化（2026-09-20）

**修复**：
- 工单详情页允许 `assignee` 处理人转派自己负责的工单，主管/管理员仍可转派任意工单。
- 工单列表页允许 `assignee` 仅勾选并批量移交自己负责的工单。
- 列表分页默认每页 20 条，可切换为 50/100 条，选择保存在 URL 参数中并在刷新后保持。

## 在线接待登录用户字段修复（2026-09-22）

**问题**：在线接待工作台的“挂起会话”和“转工单”接口读取 `AuthedUser.id`，但登录用户对象只提供 `user_id`，调用时触发 `AttributeError` 并返回 HTTP 500；“转工单”接口还误用了不存在的请求模型 `ConvertTicketBody`，导致合法请求返回 HTTP 422。

**修复**：两处坐席查询统一改用 `user.user_id`，与其它接待接口和鉴权模型字段保持一致；转工单请求模型改为已定义且与前端契约一致的 `TransferTicketBody`，并通过接待工作台全流程回归测试。

## KSM 退回后被误重新接管（2026-09-24）

**问题**：工单调用 `returnKsmOrder` 成功后，KSM 会紧接着回推两条 `status=2` 的流转通知。入站逻辑把「已退回后的任意非 4/6 回推」都视为真实重新分派，将本地状态从 `transferred_return` 恢复为 `processing`，随后又执行 `lockKsmOrder`/`handleKsmOrder`，把 KSM 节点从退回目标拽回「协同处理」。

**修复**：
- 退回成功后在 return outbox 中记录退回源节点、目标节点以及当时的产品/版本/模块 id。
- 已退回工单收到回推时，若仍在退回目标节点且目录未变，判定为退回回声，保持 `transferred_return/returned` 且禁止重新接管。
- 节点真正离开退回目标，或产品/模块确实变更时，仍允许原有重新接入流程。
- 接管阶段按 ticket 增加 PostgreSQL 事务级串行锁，避免同一 bill 的并发回推重复 `lock/handle`。

**验证**：KSM 退回、回推、接管相关回归测试通过；后端完整单测 `1568 passed`。

## 智齿来源工单号与提单产品映射修复（2026-09-28）

**问题**：智齿工单此前把内部 `ticketid` 同时作为页面“来源工单号”，且“提单产品”没有稳定的跨来源落库字段，导致列表展示 UUID、智齿产品为空。

**修复**：
- 保留 `ticketid` 作为智齿内部去重和出站回写 ID；页面“来源工单号”改为落库 `ticket_code`。
- “提单产品”按 `extend_fields_list` 中固定 `fieldid=c70e65964c714dde8817983b2d3b710d` 精确取值，优先保存可读的 `field_text`，缺失时回退 `field_value`。
- 新增跨来源 `tickets.source_product_name` 字段；KSM 同步写入原 `version.mainproductname`，迁移时回填已有 KSM 数据，列表和详情统一由该字段输出 `product_name`。
- 智齿历史工单再次推送时同步补齐来源工单号和提单产品，不改变原有去重键。

**验证**：智齿入库与工单接口 97 项、KSM 入库 34 项通过；迁移链最新版本为 `0058_ticket_source_product_name`。

## 飞书内部提单责任田与来源筛选优化（2026-10-09）

**问题 1**：飞书内部提单按产品分类、问题模块匹配责任田时，同一个中文产品名可能命中多条历史产品线/模块记录；旧逻辑直接取数据库返回的第一条，可能优先命中停用记录，导致责任人为空且未转产研。

**修复 1**：责任田匹配只从“产品线启用且模块启用”的记录中选择；全部禁用时保持责任人为空，仅一条启用时采用该条，多条启用时按模块记录 id 升序稳定取第一条。

**问题 2**：工单列表把 `ai_cs` 和 `feishu_ai` 都展示为“内部提单”，但筛选“内部提单”只传 `ai_cs`，造成真正的飞书内部提单无法查询。

**修复 2**：统一来源口径：`feishu_ai` 为内部提单；在线接待转工单 `ai_cs` 与 `zammad` 为外部提单。来源筛选改为分组展开：内部提单查询 `feishu_ai`，外部提单查询 `ai_cs + zammad`；列表和详情展示同步使用相同口径。

**验证**：飞书入库后端相关 20 项测试通过；工单列表和详情前端 57 项测试、TypeScript 类型检查通过。
