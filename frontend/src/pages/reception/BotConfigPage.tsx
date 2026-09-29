import { useEffect, useState, useRef } from "react";
import { useTabTitle } from "@/tabs/useTabTitle";
import {
  type BotAgentProfile,
  type BotConfigData,
  type ProductLineOption,
  CHANNEL_OPTIONS,
  DEFAULT_BOT_CONFIG,
  fetchBotConfig,
  fetchProductLineOptions,
  saveBotConfig,
} from "./receptionApi";

export function BotConfigPage() {
  useTabTitle("智能体接待配置");
  const [activeTab, setActiveTab] = useState<"agents" | "strategy">("agents");
  const [config, setConfig] = useState<BotConfigData>(DEFAULT_BOT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // 适用产品线字典列表
  const [productLineOptions, setProductLineOptions] = useState<ProductLineOption[]>([]);

  // 智能体列表表格勾选状态
  const [checkedAgentIds, setCheckedAgentIds] = useState<string[]>([]);

  // 鼠标移入浮窗状态（500px 说明浮窗 / 400px 产品线浮窗 / 渠道浮窗）
  const [tooltip, setTooltip] = useState<{
    type: "desc" | "lines" | "channels";
    title: string;
    content: string;
    x: number;
    y: number;
  } | null>(null);

  // 智能体维护 1000px 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<BotAgentProfile | null>(null);
  const [agentForm, setAgentForm] = useState<BotAgentProfile>({
    id: "",
    code: "AGENT0001",
    name: "",
    avatar: "🤖",
    agent_type: "normal",
    description: "",
    webhook_url: "",
    welcome_message: "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，请问有什么可以帮您？",
    unresolved_prompt: "很抱歉没能解决您的问题，请问需要为您转接人工坐席或提交售后工单跟进吗？",
    system_prompt: "你是一名专业的发票云客服支持专家，请解答用户关于发票云产品的业务与操作问题。",
    skills: [],
    product_lines: ["全部"],
    source_channels: ["全部"],
    support_transfer_human: true,
    transfer_human_rule: "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
    temperature: 0.3,
    is_enabled: false,
    created_at: "",
    created_by: "系统管理员",
  });
  const [skillsInput, setSkillsInput] = useState("");

  // 产品线下拉搜索多选状态
  const [lineDropdownOpen, setLineDropdownOpen] = useState(false);
  const [lineSearchKeyword, setLineSearchKeyword] = useState("");
  const lineDropdownRef = useRef<HTMLDivElement>(null);

  // 渠道下拉多选状态
  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const channelDropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部收起下拉框
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (lineDropdownRef.current && !lineDropdownRef.current.contains(event.target as Node)) {
        setLineDropdownOpen(false);
      }
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(event.target as Node)) {
        setChannelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const [data, lines] = await Promise.all([
        fetchBotConfig(),
        fetchProductLineOptions(),
      ]);
      setConfig(data);
      setProductLineOptions(lines);
    } catch (err) {
      console.error("加载智能接待配置失败:", err);
      showToast("加载配置失败，已展示默认配置", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async (newConfig?: BotConfigData) => {
    const toSave = newConfig || config;
    try {
      const updated = await saveBotConfig(toSave);
      setConfig(updated);
      return updated;
    } catch (err) {
      console.error("保存配置失败:", err);
      showToast("保存配置失败，请重试", "error");
      throw err;
    }
  };

  // --- 智能体列表操作按钮组 ---

  // 1. 新增 Agent 抽屉
  const handleOpenCreateAgent = () => {
    setEditingAgent(null);
    let maxNum = 0;
    config.agents.forEach((a) => {
      if (a.code && a.code.startsWith("AGENT")) {
        const num = parseInt(a.code.slice(5), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    const nextCode = `AGENT${(maxNum + 1).toString().padStart(4, "0")}`;
    const newId = `agent-${Date.now().toString(36)}`;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

    setAgentForm({
      id: newId,
      code: nextCode,
      name: "",
      avatar: "🤖",
      agent_type: "normal",
      description: "",
      webhook_url: "",
      welcome_message: "您好！欢迎使用发票云售后在线支持。系统已为您建立会话，请问有什么可以帮您？",
      unresolved_prompt: "很抱歉没能解决您的问题，请问需要为您转接人工坐席或提交售后工单跟进吗？",
      system_prompt: "你是一名专业的发票云客服支持专家，请解答用户关于发票云产品的业务与操作问题。",
      skills: [],
      product_lines: ["全部"],
      source_channels: ["全部"],
      support_transfer_human: true,
      transfer_human_rule: "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
      temperature: 0.3,
      is_enabled: false, // 新增提交后默认为禁用状态
      created_at: nowStr,
      created_by: "系统管理员",
    });
    setSkillsInput("");
    setLineSearchKeyword("");
    setLineDropdownOpen(false);
    setChannelDropdownOpen(false);
    setDrawerOpen(true);
  };

  // 2. 点击名字/编号超链接打开编辑抽屉
  const handleOpenEditAgent = (agent: BotAgentProfile) => {
    setEditingAgent(agent);
    setAgentForm({
      ...agent,
      agent_type: agent.agent_type || (agent.id === config.default_agent_id ? "fallback" : "normal"),
      product_lines:
        Array.isArray(agent.product_lines) && agent.product_lines.length > 0
          ? [...agent.product_lines]
          : ["全部"],
      source_channels:
        Array.isArray(agent.source_channels) && agent.source_channels.length > 0
          ? [...agent.source_channels]
          : ["全部"],
      support_transfer_human: agent.support_transfer_human ?? true,
      transfer_human_rule:
        agent.transfer_human_rule || "客户回复未解决且在人工工作时间有空闲坐席时触发转人工",
    });
    setSkillsInput((agent.skills || []).join("，"));
    setLineSearchKeyword("");
    setLineDropdownOpen(false);
    setChannelDropdownOpen(false);
    setDrawerOpen(true);
  };

  // 3. 抽屉【提交】按钮
  const handleSubmitAgentDrawer = async () => {
    const trimmedName = agentForm.name.trim();
    if (!trimmedName) {
      alert("请输入智能体名字");
      return;
    }
    if (trimmedName.length > 10) {
      alert("智能体名字不能超过10个字");
      return;
    }
    const trimmedDesc = agentForm.description.trim();
    if (!trimmedDesc) {
      alert("请输入智能体说明");
      return;
    }
    if (trimmedDesc.length > 1000) {
      alert("智能体说明不能超过1000个字");
      return;
    }
    if (!agentForm.welcome_message.trim()) {
      alert("请输入欢迎语");
      return;
    }

    const skillsList = skillsInput
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // 核心约束：新增提交后插入列表且状态为禁用；编辑提交后更新记录且状态为禁用
    const profileToSave: BotAgentProfile = {
      ...agentForm,
      name: trimmedName,
      agent_type: agentForm.agent_type || "normal",
      description: trimmedDesc,
      skills: skillsList,
      product_lines: agentForm.product_lines.length > 0 ? agentForm.product_lines : ["全部"],
      source_channels: agentForm.source_channels && agentForm.source_channels.length > 0 ? agentForm.source_channels : ["全部"],
      is_enabled: false,
    };

    let newAgents: BotAgentProfile[];
    if (editingAgent) {
      newAgents = config.agents.map((a) => (a.id === editingAgent.id ? profileToSave : a));
    } else {
      newAgents = [...config.agents, profileToSave];
    }

    // 若当前新增/修改为兜底智能体，同步将其设为 default_agent_id
    let newDefaultAgentId = config.default_agent_id;
    if (profileToSave.agent_type === "fallback") {
      newDefaultAgentId = profileToSave.id;
    }

    const updatedConfig = { ...config, agents: newAgents, default_agent_id: newDefaultAgentId };
    setConfig(updatedConfig);
    setDrawerOpen(false);
    await handleSave(updatedConfig);
    showToast(editingAgent ? "智能体更新成功，状态已置为禁用" : "新增智能体成功，状态已置为禁用");
  };

  // 4. 【启用】按钮：勾选禁用的智能体，点击启用，更新智能体状态为启用
  const handleBatchEnable = async () => {
    if (checkedAgentIds.length === 0) {
      alert("请先勾选需要启用的智能体");
      return;
    }
    const targetAgents = config.agents.filter(
      (a) => checkedAgentIds.includes(a.id) && !a.is_enabled
    );
    if (targetAgents.length === 0) {
      showToast("所选智能体均已处于启用状态", "info");
      return;
    }
    const updatedAgents = config.agents.map((a) =>
      checkedAgentIds.includes(a.id) ? { ...a, is_enabled: true } : a
    );
    const updatedConfig = { ...config, agents: updatedAgents };
    setConfig(updatedConfig);
    await handleSave(updatedConfig);
    showToast(`已成功启用 ${targetAgents.length} 个智能体`);
  };

  // 5. 【禁用】按钮：勾选启用状态的智能体，点击禁用，更新智能体状态为禁用
  const handleBatchDisable = async () => {
    if (checkedAgentIds.length === 0) {
      alert("请先勾选需要禁用的智能体");
      return;
    }
    const targetAgents = config.agents.filter(
      (a) => checkedAgentIds.includes(a.id) && a.is_enabled
    );
    if (targetAgents.length === 0) {
      showToast("所选智能体均已处于禁用状态", "info");
      return;
    }
    const updatedAgents = config.agents.map((a) =>
      checkedAgentIds.includes(a.id) ? { ...a, is_enabled: false } : a
    );
    const updatedConfig = { ...config, agents: updatedAgents };
    setConfig(updatedConfig);
    await handleSave(updatedConfig);
    showToast(`已成功禁用 ${targetAgents.length} 个智能体`);
  };

  // 6. 【删除】按钮：勾选禁用状态的智能体，点击删除可删除；如果勾选的智能体存在启用状态的，提示：存在启用状态的记录，不能删除
  const handleBatchDelete = async () => {
    if (checkedAgentIds.length === 0) {
      alert("请先勾选需要删除的智能体");
      return;
    }
    const checkedAgents = config.agents.filter((a) => checkedAgentIds.includes(a.id));
    const hasEnabled = checkedAgents.some((a) => a.is_enabled);
    if (hasEnabled) {
      alert("存在启用状态的记录，不能删除");
      return;
    }
    if (!confirm(`确定要删除选中的 ${checkedAgents.length} 个禁用状态智能体吗？`)) {
      return;
    }
    const remainingAgents = config.agents.filter((a) => !checkedAgentIds.includes(a.id));
    const updatedConfig = { ...config, agents: remainingAgents };
    setConfig(updatedConfig);
    setCheckedAgentIds([]);
    await handleSave(updatedConfig);
    showToast(`已成功删除选中的 ${checkedAgents.length} 个智能体`);
  };

  // 7. 【刷新】按钮：刷新列表数据
  const handleRefresh = async () => {
    await loadConfig();
    setCheckedAgentIds([]);
    showToast("列表数据已刷新");
  };

  // 表格全选切换
  const handleToggleSelectAll = () => {
    if (checkedAgentIds.length === config.agents.length && config.agents.length > 0) {
      setCheckedAgentIds([]);
    } else {
      setCheckedAgentIds(config.agents.map((a) => a.id));
    }
  };

  const handleToggleSelectOne = (agentId: string) => {
    setCheckedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  // 抽屉产品线多选切换
  const handleToggleProductLine = (lineName: string) => {
    let current = [...agentForm.product_lines];
    if (lineName === "全部") {
      setAgentForm({ ...agentForm, product_lines: ["全部"] });
      return;
    }
    current = current.filter((l) => l !== "全部");
    if (current.includes(lineName)) {
      current = current.filter((l) => l !== lineName);
    } else {
      current.push(lineName);
    }
    if (current.length === 0) {
      current = ["全部"];
    }
    setAgentForm({ ...agentForm, product_lines: current });
  };

  // 抽屉来源渠道多选切换
  const handleToggleChannel = (channelName: string) => {
    let current = [...(agentForm.source_channels || ["全部"])];
    if (channelName === "全部") {
      setAgentForm({ ...agentForm, source_channels: ["全部"] });
      return;
    }
    current = current.filter((c) => c !== "全部");
    if (current.includes(channelName)) {
      current = current.filter((c) => c !== channelName);
    } else {
      current.push(channelName);
    }
    if (current.length === 0) {
      current = ["全部"];
    }
    setAgentForm({ ...agentForm, source_channels: current });
  };

  // 过滤后的产品线选项
  const filteredProductLines = productLineOptions.filter((opt) =>
    opt.name.toLowerCase().includes(lineSearchKeyword.trim().toLowerCase())
  );

  return (
    <div className="relative pb-10 space-y-4">
      {/* Toast 提示 */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium transition-all ${
            toast.type === "success"
              ? "bg-emerald-600 text-white shadow-emerald-200"
              : toast.type === "error"
              ? "bg-rose-600 text-white shadow-rose-200"
              : "bg-blue-600 text-white shadow-blue-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* 1、标题”智能接待配置“：字体修改为16号，居于右侧展示页面左上角，标题矩形宽度铺满展示区，居于顶部不移动，标题下的说明文字字体12号 */}
      {/* 2、重新载入、保存全部配置 按钮隐藏 */}
      <div className="-mt-6 -mx-6 px-6 py-3.5 sticky top-[-24px] z-30 bg-white border-b border-slate-200 shadow-2xs w-[calc(100%+48px)]">
        <div className="flex flex-col items-start justify-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <h1 className="text-[16px] font-bold text-slate-800 tracking-tight">智能体接待配置</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[rgb(35,94,212)] border border-blue-200/60">
              Agent 接入与自动作答
            </span>
          </div>
          <p className="text-[12px] text-slate-500 mt-1 leading-normal">
            配置在线咨询优先接入的 AI Agent 智能体列表、适用产品线/渠道消息分流以及未解决转人工坐席/提工单引导策略。
          </p>
        </div>
      </div>

      {/* 1、Tab 切换：智能体管理、接待转人工策略 字体调整为14号，增加白底矩形底框，宽度和列表宽度一致 */}
      <div className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-6 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab("agents")}
          className={`flex items-center gap-2 text-[14px] font-semibold transition cursor-pointer pb-0.5 border-b-2 ${
            activeTab === "agents"
              ? "border-[rgb(35,94,212)] text-[rgb(35,94,212)] font-bold"
              : "border-transparent text-slate-600 hover:text-slate-800"
          }`}
        >
          <span>🤖 智能体管理</span>
          <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-100 text-slate-600 font-mono">
            {config.agents.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("strategy")}
          className={`flex items-center gap-2 text-[14px] font-semibold transition cursor-pointer pb-0.5 border-b-2 ${
            activeTab === "strategy"
              ? "border-[rgb(35,94,212)] text-[rgb(35,94,212)] font-bold"
              : "border-transparent text-slate-600 hover:text-slate-800"
          }`}
        >
          <span>⚙️ 接待与转人工策略</span>
        </button>
      </div>

      {/* ---------------- Tab 1: 智能体列表 ---------------- */}
      {activeTab === "agents" && (
        <div className="space-y-3">
          {/* 操作按钮栏：按照按钮上的字体调整按钮的宽度，字体居中左右边距2px，按钮的颜色统一，不要花花绿绿 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenCreateAgent}
              className="h-[25px] rounded-[5px] text-[12px] font-medium flex items-center justify-center gap-1 transition cursor-pointer select-none bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs px-2"
            >
              <span>+</span>
              <span>新增agent</span>
            </button>

            <button
              type="button"
              onClick={handleBatchEnable}
              className="h-[25px] rounded-[5px] text-[12px] font-medium flex items-center justify-center gap-1 transition cursor-pointer select-none bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs px-2"
            >
              <span>✓</span>
              <span>启用</span>
            </button>

            <button
              type="button"
              onClick={handleBatchDisable}
              className="h-[25px] rounded-[5px] text-[12px] font-medium flex items-center justify-center gap-1 transition cursor-pointer select-none bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs px-2"
            >
              <span>⏸</span>
              <span>禁用</span>
            </button>

            <button
              type="button"
              onClick={handleBatchDelete}
              className="h-[25px] rounded-[5px] text-[12px] font-medium flex items-center justify-center gap-1 transition cursor-pointer select-none bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs px-2"
            >
              <span>✕</span>
              <span>删除</span>
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              className="h-[25px] rounded-[5px] text-[12px] font-medium flex items-center justify-center gap-1 transition cursor-pointer select-none bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-2xs px-2"
            >
              <span>🔄</span>
              <span>刷新</span>
            </button>
          </div>

          {/* 智能体列表表格：
              表头固定，字体13号加粗；内容字体13号；
              固定列（Sticky）：勾选框、智能体编号、智能体名字 3列为固定列，居于顶层(z-20)；
              智能体编号也换成超链接，颜色和智能体名字一致 */}
          <div className="relative border border-slate-200 rounded-xl bg-white shadow-2xs overflow-hidden">
            <div className="overflow-x-auto scroll-smooth max-h-[calc(100vh-270px)]">
              <table className="w-full text-left border-collapse min-w-[1350px]">
                {/* 固定表头，字体 13 号加粗 */}
                <thead className="sticky top-0 z-30 bg-slate-50 border-b border-slate-200 text-[13px] font-bold text-slate-700 select-none">
                  <tr>
                    {/* 固定列 1: 勾选框 */}
                    <th className="sticky left-0 z-30 bg-slate-50 w-[48px] min-w-[48px] max-w-[48px] px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        aria-label="全选"
                        checked={
                          config.agents.length > 0 &&
                          checkedAgentIds.length === config.agents.length
                        }
                        onChange={handleToggleSelectAll}
                        className="rounded border-slate-300 text-[rgb(35,94,212)] focus:ring-0 cursor-pointer"
                      />
                    </th>

                    {/* 固定列 2: 智能体编号 */}
                    <th className="sticky left-[48px] z-30 bg-slate-50 w-[130px] min-w-[130px] max-w-[130px] px-3 py-3">
                      智能体编号
                    </th>

                    {/* 固定列 3: 智能体名字 */}
                    <th className="sticky left-[178px] z-30 bg-slate-50 w-[180px] min-w-[180px] max-w-[180px] px-3 py-3 border-r border-slate-200 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.06)]">
                      智能体名字
                    </th>

                    {/* 右侧滚动列: 智能体类型 */}
                    <th className="w-[110px] min-w-[110px] px-3 py-3 text-center">
                      智能体类型
                    </th>

                    {/* 右侧滚动列: 智能体说明 */}
                    <th className="w-[260px] min-w-[260px] px-3 py-3">
                      智能体说明
                    </th>

                    {/* 右侧滚动列: 适用产品线 */}
                    <th className="w-[220px] min-w-[220px] px-3 py-3">
                      适用产品线
                    </th>

                    {/* 右侧滚动列: 适用来源渠道 */}
                    <th className="w-[180px] min-w-[180px] px-3 py-3">
                      适用来源渠道
                    </th>

                    {/* 右侧滚动列: 智能体状态 */}
                    <th className="w-[100px] min-w-[100px] px-3 py-3 text-center">
                      智能体状态
                    </th>

                    {/* 右侧滚动列: 创建时间 */}
                    <th className="w-[160px] min-w-[160px] px-3 py-3">
                      创建时间
                    </th>

                    {/* 右侧滚动列: 创建人 */}
                    <th className="w-[110px] min-w-[110px] px-3 py-3">
                      创建人
                    </th>
                  </tr>
                </thead>

                {/* 内容，字体 13 号 */}
                <tbody className="divide-y divide-slate-100 text-[13px] text-slate-600">
                  {config.agents.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center py-12 text-slate-400">
                        {loading ? "正在加载智能体列表..." : "暂无智能体记录，请点击上方【新增agent】添加"}
                      </td>
                    </tr>
                  ) : (
                    config.agents.map((agent) => {
                      const isChecked = checkedAgentIds.includes(agent.id);
                      const isFallback =
                        agent.agent_type === "fallback" || config.default_agent_id === agent.id;

                      // 智能体说明：单行最多50字，超长省略号
                      const descText = agent.description || "暂无说明";
                      const descDisplay =
                        descText.length > 50 ? `${descText.slice(0, 50)}...` : descText;

                      // 适用产品线：顿号隔开，单行最多50字符，超长显示 +剩余数
                      const linesList =
                        Array.isArray(agent.product_lines) && agent.product_lines.length > 0
                          ? agent.product_lines
                          : ["全部"];
                      const fullLinesStr = linesList.join("、");
                      let linesDisplay = fullLinesStr;
                      if (fullLinesStr.length > 50) {
                        const visibleSlice = fullLinesStr.slice(0, 50);
                        const remainingCount = linesList.length - 1;
                        linesDisplay = `${visibleSlice}... (+剩余${remainingCount > 0 ? remainingCount : 1}个)`;
                      }

                      // 适用来源渠道：顿号隔开
                      const channelList =
                        Array.isArray(agent.source_channels) && agent.source_channels.length > 0
                          ? agent.source_channels
                          : ["全部"];
                      const fullChannelsStr = channelList.join("、");

                      return (
                        <tr
                          key={agent.id}
                          className={`group transition hover:bg-blue-50/20 ${
                            isChecked ? "bg-blue-50/30" : "bg-white"
                          }`}
                        >
                          {/* 固定列 1: 勾选框 */}
                          <td className="sticky left-0 z-20 bg-white group-hover:bg-[#f6f9fe] w-[48px] min-w-[48px] max-w-[48px] px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSelectOne(agent.id)}
                              className="rounded border-slate-300 text-[rgb(35,94,212)] focus:ring-0 cursor-pointer"
                            />
                          </td>

                          {/* 固定列 2: 智能体编号（超链接，颜色和智能体名字一致，点击打开抽屉） */}
                          <td className="sticky left-[48px] z-20 bg-white group-hover:bg-[#f6f9fe] w-[130px] min-w-[130px] max-w-[130px] px-3 py-3 font-mono">
                            <button
                              type="button"
                              onClick={() => handleOpenEditAgent(agent)}
                              className="text-[rgb(35,94,212)] hover:text-blue-800 hover:underline font-medium text-left cursor-pointer"
                              title="点击打开智能体维护"
                            >
                              {agent.code || "AGENT0001"}
                            </button>
                          </td>

                          {/* 固定列 3: 智能体名字（超链接，点击打开智能体维护抽屉，单行不换行） */}
                          <td className="sticky left-[178px] z-20 bg-white group-hover:bg-[#f6f9fe] w-[180px] min-w-[180px] max-w-[180px] px-3 py-3 border-r border-slate-200 shadow-[3px_0_5px_-2px_rgba(0,0,0,0.06)]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="flex-none text-base">
                                {agent.avatar && (agent.avatar.startsWith("data:image") || agent.avatar.startsWith("http")) ? (
                                  <img
                                    src={agent.avatar}
                                    alt="avatar"
                                    className="w-5 h-5 rounded-full object-cover inline-block"
                                  />
                                ) : (
                                  agent.avatar || "🤖"
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenEditAgent(agent)}
                                className="text-[rgb(35,94,212)] hover:text-blue-800 hover:underline font-medium truncate text-left cursor-pointer"
                                title="点击打开智能体维护"
                              >
                                {agent.name}
                              </button>
                            </div>
                          </td>

                          {/* 智能体类型：兜底智能体 / 正常智能体 */}
                          <td className="w-[110px] min-w-[110px] px-3 py-3 text-center">
                            {isFallback ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                兜底智能体
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                正常智能体
                              </span>
                            )}
                          </td>

                          {/* 智能体说明：鼠标移入弹出 500px 顶层自适应浮窗 */}
                          <td
                            className="w-[260px] min-w-[260px] px-3 py-3 text-slate-600 cursor-help"
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setTooltip({
                                type: "desc",
                                title: `智能体说明（${agent.name}）`,
                                content: descText,
                                x: Math.min(rect.left, window.innerWidth - 520),
                                y: rect.bottom + 6,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <div className="truncate max-w-[250px]" title={descText}>
                              {descDisplay}
                            </div>
                          </td>

                          {/* 适用产品线：鼠标移入弹出 400px 顶层浮窗 */}
                          <td
                            className="w-[220px] min-w-[220px] px-3 py-3 text-slate-600 cursor-help"
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setTooltip({
                                type: "lines",
                                title: `适用产品线列表（共 ${linesList.length} 项）`,
                                content: fullLinesStr,
                                x: Math.min(rect.left, window.innerWidth - 420),
                                y: rect.bottom + 6,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <div className="truncate max-w-[210px]" title={fullLinesStr}>
                              {linesDisplay}
                            </div>
                          </td>

                          {/* 适用来源渠道：鼠标移入浮窗 */}
                          <td
                            className="w-[180px] min-w-[180px] px-3 py-3 text-slate-600 cursor-help"
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setTooltip({
                                type: "channels",
                                title: `适用来源渠道（${agent.name}）`,
                                content: fullChannelsStr,
                                x: Math.min(rect.left, window.innerWidth - 320),
                                y: rect.bottom + 6,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <div className="truncate max-w-[170px]" title={fullChannelsStr}>
                              {fullChannelsStr}
                            </div>
                          </td>

                          {/* 智能体状态：启用/禁用标签 */}
                          <td className="w-[100px] min-w-[100px] px-3 py-3 text-center">
                            {agent.is_enabled ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                启用
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                禁用
                              </span>
                            )}
                          </td>

                          {/* 创建时间 */}
                          <td className="w-[160px] min-w-[160px] px-3 py-3 font-mono text-[12px] text-slate-500">
                            {agent.created_at || "—"}
                          </td>

                          {/* 创建人 */}
                          <td className="w-[110px] min-w-[110px] px-3 py-3 text-slate-600 truncate">
                            {agent.created_by || "系统管理员"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Tab 2: 接待与转人工策略 ---------------- */}
      {/* 优化【接待与转人工策略】：正文所有字体修改为13号，内容间隔调大（解决过于紧密的问题） */}
      {activeTab === "strategy" && (
        <div className="space-y-6 text-[13px]">
          {/* 卡片 1: 在线咨询智能接待优先 */}
          <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="space-y-1">
                <h3 className="font-bold text-slate-800 text-[15px] flex items-center gap-2">
                  <span>🤖</span>
                  <span>在线咨询智能接待优先</span>
                </h3>
                <p className="text-[13px] text-slate-500">
                  开启后，客户发起在线咨询时，系统优先根据客户渠道和产品线匹配智能体自动接待；关闭后，咨询直通人工待接入队列。
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.escalation_strategy?.enable_agent_reception ?? true}
                  onChange={(e) => {
                    const updated = {
                      ...config,
                      escalation_strategy: {
                        ...config.escalation_strategy,
                        enable_agent_reception: e.target.checked,
                      },
                    };
                    setConfig(updated);
                    handleSave(updated);
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[rgb(35,94,212)]"></div>
              </label>
            </div>

            <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100/80 text-[13px] text-slate-700 leading-relaxed">
              💡 <span className="font-semibold">自动分流规则：</span>根据智能机器人的适用产品线和适用来源渠道匹配。来访客户能明确渠道和产品线时调用匹配智能体，不知道或无适配则匹配兜底智能体。
            </div>
          </div>

          {/* 卡片 2: 转人工在岗探针校验 */}
          <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-2xs space-y-6">
            <div className="pb-3 border-b border-slate-100 space-y-1">
              <h3 className="font-bold text-slate-800 text-[15px] flex items-center gap-2">
                <span>⏱️</span>
                <span>未解决转人工实时在岗探针校验</span>
              </h3>
              <p className="text-[13px] text-slate-500">
                客户点击【未解决】时，系统实时探针判断人工客服是否在岗。仅当满足条件时才询问转接人工，避免客户转入无人应答队列。
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 bg-slate-50 rounded-lg space-y-2 flex items-start justify-between">
                <div>
                  <h4 className="text-[13px] font-bold text-slate-800">校验工作时段</h4>
                  <p className="text-[12px] text-slate-500 mt-1">
                    仅在工作日与周末设定的服务时间段内允许转接人工。
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.escalation_strategy?.probe_working_hours ?? true}
                    onChange={(e) => {
                      const updated = {
                        ...config,
                        escalation_strategy: {
                          ...config.escalation_strategy,
                          probe_working_hours: e.target.checked,
                        },
                      };
                      setConfig(updated);
                      handleSave(updated);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[rgb(35,94,212)]"></div>
                </label>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg space-y-2 flex items-start justify-between">
                <div>
                  <h4 className="text-[13px] font-bold text-slate-800">校验在线坐席</h4>
                  <p className="text-[12px] text-slate-500 mt-1">
                    校验规则：至少有 1 名状态“在线”的人工坐席。
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.escalation_strategy?.probe_human_agents ?? true}
                    onChange={(e) => {
                      const updated = {
                        ...config,
                        escalation_strategy: {
                          ...config.escalation_strategy,
                          probe_human_agents: e.target.checked,
                        },
                      };
                      setConfig(updated);
                      handleSave(updated);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[rgb(35,94,212)]"></div>
                </label>
              </div>
            </div>

            <div className="space-y-5 pt-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[13px] font-bold text-slate-700">
                    1. 满足在岗条件时的询问话术
                  </label>
                  <span className="text-[12px] text-slate-400">（支持自定义编辑，失焦自动保存）</span>
                </div>
                <textarea
                  rows={2}
                  value={config.escalation_strategy?.ask_transfer_text ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      escalation_strategy: {
                        ...config.escalation_strategy,
                        ask_transfer_text: e.target.value,
                      },
                    })
                  }
                  onBlur={() => {
                    handleSave(config);
                    showToast("询问话术已保存", "success");
                  }}
                  className="w-full text-[13px] p-3 rounded-lg border border-slate-200 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                  placeholder="例如：很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[13px] font-bold text-slate-700">
                    2. 非工作时间或无空闲坐席时的引导话术
                  </label>
                  <span className="text-[12px] text-slate-400">（支持自定义编辑，失焦自动保存）</span>
                </div>
                <textarea
                  rows={2}
                  value={config.escalation_strategy?.no_human_guide_text ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      escalation_strategy: {
                        ...config.escalation_strategy,
                        no_human_guide_text: e.target.value,
                      },
                    })
                  }
                  onBlur={() => {
                    handleSave(config);
                    showToast("引导话术已保存", "success");
                  }}
                  className="w-full text-[13px] p-3 rounded-lg border border-slate-200 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                  placeholder="例如：当前人工坐席均在忙碌中或已下班，建议您直接提交售后工单，我们将由技术专家加急排查并在第一时间答复您！"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200/80">
                <div>
                  <h4 className="text-[13px] font-bold text-slate-800">呈现一键提交售后工单按钮</h4>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    在无在线坐席时，卡片内提供【一键提交售后工单】快捷操作按钮。
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.escalation_strategy?.show_ticket_button ?? true}
                    onChange={(e) => {
                      const updated = {
                        ...config,
                        escalation_strategy: {
                          ...config.escalation_strategy,
                          show_ticket_button: e.target.checked,
                        },
                      };
                      setConfig(updated);
                      handleSave(updated);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[rgb(35,94,212)]"></div>
                </label>
              </div>

              {/* 话术专属操作栏：保存与恢复默认 */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    const updated = {
                      ...config,
                      escalation_strategy: {
                        ...config.escalation_strategy,
                        ask_transfer_text: "很抱歉没能解决您的问题。当前有在线专业人工客服，是否为您转接人工坐席？",
                        no_human_guide_text: "当前人工坐席均在忙碌中或已下班，建议您直接提交售后工单，我们将由技术专家加急排查并在第一时间答复您！",
                      },
                    };
                    setConfig(updated);
                    handleSave(updated);
                    showToast("已恢复默认话术配置并保存！", "info");
                  }}
                  className="px-4 py-1.5 rounded-[5px] text-[13px] font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition cursor-pointer"
                >
                  恢复默认话术
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSave(config);
                    showToast("接待与转人工策略配置已保存！", "success");
                  }}
                  className="px-5 py-1.5 rounded-[5px] text-[13px] font-medium bg-[rgb(35,94,212)] text-white hover:bg-blue-700 shadow-2xs transition cursor-pointer"
                >
                  保存话术配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 2、智能体维护抽屉 Drawer（右侧展开，宽 1000px） ---------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* 遮罩背景 */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />

          {/* 抽屉容器：右侧展开，宽 1000px */}
          <div className="fixed inset-y-0 right-0 w-[1000px] max-w-[95vw] bg-white shadow-2xl flex flex-col border-l border-slate-200 transition-transform duration-300">
            {/* 抽屉头部：标题后面的智能体编号，字号修改为16，颜色和标题颜色一致，加粗 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
              <div className="flex items-center gap-2">
                <span className="text-xl">🤖</span>
                <h2 className="text-[16px] font-bold text-slate-800">
                  智能体维护 <span className="font-mono">({agentForm.code})</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                title="关闭抽屉"
              >
                ✕
              </button>
            </div>

            {/* 抽屉正文：维护字段（所有字段均可编辑修改） */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-[13px]">
              {/* 字段 1: 智能体名字（≤10字） */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 flex items-center gap-1">
                    <span>智能体名字</span>
                    <span className="text-rose-500">*</span>
                    <span className="text-xs text-slate-400 font-normal">（最多 10 个字）</span>
                  </label>
                  <span
                    className={`text-xs ${
                      agentForm.name.length > 10 ? "text-rose-500 font-bold" : "text-slate-400"
                    }`}
                  >
                    {agentForm.name.length}/10
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={10}
                  value={agentForm.name}
                  onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                  placeholder="例如：数电发票专家"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] text-slate-800 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                />
              </div>

              {/* 字段 2 & 3:
                  2) 智能体形象：修改为附件上传，向前移动和现在智能体编号的位置一致；
                  3) 现在的智能体形象配置字段修改为【智能体类型】，下拉勾选，配置值：兜底智能体，正常智能体 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 智能体形象：附件上传 */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 flex items-center gap-1">
                    <span>智能体形象</span>
                    <span className="text-xs text-slate-400 font-normal">（支持图片附件上传）</span>
                  </label>
                  <div className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                      {agentForm.avatar &&
                      (agentForm.avatar.startsWith("data:image") || agentForm.avatar.startsWith("http")) ? (
                        <img
                          src={agentForm.avatar}
                          alt="avatar"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl">{agentForm.avatar || "🤖"}</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <label className="h-[28px] px-3 rounded-[5px] text-[12px] font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-1 cursor-pointer transition shadow-2xs">
                          <span>📎 选择图片上传</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.size > 2 * 1024 * 1024) {
                                  alert("图片附件大小不能超过 2MB");
                                  return;
                                }
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  const res = ev.target?.result as string;
                                  if (res) {
                                    setAgentForm({ ...agentForm, avatar: res });
                                  }
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setAgentForm({ ...agentForm, avatar: "🤖" })}
                          className="h-[28px] px-2.5 rounded-[5px] text-[12px] text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition"
                        >
                          重置默认
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">支持常见图片格式附件，最大 2MB</p>
                    </div>
                  </div>
                </div>

                {/* 智能体类型：下拉勾选（正常智能体 / 兜底智能体） */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 flex items-center gap-1">
                    <span>智能体类型</span>
                    <span className="text-rose-500">*</span>
                    <span className="text-xs text-slate-400 font-normal">（下拉勾选）</span>
                  </label>
                  <select
                    value={agentForm.agent_type || "normal"}
                    onChange={(e) =>
                      setAgentForm({
                        ...agentForm,
                        agent_type: e.target.value as "normal" | "fallback",
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] text-slate-800 bg-white focus:border-[rgb(35,94,212)] focus:outline-hidden"
                  >
                    <option value="normal">正常智能体</option>
                    <option value="fallback">兜底智能体</option>
                  </select>
                  <p className="text-[12px] text-slate-500 leading-normal mt-1">
                    如果是兜底智能体，按照适用产品线进行消息分流后没有定位到适配的智能机器人，就用兜底机器人接待。
                  </p>
                </div>
              </div>

              {/* 字段 4: 智能体说明（≤1000字） */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 flex items-center gap-1">
                    <span>智能体说明</span>
                    <span className="text-rose-500">*</span>
                    <span className="text-xs text-slate-400 font-normal">（最多 1000 个字）</span>
                  </label>
                  <span
                    className={`text-xs ${
                      agentForm.description.length > 1000
                        ? "text-rose-500 font-bold"
                        : "text-slate-400"
                    }`}
                  >
                    {agentForm.description.length}/1000
                  </span>
                </div>
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={agentForm.description}
                  onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })}
                  placeholder="请输入智能体的业务特长、定位、常见答疑场景以及擅长解决的问题说明..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] text-slate-800 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                />
              </div>

              {/* 字段 5: 消息推送地址 */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 flex items-center gap-1">
                  <span>消息推送地址</span>
                  <span className="text-xs text-slate-400 font-normal">（第三方大模型接收消息接口）</span>
                </label>
                <input
                  type="text"
                  value={agentForm.webhook_url || ""}
                  onChange={(e) => setAgentForm({ ...agentForm, webhook_url: e.target.value })}
                  placeholder="例如：https://api.example.com/v1/agent/chat-stream"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-[13px] text-slate-800 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                />
                <p className="text-[11.5px] text-slate-500 leading-normal">
                  配置后，智能体收到客户消息将实时向该接口推送，收到大模型回复后自动回复展示在会话窗口中；支持第三方异步回调推送。
                </p>
              </div>

              {/* 字段 6: 欢迎语 */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 flex items-center gap-1">
                  <span>欢迎语</span>
                  <span className="text-rose-500">*</span>
                  <span className="text-xs text-slate-400 font-normal">（客户接入后由该智能体发送的首条欢迎引导话术）</span>
                </label>
                <textarea
                  rows={3}
                  value={agentForm.welcome_message}
                  onChange={(e) => setAgentForm({ ...agentForm, welcome_message: e.target.value })}
                  placeholder="例如：您好！欢迎使用发票云售后在线支持。系统已为您建立会话，请问有什么可以帮您？"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] text-slate-800 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                />
              </div>

              {/* 字段 7: 适用产品线（换成下拉勾选框，带输入关键字快速定位搜索的下拉多选，不平铺全部选项） */}
              <div className="space-y-1.5 relative" ref={lineDropdownRef}>
                <label className="font-semibold text-slate-700 flex items-center gap-1">
                  <span>适用产品线</span>
                  <span className="text-rose-500">*</span>
                  <span className="text-xs text-slate-400 font-normal">（下拉多选勾选，支持关键字搜索定位，默认“全部”）</span>
                </label>

                {/* 触发下拉的选择框 */}
                <div
                  onClick={() => setLineDropdownOpen((prev) => !prev)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] bg-white cursor-pointer flex items-center justify-between hover:border-slate-400"
                >
                  <div className="truncate text-slate-800">
                    {agentForm.product_lines.includes("全部")
                      ? "全部（适用于所有产品线）"
                      : agentForm.product_lines.join("、")}
                  </div>
                  <div className="flex items-center gap-2 text-slate-400 shrink-0">
                    <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                      {agentForm.product_lines.includes("全部") ? "全部" : `${agentForm.product_lines.length} 项`}
                    </span>
                    <span className="text-xs">{lineDropdownOpen ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* 下拉展开面板（含关键字搜索框与选项列表） */}
                {lineDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 z-40 mt-1 bg-white border border-slate-300 rounded-lg shadow-xl p-3 space-y-2.5 max-h-[300px] flex flex-col">
                    {/* 输入关键字快速定位搜索 */}
                    <div className="relative shrink-0">
                      <input
                        type="text"
                        value={lineSearchKeyword}
                        onChange={(e) => setLineSearchKeyword(e.target.value)}
                        placeholder="输入关键字快速定位搜索产品线..."
                        className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-md text-[12.5px] focus:border-[rgb(35,94,212)] focus:outline-hidden"
                      />
                      <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
                    </div>

                    {/* 可勾选的产品线列表 */}
                    <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                      {/* 全部 选项 */}
                      <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agentForm.product_lines.includes("全部")}
                          onChange={() => handleToggleProductLine("全部")}
                          className="rounded border-slate-300 text-[rgb(35,94,212)] focus:ring-0 cursor-pointer"
                        />
                        <span className="font-semibold text-slate-800">全部 (所有产品线)</span>
                      </label>

                      {/* 过滤后的具体产品线 */}
                      {filteredProductLines.length === 0 ? (
                        <div className="text-center py-4 text-xs text-slate-400">
                          未匹配到相关产品线
                        </div>
                      ) : (
                        filteredProductLines.map((opt) => {
                          const isSelected =
                            !agentForm.product_lines.includes("全部") &&
                            agentForm.product_lines.includes(opt.name);
                          return (
                            <label
                              key={opt.code}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleProductLine(opt.name)}
                                className="rounded border-slate-300 text-[rgb(35,94,212)] focus:ring-0 cursor-pointer"
                              />
                              <span>{opt.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500 shrink-0">
                      <span>已选: {agentForm.product_lines.join("、")}</span>
                      <button
                        type="button"
                        onClick={() => setLineDropdownOpen(false)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs transition"
                      >
                        完成
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 字段 8: 增加【适用来源渠道】（放置在适用产品线下方，默认全部，选项值：全部、星瀚侧边栏、星空侧边栏、标准侧边栏） */}
              <div className="space-y-1.5 relative" ref={channelDropdownRef}>
                <label className="font-semibold text-slate-700 flex items-center gap-1">
                  <span>适用来源渠道</span>
                  <span className="text-rose-500">*</span>
                  <span className="text-xs text-slate-400 font-normal">（默认全部，选项值：全部、星瀚侧边栏、星空侧边栏、标准侧边栏）</span>
                </label>

                {/* 触发下拉的选择框 */}
                <div
                  onClick={() => setChannelDropdownOpen((prev) => !prev)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] bg-white cursor-pointer flex items-center justify-between hover:border-slate-400"
                >
                  <div className="truncate text-slate-800">
                    {(agentForm.source_channels || ["全部"]).includes("全部")
                      ? "全部（适用于所有来源渠道）"
                      : (agentForm.source_channels || []).join("、")}
                  </div>
                  <div className="flex items-center gap-2 text-slate-400 shrink-0">
                    <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                      {(agentForm.source_channels || ["全部"]).includes("全部")
                        ? "全部"
                        : `${agentForm.source_channels?.length} 个渠道`}
                    </span>
                    <span className="text-xs">{channelDropdownOpen ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* 渠道下拉展开列表 */}
                {channelDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 z-40 mt-1 bg-white border border-slate-300 rounded-lg shadow-xl p-3 space-y-2">
                    <div className="space-y-1">
                      {CHANNEL_OPTIONS.map((channel) => {
                        const isSelected =
                          channel === "全部"
                            ? (agentForm.source_channels || ["全部"]).includes("全部")
                            : !(agentForm.source_channels || ["全部"]).includes("全部") &&
                              (agentForm.source_channels || []).includes(channel);

                        return (
                          <label
                            key={channel}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleChannel(channel)}
                              className="rounded border-slate-300 text-[rgb(35,94,212)] focus:ring-0 cursor-pointer"
                            />
                            <span className={channel === "全部" ? "font-semibold text-slate-800" : ""}>
                              {channel}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
                      <span>已选: {(agentForm.source_channels || ["全部"]).join("、")}</span>
                      <button
                        type="button"
                        onClick={() => setChannelDropdownOpen(false)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs transition"
                      >
                        完成
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 字段 9: 是否支持转人工（开关/单选）及转人工规则 */}
              <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-slate-800 text-[13px]">是否支持转人工</h4>
                    <p className="text-[11.5px] text-slate-500 mt-0.5">
                      开启后，当该智能体未能解决问题或客户主动申请时，可引导转接在线人工坐席。
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="support_human"
                        checked={agentForm.support_transfer_human === true}
                        onChange={() =>
                          setAgentForm({ ...agentForm, support_transfer_human: true })
                        }
                      />
                      <span>支持</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="support_human"
                        checked={agentForm.support_transfer_human === false}
                        onChange={() =>
                          setAgentForm({ ...agentForm, support_transfer_human: false })
                        }
                      />
                      <span>不支持</span>
                    </label>
                  </div>
                </div>

                {/* 转人工规则 */}
                {agentForm.support_transfer_human && (
                  <div className="space-y-1 pt-2 border-t border-slate-200">
                    <label className="font-semibold text-slate-700 flex items-center gap-1">
                      <span>转人工规则</span>
                      <span className="text-xs text-slate-400 font-normal">（触发转人工的前置条件与逻辑说明）</span>
                    </label>
                    <textarea
                      rows={2}
                      value={agentForm.transfer_human_rule}
                      onChange={(e) =>
                        setAgentForm({ ...agentForm, transfer_human_rule: e.target.value })
                      }
                      placeholder="例如：客户回复未解决且在人工工作时间有空闲坐席时触发转人工"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-[13px] text-slate-800 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                    />
                  </div>
                )}
              </div>

              {/* 高级参数：系统提示词与技能标签 */}
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">系统提示词</label>
                  <textarea
                    rows={3}
                    value={agentForm.system_prompt}
                    onChange={(e) => setAgentForm({ ...agentForm, system_prompt: e.target.value })}
                    placeholder="设定大模型的角色、回复口吻与知识边界..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs text-slate-700 focus:border-[rgb(35,94,212)] focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">关联知识技能 (逗号分隔)</label>
                  <input
                    type="text"
                    value={skillsInput}
                    onChange={(e) => setSkillsInput(e.target.value)}
                    placeholder="例如：数电发票开具, 红字发票, 抵扣勾选"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:border-[rgb(35,94,212)] focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* 抽屉底部按钮：【取消】、【提交】 */}
            <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3 bg-slate-50/70">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="px-5 py-1.5 border border-slate-300 rounded-[5px] text-[13px] font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmitAgentDrawer}
                className="px-6 py-1.5 bg-[rgb(35,94,212)] text-white rounded-[5px] text-[13px] font-medium hover:bg-blue-700 shadow-2xs transition cursor-pointer"
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 鼠标移入浮窗 */}
      {tooltip && (
        <div
          className="fixed z-50 p-3 bg-slate-900 text-white text-[12px] rounded-lg shadow-xl pointer-events-none transition-opacity duration-150 leading-relaxed max-w-[500px]"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            width:
              tooltip.type === "desc"
                ? "500px"
                : tooltip.type === "lines"
                ? "400px"
                : "300px",
          }}
        >
          <div className="font-bold text-slate-200 mb-1 border-b border-slate-700 pb-1 flex items-center justify-between">
            <span>{tooltip.title}</span>
            <span className="text-[10px] text-slate-400 font-normal">悬停预览</span>
          </div>
          <div className="whitespace-pre-wrap break-words text-slate-300 max-h-[220px] overflow-y-auto">
            {tooltip.content}
          </div>
        </div>
      )}
    </div>
  );
}
