import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CustomerEvaluationModal } from "./CustomerEvaluationModal";
import { CustomerInfoCollectionPage, type CustomerProfile } from "./CustomerInfoCollectionPage";
import { CustomerChatWorkbenchPage } from "./CustomerChatWorkbenchPage";
import { CustomerClientApp, STORAGE_SESSION_KEY } from "./CustomerClientApp";
import * as receptionApi from "../receptionApi";
import type { SessionItem, MessageItem } from "../receptionApi";

describe("Customer Client Online Support H5 / Web App", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
      recent_open: [],
      closed: [],
    });
    vi.spyOn(receptionApi, "clientFetchNotices").mockResolvedValue(receptionApi.SEED_CLIENT_NOTICES);
    vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue([]);
  });

  describe("CustomerEvaluationModal", () => {
    it("renders 5-star rating, tags, comment textarea and submits evaluation", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      render(
        <CustomerEvaluationModal
          isOpen={true}
          sessionId="CS-20260921-001"
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );

      expect(screen.getByText("服务满意度评价")).toBeInTheDocument();
      expect(screen.getByText(/CS-20260921-001/)).toBeInTheDocument();
      expect(screen.getByText("非常满意")).toBeInTheDocument();

      // Click on tag
      const tagBtn = screen.getByText("讲解清晰");
      fireEvent.click(tagBtn);

      // Enter feedback comment
      const commentInput = screen.getByPlaceholderText(/请留下您宝贵的意见/);
      fireEvent.change(commentInput, { target: { value: "客服服务态度很好，问题解决很迅速！" } });

      // Click submit
      const submitBtn = screen.getByRole("button", { name: "提交评价" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(onSubmit).toHaveBeenCalledWith({
        score: 5,
        tags: ["响应迅速", "专业耐心", "讲解清晰"],
        comment: "客服服务态度很好，问题解决很迅速！",
      });
    });

    it("allows changing star score and clicking cancel", () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <CustomerEvaluationModal
          isOpen={true}
          sessionId="CS-20260921-002"
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );

      // Change star score
      const stars = screen.getAllByRole("button").filter((b) => b.textContent?.includes("★"));
      expect(stars.length).toBe(5);
      fireEvent.click(stars[2]); // 3 stars
      expect(screen.getByText("一般")).toBeInTheDocument();

      // Click close/cancel
      const cancelBtn = screen.getByRole("button", { name: "取消" });
      fireEvent.click(cancelBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("CustomerInfoCollectionPage", () => {
    it("renders page title and elements properly", () => {
      const onSuccess = vi.fn();
      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      expect(screen.getByText("发票云售后在线支持")).toBeInTheDocument();
      expect(screen.getByText("欢迎咨询 · 身份登记")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/请输入您的称呼/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/请输入11位中国大陆手机号码/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/请输入本次咨询的企业全称/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/请输入统一社会信用代码/)).toBeInTheDocument();
    });

    it("adheres to optimized layout: 16px title, 500x30px inputs, 500x30px submit button, 10px row spacing, query enterprise tip, and RGB666666 explanatory text", () => {
      const onSuccess = vi.fn();
      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      // 16px font-bold title
      const title = screen.getByText("发票云售后在线支持");
      expect(title).toHaveClass("text-[16px]");
      expect(title).toHaveClass("font-bold");

      // Key labels and 500x30px value inputs
      expect(screen.getByText("咨询人姓名")).toBeInTheDocument();
      expect(screen.getByText(/咨询人手机号/)).toBeInTheDocument();
      expect(screen.getByText(/企业名称/)).toBeInTheDocument();
      expect(screen.getByText(/企业税号/)).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText(/请输入您的称呼/);
      expect(nameInput).toHaveClass("w-[500px]");
      expect(nameInput).toHaveClass("h-[30px]");

      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);
      expect(phoneInput).toHaveClass("w-[500px]");
      expect(phoneInput).toHaveClass("h-[30px]");

      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      expect(companyInput).toHaveClass("w-[500px]");
      expect(companyInput).toHaveClass("h-[30px]");

      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);
      expect(taxInput).toHaveClass("w-[500px]");
      expect(taxInput).toHaveClass("h-[30px]");

      // Updated tip text with RGB:666666 color
      const tipText = screen.getByText("支持输入关键字查询企业信息");
      expect(tipText).toBeInTheDocument();
      expect(tipText).toHaveClass("text-[#666666]");

      // Explanatory subtitle text with RGB:666666 color
      const subTitle = screen.getByText("欢迎咨询 · 身份登记").parentElement;
      expect(subTitle).toHaveClass("text-[#666666]");

      // Submit button: width 500px, height 30px, text 【提交】
      const submitBtn = screen.getByRole("button", { name: "提交" });
      expect(submitBtn).toHaveClass("w-[500px]");
      expect(submitBtn).toHaveClass("h-[30px]");

      // Bottom protection tags: only privacy safety protection with RGB:666666
      const privacyText = screen.getByText("🔒 隐私安全保护");
      expect(privacyText).toBeInTheDocument();
      expect(privacyText.parentElement).toHaveClass("text-[#666666]");
      expect(screen.queryByText("⚡ 官方售后直达")).not.toBeInTheDocument();
      expect(screen.queryByText("💼 研发专家支持")).not.toBeInTheDocument();

      // Horizontal centering and 10px row spacing
      const titleWrapper = title.closest(".w-full.text-center");
      expect(titleWrapper).toBeInTheDocument();

      const form = submitBtn.closest("form");
      expect(form).toHaveClass("items-center");
      expect(form).toHaveClass("space-y-[10px]");

      const submitRow = submitBtn.closest(".flex");
      expect(submitRow).toHaveClass("justify-center");

      const privacyRow = screen.getByText("🔒 隐私安全保护").closest(".flex.items-center");
      expect(privacyRow?.parentElement).toHaveClass("justify-center");
    });

    it("strictly validates 11-digit mobile number and intercepts repetitive bogus numbers", async () => {
      const onSuccess = vi.fn();
      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);

      // Test repetitive fake number 11111111111
      fireEvent.change(phoneInput, { target: { value: "11111111111" } });
      fireEvent.blur(phoneInput);
      expect(screen.getByText("请输入有效的11位手机号码（不允许全相同重复伪号码）")).toBeInTheDocument();

      // Test repetitive fake number 22222222222
      fireEvent.change(phoneInput, { target: { value: "22222222222" } });
      fireEvent.blur(phoneInput);
      expect(screen.getByText("请输入有效的11位手机号码（不允许全相同重复伪号码）")).toBeInTheDocument();

      // Test incomplete phone
      fireEvent.change(phoneInput, { target: { value: "1380013" } });
      fireEvent.blur(phoneInput);
      expect(screen.getByText("请输入有效的11位手机号码（不允许全相同重复伪号码）")).toBeInTheDocument();
    });

    it("does NOT auto-fill enterprise inputs when historical records exist (whether 1 or multiple); shows prompt banner and requires manual click", async () => {
      const onSuccess = vi.fn();
      vi.spyOn(receptionApi, "clientLookupPhone").mockResolvedValue({
        phone: "13800138000",
        exists: true,
        count: 2,
        items: [
          {
            company_name: "北京航天信息云创有限公司",
            tax_no: "91110108MA00XYZ991",
            tenant_name: "航天信息北京云租户",
            contact_name: "张经理",
          },
          {
            company_name: "广州天河税务科技发展有限公司",
            tax_no: "91440101MA59ABC882",
            tenant_name: "天河财税专区",
            contact_name: "张总",
          },
        ],
      });

      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);
      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);

      // Input valid 11-digit phone
      fireEvent.change(phoneInput, { target: { value: "13800138000" } });

      // Wait for lookup
      await waitFor(() => {
        expect(screen.getByText(/根据咨询手机号关联咨询企业/)).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(screen.getByText(/下拉按钮查看并选择历史企业发起咨询/)).toBeInTheDocument();
      });

      // Verify that inputs are NOT auto-filled!
      expect((companyInput as HTMLInputElement).value).toBe("");
      expect((taxInput as HTMLInputElement).value).toBe("");

      // Button is placed right in the company name row (after the company name input)
      const viewDropdownBtn = screen.getByRole("button", { name: /查看并选择历史企业/ });
      const companyRow = companyInput.closest(".flex.items-start.justify-center");
      expect(companyRow).toContainElement(viewDropdownBtn);

      // Open dropdown under company name input
      fireEvent.click(viewDropdownBtn);

      const historyDropdown = screen.getByTestId("history-enterprise-dropdown");
      expect(companyInput.parentElement).toContainElement(historyDropdown);
      expect(screen.getByText("北京航天信息云创有限公司")).toBeInTheDocument();
      expect(screen.getByText("广州天河税务科技发展有限公司")).toBeInTheDocument();
      expect(screen.getByText(/统一社会信用代码:\s*91110108MA00XYZ991/)).toBeInTheDocument();

      // Clicking close button closes dropdown without selecting
      const closeBtn = screen.getByRole("button", { name: "关闭历史企业列表" });
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId("history-enterprise-dropdown")).not.toBeInTheDocument();
      expect((companyInput as HTMLInputElement).value).toBe("");

      // Re-open dropdown and click the first company item directly to select
      fireEvent.click(viewDropdownBtn);
      fireEvent.click(screen.getByText("北京航天信息云创有限公司"));

      // Now it should be filled with selected enterprise
      expect((companyInput as HTMLInputElement).value).toBe("北京航天信息云创有限公司");
      expect((taxInput as HTMLInputElement).value).toBe("91110108MA00XYZ991");
      expect(screen.getByText("✓ 已选用历史企业")).toBeInTheDocument();
    });

    it("does NOT auto-fill even when exactly 1 historical enterprise is found", async () => {
      const onSuccess = vi.fn();
      vi.spyOn(receptionApi, "clientLookupPhone").mockResolvedValue({
        phone: "13912345678",
        exists: true,
        count: 1,
        items: [
          {
            company_name: "独家历史企业有限公司",
            tax_no: "91310000000000001X",
            tenant_name: "上海租户",
            contact_name: "李总",
          },
        ],
      });

      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);
      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);

      fireEvent.change(phoneInput, { target: { value: "13912345678" } });

      await waitFor(() => {
        expect(screen.getByText(/根据咨询手机号关联咨询企业/)).toBeInTheDocument();
        expect(screen.getByText("1")).toBeInTheDocument();
        expect(screen.getByText(/下拉按钮查看并选择历史企业发起咨询/)).toBeInTheDocument();
      });

      // Crucial requirement: Even with 1 record, MUST NOT auto-fill!
      expect((companyInput as HTMLInputElement).value).toBe("");
      expect((taxInput as HTMLInputElement).value).toBe("");
    });

    it("supports AIC enterprise association recommendations when typing new company name", async () => {
      const onSuccess = vi.fn();
      vi.spyOn(receptionApi, "clientLookupPhone").mockResolvedValue({
        phone: "13700000000",
        exists: false,
        count: 0,
        items: [],
      });
      vi.spyOn(receptionApi, "clientSearchEnterprises").mockResolvedValue([
        {
          company_name: "北京金税发票网络技术有限公司",
          tax_no: "91110105MA11TAX2026",
          legal_person: "王五",
        },
      ]);

      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);
      fireEvent.change(phoneInput, { target: { value: "13700000000" } });

      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      fireEvent.change(companyInput, { target: { value: "北京金税" } });

      await waitFor(() => {
        expect(screen.getByText("根据录入信息查询企业信息")).toBeInTheDocument();
        expect(screen.getByText("北京金税发票网络技术有限公司")).toBeInTheDocument();
      });

      // Verify font sizes and colors according to optimizations
      const compItem = screen.getByText("北京金税发票网络技术有限公司");
      expect(compItem).toHaveClass("text-[14px]");

      const taxItem = screen.getByText(/统一社会信用代码:\s*91110105MA11TAX2026/);
      expect(taxItem.parentElement).toHaveClass("text-[13px]");
      expect(taxItem.parentElement).toHaveClass("text-[#666666]");

      // Click on recommendation
      fireEvent.click(compItem);

      expect((companyInput as HTMLInputElement).value).toBe("北京金税发票网络技术有限公司");
      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);
      expect((taxInput as HTMLInputElement).value).toBe("91110105MA11TAX2026");
    });

    it("dynamically queries enterprise titles when typing >2 chars and displays multiple records as company_name + tax_no", async () => {
      const onSuccess = vi.fn();
      vi.spyOn(receptionApi, "clientLookupPhone").mockResolvedValue({
        phone: "13900001111",
        exists: false,
        count: 0,
        items: [],
      });
      const searchMock = vi.spyOn(receptionApi, "clientSearchEnterprises").mockResolvedValue([
        {
          company_name: "广西中油能源有限公司",
          tax_no: "9145060075372154XH",
        },
        {
          company_name: "广西中油能源有限公司柳州分公司",
          tax_no: "91450203MA5K9DYEX2",
        },
      ]);

      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      // Type 1 char: should NOT query
      fireEvent.change(companyInput, { target: { value: "广" } });
      expect(searchMock).not.toHaveBeenCalled();

      // Type >=2 chars: should query and display all records
      fireEvent.change(companyInput, { target: { value: "广西中油" } });

      await waitFor(() => {
        expect(screen.getByText("广西中油能源有限公司")).toBeInTheDocument();
        expect(screen.getByText("广西中油能源有限公司柳州分公司")).toBeInTheDocument();
        expect(screen.getByText(/9145060075372154XH/)).toBeInTheDocument();
        expect(screen.getByText(/91450203MA5K9DYEX2/)).toBeInTheDocument();

        // 验证下拉框紧贴录入框底部（top-[30px]，0间隔对齐），且高度容纳5条数据（max-h-[280px]）
        const dropdown = screen.getByText("根据录入信息查询企业信息").closest(".absolute");
        expect(dropdown).toHaveClass("top-[30px]");
        expect(screen.getByText("广西中油能源有限公司").closest(".max-h-\\[280px\\]")).toBeInTheDocument();
      });

      // Press Enter to trigger search immediately
      fireEvent.keyDown(companyInput, { key: "Enter" });
      expect(searchMock).toHaveBeenCalledWith("广西中油");

      // Select the first record
      fireEvent.click(screen.getByText("广西中油能源有限公司"));

      // Verify name and creditCode are populated
      expect((companyInput as HTMLInputElement).value).toBe("广西中油能源有限公司");
      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);
      expect((taxInput as HTMLInputElement).value).toBe("9145060075372154XH");
    });

    it("completes submission and calls onSuccess with profile", async () => {
      const onSuccess = vi.fn();

      vi.spyOn(receptionApi, "clientLookupPhone").mockResolvedValue({
        phone: "13812345678",
        exists: false,
        count: 0,
        items: [],
      });
      vi.spyOn(receptionApi, "clientFetchTenantProfile").mockResolvedValue({
        tenant_name: "北京企业标准租户",
        tenant_no: "TENANT-BJ-01",
        purchased_products: ["发票云敏捷版", "自动开票插件"],
      });

      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const nameInput = screen.getByPlaceholderText(/请输入您的称呼/);
      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);
      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);

      fireEvent.change(nameInput, { target: { value: "陈女士" } });
      fireEvent.change(phoneInput, { target: { value: "13812345678" } });
      fireEvent.change(companyInput, { target: { value: "新联科技有限公司" } });
      fireEvent.change(taxInput, { target: { value: "91110108MA88888888" } });

      const submitBtn = screen.getByRole("button", { name: "提交" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            contact_name: "陈女士",
            contact_phone: "13812345678",
            company_name: "新联科技有限公司",
            tax_no: "91110108MA88888888",
          }),
        })
      );
    });

    it("defaults contact_name to contact_phone when name input is left empty", async () => {
      const onSuccess = vi.fn();
      render(<CustomerInfoCollectionPage onSuccess={onSuccess} />);

      const phoneInput = screen.getByPlaceholderText(/11位中国大陆手机号码/);
      const companyInput = screen.getByPlaceholderText(/本次咨询的企业全称/);
      const taxInput = screen.getByPlaceholderText(/统一社会信用代码/);

      // 故意不录入姓名（保持为空）
      fireEvent.change(phoneInput, { target: { value: "13912344498" } });
      fireEvent.change(companyInput, { target: { value: "无名测试科技有限公司" } });
      fireEvent.change(taxInput, { target: { value: "91110108MA99999999" } });

      const submitBtn = screen.getByRole("button", { name: "提交" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });
      // 验证咨询人姓名等于联系电话，而不是 客户_4498
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: expect.objectContaining({
            contact_name: "13912344498",
            contact_phone: "13912344498",
          }),
        })
      );
    });
  });

  describe("CustomerChatWorkbenchPage (3-Column Workbench)", () => {
    const mockProfile: CustomerProfile = {
      contact_name: "王先生",
      contact_phone: "13987654321",
      company_name: "上海数科集团股份有限公司",
      tax_no: "913100007788990011",
      tenant_name: "上海数科云租户",
      tenant_no: "T-SH-09",
      purchased_products: ["数电发票云", "进项勾选认证", "发票查验API"],
      is_historical: true,
    };

    const mockSession: SessionItem = {
      id: "CS-BENCH-001",
      contact_name: "王先生",
      contact_phone: "13987654321",
      company_name: "上海数科集团股份有限公司",
      tax_no: "913100007788990011",
      tenant_name: "上海数科云租户",
      status: "in_progress",
      session_type: "online",
      agent_name: "李客服",
      created_at: "2026-09-21 14:10:00",
      updated_at: "2026-09-21 14:10:00",
      is_human: true,
      unread_count: 0,
    };

    const mockInitialMessages: MessageItem[] = [
      {
        id: 1,
        session_id: "CS-BENCH-001",
        sender_type: "system",
        sender_name: "发票云智能支持",
        content: "您好！我是发票云在线支持助手，请问有什么可以帮助您？",
        is_read: true,
        created_at: "2026-09-21 14:10:01",
      },
    ];

    it("renders 3 columns: left 500px notices & profile tabs, chat area, and right 300px session list with collapsible categories and 800x1000 modal", async () => {
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockSession],
        closed: [],
      });
      const onBackToLogin = vi.fn();
      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={mockSession}
          initialMessages={mockInitialMessages}
          onBackToLogin={onBackToLogin}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("CS-BENCH-001")).toBeInTheDocument();
      });

      // Header: "客户在线沟通端 · 官方保障" removed
      expect(screen.queryByText("客户在线沟通端 · 官方保障")).not.toBeInTheDocument();

      // 1. Left column: notices & profile tabs (width 500px)
      const noticesTab = screen.getByRole("button", { name: /重要通知/ });
      const profileTab = screen.getByRole("button", { name: /客户信息/ });
      expect(noticesTab).toBeInTheDocument();
      expect(profileTab).toBeInTheDocument();
      expect(noticesTab).toHaveClass("text-[rgb(35,94,212)]"); // selected tab style

      const leftAside = noticesTab.closest("aside");
      expect(leftAside).toHaveClass("md:w-[500px]");

      // 2. Middle column: chat area
      expect(screen.getByText(/会话: CS-BENCH-001/)).toBeInTheDocument();
      expect(screen.getByText("坐席在线沟通中")).toBeInTheDocument();
      expect(screen.getByText(/接待人: 李客服/)).toBeInTheDocument();
      expect(screen.getByText("您好！我是发票云在线支持助手，请问有什么可以帮助您？")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/请输入您遇到的问题/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "结束会话" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "⭐ 服务评价" })).toBeInTheDocument();

      // 3. Right column: session list (width 300px)
      const ongoingTitle = screen.getByText("进行中会话");
      expect(ongoingTitle).toBeInTheDocument();
      expect(ongoingTitle).toHaveClass("text-[14px]", "font-bold", "text-[rgb(72,80,95)]");

      const rightAside = ongoingTitle.closest("aside");
      expect(rightAside).toHaveClass("md:w-[300px]");

      // Rotating collapse/expand arrow icon ▼
      const arrows = screen.getAllByText("▼");
      expect(arrows.length).toBe(3);

      // Session card: ID font size 13px, truncate block, date/time yyyy-mm-dd hh:mm
      const sessionIdEl = screen.getByText("CS-BENCH-001");
      expect(sessionIdEl).toHaveClass("text-[13px]");
      const lastMsgEl = screen.getByText("正在沟通中...");
      expect(lastMsgEl).toHaveClass("truncate", "block");
      expect(screen.getByText("2026-09-21 14:10")).toBeInTheDocument();

      // Default expanded: Ongoing session is visible
      expect(screen.getByText("CS-BENCH-001")).toBeInTheDocument();

      // Test collapse toggle: click ongoing session header button to collapse
      const ongoingBtn = ongoingTitle.closest("button");
      expect(ongoingBtn).toBeInTheDocument();
      fireEvent.click(ongoingBtn!);
      expect(screen.queryByText("CS-BENCH-001")).not.toBeInTheDocument();

      // Click again to expand
      fireEvent.click(ongoingBtn!);
      expect(screen.getByText("CS-BENCH-001")).toBeInTheDocument();

      const unclosedTitle = screen.getByText("24小时内未关闭会话");
      expect(unclosedTitle).toBeInTheDocument();
      expect(unclosedTitle).toHaveClass("text-[14px]", "font-bold", "text-[rgb(72,80,95)]");

      const closedTitle = screen.getByText("已结束会话");
      expect(closedTitle).toBeInTheDocument();
      expect(closedTitle).toHaveClass("text-[14px]", "font-bold", "text-[rgb(72,80,95)]");

      // 0 unclosed / closed sessions should not show placeholder text
      expect(screen.queryByText("暂无其他未关闭会话")).not.toBeInTheDocument();
      expect(screen.queryByText("暂无历史已结束会话")).not.toBeInTheDocument();

      // Requirement: Entry for new session is removed
      expect(screen.queryByText("发起新会话")).not.toBeInTheDocument();

      // 4. Modal test: Notice card click opens full modal with width 800px and height 1000px, centered
      const cardTitle = screen.getByText("关于数电发票乐企直连通道升级维护的通知");
      const card = cardTitle.closest(".cursor-pointer");
      expect(card).toBeInTheDocument();
      fireEvent.click(card!);

      // Full modal content and dimension checks (800px x 1000px)
      await waitFor(() => {
        expect(screen.getByText("我知道了")).toBeInTheDocument();
        expect(screen.getByText(/发布方:\s*国家税务总局运维中心/)).toBeInTheDocument();
      });

      const modalBox = screen.getByText("我知道了").closest(".relative");
      expect(modalBox).toHaveClass("md:w-[800px]");
      expect(modalBox).toHaveClass("h-[1000px]");

      // Modal parent container is centered on screen
      const modalOverlay = modalBox?.parentElement;
      expect(modalOverlay).toHaveClass("flex", "items-center", "justify-center");

      // Close modal
      fireEvent.click(screen.getByRole("button", { name: "我知道了" }));
      expect(screen.queryByText("我知道了")).not.toBeInTheDocument();

      // Switch to profile tab
      fireEvent.click(profileTab);
      expect(screen.getByText("咨询企业")).toBeInTheDocument();
      expect(screen.getByText("上海数科集团股份有限公司")).toBeInTheDocument();
      expect(screen.getByText(/913100007788990011/)).toBeInTheDocument();
      expect(screen.getByText(/上海数科云租户/)).toBeInTheDocument();
      expect(screen.getByText("数电发票云")).toBeInTheDocument();
    });

    it("detects 24-hour unclosed session: displays unclosed prompt and creates new session upon customer sending message", async () => {
      const mockUnclosedSession: SessionItem = {
        id: "CS-UNCLOSED-999",
        contact_name: "王先生",
        contact_phone: "13987654321",
        company_name: "上海数科集团股份有限公司",
        tax_no: "913100007788990011",
        tenant_name: "上海数科云租户",
        status: "queue",
        session_type: "online",
        is_human: false,
        agent_name: "在线待分配",
        created_at: "2026-09-21 10:00:00",
        updated_at: "2026-09-21 10:00:00",
        unread_count: 0,
        last_message: "上次开票报错 502",
      };

      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockUnclosedSession],
        closed: [],
      });

      const mockNewSession: SessionItem = {
        id: "CS-CREATED-001",
        contact_name: "王先生",
        contact_phone: "13987654321",
        company_name: "上海数科集团股份有限公司",
        tax_no: "913100007788990011",
        tenant_name: "上海数科云租户",
        status: "queue",
        session_type: "online",
        is_human: false,
        agent_name: "在线待分配",
        created_at: "2026-09-21 15:00:00",
        updated_at: "2026-09-21 15:00:00",
        unread_count: 0,
      };

      const initSessionSpy = vi.spyOn(receptionApi, "clientInitSession").mockResolvedValue({
        session: mockNewSession,
        messages: [],
      });
      const sendMsgSpy = vi.spyOn(receptionApi, "clientSendMessage").mockResolvedValue({
        id: 101,
        session_id: "CS-CREATED-001",
        sender_type: "customer",
        sender_name: "王先生",
        content: "我想咨询一个全新的税盘清卡问题",
        is_read: false,
        created_at: "2026-09-21 15:00:01",
      });

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          onBackToLogin={vi.fn()}
        />
      );

      // Detection prompt for 24h unclosed session
      await waitFor(() => {
        expect(
          screen.getByText(
            /您好！欢迎使用金蝶发票云在线支持，系统检测到你存在没有结束的会话，如果你要继续之前的会话，在右侧24小时未结束回话列表点击历史会话，可继续沟通，如需发起新的会话，可直接发送您遇到的问题/
          )
        ).toBeInTheDocument();
      });

      // Customer inputs a new question and clicks send
      const textarea = screen.getByPlaceholderText(/请输入您遇到的问题/);
      fireEvent.change(textarea, { target: { value: "我想咨询一个全新的税盘清卡问题" } });

      const sendBtn = screen.getByRole("button", { name: "发送" });
      fireEvent.click(sendBtn);

      // Should automatically call clientInitSession to generate new session row in DB!
      await waitFor(() => {
        expect(initSessionSpy).toHaveBeenCalledTimes(1);
        expect(sendMsgSpy).toHaveBeenCalledWith(
          "CS-CREATED-001",
          "我想咨询一个全新的税盘清卡问题",
          "王先生"
        );
      });
    });

    it("ongoing session stays in ongoing group even after 10+ minutes unless window is closed, and only enters unclosed list after window is closed", async () => {
      // 1. 模拟一个超过 10 分钟前的进行中会话（例如 30 分钟前创建）
      const mockOngoingSession: SessionItem = {
        id: "CS-LONG-RUNNING-001",
        contact_name: "王先生",
        contact_phone: "13987654321",
        company_name: "上海数科集团股份有限公司",
        tax_no: "913100007788990011",
        tenant_name: "上海数科云租户",
        status: "in_progress",
        session_type: "online",
        is_human: true,
        agent_name: "小李",
        created_at: "2026-09-21 14:00:00",
        updated_at: "2026-09-21 14:15:00",
        unread_count: 0,
        last_message: "您好，正在为您排查开票异常",
      };

      const mockExistingMsgs: MessageItem[] = [
        {
          id: 1,
          session_id: "CS-LONG-RUNNING-001",
          sender_type: "customer",
          sender_name: "王先生",
          content: "我的增值税发票无法开具",
          is_read: true,
          created_at: "2026-09-21 14:00:01",
        },
        {
          id: 2,
          session_id: "CS-LONG-RUNNING-001",
          sender_type: "agent",
          sender_name: "小李",
          content: "您好，正在为您排查开票异常",
          is_read: true,
          created_at: "2026-09-21 14:00:20",
        },
      ];

      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockOngoingSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue(mockExistingMsgs);

      // 阶段 A：页面未关闭（窗口生命周期内，sessionStorage 绑定该进行中会话）
      sessionStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(mockOngoingSession));

      const { unmount } = render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          onBackToLogin={vi.fn()}
        />
      );

      // 验证：直接加载会话消息，绝不显示系统“检测到未结束会话”提示
      expect(await screen.findByText(/我的增值税发票无法开具/)).toBeInTheDocument();
      expect((await screen.findAllByText(/您好，正在为您排查开票异常/)).length).toBeGreaterThanOrEqual(1);
      expect(
        screen.queryByText(/系统检测到你存在没有结束的会话/)
      ).not.toBeInTheDocument();

      // 验证：右侧栏中，当前会话在「进行中会话」中展示，标记为「当前活跃」和「服务中」
      expect(screen.getByText("当前活跃")).toBeInTheDocument();
      expect(screen.getByText("服务中")).toBeInTheDocument();

      // 验证：「24小时内未关闭会话」数量为 0（被过滤排除了当前活跃会话）
      const unclosedBadge = screen.getByText("24小时内未关闭会话").closest("button");
      expect(unclosedBadge).toHaveTextContent("0");

      unmount();

      // 阶段 B：用户关闭了操作窗口（sessionStorage 随窗口关闭被销毁，清空）
      sessionStorage.clear();

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          onBackToLogin={vi.fn()}
        />
      );

      // 验证：新窗口重新载入时，因为此前窗口已关闭且未标记结束，此时才进入「24小时内未关闭会话」并发出检测提示
      await waitFor(() => {
        expect(
          screen.getByText(/系统检测到你存在没有结束的会话，如果你要继续之前的会话，在右侧24小时未结束回话列表点击历史会话/)
        ).toBeInTheDocument();
      });

      // 此时「进行中会话」显示为 0
      const ongoingButton = screen.getByText("进行中会话").closest("button");
      expect(ongoingButton).toHaveTextContent("0");

      // 「24小时内未关闭会话」数量为 1
      const unclosedButtonNew = screen.getByText("24小时内未关闭会话").closest("button");
      expect(unclosedButtonNew).toHaveTextContent("1");

      // 展开「24小时内未关闭会话」
      fireEvent.click(unclosedButtonNew!);

      // 点击该历史会话卡片恢复沟通（此时仅载入查看，不自动移入进行中）
      const unclosedCard = await screen.findByText("CS-LONG-RUNNING-001");
      fireEvent.click(unclosedCard);

      // 验证：点击后该会话载入为当前窗口操作会话
      await waitFor(() => {
        expect(sessionStorage.getItem(STORAGE_SESSION_KEY)).toBeTruthy();
        const saved = JSON.parse(sessionStorage.getItem(STORAGE_SESSION_KEY)!);
        expect(saved.id).toBe("CS-LONG-RUNNING-001");
      });

      // 需求2：在未关闭会话中重新发送消息后，会话从24小时未关闭晋升进入「进行中会话」
      const sendMsgSpy = vi.spyOn(receptionApi, "clientSendMessage").mockResolvedValue({
        id: 999,
        session_id: "CS-LONG-RUNNING-001",
        sender_type: "customer",
        sender_name: "王先生",
        content: "请问有最新排查进展吗？",
        is_read: false,
        created_at: "2026-09-21 14:20:00",
      });

      const textarea = screen.getByPlaceholderText(/请输入您遇到的问题/);
      fireEvent.change(textarea, { target: { value: "请问有最新排查进展吗？" } });
      const sendBtn = screen.getByRole("button", { name: "发送" });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(sendMsgSpy).toHaveBeenCalled();
        expect(screen.getByText("当前活跃")).toBeInTheDocument();
      });
    });

    it("detects NO unclosed session: displays welcome prompt and creates session upon sending message", async () => {
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [],
        closed: [],
      });

      const mockNewSession: SessionItem = {
        id: "CS-NO-UNCLOSED-002",
        contact_name: "王先生",
        contact_phone: "13987654321",
        company_name: "上海数科集团股份有限公司",
        tax_no: "913100007788990011",
        tenant_name: "上海数科云租户",
        status: "queue",
        session_type: "online",
        is_human: false,
        agent_name: "在线待分配",
        created_at: "2026-09-21 15:10:00",
        updated_at: "2026-09-21 15:10:00",
        unread_count: 0,
      };

      const initSessionSpy = vi.spyOn(receptionApi, "clientInitSession").mockResolvedValue({
        session: mockNewSession,
        messages: [],
      });
      vi.spyOn(receptionApi, "clientSendMessage").mockResolvedValue({
        id: 102,
        session_id: "CS-NO-UNCLOSED-002",
        sender_type: "customer",
        sender_name: "王先生",
        content: "请教乐企直连接口报送失败的原因",
        is_read: false,
        created_at: "2026-09-21 15:10:01",
      });

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          onBackToLogin={vi.fn()}
        />
      );

      // Detection prompt for NO unclosed session
      await waitFor(() => {
        expect(
          screen.getByText(
            "你好，欢迎使用金蝶发票云在线支持，有什么可以帮助您？你可以直接给我发送您遇到的问题。"
          )
        ).toBeInTheDocument();
      });

      // Customer sends question
      const textarea = screen.getByPlaceholderText(/请输入您遇到的问题/);
      fireEvent.change(textarea, { target: { value: "请教乐企直连接口报送失败的原因" } });

      const sendBtn = screen.getByRole("button", { name: "发送" });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(initSessionSpy).toHaveBeenCalledTimes(1);
      });
    });

    it("sends message properly and updates conversation", async () => {
      const onBackToLogin = vi.fn();
      vi.spyOn(receptionApi, "clientSendMessage").mockResolvedValue({
        id: 2,
        session_id: "CS-BENCH-001",
        sender_type: "customer",
        sender_name: "王先生",
        content: "请问数电发票开票额度如何申请调高？",
        is_read: false,
        created_at: "2026-09-21 14:15:00",
      });

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={mockSession}
          initialMessages={mockInitialMessages}
          onBackToLogin={onBackToLogin}
        />
      );

      const textarea = screen.getByPlaceholderText(/请输入您遇到的问题/);
      fireEvent.change(textarea, { target: { value: "请问数电发票开票额度如何申请调高？" } });

      const sendBtn = screen.getByRole("button", { name: "发送" });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(receptionApi.clientSendMessage).toHaveBeenCalledWith(
          "CS-BENCH-001",
          "请问数电发票开票额度如何申请调高？",
          "王先生"
        );
        expect(screen.getByText("请问数电发票开票额度如何申请调高？")).toBeInTheDocument();
      });
    });

    it("handles closing session and opens evaluation modal", async () => {
      const onBackToLogin = vi.fn();
      vi.spyOn(receptionApi, "clientCloseSession").mockResolvedValue({
        status: "ok",
        closed_at: "2026-09-21 14:20:00",
      });

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={mockSession}
          initialMessages={mockInitialMessages}
          onBackToLogin={onBackToLogin}
        />
      );

      const closeBtn = screen.getByRole("button", { name: "结束会话" });
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(receptionApi.clientCloseSession).toHaveBeenCalledWith("CS-BENCH-001");
        // Evaluation modal opens automatically after closing
        expect(screen.getByText("服务满意度评价")).toBeInTheDocument();
      });
    });

    it("supports quoting agent message by clicking bubble or quote button and sending quoted response", async () => {
      const onBackToLogin = vi.fn();
      const agentMsg: MessageItem = {
        id: 10,
        session_id: "CS-BENCH-001",
        sender_type: "agent",
        sender_name: "李客服",
        content: "您好，开票额度可以在电子税务局【发票额度调整】模块申请",
        is_read: true,
        created_at: "2026-09-21 14:12:00",
      };

      let currentMsgs: MessageItem[] = [agentMsg];
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockImplementation(async () => currentMsgs);
      const sendSpy = vi.spyOn(receptionApi, "clientSendMessage").mockImplementation(
        async (_sid, content, senderName) => {
          const newMsg: MessageItem = {
            id: 11,
            session_id: "CS-BENCH-001",
            sender_type: "customer",
            sender_name: senderName || "王先生",
            content,
            is_read: false,
            created_at: "2026-09-21 14:13:00",
          };
          currentMsgs = [...currentMsgs, newMsg];
          return newMsg;
        }
      );

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={mockSession}
          initialMessages={[agentMsg]}
          onBackToLogin={onBackToLogin}
        />
      );

      // Find the agent message bubble
      const msgBubble = screen.getByText("您好，开票额度可以在电子税务局【发票额度调整】模块申请");
      expect(msgBubble).toBeInTheDocument();

      // Click agent message bubble to trigger quote
      fireEvent.click(msgBubble);

      // Verify quote preview bar appears
      expect(screen.getByText(/💬 引用 李客服:/)).toBeInTheDocument();

      // Test cancel quote
      const cancelBtn = screen.getByRole("button", { name: "取消引用" });
      fireEvent.click(cancelBtn);
      expect(screen.queryByText(/💬 引用 李客服:/)).not.toBeInTheDocument();

      // Click "引用回复" button at the bottom-right of the message to trigger quote again
      const quoteActionBtn = screen.getByRole("button", { name: "引用此消息" });
      expect(quoteActionBtn.closest("div")).toHaveClass("justify-end");
      fireEvent.click(quoteActionBtn);
      expect(screen.getByText(/💬 引用 李客服:/)).toBeInTheDocument();
      expect(screen.getByText("已引用")).toBeInTheDocument();

      // Input reply and send
      const textarea = screen.getByPlaceholderText(/请输入您遇到的问题/);
      fireEvent.change(textarea, { target: { value: "好的，请问审批一般需要多久？" } });

      const sendBtn = screen.getByRole("button", { name: "发送" });
      fireEvent.click(sendBtn);

      await waitFor(() => {
        expect(sendSpy).toHaveBeenCalledWith(
          "CS-BENCH-001",
          "「引用 李客服: 您好，开票额度可以在电子税务局【发票额度调整】模块申请」\n好的，请问审批一般需要多久？",
          "王先生"
        );
      });

      // Quote preview bar is cleared
      expect(screen.queryByText(/💬 引用 李客服:/)).not.toBeInTheDocument();

      // Check rendered quote box inside customer message bubble
      await waitFor(() => {
        expect(screen.getByText("引用 李客服")).toBeInTheDocument();
        expect(screen.getByText("好的，请问审批一般需要多久？")).toBeInTheDocument();
      });
    });

    it("polls session status updates from queue to in_progress in real time", async () => {
      const onBackToLogin = vi.fn();
      const queueSession: SessionItem = {
        ...mockSession,
        status: "queue",
        agent_name: "",
      };

      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValueOnce({
        recent_open: [queueSession],
        closed: [],
      }).mockResolvedValue({
        recent_open: [
          {
            ...queueSession,
            status: "in_progress",
            agent_name: "专家张三",
            updated_at: "2026-09-21 14:15:00",
          },
        ],
        closed: [],
      });

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={queueSession}
          initialMessages={[]}
          onBackToLogin={onBackToLogin}
        />
      );

      // Initially shows queue status
      expect(screen.getByText("排队中，客服正接入...")).toBeInTheDocument();
      expect(screen.getByText("排队中")).toBeInTheDocument();

      // After polling interval, status updates to in_progress
      await waitFor(
        () => {
          expect(screen.getByText("坐席在线沟通中")).toBeInTheDocument();
          expect(screen.getByText("接待人: 专家张三")).toBeInTheDocument();
          expect(screen.getByText("服务中")).toBeInTheDocument();
        },
        { timeout: 4000 }
      );
    });

    it("displays system notification with agent nickname instead of real name when transferred to human agent", async () => {
      const onBackToLogin = vi.fn();
      const inProgressSession: SessionItem = {
        ...mockSession,
        status: "in_progress",
        agent_name: "慧莉客服",
      };

      const transferMsg: MessageItem = {
        id: 999,
        session_id: inProgressSession.id,
        sender_type: "system",
        sender_name: "系统通知",
        content: "已为您分配在线坐席【慧莉客服】，正在接入会话...",
        is_read: true,
        created_at: "2026-09-22 10:15:00",
      };

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={inProgressSession}
          initialMessages={[transferMsg]}
          onBackToLogin={onBackToLogin}
        />
      );

      // 验证系统转人工提示信息中使用坐席昵称，且不出现真实姓名
      expect(screen.getByText("已为您分配在线坐席【慧莉客服】，正在接入会话...")).toBeInTheDocument();
      expect(screen.queryByText(/已为您分配在线坐席【杨慧莉】/)).not.toBeInTheDocument();
      // 验证顶部接待人显示坐席昵称
      expect(screen.getByText("接待人: 慧莉客服")).toBeInTheDocument();
    });
  });

  describe("CustomerClientApp Integrated Flow", () => {
    it("renders info collection page first, switches to workbench upon login, and supports re-login", async () => {
      vi.spyOn(receptionApi, "clientLookupPhone").mockResolvedValue({
        phone: "13588889999",
        exists: false,
        count: 0,
        items: [],
      });
      vi.spyOn(receptionApi, "clientFetchTenantProfile").mockResolvedValue({
        tenant_name: "浙江电商租户",
        tenant_no: "T-ZJ-01",
        purchased_products: ["数电发票云"],
      });

      render(
        <MemoryRouter>
          <CustomerClientApp />
        </MemoryRouter>
      );

      // Initially shows collection page
      expect(screen.getByText("发票云售后在线支持")).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText(/请输入您的称呼/);
      const phoneInput = screen.getByPlaceholderText(/请输入11位中国大陆手机号码/);
      const companyInput = screen.getByPlaceholderText(/请输入本次咨询的企业全称/);
      const taxInput = screen.getByPlaceholderText(/请输入统一社会信用代码/);

      fireEvent.change(nameInput, { target: { value: "周工" } });
      fireEvent.change(phoneInput, { target: { value: "13588889999" } });
      fireEvent.change(companyInput, { target: { value: "杭州某电子商务公司" } });
      fireEvent.change(taxInput, { target: { value: "91330106MA22TEST33" } });

      const submitBtn = screen.getByRole("button", { name: "提交" });
      fireEvent.click(submitBtn);

      // Successfully transitioned to chat workbench with welcome prompt
      await waitFor(() => {
        expect(screen.getByText("周工")).toBeInTheDocument();
        expect(
          screen.getByText(/您好！欢迎使用发票云售后在线支持。系统已为您建立会话/)
        ).toBeInTheDocument();
      });

      // 关闭弹出的重要通知
      const closePopupBtn = screen.queryByRole("button", { name: "我知道了" });
      if (closePopupBtn) {
        fireEvent.click(closePopupBtn);
      }

      // Right panel defaults to "重要通知", can switch to "客户信息" and verify company name
      const profileTab = screen.getByRole("button", { name: /客户信息/ });
      fireEvent.click(profileTab);
      expect(screen.getByText("杭州某电子商务公司")).toBeInTheDocument();

      // Test switching identity / re-login
      const switchBtn = screen.getByRole("button", { name: "切换身份" });
      fireEvent.click(switchBtn);

      // Returns to collection page
      expect(screen.getByText("发票云售后在线支持")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/请输入您的称呼/)).toBeInTheDocument();
    });
  });

  describe("Ticket Information Tab & Client Notice Rules", () => {
    const mockProfile: CustomerProfile = {
      contact_name: "测试用户",
      contact_phone: "13800001111",
      company_name: "北京阳光科技有限责任公司",
      tax_no: "91110108MA00XYZ99",
      tenant_name: "阳光华北租户",
      tenant_no: "T-BJ-01",
      purchased_products: ["数电发票乐企直连模块"],
      is_historical: false,
    };

    const mockTickets: receptionApi.ClientTicketItem[] = [
      {
        id: 201,
        short_code: "TKT-009201",
        ticket_number: "R20260924-0099",
        source_code: "ksm",
        source_name: "KSM系统",
        handler_name: "张工(产研)",
        process_stage: "产研处理",
        status: "processing",
        client_category: "processing",
        title: "批量打印数电票据超时失败错误代码0x8004",
        body: "批量开具100张数电发票时偶发请求超时",
        created_at: "2026-09-22 14:00",
        hours_since_created: 45.2,
      },
      {
        id: 202,
        short_code: "TKT-009202",
        ticket_number: "R20260923-0055",
        source_code: "zhichi",
        source_name: "智齿客服",
        handler_name: "李客服(服务)",
        process_stage: "服务处理",
        status: "reviewing",
        client_category: "reviewing",
        title: "税控盘驱动无法正常识别",
        body: "更新客户端后提示驱动未安装",
        created_at: "2026-09-23 09:30",
        hours_since_created: 25.0,
        reply_content: "已远程重新安装驱动补丁包，请重新插拔税控盘测试是否正常识别。",
        reply_at: "2026-09-23 16:00",
        reply_by: "李客服(服务)",
      },
      {
        id: 203,
        short_code: "TKT-009203",
        ticket_number: "R20260920-0010",
        source_code: "ksm",
        source_name: "KSM系统",
        handler_name: "王工程师",
        process_stage: "完成",
        status: "closed",
        client_category: "closed",
        title: "乐企直连证书续期咨询",
        body: "咨询直连乐企平台证书续期的具体流程与审核材料",
        created_at: "2026-09-20 11:20",
        hours_since_created: 96.0,
        reply_content: "已发送乐企平台证书更新指引手册至客户邮箱，客户已查收确认无误。",
        reply_at: "2026-09-21 10:00",
        reply_by: "王工程师",
      },
    ];

    it("verifies tab order (客户信息 -> 重要通知 -> 工单信息) and default tab selection based on notice count", async () => {
      // 场景 1：无任何上架通知时，进入后默认选中「客户信息」
      vi.spyOn(receptionApi, "clientFetchNotices").mockResolvedValueOnce([]);
      vi.spyOn(receptionApi, "clientFetchTickets").mockResolvedValueOnce(mockTickets);

      const { unmount } = render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={null}
          onBackToLogin={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("咨询企业")).toBeInTheDocument();
      });

      // 验证 Tab 标签存在且顺序正确
      const tabButtons = screen.getAllByRole("button").filter((b) =>
        b.textContent?.includes("客户信息") ||
        b.textContent?.includes("重要通知") ||
        b.textContent?.includes("工单信息")
      );
      expect(tabButtons.length).toBe(3);
      expect(tabButtons[0].textContent).toContain("客户信息");
      expect(tabButtons[1].textContent).toContain("重要通知");
      expect(tabButtons[2].textContent).toContain("工单信息");

      unmount();

      // 场景 2：有 ≥1 条通知时，进入后默认选中「重要通知」
      vi.spyOn(receptionApi, "clientFetchNotices").mockResolvedValueOnce([
        {
          id: "notice-1",
          title: "国税局核心征管系统停机维护通知",
          content: "<p>国税局将于周日凌晨进行系统维护...</p>",
          publish_time: "2026-09-24 08:00",
          is_important: true,
        },
      ]);
      vi.spyOn(receptionApi, "clientFetchTickets").mockResolvedValueOnce(mockTickets);

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={null}
          onBackToLogin={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("国税局核心征管系统停机维护通知")).toBeInTheDocument();
      });
    });

    it("renders ticket information list, handles remind, confirm, and return modals", async () => {
      vi.spyOn(receptionApi, "clientFetchTickets").mockResolvedValue(mockTickets);
      vi.spyOn(receptionApi, "clientRemindTicket").mockResolvedValue({
        success: true,
        notified: true,
        hours_since_created: 45.2,
        message: "提单已超过24小时，已向工单当前处理人推送催单信息！",
      });
      vi.spyOn(receptionApi, "clientConfirmTicket").mockResolvedValue({
        success: true,
        status: "closed",
        message: "工单已确认解决并顺利关闭！",
      });

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={null}
          onBackToLogin={vi.fn()}
        />
      );

      // 等待初始化加载完成
      await waitFor(() => {
        expect(receptionApi.clientFetchTickets).toHaveBeenCalled();
      });

      // 关闭弹出的通知（若有）
      const closePopupBtn = screen.queryByRole("button", { name: "我知道了" });
      if (closePopupBtn) {
        fireEvent.click(closePopupBtn);
      }

      // 切换到【工单信息】Tab
      const ticketTab = screen.getByRole("button", { name: /工单信息/ });
      fireEvent.click(ticketTab);

      // 验证固定表头
      await waitFor(() => {
        expect(screen.getByText("工单号")).toBeInTheDocument();
      });
      expect(screen.getByText("提单渠道")).toBeInTheDocument();
      expect(screen.getByText("处理人")).toBeInTheDocument();
      expect(screen.getByText("提单时间")).toBeInTheDocument();
      expect(screen.getByText("操作")).toBeInTheDocument();

      // 验证工单信息Tab徽标统计数等于处理中(1)+已答复待确认(1)=2
      expect(screen.getByRole("button", { name: /工单信息/ })).toHaveTextContent("2");

      // 验证二级切换菜单存在：处理中、已答复待确认、已关闭
      expect(screen.getByRole("button", { name: /处理中/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /已答复待确认/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /已关闭/ })).toBeInTheDocument();

      // 1. 处理中：显示催单按钮并测试点击（验证说明文字最多12字并用省略号截断）
      expect(screen.getByText("R20260924-0099")).toBeInTheDocument();
      expect(screen.getByText("批量打印数电票据超时失败...")).toBeInTheDocument();
      const remindBtn = screen.getByRole("button", { name: "催单" });
      fireEvent.click(remindBtn);

      await waitFor(() => {
        expect(receptionApi.clientRemindTicket).toHaveBeenCalledWith(201, "13800001111");
        expect(screen.getByText("提单已超过24小时，已向工单当前处理人推送催单信息！")).toBeInTheDocument();
      });

      // 关闭催单模态窗
      const confirmNoticeBtn = screen.getByRole("button", { name: "我知道了" });
      fireEvent.click(confirmNoticeBtn);

      // 2. 已答复待确认：切换并点击【查看确认】
      const reviewingSubTab = screen.getByRole("button", { name: /已答复待确认/ });
      fireEvent.click(reviewingSubTab);

      expect(screen.getByText("R20260923-0055")).toBeInTheDocument();
      const checkConfirmBtn = screen.getByRole("button", { name: "查看确认" });
      fireEvent.click(checkConfirmBtn);

      // 弹窗展示答复方案与确认/退回按钮
      expect(screen.getAllByText("税控盘驱动无法正常识别").length).toBeGreaterThan(0);
      expect(screen.getByText(/已远程重新安装驱动补丁包/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /确认已解决/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "未解决退回" })).toBeInTheDocument();

      // 测试未解决退回交互
      const returnBtn = screen.getByRole("button", { name: "未解决退回" });
      fireEvent.click(returnBtn);
      expect(screen.getByPlaceholderText(/请详细说明问题为何未解决/)).toBeInTheDocument();

      const reasonInput = screen.getByPlaceholderText(/请详细说明问题为何未解决/);
      fireEvent.change(reasonInput, { target: { value: "重新插拔后仍然提示错误代码0x8004" } });

      const doReturnBtn = screen.getByRole("button", { name: "确认退回给处理人" });
      fireEvent.click(doReturnBtn);

      await waitFor(() => {
        expect(receptionApi.clientConfirmTicket).toHaveBeenCalledWith(
          202,
          "13800001111",
          "return",
          "重新插拔后仍然提示错误代码0x8004"
        );
      });

      // 3. 已关闭：切换并点击【查看】
      const closeDialogBtn = screen.queryByRole("button", { name: "我知道了" });
      if (closeDialogBtn) {
        fireEvent.click(closeDialogBtn);
      }

      const closedSubTab = screen.getByRole("button", { name: /已关闭/ });
      fireEvent.click(closedSubTab);

      expect(screen.getByText("R20260920-0010")).toBeInTheDocument();
      const viewBtn = screen.getByRole("button", { name: "查看" });
      fireEvent.click(viewBtn);

      expect(screen.getByText("提单详情")).toBeInTheDocument();
      expect(screen.getAllByText("乐企直连证书续期咨询").length).toBeGreaterThan(0);
      expect(screen.getByText(/已发送乐企平台证书更新指引手册/)).toBeInTheDocument();

      const closeViewModalBtn = screen.getByRole("button", { name: "关闭" });
      fireEvent.click(closeViewModalBtn);
      expect(screen.queryByText("提单详情")).not.toBeInTheDocument();
    });

    it("only displays tickets where reporter_mobile equals consulting customer phone and filters out mismatched ones", async () => {
      vi.spyOn(receptionApi, "clientFetchTickets").mockResolvedValue([
        {
          id: 301,
          short_code: "TKT-00301",
          ticket_number: "R20261009-0301",
          source_code: "ksm",
          source_name: "KSM",
          handler_name: "苗一琳",
          process_stage: "服务处理",
          status: "processing",
          client_category: "processing",
          title: "本人手机号提单记录",
          body: "提单人手机号等于咨询人手机号",
          created_at: "2026-10-09 10:00",
          hours_since_created: 2.0,
          reporter_mobile: "13800001111",
        },
        {
          id: 302,
          short_code: "TKT-00302",
          ticket_number: "R20261009-0302",
          source_code: "ksm",
          source_name: "KSM",
          handler_name: "张工",
          process_stage: "服务处理",
          status: "processing",
          client_category: "processing",
          title: "他人手机号提单记录",
          body: "提单人手机号不等于咨询人手机号",
          created_at: "2026-10-09 09:00",
          hours_since_created: 3.0,
          reporter_mobile: "13999998888",
        },
      ]);

      render(
        <CustomerChatWorkbenchPage
          profile={mockProfile}
          initialSession={null}
          onBackToLogin={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(receptionApi.clientFetchTickets).toHaveBeenCalledWith("13800001111");
      });

      const ticketTab = screen.getByRole("button", { name: /工单信息/ });
      fireEvent.click(ticketTab);

      await waitFor(() => {
        expect(screen.getByText("R20261009-0301")).toBeInTheDocument();
      });
      expect(screen.queryByText("R20261009-0302")).not.toBeInTheDocument();
    });
  });

  describe("Agent Reception & Unresolved Escalation Flow", () => {
    const mockClientProfile: CustomerProfile = {
      contact_phone: "13800008888",
      contact_name: "林经理",
      company_name: "数电乐企技术测试公司",
      tax_no: "91330100MA22334455",
      tenant_name: "数电乐企租户",
      tenant_no: "T-LEQI-01",
      purchased_products: ["数电发票乐企模块"],
      is_historical: false,
    };

    const mockAgentSession: SessionItem = {
      id: "CS-AGENT-888",
      contact_name: "林经理",
      contact_phone: "13800008888",
      company_name: "数电乐企技术测试公司",
      status: "in_progress",
      is_human: false,
      agent_name: "数电乐企技术专家",
      session_type: "online",
      unread_count: 0,
      created_at: "2026-09-24T10:00:00Z",
      updated_at: "2026-09-24T10:00:00Z",
    };

    const mockBotMessage: MessageItem = {
      id: 9901,
      session_id: "CS-AGENT-888",
      sender_type: "bot",
      sender_name: "数电乐企技术专家",
      content: "您好！这是针对乐企直连通道证书同步异常的自动解决方案，请检查根证书有效性。",
      is_read: true,
      created_at: "2026-09-24T10:01:00Z",
    };

    it("displays bot message with feedback buttons, triggers ask_transfer card on 未解决 and escalates to human", async () => {
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockAgentSession],
        closed: [],
      });
      const transferCardMsg: MessageItem = {
        id: 9902,
        session_id: "CS-AGENT-888",
        sender_type: "system",
        sender_name: "系统通知",
        content: "[CARD:ask_transfer] 当前人工坐席在岗，是否需要为您转接人工坐席继续跟进？",
        is_read: true,
        created_at: "2026-09-24T10:02:00Z",
      };

      vi.spyOn(receptionApi, "clientFetchMessages")
        .mockResolvedValueOnce([mockBotMessage])
        .mockResolvedValueOnce([mockBotMessage, transferCardMsg])
        .mockResolvedValue([mockBotMessage, transferCardMsg]);

      vi.spyOn(receptionApi, "clientMarkUnresolved").mockResolvedValue({
        ok: true,
        action_type: "ask_transfer",
        prompt_text: "当前人工坐席在岗，是否需要为您转接人工坐席继续跟进？",
      });
      vi.spyOn(receptionApi, "clientEscalateHuman").mockResolvedValue({
        session: { ...mockAgentSession, status: "queue", is_human: true, agent_name: "待分配坐席" },
        messages: [
          mockBotMessage,
          {
            id: 9903,
            session_id: "CS-AGENT-888",
            sender_type: "system",
            sender_name: "系统通知",
            content: "已为您转接人工客服，正在为您排队分配空闲坐席，请稍候...",
            is_read: true,
            created_at: "2026-09-24T10:03:00Z",
          },
        ],
      });

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockAgentSession}
            initialMessages={[mockBotMessage]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      // 验证渲染了 AI 智能回答
      expect(await screen.findByText("数电乐企技术专家")).toBeInTheDocument();
      expect(screen.getByText(/针对乐企直连通道证书同步异常的自动解决方案/)).toBeInTheDocument();
      // 用户需求5：彻底移除消息气泡底部的「以上解答是否对您有帮助？」
      expect(screen.queryByText("以上解答是否对您有帮助？")).not.toBeInTheDocument();

      // 验证快捷点击胶囊中的 👍 1 解决 和 👎 2 未解决 按钮
      const solvedBtn = screen.getByRole("button", { name: /1 解决/ });
      const unsolvedBtn = screen.getByRole("button", { name: /2 未解决/ });
      expect(solvedBtn).toBeInTheDocument();
      expect(unsolvedBtn).toBeInTheDocument();

      // 点击 未解决
      fireEvent.click(unsolvedBtn);

      await waitFor(() => {
        expect(receptionApi.clientMarkUnresolved).toHaveBeenCalledWith("CS-AGENT-888", 9901);
      });

      // 渲染转人工询问卡片
      expect(await screen.findByText("转接人工客服询问")).toBeInTheDocument();
      expect(screen.getByText(/当前人工坐席在岗，是否需要为您转接人工坐席继续跟进？/)).toBeInTheDocument();
      const transferBtn = screen.getByRole("button", { name: /确认转接人工坐席/ });
      expect(transferBtn).toBeInTheDocument();

      // 点击 确认转接人工坐席
      fireEvent.click(transferBtn);

      await waitFor(() => {
        expect(receptionApi.clientEscalateHuman).toHaveBeenCalledWith("CS-AGENT-888");
      });
    });

    it("opens submit ticket modal and submits ticket successfully", async () => {
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockAgentSession],
        closed: [],
      });
      const guideTicketMsg: MessageItem = {
        id: 9904,
        session_id: "CS-AGENT-888",
        sender_type: "system",
        sender_name: "系统通知",
        content: "[CARD:guide_ticket] 当前非人工工作时段或人工坐席全忙，建议您提交售后工单，由专属工程师跟进处理。",
        is_read: true,
        created_at: "2026-09-24T10:04:00Z",
      };
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue([guideTicketMsg]);
      vi.spyOn(receptionApi, "clientSubmitTicket").mockResolvedValue({
        ok: true,
        ticket_short_code: "R20260924-0301",
        status: "received",
        title: "乐企直连通道证书同步异常",
      });

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockAgentSession}
            initialMessages={[guideTicketMsg]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(await screen.findByText("在线客服暂无空闲 / 引导提交售后工单")).toBeInTheDocument();
      expect(screen.getByText(/当前非人工工作时段或人工坐席全忙/)).toBeInTheDocument();
      const oneClickSubmitBtn = screen.getByRole("button", { name: /一键提交售后工单/ });
      fireEvent.click(oneClickSubmitBtn);

      // 弹窗打开
      expect(await screen.findByText("一键提交售后工单")).toBeInTheDocument();
      expect(screen.getByText("数电乐企技术测试公司")).toBeInTheDocument();

      const confirmBtn = screen.getByRole("button", { name: "确认提交工单" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(receptionApi.clientSubmitTicket).toHaveBeenCalled();
      });
    });

    it("renders quick action capsules for '1 解决 2 未解决' and handles clicking '1 解决'", async () => {
      const botMsgWithOptions: MessageItem = {
        id: 9910,
        session_id: "CS-AGENT-888",
        sender_type: "bot",
        sender_name: "🧾 数电发票专家",
        content:
          "【数电发票开具解答】\n1. 请在发票管理开具发票；\n\n以上回复是否已经解决您的问题\n1 解决\n2 未解决",
        is_read: true,
        created_at: "2026-09-24T10:10:00Z",
      };
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockAgentSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue([botMsgWithOptions]);
      const sendMock = vi.spyOn(receptionApi, "clientSendMessage").mockResolvedValue({
        id: 9911,
        session_id: "CS-AGENT-888",
        sender_type: "customer",
        sender_name: "张三",
        content: "1 解决",
        is_read: false,
        created_at: "2026-09-24T10:10:05Z",
      });

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockAgentSession}
            initialMessages={[botMsgWithOptions]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      // Verify quick click capsules are rendered
      expect(await screen.findByText("⚡ 快捷点击：")).toBeInTheDocument();
      const solveCapsule = screen.getByRole("button", { name: /👍 1 解决/ });
      const unsolveCapsule = screen.getByRole("button", { name: /👎 2 未解决/ });
      expect(solveCapsule).toBeInTheDocument();
      expect(unsolveCapsule).toBeInTheDocument();

      // Click "👍 1 解决" capsule
      fireEvent.click(solveCapsule);

      await waitFor(() => {
        expect(sendMock).toHaveBeenCalledWith("CS-AGENT-888", "1 解决", "林经理");
      });
    });

    it("renders numbered choice capsules and sends option on click", async () => {
      const botMsgWithChoices: MessageItem = {
        id: 9920,
        session_id: "CS-AGENT-888",
        sender_type: "bot",
        sender_name: "🧾 数电发票专家",
        content:
          "【金蝶发票云产品版本全景】\n1. 标准版发票云\n2. For AI 星瀚版\n3. 星空旗舰版\n4. 国际版\n\n您可以点击下方快捷按钮了解详情！",
        is_read: true,
        created_at: "2026-09-24T10:12:00Z",
      };
      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockAgentSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue([botMsgWithChoices]);
      const sendMock = vi.spyOn(receptionApi, "clientSendMessage").mockResolvedValue({
        id: 9921,
        session_id: "CS-AGENT-888",
        sender_type: "customer",
        sender_name: "林经理",
        content: "1. 标准版发票云",
        is_read: false,
        created_at: "2026-09-24T10:12:05Z",
      });

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockAgentSession}
            initialMessages={[botMsgWithChoices]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      // Verify numbered capsules
      expect(await screen.findByText("⚡ 快捷点击：")).toBeInTheDocument();
      const opt1Btn = screen.getByRole("button", { name: /1\. 标准版发票云/ });
      const opt2Btn = screen.getByRole("button", { name: /2\. For AI 星瀚版/ });
      expect(opt1Btn).toBeInTheDocument();
      expect(opt2Btn).toBeInTheDocument();

      // Click option 1
      fireEvent.click(opt1Btn);

      await waitFor(() => {
        expect(sendMock).toHaveBeenCalledWith("CS-AGENT-888", "1. 标准版发票云", "林经理");
      });
    });

    it("resolves session automatically on clicking 👍 已解决 and pops evaluation modal", async () => {
      const mockSession: SessionItem = {
        id: "CS-RESOLVE-100",
        contact_name: "林经理",
        contact_phone: "13800138000",
        company_name: "深圳市创新科技有限公司",
        status: "in_progress",
        is_human: false,
        agent_name: "🧾 数电发票专家",
        unread_count: 0,
        session_type: "online",
        created_at: "2026-09-24 10:00:00",
        updated_at: "2026-09-24 10:05:00",
      };
      const botMsg: MessageItem = {
        id: 7701,
        session_id: "CS-RESOLVE-100",
        sender_type: "bot",
        sender_name: "🧾 数电发票专家",
        content: "数电发票红字冲红操作说明已提供。请点击下方【👍 已解决】或【👎 未解决】。",
        is_read: true,
        created_at: "2026-09-24 10:05:00",
      };

      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue([botMsg]);
      const resolveMock = vi.spyOn(receptionApi, "clientResolveSession").mockResolvedValue({
        ok: true,
        status: "closed",
        is_human: false,
        agent_name: "🧾 数电发票专家",
      });

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockSession}
            initialMessages={[botMsg]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      const resolveBtn = await screen.findByRole("button", { name: /1 解决/ });
      expect(resolveBtn).toBeInTheDocument();
      fireEvent.click(resolveBtn);

      await waitFor(() => {
        expect(resolveMock).toHaveBeenCalledWith("CS-RESOLVE-100");
        // Verify evaluation modal is opened
        expect(screen.getByText("服务满意度评价")).toBeInTheDocument();
      });
    });

    it("cleans greetings, status and transfer words when opening submit ticket modal", async () => {
      const mockSession: SessionItem = {
        id: "CS-TICKET-CLEAN-200",
        contact_name: "林经理",
        contact_phone: "13800138000",
        company_name: "深圳市创新科技有限公司",
        status: "in_progress",
        is_human: false,
        agent_name: "🧾 数电发票专家",
        unread_count: 0,
        session_type: "online",
        created_at: "2026-09-24 10:00:00",
        updated_at: "2026-09-24 10:05:00",
      };
      const msgs: MessageItem[] = [
        {
          id: 1,
          session_id: "CS-TICKET-CLEAN-200",
          sender_type: "customer",
          sender_name: "林经理",
          content: "您好，在吗？",
          is_read: true,
          created_at: "2026-09-24 10:01:00",
        },
        {
          id: 2,
          session_id: "CS-TICKET-CLEAN-200",
          sender_type: "customer",
          sender_name: "林经理",
          content: "你好，请问数电发票怎么冲红？",
          is_read: true,
          created_at: "2026-09-24 10:02:00",
        },
        {
          id: 3,
          session_id: "CS-TICKET-CLEAN-200",
          sender_type: "customer",
          sender_name: "林经理",
          content: "2 未解决",
          is_read: true,
          created_at: "2026-09-24 10:03:00",
        },
        {
          id: 4,
          session_id: "CS-TICKET-CLEAN-200",
          sender_type: "customer",
          sender_name: "林经理",
          content: "转人工客服",
          is_read: true,
          created_at: "2026-09-24 10:04:00",
        },
        {
          id: 5,
          session_id: "CS-TICKET-CLEAN-200",
          sender_type: "customer",
          sender_name: "林经理",
          content: "另外还有个问题：跨月发票可以直接作废吗？",
          is_read: true,
          created_at: "2026-09-24 10:05:00",
        },
        {
          id: 6,
          session_id: "CS-TICKET-CLEAN-200",
          sender_type: "system",
          sender_name: "智能服务助手",
          content: "[CARD:guide_ticket] 当前人工客服全忙，建议您提交售后工单加急处理。",
          is_read: true,
          created_at: "2026-09-24 10:06:00",
        },
      ];

      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue(msgs);

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockSession}
            initialMessages={msgs}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      // Trigger card ticket modal
      const ticketBtn = await screen.findByRole("button", { name: /一键提交售后工单/ });
      fireEvent.click(ticketBtn);

      await waitFor(() => {
        expect(screen.getByText("一键提交售后工单")).toBeInTheDocument();
      });

      // Verify title is set to first valid question (greeting stripped)
      const titleInput = screen.getByDisplayValue("数电发票怎么冲红？");
      expect(titleInput).toBeInTheDocument();

      // Verify body contains clean combined questions and does not contain greeting or status
      const descInput = screen.getByPlaceholderText(
        "详细描述异常场景、开票软件提示及诉求"
      ) as HTMLTextAreaElement;
      expect(descInput).toBeInTheDocument();
      expect(descInput.value).toContain("1. 数电发票怎么冲红？");
      expect(descInput.value).toContain("2. 另外还有个问题：跨月发票可以直接作废吗？");
      expect(descInput.value).not.toContain("您好，在吗？");
      expect(descInput.value).not.toContain("2 未解决");
      expect(descInput.value).not.toContain("转人工客服");
    });

    it("does NOT render quick click '1 解决 2 未解决' capsules for inquiry/question-confirmation replies", async () => {
      const inquiryBotMsg: MessageItem = {
        id: 9950,
        session_id: "CS-AGENT-888",
        sender_type: "bot",
        sender_name: "数电乐企技术专家",
        content: "您好！请问您遇到的是什么问题，使用的是哪款产品呢？请描述一下具体情况，我来帮您解答。",
        is_read: true,
        created_at: "2026-09-24T10:15:00Z",
      };

      vi.spyOn(receptionApi, "clientFetchSessions").mockResolvedValue({
        recent_open: [mockAgentSession],
        closed: [],
      });
      vi.spyOn(receptionApi, "clientFetchMessages").mockResolvedValue([inquiryBotMsg]);

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockAgentSession}
            initialMessages={[inquiryBotMsg]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(await screen.findByText(/您好！请问您遇到的是什么问题/)).toBeInTheDocument();
      // 确认询问类回复严禁展示 1 解决 和 2 未解决 胶囊
      expect(screen.queryByRole("button", { name: /1 解决/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /2 未解决/ })).not.toBeInTheDocument();
      expect(screen.queryByText("⚡ 快捷点击：")).not.toBeInTheDocument();
    });

    it("renders agent avatar as a 25px*25px circular element", async () => {
      const botMsg: MessageItem = {
        id: 9960,
        session_id: "CS-AGENT-888",
        sender_type: "bot",
        sender_name: "数电乐企技术专家",
        content: "这是操作指导，请参考以下说明处理。",
        is_read: true,
        created_at: "2026-09-24T10:16:00Z",
      };

      render(
        <MemoryRouter>
          <CustomerChatWorkbenchPage
            profile={mockClientProfile}
            initialSession={mockAgentSession}
            initialMessages={[botMsg]}
            onBackToLogin={vi.fn()}
          />
        </MemoryRouter>
      );

      // 验证渲染的 Agent 头像元素尺寸为 25px*25px 且为圆形 (rounded-full)
      const avatarEl = screen.getByTitle("数电乐企技术专家");
      expect(avatarEl).toBeInTheDocument();
      expect(avatarEl.className).toContain("w-[25px]");
      expect(avatarEl.className).toContain("h-[25px]");
      expect(avatarEl.className).toContain("rounded-full");
    });
  });
});
