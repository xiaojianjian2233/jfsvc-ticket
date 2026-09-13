import type { ReactNode } from "react";

export type MetricTone = "teal" | "blue" | "amber" | "rose" | "neutral";
const tones: Record<MetricTone, string> = {
  teal: "bg-hub-teal-light text-hub-teal-deep",
  blue: "bg-hub-blue-light text-hub-blue-deep",
  amber: "bg-hub-amber-light text-hub-amber-deep",
  rose: "bg-hub-rose-light text-hub-rose-deep",
  neutral: "bg-hub-neutral-light text-hub-textSecondary",
};

export function MetricCard({ label, value, note, tone = "teal", testId, noteTestId }: {
  label: string; value: ReactNode; note: ReactNode; tone?: MetricTone; testId?: string; noteTestId?: string;
}) {
  return <div className="min-w-0 rounded-2xl border border-hub-borderLight bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-hub-textSecondary">{label}</span>
      <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}><span className="h-2 w-2 rounded-full bg-current" /></span>
    </div>
    <div data-testid={testId} className={`mt-4 text-[32px] font-semibold tracking-tight tabular-nums leading-none ${tone === "rose" ? "text-hub-rose" : "text-hub-text"}`} style={tone === "rose" ? { color: "#b04a4a" } : undefined}>{value}</div>
    <div data-testid={noteTestId} className="mt-3 text-xs leading-relaxed text-hub-textMuted">{note}</div>
  </div>;
}

export function SectionTitle({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
    <div><h2 className="text-sm font-semibold text-hub-text">{title}</h2>{note && <p className="mt-1 text-xs text-hub-textMuted">{note}</p>}</div>{children}
  </div>;
}

export const dashboardPage = "font-hub text-hub-text text-[13px] -m-6 min-h-screen bg-[#f3f5f7] p-4 sm:p-7";
export const dashboardPanel = "min-w-0 rounded-2xl border border-hub-borderLight bg-white p-5 shadow-sm";
export const dashboardButton = "rounded-lg border border-hub-border bg-white px-3 py-2 text-xs text-hub-textSecondary hover:bg-hub-teal-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-hub-teal disabled:opacity-50";
