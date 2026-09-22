import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/msw-server";
import { CatalogPage } from "./CatalogPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/catalog"]}>
        <CatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const MOCK_PRODUCT_LINES = [
  { id: 1, code: "PL001", name: "发票云", is_active: true, category: "开票" },
  { id: 2, code: "PL002", name: "影像云", is_active: false, category: "影像" },
];

const MOCK_MODULES = [
  {
    id: 101,
    product_line_code: "PL001",
    product_line_name: "发票云",
    product_line_category: "开票",
    name: "数电发票",
    is_active: true,
    status: "enabled",
    product_owner: "张产品",
    dev_owners: "李研发",
    updated_by: "admin",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-20T15:30:00Z",
  },
  {
    id: 102,
    product_line_code: "PL002",
    product_line_name: "影像云",
    product_line_category: "影像",
    name: "影像识别",
    is_active: true,
    status: "enabled",
    product_owner: "王产品",
    dev_owners: "赵研发",
    updated_by: "admin",
    created_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-21T09:15:00Z",
  },
];

beforeEach(() => {
  localStorage.setItem("auth_user", JSON.stringify({ name: "管理员", role: "admin" }));
  server.use(
    http.get("/api/admin/product-lines", () => HttpResponse.json(MOCK_PRODUCT_LINES)),
    http.get("/api/admin/modules", () => HttpResponse.json(MOCK_MODULES)),
    http.get("/api/admin/users", () => HttpResponse.json([])),
  );
});

describe("CatalogPage search and format", () => {
  it("renders search filter toolbar and formats updated_at as yyyy-mm-dd hh:mm", async () => {
    renderPage();

    // 确认页面与表格渲染
    expect(await screen.findByText("数电发票")).toBeInTheDocument();
    expect(screen.getByText("影像识别")).toBeInTheDocument();

    // 确认顶部搜查查询条件包含：产品线、模块、研发责任人、最后操作时间
    expect(screen.getAllByText("产品线").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("模块").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText("研发责任人")).toBeInTheDocument();
    expect(screen.getAllByText("最后操作时间").length).toBeGreaterThanOrEqual(1);

    // 确认按钮存在
    expect(screen.getByRole("button", { name: "查询" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();

    // 确认格式为 yyyy-mm-dd hh:mm (例如 2026-09-20 15:30 或 2026-09-21 09:15)
    const dateCells = screen.getAllByText(/2026-09-\d{2} \d{2}:\d{2}/);
    expect(dateCells.length).toBeGreaterThanOrEqual(2);
  });

  it("filters records by 研发责任人", async () => {
    renderPage();
    expect(await screen.findByText("数电发票")).toBeInTheDocument();

    const devInput = screen.getByPlaceholderText("研发责任人");
    fireEvent.change(devInput, { target: { value: "李研发" } });

    // 筛选后只剩数电发票，影像识别被过滤
    expect(screen.getByText("数电发票")).toBeInTheDocument();
    expect(screen.queryByText("影像识别")).not.toBeInTheDocument();

    // 点击重置后恢复
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByText("数电发票")).toBeInTheDocument();
    expect(screen.getByText("影像识别")).toBeInTheDocument();
  });

  it("filters records by 产品线 and links to 模块 options", async () => {
    renderPage();
    expect(await screen.findByText("数电发票")).toBeInTheDocument();

    // 找到产品线下拉触发器并打开（通过 placeholder "产品线" 的触发按钮）
    const plTriggers = screen.getAllByText("产品线");
    fireEvent.click(plTriggers[0]);

    // 勾选"发票云"
    const plCheckbox = screen.getByRole("checkbox", { name: "发票云" });
    fireEvent.click(plCheckbox);

    // 筛选后只包含发票云下的模块
    expect(screen.getByText("数电发票")).toBeInTheDocument();
    expect(screen.queryByText("影像识别")).not.toBeInTheDocument();

    // 打开模块下拉，确认联动只显示"数电发票"
    const modTriggers = screen.getAllByText("模块");
    fireEvent.click(modTriggers[0]);
    expect(screen.getByRole("checkbox", { name: "数电发票" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "影像识别" })).not.toBeInTheDocument();
  });

  it("filters records by 最后操作时间 range", async () => {
    renderPage();
    expect(await screen.findByText("数电发票")).toBeInTheDocument();

    // 开始时间 2026-09-21，数电发票为 2026-09-20，应被过滤
    const fromInput = screen.getByTitle("开始时间");
    fireEvent.change(fromInput, { target: { value: "2026-09-21" } });

    expect(screen.queryByText("数电发票")).not.toBeInTheDocument();
    expect(screen.getByText("影像识别")).toBeInTheDocument();
  });
});
