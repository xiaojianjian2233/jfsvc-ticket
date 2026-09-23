import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentsPage } from "./AgentsPage";
import { formatDateTime, SessionListPage } from "./SessionListPage";
import { ReceptionWorkbenchPage } from "./ReceptionWorkbenchPage";
import { notifySessionCreated } from "./receptionApi";

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

      // 验证抽屉宽度为 1000px
      const drawer = screen.getByText("客户信息").closest(".relative.w-\\[1000px\\]");
      expect(drawer).toBeInTheDocument();

      // 验证【客户信息】容器与 10 项信息
      expect(screen.getByText("客户信息")).toBeInTheDocument();
      expect(screen.getAllByText("咨询企业").length).toBeGreaterThan(0);
      expect(screen.getAllByText("咨询企业税号").length).toBeGreaterThan(0);
      expect(screen.getAllByText("归属租户").length).toBeGreaterThan(0);
      expect(screen.getAllByText("咨询人").length).toBeGreaterThan(0);
      expect(screen.getAllByText("咨询人电话").length).toBeGreaterThan(0);

      expect(screen.getAllByText("会话状态").length).toBeGreaterThan(0);
      expect(screen.getAllByText("创建时间").length).toBeGreaterThan(0);
      expect(screen.getAllByText("是否转人工").length).toBeGreaterThan(0);
      expect(screen.getAllByText("最后解答人").length).toBeGreaterThan(0);
      expect(screen.getAllByText("关联工单").length).toBeGreaterThan(0);

      // 验证客户信息下面的值均为 13 号不加粗 (text-[13px] font-normal) 且不换行 (whitespace-nowrap)
      const companyVal = screen.getByTitle("腾讯科技（深圳）有限公司");
      expect(companyVal).toHaveClass("text-[13px]");
      expect(companyVal).toHaveClass("font-normal");
      expect(companyVal).toHaveClass("whitespace-nowrap");
      expect(companyVal).not.toHaveClass("font-semibold");
      expect(companyVal).not.toHaveClass("font-medium");
      expect(companyVal).not.toHaveClass("break-words");

      // 验证客户问题总结与会话内容明细
      expect(screen.getAllByText("客户问题总结").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("会话内容明细")).toBeInTheDocument();
    });

    it("applies new styling: 16px title with 40px fixed bar, queue status option, 300x25px inputs, 100x25px query button, sticky column, and 500px summary modal", async () => {
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>
      );

      // 1. 标题 16 号与说明 12 号
      const title = screen.getByText("会话记录列表");
      expect(title).toHaveClass("text-[16px]");
      const desc = screen.getByText(/记录所有在线与热线会话的历史详情/);
      expect(desc).toHaveClass("text-[12px]");

      // 2. 状态选项中包含【排队中】
      const statusBtn = screen.getByLabelText("会话状态选择");
      fireEvent.click(statusBtn);
      expect(screen.getByText("排队中")).toBeInTheDocument();

      // 3. 输入框尺寸 300px * 25px，字体 13 号
      const companyInput = screen.getByPlaceholderText("录入企业名称查找");
      expect(companyInput).toHaveClass("w-[300px]");
      expect(companyInput).toHaveClass("h-[25px]");
      expect(companyInput).toHaveClass("text-[13px]");

      // 4. 查询按钮样式与 13 号字体
      const queryBtn = screen.getByRole("button", { name: "查询" });
      expect(queryBtn).toHaveClass("w-[100px]");
      expect(queryBtn).toHaveClass("h-[25px]");
      expect(queryBtn).toHaveClass("rounded-[5px]");
      expect(queryBtn).toHaveClass("bg-[rgb(102,139,221)]");
      expect(queryBtn).toHaveClass("text-[13px]");

      // 5. 导出操作按钮与 13 号字体，填充颜色为 rgb(35, 94, 212)
      const exportBtn = screen.getByRole("button", { name: /导出/ });
      expect(exportBtn).toHaveClass("w-[100px]");
      expect(exportBtn).toHaveClass("h-[25px]");
      expect(exportBtn).toHaveClass("bg-[rgb(35,94,212)]");
      expect(exportBtn).toHaveClass("text-[13px]");

      // 6. 会话ID前面多选框与固定列样式
      const selectAllCheckbox = screen.getByLabelText("全选本页会话");
      expect(selectAllCheckbox).toBeInTheDocument();
      fireEvent.click(selectAllCheckbox);

      const sessionTh = screen.getByRole("columnheader", { name: "会话ID" });
      expect(sessionTh).toHaveClass("sticky");
      expect(sessionTh).toHaveClass("left-[44px]");
      expect(sessionTh).toHaveClass("top-0");
      expect(sessionTh).toHaveClass("z-30");

      const sessionIdBtn = await screen.findByText("ZXHH202609180001");
      expect(sessionIdBtn).toHaveClass("text-[rgb(102,139,221)]");

      // 7. 客户问题总结点击后弹出 500px 顶层浮窗
      const summaryCell = await screen.findByText(/数电发票开具额度不足/);
      expect(summaryCell).toBeInTheDocument();
      fireEvent.click(summaryCell);

      // 浮窗弹出并在顶层显示固定 500px 宽度
      const modalBox = await screen.findByTestId("summary-modal");
      expect(modalBox).toBeInTheDocument();
      expect(modalBox).toHaveClass("w-[500px]");
      expect(screen.getByText("客户问题总结详情")).toBeInTheDocument();

      // 关闭浮窗
      const closeBtn = screen.getByRole("button", { name: "关闭" });
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId("summary-modal")).not.toBeInTheDocument();
    });

    it("supports multi-selection and export to Excel with or without selection", async () => {
      // mock createObjectURL & revokeObjectURL
      const createObjectURLMock = vi.fn(() => "blob:mock-url");
      const revokeObjectURLMock = vi.fn();
      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      // mock anchor click
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>
      );

      // 等待会话数据加载完成
      await screen.findByText("ZXHH202609180001");

      // 1. 无勾选状态下点击【导出】（位于列表左上角，填充颜色 rgb(35, 94, 212)），导出符合条件的全部记录
      const exportBtn = screen.getByRole("button", { name: /^导出$/ });
      expect(exportBtn).toHaveClass("bg-[rgb(35,94,212)]");
      expect(exportBtn).toHaveClass("text-white");
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(createObjectURLMock).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
      });

      // 2. 勾选第一条记录
      const rowCheckbox = screen.getByLabelText("选择会话 ZXHH202609180001");
      fireEvent.click(rowCheckbox);

      // 验证标题栏显示已勾选 1 项
      expect(screen.getByText("已勾选 1 项")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "导出 (1)" })).toBeInTheDocument();

      // 点击取消勾选
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByText("已勾选 1 项")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^导出$/ })).toBeInTheDocument();

      // 3. 点击全选
      const selectAll = screen.getByLabelText("全选本页会话");
      fireEvent.click(selectAll);
      expect(screen.getByText(/已勾选 \d+ 项/)).toBeInTheDocument();

      // 导出已勾选记录
      const exportSelectedBtn = screen.getByRole("button", { name: /导出 \(\d+\)/ });
      fireEvent.click(exportSelectedBtn);

      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalledTimes(2);
      });

      clickSpy.mockRestore();
    });

    it("renders refresh button next to export button and refreshes data on click", async () => {
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>
      );

      // 验证导出按钮后面紧跟着刷新按钮
      const exportBtn = screen.getByRole("button", { name: /^导出$/ });
      const refreshBtn = screen.getByRole("button", { name: /刷新/ });
      expect(refreshBtn).toBeInTheDocument();
      expect(exportBtn.nextElementSibling).toBe(refreshBtn);

      // 点击刷新按钮
      fireEvent.click(refreshBtn);
      expect(await screen.findByText("ZXHH202609180001")).toBeInTheDocument();
    });

    it("automatically updates session list when a new session is created and broadcasted", async () => {
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>
      );

      expect(await screen.findByText("ZXHH202609180001")).toBeInTheDocument();

      // 模拟客户端发起新会话并写入本地与广播
      const newSessionItem = {
        id: "ZXHH202609239999",
        company_name: "实时新增测试科技有限公司",
        tax_no: "91330100MA99TEST99",
        tenant_name: "测试云租户",
        tenant_no: "T-TEST-01",
        contact_name: "王先生",
        contact_phone: "13900001111",
        status: "queue" as const,
        session_type: "online" as const,
        is_human: true,
        agent_name: "在线待分配",
        purchased_products: ["数电发票云"],
        is_in_service: "服务期内",
        unread_count: 0,
        last_message: "发起了新咨询",
        last_message_at: "2026-09-23 18:20:00",
        created_at: "2026-09-23 18:20:00",
        updated_at: "2026-09-23 18:20:00",
      };

      const curSessions = JSON.parse(localStorage.getItem("reception_sessions") || "[]");
      curSessions.unshift(newSessionItem);
      localStorage.setItem("reception_sessions", JSON.stringify(curSessions));

      notifySessionCreated(newSessionItem);

      // 验证座席端会话列表自动刷新并呈现新会话
      await waitFor(() => {
        expect(screen.getByText("ZXHH202609239999")).toBeInTheDocument();
        expect(screen.getByText("实时新增测试科技有限公司")).toBeInTheDocument();
      });
    });

    it("strictly formats created_at as yyyy-mm-dd hh:mm and displays sessions in descending order by created_at", async () => {
      // 1. 验证 formatDateTime 函数逻辑
      expect(formatDateTime("2026-09-23T18:20:15.123+08:00")).toBe("2026-09-23 18:20");
      expect(formatDateTime("2026-09-18 14:40:00")).toBe("2026-09-18 14:40");
      expect(formatDateTime("")).toBe("—");
      expect(formatDateTime(null)).toBe("—");

      // 2. 验证前端列表展示的时间格式
      render(
        <MemoryRouter>
          <SessionListPage />
        </MemoryRouter>
      );

      // 等待第一条渲染完成
      await screen.findByText("ZXHH202609180001");

      // 提取表格中所有的创建时间单元格
      const timeCells = screen.getAllByText(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/);
      expect(timeCells.length).toBeGreaterThan(0);

      // 确保每一个渲染出的时间格式严格为 16 位字符且无 T
      timeCells.forEach((cell) => {
        const text = cell.textContent || "";
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(text).not.toContain("T");
        expect(text.length).toBe(16);
      });

      // 3. 验证列表按照创建时间倒序排列（第 i 条时间 >= 第 i+1 条时间）
      for (let i = 0; i < timeCells.length - 1; i++) {
        const t1 = timeCells[i].textContent || "";
        const t2 = timeCells[i + 1].textContent || "";
        expect(t1.localeCompare(t2)).toBeGreaterThanOrEqual(0);
      }
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

    it("applies enhanced input height, attachment upload methods, 13px section titles, and rgb(35,94,212) styles", async () => {
      render(
        <MemoryRouter>
          <ReceptionWorkbenchPage />
        </MemoryRouter>
      );

      // 1. 验证中间坐席端录入框高度（在原3行约75px基础上增加30px -> h-[105px] min-h-[105px]）
      const textarea = await screen.findByPlaceholderText(/输入回复内容给客户/);
      expect(textarea).toHaveClass("h-[105px]");
      expect(textarea).toHaveClass("min-h-[105px]");

      // 2. 验证附件上传按钮与说明
      const attachBtn = screen.getByRole("button", { name: "添加附件" });
      expect(attachBtn).toBeInTheDocument();
      expect(screen.getByText(/支持勾选、拖拽或 Ctrl\+V 粘贴图片与文件/)).toBeInTheDocument();

      // 模拟本地文件上传
      const file = new File(["dummy content"], "test_contract.pdf", { type: "application/pdf" });
      const fileInput = attachBtn.parentElement?.querySelector('input[type="file"]');
      expect(fileInput).not.toBeNull();
      if (fileInput) {
        fireEvent.change(fileInput, { target: { files: [file] } });
        // 验证暂存文件卡片展示
        expect(await screen.findByText("test_contract.pdf")).toBeInTheDocument();
        expect(screen.getByTitle("移除附件")).toBeInTheDocument();
      }

      // 3. 验证右侧两小节标题统一字号加2 -> 13号加粗 (text-[13px] font-bold)
      const profileHeading = screen.getByRole("heading", { name: /企业与客户画像/ });
      expect(profileHeading).toHaveClass("text-[13px]");
      expect(profileHeading).toHaveClass("font-bold");

      const assistantHeading = screen.getByRole("heading", { name: /坐席助手/ });
      expect(assistantHeading).toHaveClass("text-[13px]");
      expect(assistantHeading).toHaveClass("font-bold");

      // 4. 验证坐席助手切换按钮：选中效果切换为填充 RGB:35,94,212 (白字)
      const kbTab = screen.getByRole("button", { name: "知识库" });
      expect(kbTab).toHaveClass("bg-[rgb(35,94,212)]");
      expect(kbTab).toHaveClass("text-white");

      // 切换至「工单」Tab
      const ticketTab = screen.getByRole("button", { name: "工单" });
      fireEvent.click(ticketTab);
      expect(ticketTab).toHaveClass("bg-[rgb(35,94,212)]");
      expect(ticketTab).toHaveClass("text-white");

      // 5. 验证坐席助手的录入框标记突出的颜色 (border-2 border-[rgb(35,94,212)] bg-blue-50/50)
      const assistantInput = screen.getByPlaceholderText("录入查询内容，回车确认检索...");
      expect(assistantInput).toHaveClass("border-[rgb(35,94,212)]");
      expect(assistantInput).toHaveClass("bg-blue-50/50");

      // 6. 验证查询出的内容操作按钮【发送给客户】填充颜色为 rgb(35,94,212)
      const sendBtns = await screen.findAllByRole("button", { name: "发送给客户" });
      expect(sendBtns.length).toBeGreaterThan(0);
      expect(sendBtns[0]).toHaveClass("bg-[rgb(35,94,212)]");
      expect(sendBtns[0]).toHaveClass("text-white");
    });

    it("supports clicking customer message to quote reply and sends message with quote format", async () => {
      render(
        <MemoryRouter>
          <ReceptionWorkbenchPage />
        </MemoryRouter>
      );

      // Wait for workbench to load default active session ZXHH202609180001
      const customerMsg = await screen.findByText(/您好，我们腾讯财务今天开具数电发票提示「发票额度不足」/);
      expect(customerMsg).toBeInTheDocument();

      // Click customer message to quote
      fireEvent.click(customerMsg);

      // Verify quote preview bar appears
      expect(screen.getByText(/💬 引用 李经理:/)).toBeInTheDocument();

      // Test cancel quote
      const cancelBtn = screen.getByRole("button", { name: "取消引用" });
      fireEvent.click(cancelBtn);
      expect(screen.queryByText(/💬 引用 李经理:/)).not.toBeInTheDocument();

      // Click "引用回复" button at the bottom-right of the message to quote again
      const quoteBtns = screen.getAllByRole("button", { name: "引用此消息" });
      expect(quoteBtns.length).toBeGreaterThan(0);
      expect(quoteBtns[0].closest("div")).toHaveClass("justify-end");
      fireEvent.click(quoteBtns[0]);
      expect(screen.getByText(/💬 引用 李经理:/)).toBeInTheDocument();
      expect(screen.getByText("已引用")).toBeInTheDocument();

      // Enter response
      const textarea = screen.getByPlaceholderText(/输入回复内容给客户/);
      fireEvent.change(textarea, { target: { value: "局端审批完成后通常在15-30分钟内自动同步生效。" } });

      const sendBtn = screen.getByRole("button", { name: "发送" });
      fireEvent.click(sendBtn);

      // Verify quote block rendered in conversation
      await waitFor(() => {
        expect(screen.getByText(/引用 李经理/)).toBeInTheDocument();
        expect(screen.getByText("局端审批完成后通常在15-30分钟内自动同步生效。")).toBeInTheDocument();
      });

      // Verify quote preview bar is cleared
      expect(screen.queryByText(/💬 引用 李经理:/)).not.toBeInTheDocument();
    });

    it("verifies enlarged fonts, 5-row profile key-value layout, and peer-level purchased products 3-column table", async () => {
      render(
        <MemoryRouter>
          <ReceptionWorkbenchPage />
        </MemoryRouter>
      );

      // 1. 左侧会话列表左右字体：加2个字号
      const companyItems = await screen.findAllByText("腾讯科技（深圳）有限公司");
      expect(companyItems[0]).toHaveClass("text-[14px]");

      const card = companyItems[0].closest("div[class*='p-3']")!;
      const timeSpan = card.querySelector("span[class*='font-mono']");
      expect(timeSpan).toHaveClass("text-[12.5px]");

      const previewItem = card.querySelectorAll("span[class*='truncate']")[1];
      expect(previewItem).toHaveClass("text-[13.5px]");

      // 2. 中间会话窗口：气泡内容与输入框字体加2个字号
      const chatBubble = screen.getByText(/您好！数电发票额度由电子税务局/);
      expect(chatBubble.closest("div[class*='text-']")).toHaveClass("text-[14px]");

      const textarea = screen.getByPlaceholderText(/输入回复内容给客户/);
      expect(textarea).toHaveClass("text-[14px]");

      // 3. 右侧 企业与客户画像：5个 key-value 行结构字号调到12号、严禁换行
      const profileHeading = screen.getByRole("heading", { name: "企业与客户画像" });
      expect(profileHeading).toBeInTheDocument();

      const tenantKey = screen.getByText("租户：");
      const companyKey = screen.getByText("咨询企业：");
      const taxNoKey = screen.getByText("税号：");
      const contactKey = screen.getByText("咨询人：");
      const phoneKey = screen.getByText("联系电话：");

      expect(tenantKey).toHaveClass("text-left", "text-[12px]", "whitespace-nowrap");
      expect(companyKey).toHaveClass("text-left", "text-[12px]", "whitespace-nowrap");
      expect(taxNoKey).toHaveClass("text-left", "text-[12px]", "whitespace-nowrap");
      expect(contactKey).toHaveClass("text-left", "text-[12px]", "whitespace-nowrap");
      expect(phoneKey).toHaveClass("text-left", "text-[12px]", "whitespace-nowrap");

      // 验证值右对齐、12px字号、不换行
      const tenantValue = screen.getByText("腾讯集团财务云租户");
      expect(tenantValue).toHaveClass("text-right", "text-[12px]", "whitespace-nowrap");

      const contactValue = screen.getByText("李经理");
      expect(contactValue).toHaveClass("text-right", "text-[12px]", "whitespace-nowrap");

      // 验证坐席助手切换按钮均为 12 号字体（知识库、工单、订单、企业权益）
      const tabKnowledge = screen.getByRole("button", { name: "知识库" });
      const tabTicket = screen.getByRole("button", { name: "工单" });
      const tabOrder = screen.getByRole("button", { name: "订单" });
      const tabBenefit = screen.getByRole("button", { name: "企业权益" });

      expect(tabKnowledge).toHaveClass("text-[12px]", "whitespace-nowrap");
      expect(tabTicket).toHaveClass("text-[12px]", "whitespace-nowrap");
      expect(tabOrder).toHaveClass("text-[12px]", "whitespace-nowrap");
      expect(tabBenefit).toHaveClass("text-[12px]", "whitespace-nowrap");

      // 4. 右侧 已购产品：独立出来作为同等级模块，3列列表呈现数据（产品、状态、到期时间）
      const productsHeading = screen.getByRole("heading", { name: /已购产品/ });
      expect(productsHeading).toBeInTheDocument();
      expect(productsHeading).toHaveClass("text-[13px]");
      expect(productsHeading).toHaveClass("font-bold");

      // 验证 3 列表格标题与底边框及列宽、12px字号、不加粗、不换行
      const thProduct = screen.getByRole("columnheader", { name: "产品" });
      const thStatus = screen.getByRole("columnheader", { name: "状态" });
      const thExpire = screen.getByRole("columnheader", { name: "到期时间" });

      expect(thProduct).toBeInTheDocument();
      expect(thStatus).toBeInTheDocument();
      expect(thExpire).toBeInTheDocument();
      expect(thProduct).toHaveClass("text-[12px]", "font-normal", "whitespace-nowrap");
      expect(thStatus).toHaveClass("text-[12px]", "font-normal", "whitespace-nowrap", "w-[54px]");
      expect(thExpire).toHaveClass("text-[12px]", "font-normal", "whitespace-nowrap", "w-[90px]");
      expect(thProduct.closest("tr")).toHaveClass("border-b", "border-slate-200");

      // 验证表格数据项字号都调到12、不加粗、一行显示不换行
      const productCell = screen.getByText("发票云乐企直连版");
      expect(productCell).toBeInTheDocument();
      expect(productCell).toHaveClass("text-[12px]", "font-normal", "whitespace-nowrap");

      const statusBadge = screen.getAllByText("服务中")[0];
      expect(statusBadge).toHaveClass("text-[12px]", "font-normal", "whitespace-nowrap");

      const expireDateCells = screen.getAllByText("2027-12-31");
      expect(expireDateCells.length).toBeGreaterThan(0);
      expect(expireDateCells[0]).toHaveClass("text-[12px]", "font-normal", "whitespace-nowrap");
    });
  });
});
