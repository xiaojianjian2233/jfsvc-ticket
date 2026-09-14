import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api } from "@/api/client";
import { isSupervisor } from "@/api/auth";
import { MetricCard, SectionTitle, dashboardPage, dashboardPanel, dashboardButton } from "./DashboardUI";

function todayBeijing(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function DailyDashboardPage() {
  if (!isSupervisor()) return <div className={dashboardPanel}>每日看板仅主管/管理员可见。</div>;
  return <DailyDashboardPageInner />;
}

function DailyDashboardPageInner() {
  const today = todayBeijing();
  const [date, setDate] = useState(today);
  const query = useQuery({
    queryKey: ["daily-dashboard", date],
    queryFn: () => api.get("/api/metrics/daily-dashboard", { date }),
    staleTime: 60_000,
  });
  return <div className={dashboardPage}>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">每日看板</h1><p className="mt-1 text-xs text-hub-textMuted">跟踪每日处理进展，查看团队工作分布</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <button className={dashboardButton} onClick={() => setDate(shiftDay(date, -1))}>前一天</button>
        <label className="flex flex-col gap-1 text-xs text-hub-textMuted">统计日期（北京时间）
          <input type="date" value={date} max={today} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= today) setDate(e.target.value); }} className={dashboardButton} data-testid="date-picker" />
        </label>
        <button className={dashboardButton} disabled={date >= today} onClick={() => setDate(shiftDay(date, 1))}>后一天</button>
        <button className={dashboardButton} disabled={date === today} onClick={() => setDate(today)}>今天</button>
        <button className={dashboardButton} disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "刷新中…" : "刷新数据"}</button>
      </div>
    </div>
    {query.isLoading ? <div role="status" className={dashboardPanel}>正在加载每日数据…</div> : query.error ? <div role="alert" className={dashboardPanel}>看板加载失败，请稍后重试。<button className={`${dashboardButton} ml-3`} onClick={() => void query.refetch()}>重新加载</button></div> : query.data ? <DailyDashboardBody data={query.data} /> : null}
  </div>;
}

type DailyDashboardData = Awaited<ReturnType<typeof api.get<"/api/metrics/daily-dashboard">>>;
const SERIES = [
  { key: "transferred_to_dev", label: "转研发数量", name: "转研发", color: "#5868aa", tone: "blue", note: "当日成功转研发的工单，按工单去重" },
  { key: "received", label: "当日接收", name: "接收", color: "#3d6bb3", tone: "blue", note: "所选日期接收的工单" },
  { key: "completed", label: "当日完成", name: "完成", color: "#177e83", tone: "teal", note: "所选日期完成的工单" },
  { key: "returned_to_ksm", label: "退回KSM", name: "退回KSM", color: "#c98a1e", tone: "amber", note: "当日退回来源系统" },
  { key: "ksm_rejected", label: "KSM打回", name: "KSM打回", color: "#b04a4a", tone: "rose", note: "当日被来源系统打回" },
  { key: "supplemented", label: "补充资料", name: "补充资料", color: "#7a5ba6", tone: "neutral", note: "当日收到补充资料" },
] as const;

function DailyDashboardBody({ data }: { data: DailyDashboardData }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SERIES)[number]["key"]>("received");
  const byAssignee = [...(data.by_assignee ?? [])].filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0) || a.name.localeCompare(b.name, "zh-CN"));
  return <div className="space-y-7">
    <section>
      <SectionTitle title="当日统计" note={`${data.date} · 各项按对应事件计数，完成与接收不一定来自同一批工单`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {SERIES.map(s => <MetricCard key={s.key} label={s.label} value={(data.totals[s.key] ?? 0).toLocaleString()} note={s.note} tone={s.tone} testId={`kpi-${s.key}`} />)}
      </div>
    </section>
    <section className={dashboardPanel}>
      <SectionTitle title="按处理人统计" note="按当前处理人归属统计；图表与明细同步筛选、排序">
        <div className="flex flex-wrap gap-2">
          <input aria-label="搜索处理人" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索处理人姓名" className={dashboardButton} />
          <label className="flex items-center gap-2 text-xs text-hub-textSecondary">排序
            <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className={dashboardButton}>{SERIES.map(s => <option key={s.key} value={s.key}>{s.name}由高到低</option>)}</select>
          </label>
        </div>
      </SectionTitle>
      {byAssignee.length === 0 ? <div className="py-12 text-center text-hub-textMuted">{search.trim() ? "没有匹配的处理人，请调整关键词" : "当日暂无数据"}</div> : <>
        <div className="max-h-[480px] overflow-y-auto">
          <div style={{ width: "100%", height: Math.max(260, byAssignee.length * 94 + 60) }} data-testid="by-assignee-bar-chart">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={byAssignee} layout="vertical" margin={{ left: 0, right: 24, top: 12 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={88} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e9edf1", fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
              {SERIES.map(s => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[0, 3, 3, 0]} maxBarSize={10} />)}
            </BarChart></ResponsiveContainer>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border border-hub-borderLight">
          <table className="w-full min-w-[580px] text-xs" aria-label="处理人数据明细">
            <thead className="bg-slate-50 text-hub-textSecondary"><tr><th scope="col" className="p-3 text-left font-medium">处理人</th>{SERIES.map(s => <th scope="col" key={s.key} className="p-3 text-right font-medium">{s.name}</th>)}</tr></thead>
            <tbody>{byAssignee.map(row => <tr key={row.user_id ?? "unassigned"} className="border-t border-hub-borderLight hover:bg-slate-50"><th scope="row" className="p-3 text-left font-medium">{row.name}</th>{SERIES.map(s => <td key={s.key} className="p-3 text-right tabular-nums">{(row[s.key] ?? 0).toLocaleString()}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </>}
    </section>
  </div>;
}
