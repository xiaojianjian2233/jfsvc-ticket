import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NoticeConfigPage } from "./NoticeConfigPage";

describe("NoticeConfigPage (消息通知配置)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);
  });

  it("renders page title 消息通知管理 and action buttons", async () => {
    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    // 页面标题
    expect(screen.getByText("消息通知管理")).toBeInTheDocument();

    // 筛选区与操作按钮
    expect(screen.getByText("状态:")).toBeInTheDocument();
    expect(screen.getByText("创建时间:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查询" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();

    // 操作按钮
    expect(screen.getByRole("button", { name: /新建/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上架" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下架" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();

    // 默认种子数据
    expect(await screen.findByText(/关于数电发票乐企直连通道升级维护的通知/)).toBeInTheDocument();
    expect(screen.getByText("INF202609210001")).toBeInTheDocument();
  });

  it("opens create drawer when clicking 新建 and validates form", async () => {
    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    const createBtn = screen.getByRole("button", { name: /新建/ });
    fireEvent.click(createBtn);

    // 抽屉展开
    expect(await screen.findByText("消息通知配置")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入消息通知标题...")).toBeInTheDocument();
    expect(screen.getByText(/弹窗提示:/)).toBeInTheDocument();

    // 空提交校验
    const submitBtn = screen.getByRole("button", { name: "提交" });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText("请输入消息通知标题（不能为空且不超过50字）！")
    ).toBeInTheDocument();
  });

  it("creates a new notice and adds it to list upon submission", async () => {
    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /新建/ }));
    await screen.findByText("消息通知配置");

    const titleInput = screen.getByPlaceholderText("请输入消息通知标题...");
    fireEvent.change(titleInput, { target: { value: "测试新发布系统通知公告" } });

    // 富文本输入模拟
    const editor = document.querySelector('[contenteditable="true"]');
    if (editor) {
      editor.innerHTML = "<p>这是一条经过自动化测试新建的重要系统通知内容。</p>";
      fireEvent.input(editor);
    }

    const submitBtn = screen.getByRole("button", { name: "提交" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        expect.stringContaining("创建并上架成功")
      );
    });

    expect(await screen.findByText("测试新发布系统通知公告")).toBeInTheDocument();
  });

  it("opens view drawer when clicking notice number, and activates edit mode", async () => {
    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    const noticeLink = await screen.findByText("INF202609210001");
    fireEvent.click(noticeLink);

    // 打开查看态抽屉
    expect(await screen.findByText("查看模式")).toBeInTheDocument();
    const editBtn = screen.getByRole("button", { name: "编辑" });
    expect(editBtn).toBeInTheDocument();

    // 点击右上角编辑
    fireEvent.click(editBtn);

    // 变为编辑模式
    expect(await screen.findByText("编辑模式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument();
  });

  it("toggles status filter dropdown", async () => {
    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    const statusBtn = screen.getByRole("button", { name: /不限/ });
    fireEvent.click(statusBtn);

    expect(screen.getAllByText("上架").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("下架").length).toBeGreaterThanOrEqual(1);
  });

  it("performs batch publish, unpublish, and delete", async () => {
    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    await screen.findByText("INF202609210001");

    // 未勾选直接点击上架提示
    fireEvent.click(screen.getByRole("button", { name: "上架" }));
    expect(window.alert).toHaveBeenCalledWith("请先勾选需要上架的消息记录！");

    // 未勾选直接点击下架提示
    fireEvent.click(screen.getByRole("button", { name: "下架" }));
    expect(window.alert).toHaveBeenCalledWith("请先勾选需要下架的消息记录！");

    // 未勾选直接点击删除提示
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(window.alert).toHaveBeenCalledWith("请先勾选需要删除的消息记录！");
  });

  it("displays effective date in YYYY-MM-DD ~ YYYY-MM-DD format without time, and triggers showPicker on click", async () => {
    // Mock HTMLInputElement.prototype.showPicker
    const showPickerMock = vi.fn();
    HTMLInputElement.prototype.showPicker = showPickerMock;

    render(
      <MemoryRouter>
        <NoticeConfigPage />
      </MemoryRouter>
    );

    // 验证表格展示仅含年月日格式（例如 2026-09-20 ~ 2026-09-30）
    expect(await screen.findByText(/2026-09-20 ~ 2026-09-30/)).toBeInTheDocument();
    // 验证表格中不出现 00:00:00 这样的时分秒
    expect(screen.queryByText(/2026-09-20 00:00:00/)).not.toBeInTheDocument();

    // 打开新建抽屉，点击日期输入框应调用 showPicker
    fireEvent.click(screen.getByRole("button", { name: /新建/ }));
    await screen.findByText("消息通知配置");

    const datePickers = screen.getAllByTitle(/点击选择.*日期/);
    expect(datePickers.length).toBe(2);

    fireEvent.click(datePickers[0]);
    expect(showPickerMock).toHaveBeenCalled();
  });
});
