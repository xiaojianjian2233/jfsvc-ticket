import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/msw-server";
import { DailyDashboardPage } from "./DailyDashboardPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/analytics/daily"]}>
        <DailyDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleDaily = {
  date: "2026-09-01",
  totals: {
    received: 12,
    completed: 8,
    returned_to_ksm: 2,
    ksm_rejected: 1,
    supplemented: 3,
  },
  by_assignee: [
    {
      user_id: 1,
      name: "张三",
      received: 7,
      completed: 5,
      returned_to_ksm: 1,
      ksm_rejected: 1,
      supplemented: 2,
    },
    {
      user_id: null,
      name: "(未分配)",
      received: 5,
      completed: 3,
      returned_to_ksm: 1,
      ksm_rejected: 0,
      supplemented: 1,
    },
  ],
  lifetime: {
    total: 500,
    in_progress: 60,
    completed: 420,
    returned_to_ksm_total: 30,
  },
};

function mockAuth(role: string) {
  localStorage.setItem("auth_user", JSON.stringify({ role }));
}

describe("DailyDashboardPage", () => {
  it("filters the assignee table without changing overall daily cards", async () => {
    mockAuth("supervisor");
    server.use(http.get("*/api/metrics/daily-dashboard", () => HttpResponse.json(sampleDaily)));
    renderPage();
    const table = await screen.findByRole("table", { name: "处理人数据明细" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("搜索处理人"), { target: { value: "张三" } });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).queryByText("(未分配)")).not.toBeInTheDocument();
    expect(screen.getByTestId("kpi-received")).toHaveTextContent("12");
    expect(screen.getByTestId("kpi-supplemented")).toHaveTextContent("3");
    fireEvent.change(screen.getByLabelText("搜索处理人"), { target: { value: "不存在" } });
    expect(screen.getByText(/没有匹配的处理人/)).toBeInTheDocument();
    localStorage.clear();
  });

  it("does not send an empty date to the API", async () => {
    mockAuth("supervisor");
    let calls = 0;
    server.use(http.get("*/api/metrics/daily-dashboard", () => { calls++; return HttpResponse.json(sampleDaily); }));
    renderPage();
    await screen.findByTestId("kpi-received");
    const picker = screen.getByTestId("date-picker") as HTMLInputElement;
    const date = picker.value;
    fireEvent.change(picker, { target: { value: "" } });
    expect(picker.value).toBe(date);
    expect(calls).toBe(1);
    localStorage.clear();
  });

  it("shows a permission notice for non-supervisor roles", () => {
    mockAuth("member");
    renderPage();
    expect(screen.getByText(/仅主管\/管理员可见/)).toBeInTheDocument();
    localStorage.clear();
  });

  it("renders daily KPI cards, lifetime cards and the assignee bar chart", async () => {
    mockAuth("supervisor");
    server.use(
      http.get("*/api/metrics/daily-dashboard", () => HttpResponse.json(sampleDaily)),
    );

    renderPage();

    expect(await screen.findByTestId("kpi-received")).toHaveTextContent("12");
    expect(screen.getByTestId("kpi-completed")).toHaveTextContent("8");
    expect(screen.getByTestId("kpi-returned_to_ksm")).toHaveTextContent("2");
    expect(screen.getByTestId("kpi-ksm_rejected")).toHaveTextContent("1");

    expect(screen.queryByText("累计统计")).not.toBeInTheDocument();
    expect(screen.getByTestId("kpi-transferred_to_dev")).toHaveTextContent("0");

    expect(screen.getByTestId("by-assignee-bar-chart")).toBeInTheDocument();

    localStorage.clear();
  });

  it("switching the date triggers a new request", async () => {
    mockAuth("supervisor");
    let lastDate = "";
    server.use(
      http.get("*/api/metrics/daily-dashboard", ({ request }) => {
        const url = new URL(request.url);
        lastDate = url.searchParams.get("date") ?? "";
        return HttpResponse.json({ ...sampleDaily, date: lastDate });
      }),
    );

    renderPage();
    await screen.findByTestId("kpi-received");

    const picker = screen.getByTestId("date-picker") as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "2026-09-02" } });

    await screen.findByTestId("kpi-received");
    expect(lastDate).toBe("2026-09-02");

    localStorage.clear();
  });

  it("shows an empty state when no ticket exists that day", async () => {
    mockAuth("admin");
    server.use(
      http.get("*/api/metrics/daily-dashboard", () =>
        HttpResponse.json({ ...sampleDaily, by_assignee: [] }),
      ),
    );

    renderPage();

    expect(await screen.findByText("当日暂无数据")).toBeInTheDocument();
    localStorage.clear();
  });
});
