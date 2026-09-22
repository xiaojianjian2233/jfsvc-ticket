/** 综合看板：按接收月份、产品线查看工单规模、效率与分布。聚合口径由后端提供。 */
import { MetricCard, SectionTitle, dashboardPage } from "./DashboardUI";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { api } from "@/api/client";
import { ProductLineSelect } from "@/components/selectors";
import { isSupervisor } from "@/api/auth";

const ALL_MONTHS = "__all__";

// "2026-04" → 该月的北京时区闭区间 [start, end)（end 为下月 1 号）
function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m)}-01T00:00:00+08:00`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${pad(nm)}-01T00:00:00+08:00`;
  return { start, end };
}

const HUB_TYPES = ["Operation", "Bug_fix", "Demand", "Internal_task"] as const;
type HubType = (typeof HUB_TYPES)[number];
const TYPE_LABELS: Record<HubType, string> = {
  Operation: "运营",
  Bug_fix: "Bug修复",
  Demand: "需求",
  Internal_task: "内部任务",
};
export const TYPE_COLORS: Record<HubType, string> = {
  Bug_fix: "#ef4444",
  Demand: "#3b82f6",
  Operation: "#eab308",
  Internal_task: "#6b7280",
};

function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  return `${h.toFixed(1)}h`;
}

function fmtPct(r: number | null | undefined): string {
  if (r === null || r === undefined) return "—";
  return `${(r * 100).toFixed(1)}%`;
}

export function AnalyticsPage() {
  if (!isSupervisor()) {
    return (
      <div className="bg-white border border-hub-border rounded-[10px] p-5 text-xs text-hub-textFaint">
        统计看板仅主管/管理员可见。
      </div>
    );
  }
  return <AnalyticsPageInner />;
}

function AnalyticsPageInner() {
  const [month, setMonth] = useState<string>(ALL_MONTHS);
  const [productLine, setProductLine] = useState<string>();

  const params = useMemo(() => {
    return { ...(month === ALL_MONTHS ? {} : monthRange(month)), product_line: productLine };
  }, [month, productLine]);

  const query = useQuery({
    queryKey: ["ticket-analytics", month, productLine],
    queryFn: () => api.get("/api/metrics/ticket-analytics", params),
    staleTime: 60_000,
  });

  // 月份下拉选项来自后端 available_months（全量，不随筛选变化）
  const months = Array.from(new Set([
    ...((query.data?.available_months ?? []) as string[]),
    ...(month === ALL_MONTHS ? [] : [month]),
  ])).sort().reverse();

  return (
    <div className={dashboardPage}>
      {/* 页头 */}
      <div className="flex flex-wrap items-end gap-3.5 mb-6">
        <div>
          <h1 className="m-0 text-[24px] font-semibold tracking-tight">综合看板</h1>
          <div className="text-[11.5px] text-hub-textFaint mt-0.5">查看工单规模、处理效率与人员分布</div>
        </div>
        <div className="flex-1" />
        <label className="flex flex-col gap-1 text-xs text-hub-textMuted">
          产品线
          <ProductLineSelect value={productLine} onChange={setProductLine} placeholder="全部产品线" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-hub-textMuted">
          接收月份
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-hub-border rounded-[9px] px-3 py-[6px] text-[12.5px] bg-white text-hub-text"
          data-testid="month-select"
        >
          <option value={ALL_MONTHS}>全部月份</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m.replace("-", " 年 ")} 月
            </option>
          ))}
        </select>
        </label>
        <button type="button" onClick={() => { setMonth(ALL_MONTHS); setProductLine(undefined); }} className="px-3 py-2 text-hub-textSecondary hover:bg-white rounded-lg">重置筛选</button>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="px-3 py-2 bg-white border border-hub-border rounded-lg disabled:opacity-50">{query.isFetching ? "刷新中…" : "刷新数据"}</button>
      </div>
      <p className="text-xs text-hub-textMuted mb-4">按工单接收时间（北京时间）筛选；耗时仅统计有处理时长记录的工单，未记录值显示“—”。</p>

      {query.isLoading ? (
        <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm mb-6 text-xs text-hub-textFaint">
          加载中…
        </div>
      ) : query.error ? (
        <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm mb-6 text-xs text-hub-rose">
          看板加载失败，请稍后重试。
          <button type="button" onClick={() => void query.refetch()} className="ml-3 underline">重新加载</button>
        </div>
      ) : query.data ? (
        query.data.kpi.total === 0 ? (
          <div className="bg-white border border-hub-border rounded-xl p-10 text-center text-hub-textMuted">当前筛选下暂无工单，请调整月份或产品线。</div>
        ) : <AnalyticsBody data={query.data} />
      ) : null}
    </div>
  );
}

type AnalyticsData = Awaited<ReturnType<typeof api.get<"/api/metrics/ticket-analytics">>>;

