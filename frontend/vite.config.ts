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
