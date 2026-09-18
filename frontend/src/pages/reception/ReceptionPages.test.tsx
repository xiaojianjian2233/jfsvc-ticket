import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentsPage } from "./AgentsPage";
import { SessionListPage } from "./SessionListPage";
import { ReceptionWorkbenchPage } from "./ReceptionWorkbenchPage";

describe("Reception Management Pages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("AgentsPage (坐席设置)", () => {
    it("renders agents list and filter bar", async () => {
      render(
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      );

      expect(screen.getByText("坐席设置")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("录入用户姓名查找")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("录入昵称查找")).toBeInTheDocument();
      expect(screen.getByText("添加坐席")).toBeInTheDocument();

      // 验证种子数据
      expect(await screen.findByText("杨慧莉")).toBeInTheDocument();
      expect(screen.getByText("慧莉客服")).toBeInTheDocument();
      expect(screen.getByText("张工")).toBeInTheDocument();
    });

    it("opens drawer to add agent", async () => {
      render(
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      );

      const addBtn = screen.getByText("添加坐席");
      fireEvent.click(addBtn);

      expect(await screen.findByText("维护在线接待坐席")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("请输入在线接待客户可以看到的称呼")).toBeInTheDocument();
    });

    it("renders schedule settings card and allows edit/save", async () => {
      render(
        <MemoryRouter>
          <AgentsPage />
        </MemoryRouter>
      );

      expect(screen.getByText("坐席基础设置")).toBeInTheDocument();
      expect(screen.getByText("工作日接待时间")).toBeInTheDocument();
      expect(screen.getByText("节假日 / 周末接待时间")).toBeInTheDocument();
      expect(screen.getAllByText(/09:00 ~ 11:45/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/13:30 ~ 18:00/).length).toBeGreaterThan(0);

      // 点击修改
      const editBtn = screen.getByRole("button", { name: "修改" });
      fireEvent.click(editBtn);

      expect(screen.getByText("未保存")).toBeInTheDocument();
      const saveBtn = screen.getByRole("button", { name: "保存" });
      expect(saveBtn).toBeInTheDocument();

      // 点击保存
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "修改" })).toBeInTheDocument();
      });
    });
  });

  describe("SessionListPage (会话记录列表)", () => {
    it("renders session list and opens detail drawer with 2-row 5-column layout", async () => {
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>
      );

      expect(screen.getByText("会话记录列表")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("录入企业名称查找")).toBeInTheDocument();

      // 找到会话
      const sessionIdBtn = await screen.findByText("ZXHH202609180001");
      expect(sessionIdBtn).toBeInTheDocument();
      const companies = await screen.findAllByText("腾讯科技（深圳）有限公司");
      expect(companies.length).toBeGreaterThan(0);

      // 点击会话ID呼出抽屉
      fireEvent.click(sessionIdBtn);

      // 验证抽屉标题与结构
      await waitFor(() => {
        expect(screen.getAllByText("ZXHH202609180001").length).toBeGreaterThan(1);
      });

      // 验证 Row 1: 咨询企业、咨询企业税号、归属租户、咨询人、咨询人电话
      expect(screen.getAllByText(/咨询企业/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/咨询企业税号/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/归属租户/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/咨询人/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/咨询人电话/).length).toBeGreaterThan(0);

      // 验证 Row 2: 会话状态、创建时间、是否转人工、最后接待人、关联工单号
      expect(screen.getAllByText(/会话状态/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/创建时间/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/是否转人工/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/最后接待人/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/关联工单号/).length).toBeGreaterThan(0);

      // 验证 Row 3 & 4
      expect(screen.getByText("客户问题总结：")).toBeInTheDocument();
      expect(screen.getByText("会话内容明细：")).toBeInTheDocument();
    });
  });

  describe("ReceptionWorkbenchPage (在线接待工作台)", () => {
    it("renders reception status dropdown and queue tabs", async () => {
      render(
        <MemoryRouter>
          <ReceptionWorkbenchPage />
        </MemoryRouter>
      );

      // 验证接待状态组件
      expect(screen.getByText("接待状态")).toBeInTheDocument();
      expect(screen.getByText("在线接待")).toBeInTheDocument();
      expect(screen.getByText("热线接待")).toBeInTheDocument();

      // 检查在线接待子菜单与企业卡片
      const companies = await screen.findAllByText("腾讯科技（深圳）有限公司");
      expect(companies.length).toBeGreaterThan(0);
      expect(screen.getByText("企业与客户画像")).toBeInTheDocument();
      expect(screen.getByText("坐席助手")).toBeInTheDocument();

      // 切换到热线接待
      fireEvent.click(screen.getByText("热线接待"));
      expect(screen.getByText(/已接/)).toBeInTheDocument();
      expect(screen.getByText(/未接/)).toBeInTheDocument();
    });

    it("opens status dropdown and handles busy status switch", async () => {
      render(
        <MemoryRouter>
          <ReceptionWorkbenchPage />
        </MemoryRouter>
      );

      // 点击接待状态按钮打开下拉
      const statusBtn = await screen.findByTitle("切换接待状态");
      fireEvent.click(statusBtn);

      // 找到忙碌选项并点击
      const busyOption = screen.getByRole("button", { name: "忙碌" });
      fireEvent.click(busyOption);

      // 验证切换为忙碌
      await waitFor(() => {
        expect(screen.getByTitle("切换接待状态")).toHaveTextContent("忙碌");
      });
    });

    it("opens offline modal when switching to offline with in-progress sessions", async () => {
      render(
        <MemoryRouter>
          <ReceptionWorkbenchPage />
        </MemoryRouter>
      );

      // 点击接待状态按钮
      const statusBtn = await screen.findByTitle("切换接待状态");
      fireEvent.click(statusBtn);

      // 点击离线
      const offlineOption = screen.getByRole("button", { name: "离线" });
      fireEvent.click(offlineOption);

      // 预期弹出「离线状态切换确认」弹窗
      expect(await screen.findByText("离线状态切换确认")).toBeInTheDocument();
      expect(screen.getByText(/当前存在进行中的会话，建议修改为忙碌/)).toBeInTheDocument();
    });
  });
});