function AnalyticsBody({ data }: { data: AnalyticsData }) {
  const kpi = data.kpi;
  const slaLow = kpi.sla_rate !== null && kpi.sla_rate !== undefined && kpi.sla_rate < 0.8;

  const typePieData: { name: string; type: string; value: number }[] = HUB_TYPES.map((t) => ({
    name: TYPE_LABELS[t],
    type: t,
    value: (kpi.by_type as Record<string, number>)[t] ?? 0,
  }));

  const otherCount = Math.max(0, kpi.total - typePieData.reduce((sum, item) => sum + item.value, 0));
  if (otherCount > 0) typePieData.push({ name: "其他 / 未分类", type: "Other", value: otherCount });
  const typeColor = (type: string) => TYPE_COLORS[type as HubType] ?? "#94a3b8";

  const byModule = (data.by_module ?? []) as Array<Record<string, any>>;
  const plChartData = byModule.map((row) => ({
    module: row.module,
    total: row.total,
    overdue_count: row.overdue_count ?? 0,
    ...row.by_type,
  }));

  const byAssignee = (data.by_assignee ?? []) as Array<Record<string, any>>;
  const assigneeChartData = byAssignee.map((row) => ({
    name: row.name,
    total: row.total,
  }));

  const trend = (data.trend ?? []) as Array<Record<string, any>>;
  const hist = (data.handle_hours_hist ?? []) as Array<Record<string, any>>;

  const devStaff = (data.by_dev_staff ?? []) as Array<Record<string, any>>;
  const devChartData = devStaff.map((row) => ({
    name: row.name,
    total: row.total,
    ...row.by_type,
  }));

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle title="处理进展" note="按所选月份和产品线统计；待处理含处理中、处理异常" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            label="待处理工单总数"
            value={(kpi.pending_count ?? 0).toLocaleString()}
            note={<>运营类 {(kpi.pending_operation_count ?? 0).toLocaleString()} 个 · Bug/需求类 {(kpi.pending_dev_count ?? 0).toLocaleString()} 个</>}
            tone="amber"
          />
          <MetricCard
            label="超期工单"
            value={(kpi.overdue_count ?? 0).toLocaleString()}
            note={<>运营类 {(kpi.overdue_operation_count ?? 0).toLocaleString()} 个 · Bug/需求类 {(kpi.overdue_dev_count ?? 0).toLocaleString()} 个</>}
            tone="rose"
          />
          <MetricCard label="处理完成" value={(kpi.completed_count ?? 0).toLocaleString()} note="已答复" tone="teal" />
          <MetricCard label="退回工单" value={(kpi.returned_count ?? 0).toLocaleString()} note="补充资料、转单退回" tone="neutral" />
        </div>
      </section>
      <section>
        <SectionTitle title="工单总览" note="先了解规模与效率，再查看人员和模块分布" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="工单总量" value={kpi.total.toLocaleString()} note="所选接收范围内的全部工单" testId="kpi-total" />
          <MetricCard label="平均处理时长" value={fmtHours(kpi.avg_handle_hours)} note="仅包含已记录处理时长的工单" tone="blue" />
          <MetricCard label="SLA 达成率" value={fmtPct(kpi.sla_rate)} tone={slaLow ? "rose" : "teal"} testId="kpi-sla-rate" noteTestId="kpi-sla-base" note={`基于 ${kpi.sla_base?.toLocaleString() ?? 0} 条耗时及 SLA 标准完整的工单`} />
          <MetricCard label="未分配工单" value={(kpi.unassigned_count ?? 0).toLocaleString()} note={`平均处理时长 ${fmtHours(kpi.unassigned_avg_hours)} · 所选范围内`} tone={(kpi.unassigned_count ?? 0) > 0 ? "amber" : "neutral"} testId="kpi-unassigned" />
        </div>
      </section>
      <section className="rounded-2xl border border-hub-borderLight bg-white p-5 shadow-sm">
        <SectionTitle title="工单类型分布" note="按工单类型查看数量与占比" />
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-full sm:w-52 shrink-0" style={{ height: 160 }} data-testid="type-pie-chart">
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={false} data={typePieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={68} paddingAngle={3} stroke="none">{typePieData.map(d => <Cell key={d.type} fill={typeColor(d.type)} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
          </div>
          <div className="grid w-full grid-cols-2 lg:grid-cols-4 gap-4">
            {typePieData.map(d => <div key={d.type} className="rounded-xl bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs text-hub-textSecondary"><span className="h-2 w-2 rounded-full" style={{ background: typeColor(d.type) }} />{d.name}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{d.value.toLocaleString()}</div>
              <div className="mt-1 text-xs text-hub-textMuted">占全部 {fmtPct(kpi.total ? d.value / kpi.total : null)}</div>
            </div>)}
          </div>
        </div>
      </section>

      {/* ② 研发责任人维度（Bug/需求工单） */}
      <div>
        <div className="text-sm font-semibold text-hub-text mb-4">
          研发责任人工单量（Bug / 需求）
        </div>
        {devChartData.length === 0 ? (
          <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm text-xs text-hub-textFaint">
            暂无 Bug/需求工单
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* 工单量堆叠柱状 */}
            <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm">
              <div className="text-[11.5px] text-hub-textMuted mb-2">Bug/需求工单总数（按研发责任人）</div>
              <div
                style={{ width: "100%", height: Math.max(200, devChartData.length * 30) }}
                data-testid="dev-staff-bar-chart"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={devChartData} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10.5 }} />
                    {HUB_TYPES.filter((t) => t === "Bug_fix" || t === "Demand").map((t) => (
                      <Bar
                        key={t}
                        dataKey={t}
                        name={TYPE_LABELS[t]}
                        stackId="dev"
                        fill={TYPE_COLORS[t]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ③ 模块 × 类型 */}
      <div>
        <div className="text-sm font-semibold text-hub-text mb-4">模块 × 类型分布（工单量前 10）</div>
        <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm">
          {plChartData.length === 0 ? (
            <div className="text-xs text-hub-textFaint">暂无数据</div>
          ) : (
            <div style={{ width: "100%", height: 280 }} data-testid="module-bar-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={plChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" />
                  <XAxis dataKey="module" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0].payload as {
                        total: number;
                        overdue_count: number;
                      };
                      return (
                        <div className="bg-white border border-hub-border rounded px-2 py-1.5 text-[11px]">
                          <div className="font-semibold mb-0.5">{label}</div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)} style={{ color: p.color }}>
                              {p.name}：{p.value}
                            </div>
                          ))}
                          <div className="mt-0.5 text-hub-textSecondary">合计：{row.total}</div>
                          <div style={{ color: row.overdue_count > 0 ? "#b04a4a" : undefined }}>
                            超期：{row.overdue_count}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10.5 }} />
                  {HUB_TYPES.map((t) => (
                    <Bar key={t} dataKey={t} name={TYPE_LABELS[t]} stackId="pl" fill={TYPE_COLORS[t]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {plChartData.some((d) => d.overdue_count > 0) && (
            <div
              className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-hub-textSecondary"
              data-testid="module-overdue"
            >
              <span className="text-hub-textFaint">超期工单：</span>
              {plChartData
                .filter((d) => d.overdue_count > 0)
                .map((d) => (
                  <span key={d.module}>
                    {d.module}
                    <span className="ml-1 font-semibold" style={{ color: "#b04a4a" }}>
                      {d.overdue_count}
                    </span>
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* ③ 待处理工单按处理人 */}
      <div>
        <div className="text-sm font-semibold text-hub-text mb-4">待处理工单（按处理人，前 15）</div>
        <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm">
          {assigneeChartData.length === 0 ? (
            <div className="text-xs text-hub-textFaint">暂无数据</div>
          ) : (
            <div
              style={{ width: "100%", height: Math.max(200, assigneeChartData.length * 32) }}
              data-testid="assignee-bar-chart"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={assigneeChartData} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const row = payload[0].payload as { total: number };
                      return (
                        <div className="bg-white border border-hub-border rounded px-2 py-1.5 text-[11px]">
                          <div className="font-semibold">{label}</div>
                          <div>待处理工单：{row.total}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="total" name="待处理工单" fill="#177e83" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ④ 月度趋势 + 耗时直方图 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-semibold text-hub-text mb-4">月度趋势</div>
          <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm">
            {trend.length === 0 ? (
              <div className="text-xs text-hub-textFaint">暂无数据</div>
            ) : (
              <div style={{ width: "100%", height: 240 }} data-testid="trend-line-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    {/* 双 Y 轴：工单量(~千) 与 处理时长(~小时) 量级差百倍，同轴会把时长线压平 */}
                    <YAxis
                      yAxisId="count"
                      tick={{ fontSize: 11 }}
                      label={{ value: "工单量", angle: -90, position: "insideLeft", fontSize: 10 }}
                    />
                    <YAxis
                      yAxisId="hours"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      label={{ value: "时长(h)", angle: 90, position: "insideRight", fontSize: 10 }}
                    />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10.5 }} />
                    <Line
                      yAxisId="count"
                      type="monotone"
                      dataKey="total"
                      name="工单量"
                      stroke="#177e83"
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="hours"
                      type="monotone"
                      dataKey="median_handle_hours"
                      name="中位处理时长(h)"
                      stroke="#3b82f6"
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="hours"
                      type="monotone"
                      dataKey="p90_handle_hours"
                      name="P90处理时长(h)"
                      stroke="#ef4444"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-hub-text mb-4">处理时长分布</div>
          <div className="min-w-0 bg-white border border-hub-borderLight rounded-2xl p-5 shadow-sm">
            {hist.length === 0 ? (
              <div className="text-xs text-hub-textFaint">暂无数据</div>
            ) : (
              <div style={{ width: "100%", height: 240 }} data-testid="hist-bar-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="工单数" fill="#177e83" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
