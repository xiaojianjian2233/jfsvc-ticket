import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { DateTimeRangePicker } from "@/components/DateTimeRangePicker";
import {
  type MessageItem,
  type SessionItem,
  fetchSessions,
  fetchSessionDetail,
} from "./receptionApi";

const SESSION_STATUS_OPTIONS = ["不限", "进行中", "排队中", "挂起", "转工单", "已关闭"];

function exportSessionsToExcel(targetSessions: SessionItem[], fileName: string) {
  const statusMap: Record<string, string> = {
    in_progress: "进行中",
    queue: "排队中",
    pending: "挂起",
    converted: "转工单",
    closed: "已关闭",
  };

  const rows = targetSessions.map((s) => ({
    会话ID: s.id,
    咨询企业: s.company_name,
    咨询企业税号: s.tax_no ?? "—",
    归属租户: s.tenant_name || s.tenant_no || "—",
    咨询人: s.contact_name ?? "—",
    咨询人电话: s.contact_phone ?? "—",
    会话创建时间: s.created_at,
    会话状态: statusMap[s.status] || s.status,
    是否转人工: s.is_human ? "是" : "否",
    最后接待人: s.agent_name || "—",
    关联工单号: s.ticket_short_code ?? "—",
    客户问题总结: s.summary ?? "—",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, // 会话ID
    { wch: 28 }, // 咨询企业
    { wch: 22 }, // 咨询企业税号
    { wch: 20 }, // 归属租户
    { wch: 12 }, // 咨询人
    { wch: 16 }, // 咨询人电话
    { wch: 22 }, // 会话创建时间
    { wch: 12 }, // 会话状态
    { wch: 12 }, // 是否转人工
    { wch: 14 }, // 最后接待人
    { wch: 18 }, // 关联工单号
    { wch: 45 }, // 客户问题总结
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "会话记录");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [timeRange, setTimeRange] = useState({ start: "", end: "" });
  const [filterIsHuman, setFilterIsHuman] = useState("不限");
  const [filterAgentName, setFilterAgentName] = useState("");

  // 勾选记录与多选状态
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type?: "success" | "warning";
  } | null>(null);

  // 会话详情抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);
  const [detailMessages, setDetailMessages] = useState<MessageItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 客户问题总结浮窗（宽度固定 500px，高度自适应，置于顶层）
  const [summaryModal, setSummaryModal] = useState<{
    id: string;
    company: string;
    summary: string;
  } | null>(null);

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

  useEffect(() => {
    if (!statusDropdownOpen) return;
    function handleDocClick(e: MouseEvent) {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [statusDropdownOpen]);

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

  const handleReset = () => {
    setFilterCompany("");
    setFilterPhone("");
    setFilterStatuses(["不限"]);
    setTimeRange({ start: "", end: "" });
    setFilterIsHuman("不限");
    setFilterAgentName("");
    setSelectedIds([]);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    const pageIds = sessions.map((s) => s.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      let targetSessions: SessionItem[] = [];

      if (selectedIds.length > 0) {
        // 1. 如果有勾选，就只导出勾选的记录
        const currentFound = sessions.filter((s) => selectedIds.includes(s.id));
        if (currentFound.length === selectedIds.length) {
          targetSessions = currentFound;
        } else {
          const res = await fetchSessions({
            company_name: filterCompany,
            contact_phone: filterPhone,
            statuses: filterStatuses,
            start_time: timeRange.start,
            end_time: timeRange.end,
            is_human: filterIsHuman,
            agent_name: filterAgentName,
            page: 1,
            page_size: 9999,
          });
          targetSessions = res.items.filter((s) => selectedIds.includes(s.id));
          const remainingIds = selectedIds.filter((id) => !targetSessions.some((s) => s.id === id));
          if (remainingIds.length > 0) {
            const extra = sessions.filter((s) => remainingIds.includes(s.id));
            targetSessions = [...targetSessions, ...extra];
          }
        }
      } else {
        // 2. 如果没有勾选，将筛选出的符合条件的所有记录导出生成本地 EXCEL 表
        const res = await fetchSessions({
          company_name: filterCompany,
          contact_phone: filterPhone,
          statuses: filterStatuses,
          start_time: timeRange.start,
          end_time: timeRange.end,
          is_human: filterIsHuman,
          agent_name: filterAgentName,
          page: 1,
          page_size: 9999,
        });
        targetSessions = res.items;
      }

      if (targetSessions.length === 0) {
        setToastMessage({ text: "暂无符合条件的会话记录可导出", type: "warning" });
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const fileName = `会话记录列表_${dateStr}.xlsx`;
      exportSessionsToExcel(targetSessions, fileName);

      setToastMessage({
        text: `已成功导出 ${targetSessions.length} 条会话记录到本地 Excel`,
        type: "success",
      });
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error("导出 Excel 失败:", err);
      setToastMessage({ text: "导出失败，请稍后重试", type: "warning" });
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setExporting(false);
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

  const renderStatusBadge = (
    status: SessionItem["status"],
    textClass = "text-[11px] font-medium"
  ) => {
    switch (status) {
      case "in_progress":
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${textClass} bg-emerald-50 text-emerald-700 border border-emerald-200`}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            进行中
          </span>
        );
      case "queue":
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${textClass} bg-cyan-50 text-cyan-700 border border-cyan-200`}>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
            排队中
          </span>
        );
      case "pending":
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${textClass} bg-amber-50 text-amber-700 border border-amber-200`}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            挂起
          </span>
        );
      case "converted":
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${textClass} bg-purple-50 text-purple-700 border border-purple-200`}>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            转工单
          </span>
        );
      case "closed":
      default:
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${textClass} bg-slate-100 text-slate-500 border border-slate-200`}>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            已关闭
          </span>
        );
    }
  };

  return (
    <div className="w-full px-4 pt-1 pb-1 font-hub flex flex-col h-[calc(100vh-68px)] min-h-[640px] space-y-2.5">
      {/* 1 & 2. 标题栏矩形底框：高 40px，宽度和右侧展示区一样，X=3 阴影，固定不随页面滚动 */}
      <div className="h-[40px] w-full bg-white border border-slate-200 rounded-[5px] px-4 flex items-center justify-between shadow-[3px_2px_6px_rgba(0,0,0,0.06)] flex-none sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <h1 className="text-[16px] font-bold text-slate-800 leading-none">
            会话记录列表
          </h1>
          <span className="text-[12px] text-slate-500 leading-none">
            记录所有在线与热线会话的历史详情，包含完整沟通语料明细、转人工判定及问题总结
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-blue-700 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded">
              <span>已勾选 {selectedIds.length} 项</span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-slate-400 hover:text-slate-600 underline cursor-pointer ml-1 text-[11px]"
              >
                取消
              </button>
            </div>
          )}
          <span className="text-[12px] font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            共 {total} 条会话
          </span>
        </div>
      </div>

      {/* 3, 4, 5, 6. 筛选条件录入区：字体 13 号，录入框高 25px，宽 300px，一行展示 4 个筛选条件 */}
      <div className="bg-white rounded-[5px] p-3 border border-slate-200 shadow-sm space-y-3 text-[13px] flex-none">
        {/* 第 1 行：4 个筛选条件 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* 咨询企业 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-[85px] text-right text-[13px]">
              咨询企业：
            </span>
            <input
              type="text"
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadData(1)}
              placeholder="录入企业名称查找"
              className="w-[300px] h-[25px] px-2.5 border border-slate-200 rounded-[5px] text-[13px] focus:outline-none focus:border-[rgb(102,139,221)] bg-white"
            />
          </div>

          {/* 联系人电话 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-[85px] text-right text-[13px]">
              联系人电话：
            </span>
            <input
              type="text"
              value={filterPhone}
              onChange={(e) => setFilterPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadData(1)}
              placeholder="录入手机号查找"
              className="w-[300px] h-[25px] px-2.5 border border-slate-200 rounded-[5px] text-[13px] focus:outline-none focus:border-[rgb(102,139,221)] font-mono bg-white"
            />
          </div>

          {/* 会话状态（多选，增加【排队中】） */}
          <div className="relative flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-[85px] text-right text-[13px]">
              会话状态：
            </span>
            <div ref={statusDropdownRef} className="relative w-[300px]">
              <button
                type="button"
                aria-label="会话状态选择"
                onClick={() => setStatusDropdownOpen((v) => !v)}
                className="w-[300px] h-[25px] px-2.5 border border-slate-200 rounded-[5px] text-left flex items-center justify-between bg-white text-[13px] hover:border-slate-300 cursor-pointer"
              >
                <span className="truncate text-slate-700">
                  {filterStatuses.join("、")}
                </span>
                <span className="text-slate-400 text-[10px]">▼</span>
              </button>

              {statusDropdownOpen && (
                <div className="absolute top-[28px] left-0 w-[300px] bg-white border border-slate-200 rounded-[5px] shadow-lg p-2 z-30 space-y-1 text-[13px]">
                  {SESSION_STATUS_OPTIONS.map((opt) => {
                    const checked = filterStatuses.includes(opt);
                    return (
                      <label
                        key={opt}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleStatusToggle(opt)}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-[rgb(102,139,221)] focus:ring-[rgb(102,139,221)]"
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 是否转人工接待（单选） */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium whitespace-nowrap w-[85px] text-right text-[13px]">
              转人工接待：
            </span>
            <select
              value={filterIsHuman}
              onChange={(e) => setFilterIsHuman(e.target.value)}
              className="w-[300px] h-[25px] px-2.5 border border-slate-200 rounded-[5px] bg-white text-slate-700 text-[13px] focus:outline-none focus:border-[rgb(102,139,221)]"
            >
              <option value="不限">不限</option>
              <option value="是">是</option>
              <option value="否">否</option>
            </select>
          </div>
        </div>

        {/* 第 2 行：最后接待人、创建时间，以及右侧【查询】、【重置】与【导出】操作按钮 */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-6">
            {/* 最后接待人 */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-medium whitespace-nowrap w-[85px] text-right text-[13px]">
                最后接待人：
              </span>
              <input
                type="text"
                value={filterAgentName}
                onChange={(e) => setFilterAgentName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadData(1)}
                placeholder="录入接待人姓名查找"
                className="w-[300px] h-[25px] px-2.5 border border-slate-200 rounded-[5px] text-[13px] focus:outline-none focus:border-[rgb(102,139,221)] bg-white"
              />
            </div>

            {/* 创建时间（起止时间在一个输入框内，精确到 hh:mm） */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-medium whitespace-nowrap w-[85px] text-right text-[13px]">
                创建时间：
              </span>
              <div className="w-[300px]">
                <DateTimeRangePicker
                  fromValue={timeRange.start}
                  toValue={timeRange.end}
                  onChange={(from, to) => setTimeRange({ start: from, end: to })}
                  placeholderFrom="开始时间"
                  placeholderTo="截止时间"
                  className="!h-[25px] !w-[300px] !rounded-[5px] !text-[13px] !border-slate-200"
                />
              </div>
            </div>
          </div>

          {/* 查询与重置操作按钮组合：高 25px，宽 100px，圆角 5px，查询背景色 rgb(102, 139, 221)，字体 13 号 */}
          <div className="flex items-center gap-2.5 flex-none">
            <button
              type="button"
              onClick={() => loadData(1)}
              className="w-[100px] h-[25px] bg-[rgb(102,139,221)] text-white rounded-[5px] text-[13px] font-medium hover:opacity-90 transition cursor-pointer flex items-center justify-center shadow-xs"
            >
              查询
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="w-[100px] h-[25px] border border-slate-200 text-slate-600 rounded-[5px] text-[13px] bg-white hover:bg-slate-50 transition cursor-pointer flex items-center justify-center"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {/* 7, 8, 9, 10. 会话表格展示区：字体 13 号，不换行，完整展示咨询企业和归属租户，高度固定 */}
      <div className="bg-white rounded-[5px] border border-slate-200 shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
        {/* 列表左上角操作区：导出按钮位于左上角，填充颜色 rgb(35, 94, 212) */}
        <div className="px-3.5 py-2 border-b border-slate-200 flex items-center justify-between flex-none bg-white">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="w-[100px] h-[25px] bg-[rgb(35,94,212)] text-white rounded-[5px] text-[13px] font-medium hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-60"
              title={
                selectedIds.length > 0
                  ? `导出选中的 ${selectedIds.length} 条记录`
                  : "导出符合当前筛选条件的全部记录"
              }
            >
              <svg
                className="w-3.5 h-3.5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span>{exporting ? "导出中..." : selectedIds.length > 0 ? `导出 (${selectedIds.length})` : "导出"}</span>
            </button>
            {selectedIds.length > 0 && (
              <span className="text-[12px] text-slate-500">
                已勾选 <strong className="text-[rgb(35,94,212)] font-semibold">{selectedIds.length}</strong> 项
              </span>
            )}
          </div>
          <span className="text-slate-400 text-[12px]">
            共 <span className="font-semibold text-slate-600">{total}</span> 条会话
          </span>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-left text-[13px] border-collapse min-w-[1430px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                {/* 勾选多选框列：固定在最左侧 left-0 */}
                <th
                  className="px-3 py-2.5 w-[44px] min-w-[44px] text-center whitespace-nowrap text-[13px] font-bold sticky top-0 left-0 z-30 bg-slate-50 border-r border-slate-200 shadow-[1px_0_2px_rgba(0,0,0,0.03)]"
                >
                  <input
                    type="checkbox"
                    aria-label="全选本页会话"
                    checked={
                      sessions.length > 0 &&
                      sessions.every((s) => selectedIds.includes(s.id))
                    }
                    ref={(el) => {
                      if (el) {
                        const someSelected = sessions.some((s) => selectedIds.includes(s.id));
                        const allSelected =
                          sessions.length > 0 && sessions.every((s) => selectedIds.includes(s.id));
                        el.indeterminate = someSelected && !allSelected;
                      }
                    }}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-[rgb(102,139,221)] focus:ring-[rgb(102,139,221)] cursor-pointer align-middle"
                  />
                </th>
                {/* 会话ID列固定：left-[44px]，不随左右拖动移动，永远在顶层，防止重叠 */}
                <th
                  className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 left-[44px] z-30 bg-slate-50 border-r border-slate-200 shadow-[2px_0_4px_rgba(0,0,0,0.04)]"
                  style={{ width: 170, minWidth: 170 }}
                >
                  会话ID
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  咨询企业
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  咨询企业税号
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  归属租户
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  咨询人
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  咨询人电话
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap min-w-[140px] text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  会话创建时间
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-center text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  会话状态
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-center text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  是否转人工
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  最后接待人
                </th>
                <th className="px-3.5 py-2.5 whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  关联工单号
                </th>
                <th className="px-3.5 py-2.5 min-w-[220px] whitespace-nowrap text-[13px] font-bold sticky top-0 z-20 bg-slate-50">
                  客户问题总结
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={13} className="text-center py-16 text-slate-400 text-[13px] whitespace-nowrap">
                    数据加载中...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-16 text-slate-400 text-[13px] whitespace-nowrap">
                    暂无符合条件的会话记录
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} className="group hover:bg-slate-50/80 transition whitespace-nowrap">
                    {/* 勾选框：固定在最左侧 left-0 */}
                    <td
                      className="px-3 py-2.5 w-[44px] min-w-[44px] text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 shadow-[1px_0_2px_rgba(0,0,0,0.03)] whitespace-nowrap"
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择会话 ${s.id}`}
                        checked={selectedIds.includes(s.id)}
                        onChange={() => handleToggleSelect(s.id)}
                        className="w-4 h-4 rounded border-slate-300 text-[rgb(102,139,221)] focus:ring-[rgb(102,139,221)] cursor-pointer align-middle"
                      />
                    </td>
                    {/* 会话ID：固定列，超链接颜色 rgb(102, 139, 221)，背景纯白/hover灰，彻底阻断内容重叠 */}
                    <td
                      className="px-3.5 py-2.5 font-mono font-medium sticky left-[44px] z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 shadow-[2px_0_4px_rgba(0,0,0,0.04)] whitespace-nowrap"
                      style={{ width: 170, minWidth: 170 }}
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenDetail(s)}
                        className="text-[rgb(102,139,221)] hover:underline cursor-pointer font-mono font-medium text-[13px]"
                        title="点击查看会话详情"
                      >
                        {s.id}
                      </button>
                    </td>
                    {/* 咨询企业：不换行，完整展示 */}
                    <td className="px-3.5 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                      {s.company_name}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {s.tax_no ?? "—"}
                    </td>
                    {/* 归属租户：不换行，完整展示 */}
                    <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap" title={s.tenant_no ?? ""}>
                      {s.tenant_name || s.tenant_no || "—"}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700 whitespace-nowrap">
                      {s.contact_name ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {s.contact_phone ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-500 whitespace-nowrap">
                      {s.created_at.slice(0, 16)}
                    </td>
                    <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                      {renderStatusBadge(s.status)}
                    </td>
                    <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[12px] font-medium ${
                          s.is_human
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {s.is_human ? "是" : "否"}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700 whitespace-nowrap">
                      {s.agent_name || "Agent"}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono whitespace-nowrap">
                      {s.ticket_short_code ? (
                        <Link
                          to={`/tickets?search=${s.ticket_short_code}`}
                          className="text-[rgb(102,139,221)] hover:underline"
                        >
                          {s.ticket_short_code}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {/* 客户问题总结：不换行，显示不全省略号显示；点击后弹顶层 500px 浮窗 */}
                    <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                      <div
                        onClick={() =>
                          setSummaryModal({
                            id: s.id,
                            company: s.company_name,
                            summary: s.summary || "",
                          })
                        }
                        className="truncate max-w-[260px] cursor-pointer hover:text-slate-900 hover:underline transition-colors"
                        title="点击查看完整问题总结"
                      >
                        {s.summary ?? "—"}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页栏：和窗口底部对齐，字体 13 号 */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[13px] text-slate-500 flex-none">
          <span>
            第 {page} 页 / 共 {Math.ceil(total / 20) || 1} 页（总计 {total} 条）
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => loadData(page - 1)}
              className="px-3 py-1 border border-slate-200 rounded-[5px] bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-[13px]"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= Math.ceil(total / 20)}
              onClick={() => loadData(page + 1)}
              className="px-3 py-1 border border-slate-200 rounded-[5px] bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed text-[13px]"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* 客户问题总结完整内容浮窗（宽度固定 500px，高度自适应，置于最顶层无遮挡） */}
      {summaryModal && (
        <div
          data-testid="summary-modal-backdrop"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/25 backdrop-blur-xs animate-in fade-in duration-100"
          onClick={() => setSummaryModal(null)}
        >
          <div
            data-testid="summary-modal"
            className="w-[500px] bg-white rounded-[8px] shadow-2xl border border-slate-200 p-5 text-[13px] flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 浮窗头部 */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 flex-none">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-[15px]">客户问题总结详情</span>
                <span className="text-[12px] text-slate-400 font-mono">({summaryModal.id})</span>
              </div>
              <button
                type="button"
                onClick={() => setSummaryModal(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none cursor-pointer p-0.5"
                title="关闭"
              >
                ×
              </button>
            </div>

            {/* 浮窗正文：高度根据内容多少自适应 */}
            <div className="py-4 text-slate-700 leading-relaxed break-words whitespace-pre-wrap overflow-y-auto max-h-[60vh] select-text">
              {summaryModal.summary.trim() ? summaryModal.summary : "（该会话暂无客户问题总结）"}
            </div>

            {/* 浮窗底部：所属企业与关闭按钮 */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[12px] text-slate-500 flex-none">
              <span className="truncate max-w-[340px]" title={summaryModal.company}>
                企业：{summaryModal.company}
              </span>
              <button
                type="button"
                onClick={() => setSummaryModal(null)}
                className="px-3.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-[5px] text-[12px] font-medium transition cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. 会话详情子页面抽屉 */}
      {drawerOpen && selectedSession && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/35 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative w-[1000px] max-w-full bg-white shadow-2xl h-full flex flex-col z-10 animate-in slide-in-from-right duration-200">
            {/* 1) 标题栏：字号 14 号加粗字体 */}
            <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 flex-none">
              <div className="flex items-center gap-2.5">
                <span className="text-[14px] font-bold text-slate-900 font-mono">
                  {selectedSession.id}
                </span>
                <span className="text-[12px] text-slate-500">
                  {renderStatusBadge(selectedSession.status)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none cursor-pointer p-0.5"
                title="关闭"
              >
                ×
              </button>
            </div>

            {/* 正文区域：flex-1 min-h-0 flex flex-col p-5 pb-0 space-y-3.5 text-[13px] */}
            <div className="flex-1 min-h-0 flex flex-col p-5 pb-0 space-y-3.5 text-[13px]">
              {/* 2) 容器标题【客户信息】（13号加粗），放在一个容器里面，并且和 value 左对齐；保证值不换行且为13号不加粗 */}
              <div className="bg-slate-50/90 rounded-[6px] p-3.5 border border-slate-200/80 flex-none space-y-2.5">
                <div className="text-[13px] font-bold text-slate-800 text-left">
                  客户信息
                </div>
                <div className="grid grid-cols-[minmax(210px,1.4fr)_minmax(180px,1.2fr)_minmax(160px,1.1fr)_minmax(100px,0.8fr)_minmax(140px,1fr)] gap-y-3 gap-x-4 text-left">
                  {/* 第 1 行：咨询企业、咨询企业税号、归属租户、咨询人、咨询人电话 */}
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">咨询企业</div>
                    <div className="text-[13px] font-normal text-slate-800 whitespace-nowrap truncate" title={selectedSession.company_name}>
                      {selectedSession.company_name}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">咨询企业税号</div>
                    <div className="text-[13px] font-normal font-mono text-slate-700 whitespace-nowrap truncate" title={selectedSession.tax_no || "—"}>
                      {selectedSession.tax_no || "—"}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">归属租户</div>
                    <div className="text-[13px] font-normal text-slate-700 whitespace-nowrap truncate" title={selectedSession.tenant_name || selectedSession.tenant_no || "—"}>
                      {selectedSession.tenant_name || selectedSession.tenant_no || "—"}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">咨询人</div>
                    <div className="text-[13px] font-normal text-slate-800 whitespace-nowrap truncate" title={selectedSession.contact_name || "—"}>
                      {selectedSession.contact_name || "—"}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">咨询人电话</div>
                    <div className="text-[13px] font-normal font-mono text-slate-700 whitespace-nowrap truncate" title={selectedSession.contact_phone || "—"}>
                      {selectedSession.contact_phone || "—"}
                    </div>
                  </div>

                  {/* 第 2 行：会话状态、创建时间、是否转人工、最后解答人、关联工单 */}
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">会话状态</div>
                    <div className="whitespace-nowrap">
                      {renderStatusBadge(selectedSession.status, "text-[13px] font-normal")}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">创建时间</div>
                    <div className="text-[13px] font-normal font-mono text-slate-700 whitespace-nowrap truncate" title={selectedSession.created_at.slice(0, 16)}>
                      {selectedSession.created_at.slice(0, 16)}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">是否转人工</div>
                    <div className="text-[13px] font-normal text-slate-800 whitespace-nowrap">
                      {selectedSession.is_human ? "是" : "否"}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">最后解答人</div>
                    <div className="text-[13px] font-normal text-slate-800 whitespace-nowrap truncate" title={selectedSession.agent_name || "Agent"}>
                      {selectedSession.agent_name || "Agent"}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400 font-normal whitespace-nowrap">关联工单</div>
                    <div className="text-[13px] font-normal font-mono text-[rgb(102,139,221)] whitespace-nowrap truncate">
                      {selectedSession.ticket_short_code ? (
                        <Link
                          to={`/tickets?search=${selectedSession.ticket_short_code}`}
                          className="text-[rgb(102,139,221)] hover:underline font-normal"
                        >
                          {selectedSession.ticket_short_code}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3 & 4) 客户问题总结：13号字体加粗，展示矩形框距离内容总结 5px */}
              <div className="flex-none">
                <div className="text-[13px] font-bold text-slate-800 text-left">
                  客户问题总结
                </div>
                <div className="mt-[5px] p-3 bg-amber-50/50 border border-amber-200/80 rounded-[6px] text-slate-700 text-[13px] leading-relaxed break-words">
                  {selectedSession.summary || "暂无自动总结内容"}
                </div>
              </div>

              {/* 5 & 6) 会话内容明细：13号字体加粗；展示区高度调到页面能展示最大，底部和下方按钮区顶部间隔 5px */}
              <div className="flex-1 min-h-0 flex flex-col mb-[5px]">
                <div className="text-[13px] font-bold text-slate-800 text-left mb-[5px] flex-none">
                  会话内容明细
                </div>
                <div className="flex-1 min-h-0 border border-slate-200 rounded-[6px] p-3 bg-slate-50 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {detailLoading ? (
                      <div className="text-center py-10 text-slate-400 text-[13px]">
                        对话记录加载中...
                      </div>
                    ) : detailMessages.length === 0 ? (
                      <div className="text-center py-10 text-slate-400 text-[13px]">
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
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] bg-slate-200/70 text-slate-600">
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
                            <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-slate-400">
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
                              className={`max-w-[85%] px-3.5 py-2 rounded-lg text-[13px] leading-relaxed shadow-2xs whitespace-pre-wrap ${
                                isCustomer
                                  ? "bg-white text-slate-800 border border-slate-200 rounded-tl-none"
                                  : isBot
                                  ? "bg-purple-50 text-purple-900 border border-purple-200 rounded-tr-none"
                                  : "bg-[rgb(102,139,221)] text-white rounded-tr-none"
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

            {/* 抽屉底部操作区 */}
            <div className="p-3.5 border-t border-slate-200 flex justify-end bg-slate-50 flex-none">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-4 py-1.5 bg-slate-200 text-slate-700 rounded-[5px] text-[13px] hover:bg-slate-300 transition cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导出/操作 Toast 提示弹窗 */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-2 duration-200 pointer-events-none">
          <div
            className={`px-4 py-2.5 rounded-[5px] shadow-lg text-[13px] flex items-center gap-2 border ${
              toastMessage.type === "warning"
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-emerald-50 text-emerald-800 border-emerald-200"
            }`}
          >
            <span>{toastMessage.type === "warning" ? "⚠️" : "✓"}</span>
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
