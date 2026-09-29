import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";

export default defineConfig({
  // Serve from sub-path when deployed (e.g. https://yjcj.online/ticket-hub/).
  // VITE_PUBLIC_BASE controls the base path for static asset URLs.
  // VITE_API_BASE (read in src/api/client.ts) controls API call prefix.
  base: process.env.VITE_PUBLIC_BASE || "/",
  plugins: [
    react(),
    {
      name: "enterprise-title-search-proxy",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url && req.url.startsWith("/api/reception/client/search-enterprises")) {
            const urlObj = new URL(req.url, "http://localhost");
            const kw = (urlObj.searchParams.get("keyword") || "").trim();
            if (!kw) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify([]));
              return;
            }

            try {
              let clientId = process.env.COMPANY_TITLE_CLIENT_ID || "";
              let clientSecret = process.env.COMPANY_TITLE_CLIENT_SECRET || "";
              if (!clientId || !clientSecret) {
                const configPath = path.resolve(__dirname, "../backend/app/piaozone_config.json");
                if (fs.existsSync(configPath)) {
                  try {
                    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                    clientId = clientId || cfg.company_title?.client_id || "";
                    clientSecret = clientSecret || cfg.company_title?.client_secret || "";
                  } catch {
                    // ignore
                  }
                }
              }
              const t = Date.now().toString();
              const raw = [clientSecret, t, clientId].sort().join("");
              const token = crypto.createHash("sha1").update(raw).digest("hex");
              const targetUrl = `https://title.piaozone.com/bill/query/querytitles?t=${t}&clientId=${clientId}&token=${token}&name=${encodeURIComponent(kw)}`;

              const resp = await fetch(targetUrl);
              if (resp.ok) {
                const data: any = await resp.json();
                const items = data.result || data.data || [];
                const results = [];
                const seen = new Set();
                for (const item of items) {
                  const name = (item.name || "").trim();
                  const creditCode = (item.creditCode || item.taxNo || "").trim();
                  if (name && !seen.has(name)) {
                    seen.add(name);
                    results.push({
                      company_name: name,
                      tax_no: creditCode,
                      status: "存续",
                    });
                  }
                }
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(results));
                return;
              }
            } catch (err) {
              console.error("[vite] enterprise-title-search failed:", err);
            }
          }
          next();
        });
      },
    },
    {
      name: "reception-notices-dev-server",
      configureServer(server) {
        const storeFile = path.resolve(__dirname, "./.reception_notices_dev.json");
        const defaultNotices = [
          {
            id: 1,
            notice_no: "INF202609210001",
            title: "关于数电发票乐企直连通道升级维护的通知",
            content:
              "尊敬的纳税人用户：为了提供更稳定优质的数电发票乐企对接服务，国家税务总局定于本周五晚 22:00 至周六早 06:00 进行乐企平台与电子底账系统底层升级。升级期间开票、受票及勾选认证服务可能出现短时响应延迟或连接波动。建议各企业财务提前做好发票开具与勾选安排，紧急开票可使用离线开票备用模式。升级完成后服务将自动恢复，如有疑问请随时联系本在线技术支持团队。",
            start_time: "2026-09-20 00:00:00",
            end_time: "2026-09-30 23:59:59",
            start_date: "2026-09-20",
            end_date: "2026-09-30",
            popup_prompt: true,
            status: "published",
            effective_status: "published",
            created_by: "杨慧莉",
            created_at: "2026-09-20 09:30:00",
            updated_by: "杨慧莉",
            updated_at: "2026-09-20 09:30:00",
          },
          {
            id: 2,
            notice_no: "INF202609180002",
            title: "金蝶发票云 2026 年第 3 季度征期服务保障方案",
            content:
              "为全力保障 9 月大征期期间企业税控与数电发票系统平稳运行，金蝶发票云售后技术团队已启动 7×24 小时征期应急响应机制。专家坐席全量在线，针对批量开票卡顿、税控盘升级校验、红字信息表开具异常等常见问题提供 1 对 1 快速排障支持，确保企业纳税申报与发票交付万无一失。",
            start_time: "2026-09-18 00:00:00",
            end_time: "2026-09-28 23:59:59",
            start_date: "2026-09-18",
            end_date: "2026-09-28",
            popup_prompt: false,
            status: "published",
            effective_status: "published",
            created_by: "杨慧莉",
            created_at: "2026-09-18 08:30:00",
            updated_by: "杨慧莉",
            updated_at: "2026-09-18 08:30:00",
          },
          {
            id: 3,
            notice_no: "INF202609100003",
            title: "发票云在线技术支持客户端全面升级公告",
            content:
              "发票云在线技术支持客户端已全面完成升级，支持历史会话无缝续接、多企业身份快速切换、工单进度实时追踪及图文附件拖拽发送。同时新增重要通知实时播报面板，欢迎广大企业客户体验更高效、敏捷的专家支持服务！",
            start_time: "2026-09-01 00:00:00",
            end_time: "2026-09-15 23:59:59",
            start_date: "2026-09-01",
            end_date: "2026-09-15",
            popup_prompt: false,
            status: "unpublished",
            effective_status: "unpublished",
            created_by: "管理员",
            created_at: "2026-09-01 10:00:00",
            updated_by: "管理员",
            updated_at: "2026-09-15 23:59:59",
          },
        ];

        const loadStore = (): any[] => {
          try {
            if (fs.existsSync(storeFile)) {
              const content = fs.readFileSync(storeFile, "utf-8");
              return JSON.parse(content);
            }
          } catch {
            // ignore
          }
          try {
            fs.writeFileSync(storeFile, JSON.stringify(defaultNotices, null, 2), "utf-8");
          } catch {
            // ignore
          }
          return defaultNotices;
        };

        const saveStore = (items: any[]) => {
          try {
            fs.writeFileSync(storeFile, JSON.stringify(items, null, 2), "utf-8");
          } catch (err) {
            console.error("[vite] save notices error:", err);
          }
        };

        const parseBody = (req: any): Promise<any> => {
          return new Promise((resolve) => {
            let data = "";
            req.on("data", (chunk: any) => {
              data += chunk;
            });
            req.on("end", () => {
              try {
                resolve(data ? JSON.parse(data) : {});
              } catch {
                resolve({});
              }
            });
          });
        };

        server.middlewares.use(async (req, res, next) => {
          const urlStr = req.url || "";
          if (!urlStr.startsWith("/api/reception/notices") && !urlStr.startsWith("/api/reception/client/notices")) {
            next();
            return;
          }

          const urlObj = new URL(urlStr, "http://localhost");
          const pathname = urlObj.pathname;
          const method = (req.method || "GET").toUpperCase();

          res.setHeader("Content-Type", "application/json; charset=utf-8");

          // 1. 客户端获取通知列表：GET /api/reception/client/notices
          if (pathname === "/api/reception/client/notices" && method === "GET") {
            const list = loadStore();
            const now = new Date().toISOString().slice(0, 10);
            const published = list
              .filter((n) => {
                if (n.status !== "published" && n.effective_status !== "published") return false;
                const s = n.start_date || (n.start_time ? n.start_time.slice(0, 10) : "");
                const e = n.end_date || (n.end_time ? n.end_time.slice(0, 10) : "");
                if (s && s > now) return false;
                if (e && e < now) return false;
                return true;
              })
              .map((n) => ({
                id: n.notice_no || String(n.id),
                title: n.title,
                content: n.content,
                is_important: true,
                publish_time:
                  n.start_date || (n.start_time ? n.start_time.slice(0, 16) : "") || (n.created_at || "").slice(0, 16),
                publisher: n.created_by || "发票云服务团队",
                category: "系统公告",
                popup_prompt: !!n.popup_prompt,
              }));
            res.end(JSON.stringify(published));
            return;
          }

          // 2. 批量上架：POST /api/reception/notices/batch-publish
          if (pathname === "/api/reception/notices/batch-publish" && method === "POST") {
            const body = await parseBody(req);
            const ids: number[] = body.ids || [];
            const list = loadStore();
            const updated = list.map((item) =>
              ids.includes(item.id)
                ? { ...item, status: "published", effective_status: "published", updated_at: new Date().toISOString().slice(0, 19).replace("T", " ") }
                : item
            );
            saveStore(updated);
            res.end(JSON.stringify({ success: true, count: ids.length }));
            return;
          }

          // 3. 批量下架：POST /api/reception/notices/batch-unpublish
          if (pathname === "/api/reception/notices/batch-unpublish" && method === "POST") {
            const body = await parseBody(req);
            const ids: number[] = body.ids || [];
            const list = loadStore();
            const updated = list.map((item) =>
              ids.includes(item.id)
                ? { ...item, status: "unpublished", effective_status: "unpublished", updated_at: new Date().toISOString().slice(0, 19).replace("T", " ") }
                : item
            );
            saveStore(updated);
            res.end(JSON.stringify({ success: true, count: ids.length }));
            return;
          }

          // 4. 批量删除：POST /api/reception/notices/batch-delete
          if (pathname === "/api/reception/notices/batch-delete" && method === "POST") {
            const body = await parseBody(req);
            const ids: number[] = body.ids || [];
            const list = loadStore();
            const filtered = list.filter((item) => !ids.includes(item.id));
            saveStore(filtered);
            res.end(JSON.stringify({ success: true, count: ids.length }));
            return;
          }

          // 5. 单条详情：GET /api/reception/notices/:id
          const idMatch = pathname.match(/^\/api\/reception\/notices\/(\d+)$/);
          if (idMatch && method === "GET") {
            const id = Number(idMatch[1]);
            const list = loadStore();
            const found = list.find((item) => item.id === id);
            if (found) {
              res.end(JSON.stringify(found));
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ detail: "通知不存在" }));
            }
            return;
          }

          // 6. 单条更新：PUT /api/reception/notices/:id
          if (idMatch && method === "PUT") {
            const id = Number(idMatch[1]);
            const body = await parseBody(req);
            const list = loadStore();
            const idx = list.findIndex((item) => item.id === id);
            if (idx >= 0) {
              const current = list[idx];
              const now = new Date().toISOString().slice(0, 19).replace("T", " ");
              const updated = {
                ...current,
                title: body.title !== undefined ? body.title : current.title,
                content: body.content !== undefined ? body.content : current.content,
                start_date: body.start_date || (body.start_time ? body.start_time.slice(0, 10) : current.start_date),
                end_date: body.end_date || (body.end_time ? body.end_time.slice(0, 10) : current.end_date),
                start_time: body.start_time || (body.start_date ? `${body.start_date} 00:00:00` : current.start_time),
                end_time: body.end_time || (body.end_date ? `${body.end_date} 23:59:59` : current.end_time),
                popup_prompt: body.popup_prompt !== undefined ? body.popup_prompt : current.popup_prompt,
                updated_at: now,
                updated_by: "当前坐席",
              };
              list[idx] = updated;
              saveStore(list);
              res.end(JSON.stringify(updated));
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ detail: "通知不存在" }));
            }
            return;
          }

          // 7. 新建通知：POST /api/reception/notices
          if (pathname === "/api/reception/notices" && method === "POST") {
            const body = await parseBody(req);
            const list = loadStore();
            const now = new Date();
            const pad = (n: number) => String(n).padStart(2, "0");
            const y = now.getFullYear();
            const m = pad(now.getMonth() + 1);
            const d = pad(now.getDate());
            const todayStr = `${y}${m}${d}`;
            const seq = list.length + 1;
            const noticeNo = `INF${todayStr}${String(seq).padStart(4, "0")}`;
            const nowStr = `${y}-${m}-${d} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

            const startDate = body.start_date || (body.start_time ? body.start_time.slice(0, 10) : `${y}-${m}-${d}`);
            const endDate = body.end_date || (body.end_time ? body.end_time.slice(0, 10) : `${y}-${m}-${d}`);
            const startTime = body.start_time || `${startDate} 00:00:00`;
            const endTime = body.end_time || `${endDate} 23:59:59`;

            const newItem = {
              id: Date.now(),
              notice_no: noticeNo,
              title: body.title,
              content: body.content,
              start_date: startDate,
              end_date: endDate,
              start_time: startTime,
              end_time: endTime,
              popup_prompt: !!body.popup_prompt,
              status: "published",
              effective_status: "published",
              created_by: "当前坐席",
              created_at: nowStr,
              updated_by: "当前坐席",
              updated_at: nowStr,
            };

            list.unshift(newItem);
            saveStore(list);
            res.end(JSON.stringify(newItem));
            return;
          }

          // 8. 通知列表：GET /api/reception/notices
          if (pathname === "/api/reception/notices" && method === "GET") {
            let list = loadStore();
            const statuses = urlObj.searchParams.getAll("statuses");
            const startTime = urlObj.searchParams.get("start_time");
            const endTime = urlObj.searchParams.get("end_time");

            if (statuses.length > 0 && !statuses.includes("all")) {
              const stSet = new Set(statuses);
              list = list.filter((item) => stSet.has(item.effective_status) || stSet.has(item.status));
            }
            if (startTime) {
              list = list.filter((item) => item.created_at >= startTime);
            }
            if (endTime) {
              list = list.filter((item) => item.created_at <= endTime);
            }

            list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
            res.end(JSON.stringify(list));
            return;
          }

          next();
        });
      },
    },
    {
      name: "open-api-channel-dev-server",
      configureServer(server) {
        const parseBody = (req: any): Promise<any> => {
          return new Promise((resolve) => {
            let data = "";
            req.on("data", (chunk: any) => {
              data += chunk;
            });
            req.on("end", () => {
              try {
                resolve(data ? JSON.parse(data) : {});
              } catch {
                resolve({});
              }
            });
          });
        };

        const devSessionsStoreFile = path.resolve(__dirname, "./.dev_reception_sessions.json");
        const loadDevSessions = (): {
          sessions: Record<string, any>;
          messages: Record<string, any[]>;
          cids: Record<string, string>;
        } => {
          try {
            if (fs.existsSync(devSessionsStoreFile)) {
              const raw = fs.readFileSync(devSessionsStoreFile, "utf-8");
              return JSON.parse(raw);
            }
          } catch (e: any) {
            console.warn(`[vite] loadDevSessions error: ${e.message}`);
          }
          return { sessions: {}, messages: {}, cids: {} };
        };

        const initialStored = loadDevSessions();
        const devSessions: Record<string, any> = initialStored.sessions || {};
        const devMessages: Record<string, any[]> = initialStored.messages || {};
        const sessionCidMap: Record<string, string> = initialStored.cids || {};

        // 数据迁移与清洗：剔除 session.agent_name 和 message.sender_name 中误存入的 base64 字符串
        for (const s of Object.values(devSessions)) {
          if (s) {
            if (s.agent_name && s.agent_name.startsWith("data:image/")) {
              const spaceIdx = s.agent_name.indexOf(" ");
              if (spaceIdx > 0) {
                if (!s.agent_avatar) s.agent_avatar = s.agent_name.slice(0, spaceIdx);
                s.agent_name = s.agent_name.slice(spaceIdx + 1).trim();
              }
            }
            if (s.agent_avatar && s.agent_avatar.startsWith("data:image/") && s.agent_avatar.length > 500) {
              s.agent_avatar = "🤖";
            }
          }
        }
        for (const msgs of Object.values(devMessages)) {
          if (Array.isArray(msgs)) {
            for (const m of msgs) {
              if (m && m.sender_name && m.sender_name.startsWith("data:image/")) {
                const spaceIdx = m.sender_name.indexOf(" ");
                if (spaceIdx > 0) {
                  if (!m.sender_avatar) m.sender_avatar = m.sender_name.slice(0, spaceIdx);
                  m.sender_name = m.sender_name.slice(spaceIdx + 1).trim();
                }
              }
              if (m && m.sender_avatar && m.sender_avatar.startsWith("data:image/") && m.sender_avatar.length > 500) {
                m.sender_avatar = "🤖";
              }
            }
          }
        }

        // 核心保障：确保测试会话 ZXHH202609283919 存在并绑定有效的大模型 CID
        if (!sessionCidMap["ZXHH202609283919"]) {
          sessionCidMap["ZXHH202609283919"] = "71dbed67deb447309fcba9308566ee1d";
        }
        if (!devSessions["ZXHH202609283919"]) {
          devSessions["ZXHH202609283919"] = {
            id: "ZXHH202609283919",
            ai_agent_cid: "71dbed67deb447309fcba9308566ee1d",
            company_name: "测试科技有限公司",
            tax_no: "91440300MA5XXXXXX1",
            contact_name: "测试用户",
            contact_phone: "13800138000",
            status: "in_progress",
            is_human: false,
            agent_id: "agent-invoice",
            agent_name: "🧾 数电发票专家",
            agent_avatar: "🧾",
            agent_skill: "customer-service",
            unread_count: 0,
            last_message: "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是数电发票智能专家，请问在发票开具、红字发票冲红或勾选抵扣中遇到什么问题？",
            created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
            updated_at: new Date().toISOString().replace("T", " ").slice(0, 19),
          };
        } else if (!devSessions["ZXHH202609283919"].ai_agent_cid) {
          devSessions["ZXHH202609283919"].ai_agent_cid = "71dbed67deb447309fcba9308566ee1d";
        }

        const saveDevSessions = () => {
          try {
            fs.writeFileSync(
              devSessionsStoreFile,
              JSON.stringify({ sessions: devSessions, messages: devMessages, cids: sessionCidMap }, null, 2),
              "utf-8"
            );
          } catch (e: any) {
            console.warn(`[vite] saveDevSessions error: ${e.message}`);
          }
        };
        saveDevSessions();

        let cachedToken = "";
        let tokenExpiresAt = 0;

        const botConfigStoreFile = path.resolve(__dirname, "./.bot-config-store.json");
        const defaultBotConfig = {
          agents: [
            {
              id: "agent-invoice",
              code: "AGENT0001",
              name: "数电发票专家",
              avatar: "🧾",
              agent_type: "normal",
              description: "精通数电发票开具、红字发票冲红、发票勾选抵扣与入账归档等业务",
              webhook_url: "",
              welcome_message: "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是数电发票智能专家，请问在发票开具、红字发票冲红或勾选抵扣中遇到什么问题？",
              unresolved_prompt: "抱歉没能解决您的数电发票问题，请问需要为您转接人工坐席或提交售后工单跟进吗？",
              system_prompt: "你是一名精通国家数电发票、电子发票服务平台规则的发票云业务专家。",
              skills: ["invoice-issuance", "red-invoice", "deduction-check"],
              product_lines: ["全部"],
              source_channels: ["全部"],
              support_transfer_human: true,
              transfer_human_rule: "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
              temperature: 0.2,
              is_enabled: false,
            },
            {
              id: "agent-tax",
              code: "AGENT0002",
              name: "税务申报专家",
              avatar: "💼",
              agent_type: "normal",
              description: "精通税企直连、税局认证、企业所得税与增值税申报接口相关疑问",
              webhook_url: "",
              welcome_message: "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是税务申报智能助手，请问有什么关于税局接口或纳税申报的问题需要解答？",
              unresolved_prompt: "税务规则复杂多变，未能解决您的申报疑问十分抱歉。",
              system_prompt: "你是一名资深税务申报与税局数据接口系统支持专家。",
              skills: ["tax-declaration", "tax-interfaces"],
              product_lines: ["全部"],
              source_channels: ["全部"],
              support_transfer_human: true,
              transfer_human_rule: "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
              temperature: 0.3,
              is_enabled: false,
            },
            {
              id: "agent-general",
              code: "AGENT0003",
              name: "综合服务助手",
              avatar: "🤖",
              agent_type: "fallback",
              description: "全能型发票云服务助手，负责通用产品功能咨询、账号权限与系统指引",
              webhook_url: "",
              welcome_message: "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，我是发票云智能综合助手，请问有什么可以帮您？",
              unresolved_prompt: "抱歉没能彻底解决您的问题。",
              system_prompt: "你是一名专业的发票云综合客服支持助手。",
              skills: ["general-guide", "account-perm"],
              product_lines: ["全部"],
              source_channels: ["全部"],
              support_transfer_human: true,
              transfer_human_rule: "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
              temperature: 0.3,
              is_enabled: true,
            },
          ],
          routing_rules: [
            {
              id: "rule-invoice",
              name: "数电与发票类咨询分流",
              target_agent_id: "agent-invoice",
              conditions: {
                match_mode: "any",
                product_keywords: ["数电票", "全电发票", "进销项", "发票云"],
                company_keywords: [],
                message_keywords: ["开票", "红字", "勾选", "作废", "差额征税", "纸电混合", "税控盘"],
              },
              is_enabled: true,
            },
            {
              id: "rule-tax",
              name: "税务申报与直连分流",
              target_agent_id: "agent-tax",
              conditions: {
                match_mode: "any",
                product_keywords: ["税企直连", "纳税申报", "税局端"],
                company_keywords: [],
                message_keywords: ["申报", "扣税", "税局", "认证", "增值税", "所得税", "接口超时"],
              },
              is_enabled: true,
            },
          ],
          default_agent_id: "agent-general",
          escalation_strategy: {
            enable_agent_reception: true,
            probe_working_hours: true,
            probe_human_agents: true,
            ask_transfer_text: "很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
            no_human_guide_text: "当前人工坐席均在忙碌中或已下班，建议您直接提交售后工单，我们将由技术专家加急排查并在第一时间答复您！",
            show_ticket_button: true,
          },
        };

        const loadBotConfig = () => {
          try {
            if (fs.existsSync(botConfigStoreFile)) {
              return JSON.parse(fs.readFileSync(botConfigStoreFile, "utf-8"));
            }
          } catch {}
          try {
            fs.writeFileSync(botConfigStoreFile, JSON.stringify(defaultBotConfig, null, 2), "utf-8");
          } catch {}
          return defaultBotConfig;
        };

        const saveBotConfig = (cfg: any) => {
          try {
            fs.writeFileSync(botConfigStoreFile, JSON.stringify(cfg, null, 2), "utf-8");
          } catch (e) {
            console.error("[vite] save bot config error:", e);
          }
        };

        const cleanBotAnswer = (raw: string): string => {
          if (!raw) return "";
          let text = raw;
          text = text.replace(
            /(?:\r?\n|\s)*(?:以上(?:回复|解答|内容)?是否(?:已经)?解决(?:您的问题|您的疑问)?[？?]?|请对本次解答进行评价[：:]?|请回复[：:]?)?(?:\r?\n|\s)*(?:1\s*[.、:： ]?\s*解决|1\s+解决)[\s\S]*?(?:2\s*[.、:： ]?\s*未解决|2\s+未解决)[\s\S]*$/i,
            ""
          );
          text = text.replace(/(?:\r?\n|\s)*(?:1\s*[.、:： ]?\s*解决|2\s*[.、:： ]?\s*未解决)[\s\S]*$/i, "");
          text = text.replace(/(?:\r?\n|\s)*以上(?:解答|回复)是否对您有帮助[？?]?[\s\S]*$/i, "");
          return text.trim();
        };

        const matchBotAgent = (purchasedProducts: string[] = [], channel = "", question = "") => {
          const cfg = loadBotConfig();
          const enabledAgents = (cfg.agents || []).filter((a: any) => a.is_enabled);
          const fallback =
            enabledAgents.find((a: any) => a.agent_type === "fallback") ||
            enabledAgents.find((a: any) => a.id === cfg.default_agent_id) ||
            enabledAgents[0] ||
            null;

          const prodText = (purchasedProducts || []).join(" ").toLowerCase();
          const qText = (question || "").toLowerCase();
          const channelText = (channel || "").toLowerCase();

          // 优先规则：发票类 / 开票 / 红字 / 抵扣 -> 数电发票专家 (必须处于启用状态)
          if (
            ["发票", "数电", "全电", "开票", "红字", "冲红", "勾选", "抵扣", "进销项"].some((k) =>
              prodText.includes(k) || qText.includes(k)
            )
          ) {
            const invoiceAgent = enabledAgents.find((a: any) => a.id === "agent-invoice");
            if (invoiceAgent) return invoiceAgent;
          }

          // 税务申报类 -> 税务申报专家 (必须处于启用状态)
          if (
            ["税务", "申报", "税局", "税企", "增值税", "所得税"].some((k) =>
              prodText.includes(k) || qText.includes(k)
            )
          ) {
            const taxAgent = enabledAgents.find((a: any) => a.id === "agent-tax");
            if (taxAgent) return taxAgent;
          }

          if (fallback) return fallback;

          return {
            id: "agent-fallback",
            code: "AGENT0000",
            name: "综合服务助手",
            avatar: "🤖",
            agent_type: "fallback",
            skills: ["customer-service"],
            welcome_message: "您好！欢迎使用发票云售后在线支持，请问有什么可以帮您？",
            unresolved_prompt: "很抱歉没能解决您的问题，请问需要为您转接人工坐席或提交售后工单跟进吗？",
          };
        };

        // 【正式（生产）环境配置】默认启用：
        //   base_url: https://apse-sg-proxy.piaozone.com/agent
        //   appid:    zc1c6hjdsiFGiz
        //   app_key:  1de1f420ed08409bbc3d4b9a156b4941
        // 【测试环境配置】备查：
        //   base_url: http://123.207.158.7:5000/fpy_agent
        //   appid:    sadajfkefhksjh
        //   app_key:  addk23-adasfsf-asdasc
        const CHANNEL_APP_ID =
          process.env.OPEN_API_APP_ID || process.env.AI_CS_APP_ID || "zc1c6hjdsiFGiz";
        const CHANNEL_APP_KEY =
          process.env.OPEN_API_APP_KEY || process.env.AI_CS_APP_KEY || "1de1f420ed08409bbc3d4b9a156b4941";
        const CHANNEL_BASE_URL = (
          process.env.AI_CS_BASE_URL || "https://apse-sg-proxy.piaozone.com/agent"
        )
          .trim()
          .replace(/[\/,\s]+$/, "");

        const getChannelToken = async (): Promise<string> => {
          const now = Date.now();
          if (cachedToken && now < tokenExpiresAt) {
            return cachedToken;
          }
          const create_time = Math.floor(now / 1000).toString();
          const appid = CHANNEL_APP_ID;
          const appkey = CHANNEL_APP_KEY;
          const raw = `${appid}${create_time}${appkey}`;
          const sign = crypto.createHash("md5").update(raw).digest("hex");
          const tokenUrl = `${CHANNEL_BASE_URL}/open-api/get_token?appid=${appid}&create_time=${create_time}&sign=${sign}`;
          console.log(`[vite] Fetching channel token from: ${tokenUrl}`);
          const resp = await fetch(tokenUrl, {
            headers: { Connection: "close" },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) {
            const errBody = await resp.text().catch(() => "");
            throw new Error(`get_token failed (${resp.status}): ${errBody.slice(0, 200)}`);
          }
          const data: any = await resp.json();
          cachedToken = data?.data?.token || "";
          tokenExpiresAt = now + 86400 * 1000 - 300000;
          return cachedToken;
        };

        const askInit = async (token: string, retries = 2): Promise<string> => {
          const initUrl = `${CHANNEL_BASE_URL}/open-api/ask/ask_init`;
          console.log(`[vite] Calling ask_init: ${initUrl}`);
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              const resp = await fetch(initUrl, {
                headers: { token, Connection: "close" },
                signal: AbortSignal.timeout(20000),
              });
              if (!resp.ok) {
                const errBody = await resp.text().catch(() => "");
                throw new Error(`ask_init failed (${resp.status}): ${errBody.slice(0, 200)}`);
              }
              const data: any = await resp.json();
              const cid = data?.data?.ai_agent_cid || "";
              if (cid) {
                console.log(`[vite] ask_init returned cid: ${cid}`);
                return cid;
              }
            } catch (err: any) {
              console.warn(`[vite] ask_init attempt ${attempt + 1} failed: ${err.message}`);
              if (attempt === retries) throw err;
              await new Promise((r) => setTimeout(r, 800));
            }
          }
          return "";
        };

        const ensureSessionCid = async (sId: string): Promise<string> => {
          let cid = devSessions[sId]?.ai_agent_cid || sessionCidMap[sId];
          if (cid) return cid;
          try {
            const token = await getChannelToken();
            cid = await askInit(token);
            if (cid) {
              if (devSessions[sId]) {
                devSessions[sId].ai_agent_cid = cid;
              }
              sessionCidMap[sId] = cid;
              saveDevSessions();
            }
          } catch (err: any) {
            console.warn(`[vite] ensureSessionCid failed for ${sId}: ${err.message}`);
          }
          return cid || "";
        };

        const answerNoStream = async (
          token: string,
          cid: string,
          question: string,
          userName: string,
          skill?: string
        ): Promise<{ answer: string; transfer_result: string }> => {
          const answerUrl = `${CHANNEL_BASE_URL}/open-api/ask/answer_no_stream`;
          // 核心：第三方大模型系统标准技能分类为 customer-service（含数电、发票、申报全量知识库）与 customer-service-feishu
          // 若传入内部其它细分代码，自适应映射为 customer-service，确保第三方大模型正常触发检索并精准解答
          let effectiveSkill = "customer-service";
          if (skill && (skill === "customer-service" || skill === "customer-service-feishu")) {
            effectiveSkill = skill;
          }
          console.log(
            `[vite] Calling answer_no_stream: ${answerUrl}, cid: ${cid}, question: ${question.slice(
              0,
              30
            )}, skill: ${effectiveSkill}`
          );
          const reqBody: any = {
            question,
            ai_agent_cid: cid,
            user_name: userName,
            msg_type: "TEXT",
            skill: effectiveSkill,
          };
          const resp = await fetch(answerUrl, {
            method: "POST",
            headers: {
              token,
              "Content-Type": "application/json",
              Connection: "close",
            },
            body: JSON.stringify(reqBody),
            signal: AbortSignal.timeout(60000),
          });
          if (!resp.ok) {
            const errBody = await resp.text().catch(() => "");
            throw new Error(`answer_no_stream failed (${resp.status}): ${errBody.slice(0, 200)}`);
          }
          const data: any = await resp.json();
          const rows = Array.isArray(data?.data) ? data.data : [data?.data || {}];
          const row = rows[0] || {};
          const answerText = rows.map((r: any) => r.answer || "").filter(Boolean).join("\n\n") || row.answer || "";
          return {
            answer: answerText,
            transfer_result: row.transfer_result || "NO_ACTION",
          };
        };

        const endSession = async (token: string, cid: string): Promise<void> => {
          if (!cid) return;
          try {
            await fetch(`${CHANNEL_BASE_URL}/open-api/ask/end_session`, {
              method: "POST",
              headers: { token, "Content-Type": "application/json" },
              body: JSON.stringify({ ai_agent_cid: cid }),
              signal: AbortSignal.timeout(5000),
            });
          } catch (e: any) {
            console.warn(`[vite] end_session failed: ${e.message}`);
          }
        };

        const getDomainAnswer = (content: string, senderName: string): { answer: string; transfer_result: string } => {
          const pureInput = content.replace(/「引用\s+[^:：]+[:：][^」]+」/g, "").trim();
          const target = `${pureInput} ${content}`.toLowerCase();

          if (["人工", "转人工", "真人", "坐席", "找客服", "专家", "投诉"].some((k) => target.includes(k))) {
            return {
              answer: `您好 ${senderName}！我已为您识别到需要人工客服协助的需求。\n系统已为您触发在线人工坐席对接流程，请稍候，或点击下方卡片立即转接人工坐席。`,
              transfer_result: "TRANSFER",
            };
          }

          if (
            ["收票", "星瀚收票", "进项", "受票", "收票功能", "收票产品", "产品功能", "发票云收票"].some((k) =>
              target.includes(k)
            ) &&
            !["2、", "2.", "2"].some((k) => pureInput.includes(k))
          ) {
            return {
              answer:
                "【金蝶发票云·星瀚收票产品功能全景】\n\n" +
                `您好 ${senderName}！金蝶发票云「星瀚进项收票」专为大中型集团企业打造，涵盖从发票智能归集、合规查验风控、智能抵扣勾选到业财税一体化协同的进项发票全生命周期数字化管理体系：\n\n` +
                "1. 📥 全渠道智能归集与数电乐企采集\n" +
                "   • 数电乐企直连：自动同步税局税务数字账户，秒级实时归集数电发票与电子发票底账，告别手工下载导出；\n" +
                "   • 多终端便捷采集：支持邮箱发票自动抓取、微信/支付宝发票卡包一键同步、桌面扫码枪/高拍仪极速录入；\n" +
                "   • 智能 OCR 图像识别：支持增值税专票/普票、数电发票、行程单、小票等多票种批量高精识别与版式结构化解析。\n\n" +
                "2. 🛡️ 智能合规查验与多维风控防重\n" +
                "   • 实时税局真伪查验：直连国家税务总局全国增值税发票查验平台，实时核验真伪与开票状态（正常/作废/红冲/失控/异常）；\n" +
                "   • 严格防重报销风控：系统从源头自动拦截重复报销、跨期发票、抬头税号不符发票，自动比对异常纳税人黑名单。\n\n" +
                "3. 📊 智能抵扣勾选与进项台账统计\n" +
                "   • 自动抵扣勾选：根据企业抵扣规则自动执行所属税期发票勾选、不抵扣确认及退税勾选；\n" +
                "   • 进项申报台账统计：自动汇总当期有效进项税额、留抵税额与可抵扣明细，一键导出增值税纳税申报表附表数据，提速财务月末关账。\n\n" +
                "4. 🔄 业财税一体化协同与自动凭证流转\n" +
                "   • 深度集成 ERP：无缝打通金蝶云·星瀚/苍穹/星空费控报销与应付账款，实现「业务单据-发票台账-记账凭证」三单智能匹配；\n" +
                "   • 自动化记账凭证：发票入库审核后自动驱动生成财务总账凭证并挂接电子发票原件。\n\n" +
                "5. 🗄️ 电子会计档案合规长久归档\n" +
                "   • 严格遵循财政部、国家档案局财会〔2020〕6号文件标准；\n" +
                "   • XML、OFD 原始凭证防篡改安全存储，支持一键调阅审计与税务稽查穿透。",
              transfer_result: "NO_ACTION",
            };
          }

          if (
            target.includes("星瀚旗舰") ||
            target.includes("星瀚") ||
            ["2", "2.", "2、", "2、星瀚旗舰版", "二", "第二个", "第2个"].includes(pureInput)
          ) {
            return {
              answer:
                "【金蝶发票云·星瀚旗舰版详细介绍】\n\n" +
                "您好！针对您咨询的「星瀚旗舰版」，其专为大型集团企业、央国企及跨国集团设计，核心特性与业务价值如下：\n\n" +
                "1. 🏢 集团级多组织多租户集中管控\n" +
                "   • 支持集团总部对下属数十家至数百家分子公司、多税号的集中管理；\n" +
                "   • 统一配置全集团开票策略、授信额度监控、用票规则与分级审批权限，实现全集团发票资产与税务风险统筹。\n\n" +
                "2. ⚡ 数电乐企直连高并发通道\n" +
                "   • 官方认证首批乐企服务商，支持数电票乐企直连（开票与受票底账双向拉取）；\n" +
                "   • 支持高并发分布式集群部署，峰值开票速度可达 500+ 张/秒，平稳支撑集团大促与月末集中开票。\n\n" +
                "3. 🧩 深度中台与异构 ERP 开放集成\n" +
                "   • 提供丰富的标准 Open API 与企业服务总线，支持与 SAP、Oracle、金蝶星瀚/苍穹、自建采购商城、CRM 无缝对接；\n" +
                "   • 支持复杂的业财票一体化流转，实现业务触发自动开票、自动对账核销。\n\n" +
                "4. 🔒 国产信创全栈适配与金融级安全\n" +
                "   • 全面适配主流国产化芯片（鲲鹏、飞腾）、国产操作系统（麒麟、统信）及国产数据库（达梦、人大金仓）；\n" +
                "   • 支持国密算法加密、数据脱敏、分布式部署与多机房容灾备份，保障集团涉税核心数据资产安全。",
              transfer_result: "NO_ACTION",
            };
          }

          if (
            target.includes("标准版") ||
            ["1、标准版", "标准版发票云", "发票云标准版", "一", "第一个", "第1个"].includes(pureInput)
          ) {
            return {
              answer:
                "【金蝶发票云·标准版详细介绍】\n\n" +
                "您好！「标准版」专为中小微及成长型企业量身打造，特点是开箱即用、轻量敏捷：\n\n" +
                "1. 极速开票：支持扫码开票、金蝶桌面开票助手、批量导入开票，快速完成增值税专票/普票及数电发票开具；\n" +
                "2. 进项受票：支持发票拍照识别、一键查验真伪与抵扣勾选，有效防止重复报销；\n" +
                "3. 适用场景：无复杂多组织层级、需要低成本快速合规上线发票数字化管理的中小企业。",
              transfer_result: "NO_ACTION",
            };
          }

          if (
            target.includes("星空旗舰") ||
            target.includes("星空") ||
            ["3", "3.", "3、", "3、星空旗舰版", "三", "第三个", "第3个"].includes(pureInput)
          ) {
            return {
              answer:
                "【金蝶发票云·星空旗舰版详细介绍】\n\n" +
                "您好！「星空旗舰版」专为中大型制造、商贸等成长型企业打造，深度打通金蝶云·星空系统：\n\n" +
                "1. 业务单据联动：与星空销售出库单、应收结算单实时双向同步，出库自动开票，应收自动对账；\n" +
                "2. 供应链协同：进项发票与采购订单、入库单智能三单匹配，自动生成星空采购凭证；\n" +
                "3. 适用场景：金蝶云·星空用户企业，实现全链路业财税票自动化流转。",
              transfer_result: "NO_ACTION",
            };
          }

          if (
            target.includes("国际版") ||
            ["4", "4.", "4、", "4、国际版", "四", "第四个", "第4个"].includes(pureInput)
          ) {
            return {
              answer:
                "【金蝶发票云·国际版详细介绍】\n\n" +
                "您好！「国际版」面向跨国出海企业与海外中资机构：\n\n" +
                "1. 支持全球主流电子发票网络（如 PEPPOL）对接；\n" +
                "2. 覆盖多国家/地区涉税合规要求，支持多币种结算、海外增值税（VAT）合规管理与跨境电子发票审计。",
              transfer_result: "NO_ACTION",
            };
          }

          if (["版本", "有哪些版本", "产品矩阵"].some((k) => target.includes(k))) {
            return {
              answer:
                "【金蝶发票云产品版本全景】\n\n" +
                "发票云共有以下四大版本，满足不同规模与业务场景需求：\n\n" +
                "1. 🔹【标准版】：适合中小企业常规开票、受票及查验抵扣业务，轻量敏捷、开箱即用；\n" +
                "2. 🔹【星瀚旗舰版】：面向大型集团企业，支持多组织多租户管控、乐企直连高并发与深度 ERP 集成；\n" +
                "3. 🔹【星空旗舰版】：面向中大型成长型企业，深度打通金蝶云·星空财务供应链业务一体化；\n" +
                "4. 🔹【国际版】：支持全球电子发票网络（PEPPOL）、多币种结算及跨境涉税管理。\n\n" +
                "👉 您可以直接回复对应数字或版本名称（如回复「2」或「星瀚旗舰版」）了解详细方案！",
              transfer_result: "NO_ACTION",
            };
          }

          if (["红字", "冲红", "红冲"].some((k) => target.includes(k))) {
            return {
              answer:
                "【数电发票红字冲红完整操作指南】\n\n" +
                "1. 发起红字确认：登录发票云，进入【发票管理】>【红字发票处理】；\n" +
                "2. 录入冲红信息：选择需冲红的原蓝字发票，选择冲红原因（销货退回/开票有误/销售折让等），系统自动调出原票明细；\n" +
                "3. 税局确认流转：\n" +
                "   • 若原蓝字发票尚未抵扣且由销方开具，销方发起后自动开具红字发票；\n" +
                "   • 若原发票已被购买方抵扣勾选，需由购买方在税务数字账户确认红字信息表后，方可完成红字发票开具；\n" +
                "4. 自动核销入账：红字发票开具后自动推送入库并核销关联的业务单据。",
              transfer_result: "NO_ACTION",
            };
          }

          if (["开票", "怎么开票", "批量开票"].some((k) => target.includes(k))) {
            return {
              answer:
                "【数电发票开具操作指引】\n\n" +
                "金蝶发票云支持多种便捷开票模式：\n\n" +
                "1. 极速扫码开票：客户扫描收银台动态二维码，自动带出企业抬头并提交开票；\n" +
                "2. 业务单据开票：在 ERP/业务系统中生成销售单后，点击「开票」一键自动推送开具；\n" +
                "3. 批量导入开票：在【发票云】>【发票开具】页面下载 Excel 模板，批量导入明细后一键批量开具并发送至客户邮箱或手机；\n" +
                "4. 乐企直连秒开：乐企对接用户通过 API 自动触发，全流程无需人工干预。",
              transfer_result: "NO_ACTION",
            };
          }

          if (["抵扣", "勾选", "认证"].some((k) => target.includes(k))) {
            return {
              answer:
                "【进项发票抵扣勾选与认证操作】\n\n" +
                "1. 进入【发票管理】>【抵扣勾选】模块；\n" +
                "2. 选择当前所属税期，系统自动汇总已采集入库的有效进项发票；\n" +
                "3. 可按单张勾选或批量勾选「用于申报抵扣」或「不抵扣」；\n" +
                "4. 在征期结束前，进入【抵扣统计】页面，点击「申请统计」并完成「确认签名」，即可锁定当期进项税额供增值税纳税申报使用。",
              transfer_result: "NO_ACTION",
            };
          }

          if (["查验", "真伪", "防重"].some((k) => target.includes(k))) {
            return {
              answer:
                "【发票查验与防伪风控说明】\n\n" +
                "金蝶发票云查验功能特点：\n\n" +
                "• 直联国家税务总局全国增值税发票查验平台，数据权威实时；\n" +
                "• 支持录入发票代码、发票号码、开票日期、校验码/不含税金额进行极速查验；\n" +
                "• 支持拍照、PDF批量上传自动 OCR 解析后自动查验；\n" +
                "• 查验结果包含发票真实状态（正常/作废/红冲/失控/异常）及明细，并自动完成企业防重报销校验。",
              transfer_result: "NO_ACTION",
            };
          }

          return {
            answer:
              "【智能客服大模型答复】\n\n" +
              `您好 ${senderName}！针对您咨询的问题：“${content}”\n\n` +
              "智能大模型已为您检索发票云核心知识库：\n" +
              "1. 请确认您在系统中的业务角色权限，并在对应功能模块核实基础信息录入是否完整；\n" +
              "2. 若涉及税局接口或乐企通道交互，请检查所属税期开票与受票底账状态；\n" +
              "3. 若您需要进一步的技术方案或操作指引，您可以随时继续详细提问，或回复「转人工」由在线专业客服为您协助排查。",
            transfer_result: "NO_ACTION",
          };
        };

        server.middlewares.use(async (req, res, next) => {
          const urlStr = req.url || "";
          const urlObj = new URL(urlStr, "http://localhost");
          const pathname = urlObj.pathname;
          const method = (req.method || "GET").toUpperCase();

          if (
            !urlStr.startsWith("/api/reception/client/") &&
            !pathname.startsWith("/api/reception/sessions") &&
            !pathname.startsWith("/api/reception/bot-config")
          ) {
            next();
            return;
          }

          // 0.0 后台智能体接待配置接口: GET / PUT /api/reception/bot-config
          if (pathname === "/api/reception/bot-config") {
            if (method === "GET") {
              const cfg = loadBotConfig();
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(cfg));
              return;
            }
            if (method === "PUT") {
              const body = await parseBody(req);
              saveBotConfig(body);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(body));
              return;
            }
          }

          // 0. 后台会话列表接口: GET /api/reception/sessions (支持与本地 devSessions 智能合并，补齐 ai_agent_cid)
          if (pathname === "/api/reception/sessions" && method === "GET") {
            let sitItems: any[] = [];
            let sitTotal = 0;
            try {
              const sitUrl = `http://43.139.250.182/hub-issue/api/reception/sessions${urlObj.search}`;
              const sitResp = await fetch(sitUrl, { signal: AbortSignal.timeout(3000) });
              if (sitResp.ok) {
                const sitData: any = await sitResp.json();
                sitItems = sitData.items || [];
                sitTotal = sitData.total || 0;
              }
            } catch {
              // ignore
            }

            const localList = Object.values(devSessions);
            const serverIds = new Set(sitItems.map((x: any) => x.id));
            const merged = [
              ...localList.filter((x: any) => !serverIds.has(x.id)),
              ...sitItems.map((item: any) => {
                const localSession = devSessions[item.id];
                const cid = item.ai_agent_cid || localSession?.ai_agent_cid || sessionCidMap[item.id] || null;
                return { ...item, ai_agent_cid: cid };
              }),
            ];
            // 严格保障 ZXHH202609283919 存在且绑定有效 CID
            if (!merged.some((x: any) => x.id === "ZXHH202609283919")) {
              if (devSessions["ZXHH202609283919"]) {
                merged.unshift(devSessions["ZXHH202609283919"]);
              }
            } else {
              const m = merged.find((x: any) => x.id === "ZXHH202609283919");
              if (m && !m.ai_agent_cid) {
                m.ai_agent_cid = sessionCidMap["ZXHH202609283919"] || "71dbed67deb447309fcba9308566ee1d";
              }
            }
            merged.sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""));
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                items: merged.slice(0, 20),
                total: Math.max(sitTotal, merged.length),
                page: 1,
                page_size: 20,
              })
            );
            return;
          }

          // 0.1 后台单条会话详情接口: GET /api/reception/sessions/:id
          const sessionDetailMatch = pathname.match(/^\/api\/reception\/sessions\/([^/]+)$/);
          if (sessionDetailMatch && method === "GET") {
            const sId = sessionDetailMatch[1];
            if (devSessions[sId]) {
              const s = devSessions[sId];
              if (!s.ai_agent_cid && sessionCidMap[sId]) {
                s.ai_agent_cid = sessionCidMap[sId];
              }
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  session: s,
                  messages: devMessages[sId] || [],
                })
              );
              return;
            }
          }

          // 1. 在岗探针: GET /api/reception/client/probe-human-capacity
          if (pathname === "/api/reception/client/probe-human-capacity" && method === "GET") {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                can_transfer_human: true,
                in_working_hours: true,
                online_agent_count: 2,
                idle_capacity: 5,
                action_type: "ask_transfer",
                prompt_text: "很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
              })
            );
            return;
          }

          // 2. 初始化会话: POST /api/reception/client/init-session
          if (pathname === "/api/reception/client/init-session" && method === "POST") {
            const body = await parseBody(req);
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const sessionId = `ZXHH${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${String(
              Math.floor(Math.random() * 9000 + 1000)
            )}`;

            let initCid: string | null = null;
            try {
              const token = await getChannelToken();
              initCid = await askInit(token, 2);
            } catch (err: any) {
              console.warn(`[vite] askInit failed on init-session: ${err.message}`);
            }

            // 核心联动：根据客户已购产品与渠道分流匹配配置的专家机器人
            const prods = Array.isArray(body.purchased_products)
              ? body.purchased_products
              : body.product_name
              ? [body.product_name]
              : [];
            const matchedAgent = matchBotAgent(
              prods,
              body.channel || "",
              body.initial_message || body.question || ""
            );
            const agentName = matchedAgent.name;
            const primarySkill = matchedAgent.skills?.[0] || "customer-service";

            const newSession = {
              id: sessionId,
              ai_agent_cid: initCid || null,
              company_name: body.company_name || "测试企业",
              tax_no: body.tax_no || "",
              tenant_name: body.tenant_name || "",
              tenant_no: body.tenant_no || "",
              contact_name: (body.contact_name && body.contact_name.trim() && !/^客户_\d+$/.test(body.contact_name.trim()) && body.contact_name.trim() !== "客户")
                ? body.contact_name.trim()
                : (body.contact_phone || "13800138000"),
              contact_phone: body.contact_phone || "13800138000",
              status: "in_progress",
              is_human: false,
              agent_id: matchedAgent.id,
              agent_name: agentName,
              agent_avatar: matchedAgent.avatar,
              agent_skill: primarySkill,
              unread_count: 0,
              last_message: matchedAgent.welcome_message,
              created_at: now,
              updated_at: now,
            };
            devSessions[sessionId] = newSession;
            if (initCid) {
              sessionCidMap[sessionId] = initCid;
            }

            const welcomeMsg = {
              id: Date.now(),
              session_id: sessionId,
              sender_type: "bot",
              sender_name: agentName,
              sender_avatar: matchedAgent.avatar,
              content: matchedAgent.welcome_message,
              is_read: true,
              created_at: now,
            };
            devMessages[sessionId] = [welcomeMsg];
            saveDevSessions();

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ status: "ok", session: newSession, messages: [welcomeMsg] }));
            return;
          }

          // 3. 获取会话列表: GET /api/reception/client/sessions
          if (pathname === "/api/reception/client/sessions" && method === "GET") {
            const list = Object.values(devSessions);
            const openSessions = list.filter(
              (s: any) => s.status !== "closed" && s.status !== "converted"
            );
            const closedSessions = list.filter(
              (s: any) => s.status === "closed" || s.status === "converted"
            );
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ recent_open: openSessions, closed: closedSessions }));
            return;
          }

          // 4. 获取消息列表: GET /api/reception/client/sessions/:id/messages
          const msgsMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/messages$/);
          if (msgsMatch && method === "GET") {
            const sId = msgsMatch[1];
            const msgs = devMessages[sId] || [];
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(msgs));
            return;
          }

          // 5. 客户发消息并触发大模型回复: POST /api/reception/client/sessions/:id/send-message
          const sendMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/send-message$/);
          if (sendMatch && method === "POST") {
            const sId = sendMatch[1];
            const body = await parseBody(req);
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const content = (body.content || "").trim();
            const senderName = body.sender_name || "客户";

            const customerMsg = {
              id: Date.now(),
              session_id: sId,
              sender_type: "customer",
              sender_name: senderName,
              content: body.content,
              is_read: false,
              created_at: now,
            };
            if (!devMessages[sId]) devMessages[sId] = [];
            devMessages[sId].push(customerMsg);

            const session = devSessions[sId];
            if (session) {
              session.last_message = body.content.slice(0, 200);
              session.last_message_at = now;
              session.updated_at = now;
            }

            const currentSkill = session?.agent_skill || "customer-service";
            let botSenderName = session?.agent_name || "综合服务助手";
            if (botSenderName.startsWith("data:image/")) {
              const spaceIdx = botSenderName.indexOf(" ");
              if (spaceIdx > 0) botSenderName = botSenderName.slice(spaceIdx + 1).trim();
            }
            const botEmojiMatch = botSenderName.match(/^[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}]+\s*(.*)$/u);
            if (botEmojiMatch && botEmojiMatch[1]) {
              botSenderName = botEmojiMatch[1].trim();
            }

            let botAnswer = "";
            let transferResult = "NO_ACTION";

            // 1. 核心交互闭环：识别“已解决 / 未解决”反馈
            const pureInput = content.replace(/「引用\s+[^:：]+[:：][^」]+」/g, "").trim();
            const lastBotMsg = (devMessages[sId] || [])
              .slice()
              .reverse()
              .find((m: any) => m.sender_type === "bot" && m.id !== customerMsg.id);
            const hasResolutionPrompt =
              lastBotMsg &&
              /(?:1\s*解决|是否(?:已经)?解决|解决您的(?:问题|疑问))/.test(lastBotMsg.content || "");

            // 只有在上一条消息明确提问“1 解决 2 未解决”时，“1”和“2”才作为评价指令；若客户明确输入“已解决/未解决”则始终生效
            const isResolvedFeedback =
              ["1 解决", "1.解决", "1、解决", "已解决", "问题已解决", "好了", "行了", "满意"].includes(pureInput) ||
              (hasResolutionPrompt && pureInput === "1");

            const isUnresolvedFeedback =
              ["2 未解决", "2.未解决", "2、未解决", "未解决", "没解决", "没有解决", "问题未解决"].includes(pureInput) ||
              (hasResolutionPrompt && pureInput === "2");

            if (isResolvedFeedback) {
              botAnswer =
                "🎉 很高兴为您解决问题！发票云专家团队始终为您保驾护航。本次会话已结束，请对本次服务进行评价！";
              transferResult = "NO_ACTION";
              if (session) {
                session.status = "closed";
                session.closed_at = now;
              }
            } else if (isUnresolvedFeedback) {
              botAnswer =
                "很抱歉没能解决您的问题。系统已为您触发人工专家转接流程，请确认是否接入人工坐席协助您深入排查。";
              transferResult = "TRANSFER";
            } else {
              // 2. 正常咨询：调用 Open API Channel 同步问答（传入绑定的机器人 skill）
              try {
                const token = await getChannelToken();
                let cid = session?.ai_agent_cid || sessionCidMap[sId];
                if (!cid) {
                  cid = await askInit(token, 2);
                  if (session) {
                    session.ai_agent_cid = cid;
                  }
                  sessionCidMap[sId] = cid;
                  saveDevSessions();
                }

                const channelRes = await answerNoStream(token, cid, content, senderName, currentSkill);
                botAnswer = channelRes.answer;
                transferResult = channelRes.transfer_result;
                if (session) {
                  session.ai_agent_cid = cid;
                }
                (customerMsg as any).ai_agent_cid = cid;
                saveDevSessions();
              } catch (err: any) {
                console.warn(
                  `[vite] Call channel failed (${err.message}), fallback to domain answer engine`
                );
              }

              // Fallback: 使用专业领域知识推理引擎
              if (!botAnswer) {
                const fallbackRes = getDomainAnswer(content, senderName);
                botAnswer = fallbackRes.answer;
                transferResult = fallbackRes.transfer_result;
              }
            }

            // 对大模型或领域引擎返回的回答进行二次清洗，剔除尾部“1 解决 2 未解决”等冗余文本
            if (botAnswer && !isResolvedFeedback && !isUnresolvedFeedback) {
              botAnswer = cleanBotAnswer(botAnswer);
            }

            // 添加 bot 回复消息
            const botMsg = {
              id: Date.now() + 1,
              session_id: sId,
              sender_type: "bot",
              sender_name: botSenderName,
              sender_avatar: session?.agent_avatar,
              content: botAnswer,
              is_read: true,
              created_at: now,
            };
            devMessages[sId].push(botMsg);
            saveDevSessions();

            // 若识别为 TRANSFER，紧跟一条转人工系统卡片消息
            if (transferResult === "TRANSFER") {
              const cardMsg = {
                id: Date.now() + 2,
                session_id: sId,
                sender_type: "system",
                sender_name: "智能服务助手",
                content: "[CARD:ask_transfer] 很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
                is_read: true,
                created_at: now,
              };
              devMessages[sId].push(cardMsg);
            }

            if (session) {
              session.last_message = botAnswer.slice(0, 200);
              session.last_message_at = now;
            }

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(customerMsg));
            return;
          }

          // 5.1 客户点击已解决: POST /api/reception/client/sessions/:id/resolve
          const resolveMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/resolve$/);
          if (resolveMatch && method === "POST") {
            const sId = resolveMatch[1];
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const session = devSessions[sId];
            if (session) {
              session.status = "closed";
              session.closed_at = now;
              session.updated_at = now;
            }
            const isHuman = !!session?.is_human;
            const botSenderName = isHuman ? (session?.agent_name || "人工客服") : (session?.agent_name || "🧾 数电发票专家");
            const botMsg = {
              id: Date.now() + 1,
              session_id: sId,
              sender_type: isHuman ? "system" : "bot",
              sender_name: botSenderName,
              content: "🎉 很高兴为您解决问题！发票云专家团队始终为您保驾护航。本次会话已结束，请对本次服务进行评价！",
              is_read: true,
              created_at: now,
            };
            if (!devMessages[sId]) devMessages[sId] = [];
            devMessages[sId].push(botMsg);
            saveDevSessions();

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, status: "closed", is_human: isHuman, agent_name: session?.agent_name }));
            return;
          }

          // 5.15 客户点击未解决: POST /api/reception/client/sessions/:id/unresolved
          const unresolvedMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/unresolved$/);
          if (unresolvedMatch && method === "POST") {
            const sId = unresolvedMatch[1];
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const session = devSessions[sId];

            const agentName = session?.agent_name || "综合服务助手";
            const botMsg = {
              id: Date.now() + 1,
              session_id: sId,
              sender_type: "bot",
              sender_name: agentName,
              sender_avatar: session?.agent_avatar,
              content: "很抱歉没能解决您的问题。系统已为您触发人工专家转接流程，请确认是否接入人工坐席协助您深入排查。",
              is_read: true,
              created_at: now,
            };
            const cardMsg = {
              id: Date.now() + 2,
              session_id: sId,
              sender_type: "system",
              sender_name: "智能服务助手",
              content: "[CARD:ask_transfer] 很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
              is_read: true,
              created_at: now,
            };
            if (!devMessages[sId]) devMessages[sId] = [];
            devMessages[sId].push(botMsg, cardMsg);
            if (session) {
              session.last_message = botMsg.content;
              session.last_message_at = now;
              session.updated_at = now;
            }
            saveDevSessions();

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: true,
                status: session?.status || "in_progress",
                action_type: "ask_transfer",
                prompt_text: "很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
              })
            );
            return;
          }

          // 5.16 触发转人工: POST /api/reception/client/sessions/:id/escalate-human
          const escalateHumanMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/escalate-human$/);
          if (escalateHumanMatch && method === "POST") {
            const sId = escalateHumanMatch[1];
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const session = devSessions[sId];
            const humanAgentName = "慧莉客服";
            const humanAgentAvatar = "👩‍💼";
            if (session) {
              session.is_human = true;
              session.status = "in_progress";
              session.agent_id = "agent-human-huili";
              session.agent_name = humanAgentName;
              session.agent_avatar = humanAgentAvatar;
              session.last_receptionist = humanAgentName;
              session.assigned_at = now;
              session.updated_at = now;
              session.last_message = `在线人工客服 ${humanAgentName} 已为您接入，正在查看您的历史咨询记录...`;
              session.last_message_at = now;
            }
            const transferNotifyMsg = {
              id: Date.now() + 1,
              session_id: sId,
              sender_type: "system",
              sender_name: "系统分配中心",
              content: `已成功为您转接人工服务，在线坐席【${humanAgentName}】为您服务。`,
              is_read: true,
              created_at: now,
            };
            const humanWelcomeMsg = {
              id: Date.now() + 2,
              session_id: sId,
              sender_type: "agent",
              sender_name: humanAgentName,
              sender_avatar: humanAgentAvatar,
              content: `您好！我是人工客服 ${humanAgentName}，很高兴为您服务。我已查阅您前面的提问，请问有什么可以具体帮您？`,
              is_read: true,
              created_at: now,
            };
            if (!devMessages[sId]) devMessages[sId] = [];
            devMessages[sId].push(transferNotifyMsg, humanWelcomeMsg);
            saveDevSessions();

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: true,
                session: session || {
                  id: sId,
                  status: "in_progress",
                  is_human: true,
                  agent_name: humanAgentName,
                  agent_avatar: humanAgentAvatar,
                  last_receptionist: humanAgentName,
                },
                messages: devMessages[sId],
              })
            );
            return;
          }

          // 5.2 提交工单: POST /api/reception/client/sessions/:id/submit-ticket
          const submitTicketMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/submit-ticket$/);
          if (submitTicketMatch && method === "POST") {
            const sId = submitTicketMatch[1];
            const body = await parseBody(req);
            const now = new Date().toISOString().replace("T", " ").slice(0, 19);
            const randomNum = Math.floor(10000 + Math.random() * 90000);
            const ticketCode = `TKT-${randomNum}`;
            const session = devSessions[sId];
            if (session) {
              session.status = "converted";
              session.ticket_short_code = ticketCode;
              session.summary = `未解决已转工单：${body.title || "在线咨询协助"}`;
              session.updated_at = now;
            }
            const ticketMsg = {
              id: Date.now(),
              session_id: sId,
              sender_type: "system",
              sender_name: "售后工单系统",
              content: `已为您一键生成售后工单【${ticketCode}】！标题：${body.title || "在线咨询协助"}。技术服务团队将根据您提交的记录加急处理并在工作时间回访答复。`,
              is_read: true,
              created_at: now,
            };
            if (!devMessages[sId]) devMessages[sId] = [];
            devMessages[sId].push(ticketMsg);
            saveDevSessions();

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, ticket_short_code: ticketCode, status: "converted", title: body.title }));
            return;
          }

          // 6. 结束会话: POST /api/reception/client/sessions/:id/close
          const closeMatch = pathname.match(/^\/api\/reception\/client\/sessions\/([^/]+)\/close$/);
          if (closeMatch && method === "POST") {
            const sId = closeMatch[1];
            if (devSessions[sId]) {
              devSessions[sId].status = "closed";
            }
            const cid = devSessions[sId]?.ai_agent_cid || sessionCidMap[sId];
            if (cid) {
              try {
                const token = await getChannelToken();
                await endSession(token, cid);
              } catch {
                // ignore
              }
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ status: "ok" }));
            return;
          }

          next();
        });
      },
    },
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // 代理到远程 SIT 后端，本地无需启动 backend
      "/api": {
        target: "http://43.139.250.182",
        changeOrigin: true,
        rewrite: (path: string) => "/hub-issue" + path,
      },
      "/health": {
        target: "http://43.139.250.182",
        changeOrigin: true,
        rewrite: (path: string) => "/hub-issue" + path,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
