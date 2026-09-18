import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DateTimeRangePicker } from "@/components/DateTimeRangePicker";
import {
  type MessageItem,
  type SessionItem,
  fetchSessions,
  fetchSessionDetail,
} from "./receptionApi";

const SESSION_STATUS_OPTIONS = ["不限", "进行中", "挂起", "转工单", "已关闭"];

export function SessionListPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // 筛选条件录入区
  const [filterCompany, setFilterCompany] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterStatuses, setFilterStatuses] = useState<string[]>(["不限"]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [timeRange, setTimeRange] = useState({ start: "", end: "" });
  const [filterIsHuman, setFilterIsHuman] = useState("不限");
  const [filterAgentName, setFilterAgentName] = useState("");

  // 会话详情抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = async (targetPage = page) => {
    setLoading(true);
    try {
      const res = await fetchSessions({
        company_name: filterCompany,
        contact_phone: filterPhone,
        statuses: filterStatuses,
        start_time: timeRange.start,
        end_time: timeRange.end,
        is_human: filterIsHuman,
        agent_name: filterAgentName,
        page: targetPage,
        page_size: 20,
      });
      setSessions(res.items);
      setTotal(res.total);
      setPage(res.page);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusToggle = (s: string) => {
    if (s === "不限") {
      setFilterStatuses(["不限"]);
      return;
    }
    const curWithoutAll = filterStatuses.filter((x) => x !== "不限");
    if (curWithoutAll.includes(s)) {
      const remaining = curWithoutAll.filter((x) => x !== s);
      setFilterStatuses(remaining.length === 0 ? ["不限"] : remaining);
    } else {
      setFilterStatuses([...curWithoutAll, s]);
    }
  };

  const handleOpenDetail = async (session: SessionItem) => {
    setSelectedSession(session);
    setDrawerOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetchSessionDetail(session.id);
      setSelectedSession(res.session);
      setDetailMessages(res.messages);
    } finally {
      setDetailLoading(false);
    }
  };

  const renderStatusBadge = (status: SessionItem["status"]) => {
    switch (status) {
      case "in_progress":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            进行中
          </span>
        );
      case "queue":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
            排队中
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            挂起
          </span>
        );
      case "converted":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            转工单
          </span>
        );
      case "closed":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            已关闭
          </span>
        );
    }
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto font-hub space-y-4">
      {/* 标题区 */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span>会话记录列表</span>
            <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              共 {total} 条会话
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            记录所有在线与热线会话的历史详情，包含完整沟通语料明细、转人工判定及问题总结
          </p>
        </div>
      </div>

      {/* 3.1 筛选条件录入区 */}
      <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm space-y-3 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {/* 咨询企业 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-20 text-right">
              咨询企业：
            </span>
            <input
              type="text"
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadData(1)}
              placeholder="录入企业名称查找"
              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
            />
          </div>

          {/* 联系人电话 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-20 text-right">
              联系人电话：
            </span>
            <input
              type="text"
              value={filterPhone}
              onChange={(e) => setFilterPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadData(1)}
              placeholder="录入手机号查找"
              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600 font-mono"
            />
          </div>

          {/* 会话状态（多选） */}
          <div className="relative flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-20 text-right">
              会话状态：
            </span>
            <button
              type="button"
              onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-left flex items-center justify-between bg-white text-xs hover:border-slate-300"
            >
              <span className="truncate text-slate-700">
                {filterStatuses.join("、")}
              </span>
              <span className="text-slate-400 text-[10px]">▼</span>
            </button>

            {statusDropdownOpen && (
              <div className="absolute top-full left-22 mt-1 w-44 bg-white border border-slate-200 rounded shadow-lg z-30 p-1.5 space-y-1">
                {SESSION_STATUS_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    className="flex items-center gap-2 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filterStatuses.includes(opt)}
                      onChange={() => handleStatusToggle(opt)}
                      className="rounded text-teal-600 focus:ring-0"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 是否转人工接待（单选） */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-20 text-right">
              转人工接待：
            </span>
            <select
              value={filterIsHuman}
              onChange={(e) => setFilterIsHuman(e.target.value)}
              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded bg-white text-slate-700 text-xs focus:outline-none focus:border-teal-600"
            >
              <option value="不限">不限</option>
              <option value="是">是</option>
              <option value="否">否</option>
            </select>
          </div>

          {/* 最后接待人 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-20 text-right">
              最后接待人：
            </span>
            <input
              type="text"
              value={filterAgentName}
              onChange={(e) => setFilterAgentName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadData(1)}
              placeholder="录入接待人姓名查找"
              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
            />
          </div>

          {/* 创建时间（起止时间在一个输入框内，精确到 hh:mm） */}
          <div className="flex items-center gap-2 xl:col-span-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-20 text-right">
              创建时间：
            </span>
            <div className="flex-1 max-w-[360px]">
              <DateTimeRangePicker
                fromValue={timeRange.start}
                toValue={timeRange.end}
                onChange={(from, to) => setTimeRange({ start: from, end: to })}
                placeholderFrom="开始时间"
                placeholderTo="截止时间"
              />
            </div>
          </div>
        </div>

        {/* 筛选按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => loadData(1)}
            className="px-4 py-1.5 bg-teal-600 text-white rounded font-medium hover:bg-teal-700 transition cursor-pointer"
          >
            查询
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterCompany("");
              setFilterPhone("");
              setFilterStatuses(["不限"]);
              setTimeRange({ start: "", end: "" });
              setFilterIsHuman("不限");
              setFilterAgentName("");
            }}
            className="px-3.5 py-1.5 border border-slate-200 text-slate-600 rounded hover:bg-slate-50 transition cursor-pointer"
          >
            重置
          </button>
        </div>
      </div>

      {/* 3.2 会话表格展示区 */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[1280px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="px-3.5 py-2.5 whitespace-nowrap">会话ID</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap min-w-[150px]">咨询企业</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap">咨询企业税号</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap">归属租户</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap">咨询人</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap">咨询人电话</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap min-w-[130px]">会话创建时间</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-center">会话状态</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-center">是否转人工</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap">最后接待人</th>
                <th className="px-3.5 py-2.5 whitespace-nowrap">关联工单号</th>
                <th className="px-3.5 py-2.5 min-w-[200px]">客户问题总结</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-slate-400">
                    数据加载中...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-slate-400">
                    暂无符合条件的会话记录
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-3.5 py-2.5 font-mono font-medium">
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(s)}
                        className="text-teal-600 hover:text-teal-800 hover:underline cursor-pointer"
                        title="点击查看会话详情"
                      >
                        {s.id}
                      </button>
                    </td>
                    <td className="px-3.5 py-2.5 font-medium text-slate-800">
                      {s.company_name}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600">
                      {s.tax_no ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-600" title={s.tenant_no ?? ""}>
                      {s.tenant_name || s.tenant_no || "—"}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {s.contact_name ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600">
                      {s.contact_phone ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                      {s.created_at.slice(0, 16)}
                    </td>
                    <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                      {renderStatusBadge(s.status)}
                    </td>
                    <td className="px-3.5 py-2.5 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                          s.is_human
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {s.is_human ? "是" : "否"}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {s.agent_name || "Agent"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono">
                      {s.ticket_short_code ? (
                        <Link
                          to={`/tickets?search=${s.ticket_short_code}`}
                          className="text-teal-600 hover:text-teal-800 hover:underline"
                        >
                          {s.ticket_short_code}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-600 truncate max-w-[260px]" title={s.summary ?? ""}>
                      {s.summary ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页栏 */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            第 {page} 页 / 共 {Math.ceil(total / 20) || 1} 页（总计 {total} 条）
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => loadData(page - 1)}
              className="px-2.5 py-1 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= Math.ceil(total / 20)}
              onClick={() => loadData(page + 1)}
              className="px-2.5 py-1 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* 4. 会话详情子页面抽屉 */}
      {drawerOpen && selectedSession && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/35 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative w-[780px] bg-white shadow-2xl h-full flex flex-col z-10 animate-in slide-in-from-right duration-200">
            {/* 4.2 标题栏：会话ID加粗 + 一条横线与正文隔开 */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900 font-mono">
                  {selectedSession.id}
                </span>
                <span className="text-xs text-slate-500">
                  {renderStatusBadge(selectedSession.status)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* 4.3 正文排版 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* 4.3.1 第 1 行：咨询企业、咨询企业税号、归属租户、咨询人、咨询人电话 一行平均分布，key和值上下结构 */}
              <div className="bg-slate-50/90 rounded-lg p-3.5 border border-slate-200/80">
                <div className="grid grid-cols-5 gap-3 text-center">
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">咨询企业</div>
                    <div className="font-semibold text-slate-800 break-words" title={selectedSession.company_name}>
                      {selectedSession.company_name}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">咨询企业税号</div>
                    <div className="font-mono text-slate-700 break-all">
                      {selectedSession.tax_no || "—"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">归属租户</div>
                    <div className="text-slate-700 break-words">
                      {selectedSession.tenant_name || selectedSession.tenant_no || "—"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">咨询人</div>
                    <div className="font-medium text-slate-800">
                      {selectedSession.contact_name || "—"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">咨询人电话</div>
                    <div className="font-mono text-slate-700">
                      {selectedSession.contact_phone || "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4.3.2 第 2 行：会话状态、创建时间、是否转人工、最后接待人、关联工单号 第二行水平平均分布，key和值上下结构 */}
              <div className="bg-slate-50/90 rounded-lg p-3.5 border border-slate-200/80">
                <div className="grid grid-cols-5 gap-3 text-center">
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">会话状态</div>
                    <div>{renderStatusBadge(selectedSession.status)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">创建时间</div>
                    <div className="font-mono text-slate-700">
                      {selectedSession.created_at.slice(0, 16)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">是否转人工</div>
                    <div className="font-medium text-slate-800">
                      {selectedSession.is_human ? "是" : "否"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">最后接待人</div>
                    <div className="font-medium text-slate-800">
                      {selectedSession.agent_name || "Agent"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400 font-medium">关联工单号</div>
                    <div className="font-mono font-medium text-teal-600">
                      {selectedSession.ticket_short_code || "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4.3.3 客户问题总结，单独一行，key和值左右结构，值加边框 */}
              <div className="flex items-start gap-3">
                <span className="w-24 text-right font-semibold text-slate-700 whitespace-nowrap pt-1">
                  客户问题总结：
                </span>
                <div className="flex-1 p-3 bg-amber-50/50 border border-amber-200/80 rounded-md text-slate-700 leading-relaxed">
                  {selectedSession.summary || "暂无自动总结内容"}
                </div>
              </div>

              {/* 4.3.4 会话内容，单独一行，key和值左右结构，值加边框，高度自适应最大，内嵌可上下拖动查看 */}
              <div className="flex items-start gap-3">
                <span className="w-24 text-right font-semibold text-slate-700 whitespace-nowrap pt-1">
                  会话内容明细：
                </span>
                <div className="flex-1 border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col h-[400px]">
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {detailLoading ? (
                      <div className="text-center py-10 text-slate-400">
                        对话记录加载中...
                      </div>
                    ) : detailMessages.length === 0 ? (
                      <div className="text-center py-10 text-slate-400">
                        暂无对话消息流记录
                      </div>
                    ) : (
                      detailMessages.map((msg) => {
                        const isCustomer = msg.sender_type === "customer";
                        const isSystem = msg.sender_type === "system";
                        const isBot = msg.sender_type === "bot";

                        if (isSystem) {
                          return (
                            <div key={msg.id} className="text-center my-2">
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] bg-slate-200/70 text-slate-600">
                                {msg.content}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${
                              isCustomer ? "items-start" : "items-end"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5 text-[10.5px] text-slate-400">
                              <span>
                                {isCustomer
                                  ? `客户 · ${msg.sender_name}`
                                  : isBot
                                  ? "智能助手 · Agent"
                                  : `坐席 · ${msg.sender_name}`}
                              </span>
                              <span>{msg.created_at.slice(11, 16)}</span>
                            </div>
                            <div
                              className={`max-w-[85%] px-3.5 py-2 rounded-lg text-xs leading-relaxed shadow-2xs whitespace-pre-wrap ${
                                isCustomer
                                  ? "bg-white text-slate-800 border border-slate-200 rounded-tl-none"
                                  : isBot
                                  ? "bg-purple-50 text-purple-900 border border-purple-200 rounded-tr-none"
                                  : "bg-teal-600 text-white rounded-tr-none"
                              }`}
                            >
                              {msg.content}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 抽屉底部 */}
            <div className="p-4 border-t border-slate-200 flex justify-end bg-slate-50">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-4 py-1.5 bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
