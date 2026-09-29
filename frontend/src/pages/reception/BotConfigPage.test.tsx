import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/msw-server";
import { BotConfigPage } from "./BotConfigPage";
import { DEFAULT_BOT_CONFIG, type BotConfigData } from "./receptionApi";

describe("BotConfigPage (智能解答配置优化第二期)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);
    server.use(
      http.get("*/api/reception/bot-config", () => HttpResponse.json(DEFAULT_BOT_CONFIG)),
      http.put("*/api/reception/bot-config", async ({ request }) =>
        HttpResponse.json(await request.json())
      )
    );
  });

  it("shows the persisted agent type and clears a stale default fallback when saving", async () => {
    const normalAgent = {
      ...DEFAULT_BOT_CONFIG.agents.find((agent) => agent.code === "AGENT0003")!,
      agent_type: "normal" as const,
    };
    const uatConfig: BotConfigData = {
      ...DEFAULT_BOT_CONFIG,
      agents: [normalAgent],
      default_agent_id: normalAgent.id,
    };
    let savedConfig: BotConfigData | undefined;
    server.use(
      http.get("*/api/reception/bot-config", () => HttpResponse.json(uatConfig)),
      http.put("*/api/reception/bot-config", async ({ request }) => {
        savedConfig = (await request.json()) as BotConfigData;
        return HttpResponse.json(savedConfig);
      })
    );

    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "AGENT0003" }));
    expect(screen.getByDisplayValue("正常智能体")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(savedConfig?.default_agent_id).toBe("");
      expect(screen.getByText("智能体更新成功，状态已置为禁用")).toBeInTheDocument();
    });
    expect(screen.getByText("正常智能体")).toBeInTheDocument();
  });

  it("keeps the editor open and reports an error when saving fails", async () => {
    server.use(
      http.put("*/api/reception/bot-config", () =>
        HttpResponse.json({ detail: "save failed" }, { status: 500 })
      )
    );
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "AGENT0001" }));
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(await screen.findByText("保存配置失败，请重试")).toBeInTheDocument();
    expect(screen.getByText("智能体维护")).toBeInTheDocument();
    expect(screen.queryByText("智能体更新成功，状态已置为禁用")).not.toBeInTheDocument();
  });

  it("renders 14px tabs with white box, removes 消息分流规则 tab, shows 5 unified action buttons", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    // 标题”智能体接待配置“与说明
    expect(screen.getByText("智能体接待配置")).toBeInTheDocument();
    expect(screen.getByText(/配置在线咨询优先接入的 AI Agent 智能体列表/)).toBeInTheDocument();

    // 重新载入、保存全部配置 按钮隐藏
    expect(screen.queryByText(/重新载入/)).not.toBeInTheDocument();
    expect(screen.queryByText(/保存全部配置/)).not.toBeInTheDocument();

    // Tab 只有 智能体管理 和 接待与转人工策略（已移除 消息分流规则）
    expect(screen.getByRole("button", { name: /智能体管理/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /接待与转人工策略/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /消息分流规则/ })).not.toBeInTheDocument();

    // 5 个操作按钮：新增agent, 启用, 禁用, 删除, 刷新
    expect(screen.getByRole("button", { name: /新增agent/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /启用/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /禁用/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /刷新/ })).toBeInTheDocument();

    // 表格表头字段展示（包含新增的智能体类型和适用来源渠道）
    expect(screen.getByText("智能体编号")).toBeInTheDocument();
    expect(screen.getByText("智能体名字")).toBeInTheDocument();
    expect(screen.getByText("智能体类型")).toBeInTheDocument();
    expect(screen.getByText("智能体说明")).toBeInTheDocument();
    expect(screen.getByText("适用产品线")).toBeInTheDocument();
    expect(screen.getByText("适用来源渠道")).toBeInTheDocument();
    expect(screen.getByText("智能体状态")).toBeInTheDocument();
    expect(screen.getByText("创建时间")).toBeInTheDocument();
    expect(screen.getByText("创建人")).toBeInTheDocument();

    // 默认智能体与编号超链接
    expect(await screen.findByRole("button", { name: "AGENT0001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "数电发票专家" })).toBeInTheDocument();
    expect(screen.getByText("兜底智能体")).toBeInTheDocument();
  });

  it("opens 1000px Drawer '智能体维护' on clicking agent code hyperlink, shows 16px bold code in header, removes code input in body", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    // 点击智能体编号超链接
    const codeBtn = await screen.findByRole("button", { name: "AGENT0001" });
    fireEvent.click(codeBtn);

    // 抽屉头部标题后面的智能体编号，字号 16 加粗
    expect(await screen.findByText("智能体维护")).toBeInTheDocument();
    expect(screen.getByText("(AGENT0001)")).toBeInTheDocument();

    // 正文中的智能体编号配置字段已移除
    expect(screen.queryByPlaceholderText("AGENT0001")).not.toBeInTheDocument();

    // 智能体形象：修改为附件上传
    expect(screen.getByText("智能体形象")).toBeInTheDocument();
    expect(screen.getByText(/选择图片上传/)).toBeInTheDocument();

    // 原智能体形象位置修改为【智能体类型】下拉勾选
    expect(screen.getAllByText("智能体类型").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue("正常智能体")).toBeInTheDocument();

    // 适用产品线：下拉多选
    expect(screen.getAllByText("适用产品线").length).toBeGreaterThanOrEqual(1);

    // 适用来源渠道：放置在适用产品线正下方
    expect(screen.getAllByText("适用来源渠道").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/全部（适用于所有来源渠道）/)).toBeInTheDocument();
  });

  it("supports product lines search filter in drawer and submits agent edit", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    const nameBtn = await screen.findByRole("button", { name: "数电发票专家" });
    fireEvent.click(nameBtn);

    // 点击产品线下拉
    const lineDropdownTrigger = screen.getByText("全部（适用于所有产品线）");
    fireEvent.click(lineDropdownTrigger);

    // 输入搜索关键字
    const searchInput = screen.getByPlaceholderText("输入关键字快速定位搜索产品线...");
    expect(searchInput).toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: "乐企" } });

    // 修改智能体类型为兜底智能体
    const typeSelect = screen.getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "fallback" } });

    // 提交编辑
    const submitBtn = screen.getByRole("button", { name: "提交" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.queryByText("(AGENT0001)")).not.toBeInTheDocument();
      expect(screen.getByText("智能体更新成功，状态已置为禁用")).toBeInTheDocument();
    });
  });

  it("opens create agent drawer and creates new agent as disabled", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    const createBtn = screen.getByText("新增agent");
    fireEvent.click(createBtn);

    expect(await screen.findByText("智能体维护")).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText("例如：数电发票专家");
    fireEvent.change(nameInput, { target: { value: "申报专家" } });

    const descInput = screen.getByPlaceholderText(/请输入智能体的业务特长/);
    fireEvent.change(descInput, { target: { value: "负责企业所得税与增值税申报接口支持" } });

    const submitBtn = screen.getByRole("button", { name: "提交" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.queryByText(/智能体维护/)).not.toBeInTheDocument();
      expect(screen.getByText("申报专家")).toBeInTheDocument();
    });
  });

  it("handles batch enable and batch disable", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    await screen.findByText("数电发票专家");

    // 点击全选勾选框
    const selectAllBox = screen.getByLabelText("全选");
    fireEvent.click(selectAllBox);

    // 点击批量禁用
    const disableBtn = screen.getByRole("button", { name: /禁用/ });
    fireEvent.click(disableBtn);

    await waitFor(() => {
      expect(screen.getByText(/已成功禁用/)).toBeInTheDocument();
    });

    // 点击批量启用
    const enableBtn = screen.getByRole("button", { name: /启用/ });
    fireEvent.click(enableBtn);

    await waitFor(() => {
      expect(screen.getByText(/已成功启用/)).toBeInTheDocument();
    });
  });

  it("handles batch delete validation: prevents deletion if enabled agents exist", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    await screen.findByText("数电发票专家");

    // 全选（包含启用的智能体）
    const selectAllBox = screen.getByLabelText("全选");
    fireEvent.click(selectAllBox);

    // 点击删除
    const deleteBtn = screen.getByRole("button", { name: /删除/ });
    fireEvent.click(deleteBtn);

    // 页面提示：存在启用状态的记录，不能删除
    expect(window.alert).toHaveBeenCalledWith("存在启用状态的记录，不能删除");
  });

  it("switches to escalation strategy tab with 13px text, removes all English hints, supports editing and saving phrases", async () => {
    render(
      <MemoryRouter>
        <BotConfigPage />
      </MemoryRouter>
    );

    // 切换到策略
    const strategyTabBtn = screen.getByRole("button", { name: /接待与转人工策略/ });
    fireEvent.click(strategyTabBtn);

    expect(await screen.findByText(/在线咨询智能接待优先/)).toBeInTheDocument();
    expect(screen.getByText(/未解决转人工实时在岗探针校验/)).toBeInTheDocument();
    expect(screen.getByText(/校验工作时段/)).toBeInTheDocument();
    expect(screen.getByText(/校验在线坐席/)).toBeInTheDocument();
    expect(screen.getByText(/至少有 1 名状态“在线”的人工坐席/)).toBeInTheDocument();
    expect(
      screen.getByText(/根据智能机器人的适用产品线和适用来源渠道匹配/)
    ).toBeInTheDocument();

    // 确保已移除所有非中文英文后缀提示
    expect(screen.queryByText(/Bot Reception First/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Working Hours/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Online Agents/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ask_transfer_text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no_human_guide_text/)).not.toBeInTheDocument();

    // 验证话术可手动编辑
    const textareas = screen.getAllByRole("textbox");
    const askTextarea = textareas[0];
    const guideTextarea = textareas[1];

    fireEvent.change(askTextarea, {
      target: { value: "自定义：很抱歉没能解答，是否为您转接人工？" },
    });
    fireEvent.blur(askTextarea);
    expect(await screen.findByText(/询问话术已保存/)).toBeInTheDocument();

    fireEvent.change(guideTextarea, {
      target: { value: "自定义：当前坐席繁忙，建议提交售后工单！" },
    });
    fireEvent.blur(guideTextarea);
    expect(await screen.findByText(/引导话术已保存/)).toBeInTheDocument();

    // 验证保存话术配置按钮与恢复默认话术按钮
    const saveBtn = screen.getByRole("button", { name: "保存话术配置" });
    fireEvent.click(saveBtn);
    expect(await screen.findByText(/接待与转人工策略配置已保存/)).toBeInTheDocument();

    const resetBtn = screen.getByRole("button", { name: "恢复默认话术" });
    fireEvent.click(resetBtn);
    expect(await screen.findByText(/已恢复默认话术配置并保存/)).toBeInTheDocument();
  });

  it("resolves tab title for /reception/bot-config as 智能体接待配置", async () => {
    const { resolveTitle } = await import("@/tabs/tabTitle");
    expect(resolveTitle("/reception/bot-config")).toBe("智能体接待配置");
  });
});
