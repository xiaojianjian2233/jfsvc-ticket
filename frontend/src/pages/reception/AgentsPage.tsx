import { useEffect, useMemo, useState } from "react";
import {
  type AgentItem,
  type EligibleUser,
  type ScheduleSettings,
  DEFAULT_SCHEDULE_SETTINGS,
  fetchAgents,
  createAgent,
  updateAgent,
  batchRemoveAgents,
  fetchEligibleUsers,
  fetchScheduleSettings,
  updateScheduleSettings,
} from "./receptionApi";

const STATUS_OPTIONS = ["不限", "在线", "忙碌", "离线"];

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // 坐席基础设置（接待时间）
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [scheduleForm, setScheduleForm] = useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSavedToast, setScheduleSavedToast] = useState(false);

  // 筛选条件
  const [filterName, setFilterName] = useState("");
  const [filterNickname, setFilterNickname] = useState("");
  const [filterStatuses, setFilterStatuses] = useState<string[]>(["不限"]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentItem | null>(null);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([]);
  const [userSearchText, setUserSearchText] = useState("");

  // 表单状态
  const [formUserId, setFormUserId] = useState<number | null>(null);
  const [formNickname, setFormNickname] = useState("");
  const [formMaxConcurrent, setFormMaxConcurrent] = useState<number>(5);
  const [formStatus, setFormStatus] = useState<"online" | "busy" | "offline">("offline");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchAgents({
        name: filterName,
        nickname: filterNickname,
        statuses: filterStatuses,
      });
      setAgents(res.items);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedule = async () => {
    try {
      const s = await fetchScheduleSettings();
      setScheduleSettings(s);
      setScheduleForm(JSON.parse(JSON.stringify(s)));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadData();
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const updated = await updateScheduleSettings(scheduleForm);
      setScheduleSettings(updated);
      setIsEditingSchedule(false);
      setScheduleSavedToast(true);
      setTimeout(() => setScheduleSavedToast(false), 3000);
    } catch {
      alert("保存接待时间设置失败，请重试");
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCancelEditSchedule = () => {
    setScheduleForm(JSON.parse(JSON.stringify(scheduleSettings)));
    setIsEditingSchedule(false);
  };

  const handleStatusToggle = (s: string) => {
    if (s === "不限") {
      setFilterStatuses(["不限"]);
      return;
    }
    const curWithoutAll = filterStatuses.filter((x) => x !== "不限");
    if (curWithoutAll.includes(s)) {
      const remaining = curWithoutAll.filter((x) => x !== s);
      setFilterStatuses(remaining.length === 0 ? ["不限"] : remaining);
    } else {
      setFilterStatuses([...curWithoutAll, s]);
    }
  };

  const handleOpenAdd = async () => {
    setEditingAgent(null);
    setFormUserId(null);
    setFormNickname("");
    setFormMaxConcurrent(5);
    setFormStatus("offline");
    setErrorMsg("");
    setUserSearchText("");
    setDrawerOpen(true);

    try {
      const users = await fetchEligibleUsers();
      setEligibleUsers(users);
      if (users.length > 0) {
        setFormUserId(users[0].id);
      }
    } catch {
      // ignore
    }
  };

  const handleOpenEdit = (agent: AgentItem) => {
    setEditingAgent(agent);
    setFormUserId(agent.user_id);
    setFormNickname(agent.nickname);
    setFormMaxConcurrent(agent.max_concurrent);
    setFormStatus(agent.status);
    setErrorMsg("");
    setDrawerOpen(true);
  };

  const handleBatchRemove = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确定要移除选中的 ${selectedIds.length} 位在线坐席吗？`)) {
      return;
    }
    await batchRemoveAgents(selectedIds);
    await loadData();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNickname.trim()) {
      setErrorMsg("请输入坐席对外昵称");
      return;
    }
    if (formMaxConcurrent <= 0) {
      setErrorMsg("在线接待上限必须大于 0");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    try {
      if (editingAgent) {
        await updateAgent(editingAgent.id, {
          nickname: formNickname.trim(),
          max_concurrent: formMaxConcurrent,
          status: formStatus,
        });
      } else {
        if (!formUserId) {
          setErrorMsg("请选择启用状态的人员");
          setSubmitting(false);
          return;
        }
        await createAgent({
          user_id: formUserId,
          nickname: formNickname.trim(),
          max_concurrent: formMaxConcurrent,
        });
      }
      setDrawerOpen(false);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredEligibleUsers = useMemo(() => {
    if (!userSearchText.trim()) return eligibleUsers;
    const q = userSearchText.trim().toLowerCase();
    return eligibleUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q))
    );
  }, [eligibleUsers, userSearchText]);

  const allSelected = agents.length > 0 && selectedIds.length === agents.length;

  return (
    <div className="w-full pl-2.5 pr-2.5 py-3.5 font-hub space-y-3.5">
      {/* 顶部标题区 */}
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2.5">
            <span>坐席设置</span>
            <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              共 {agents.length} 位坐席
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            维护系统在线接待服务坐席人员、基础接待时段配置及单人最大接待并发会话阈值
          </p>
        </div>
      </div>

      {/* 主体双列布局：第1列坐席基础设置，第2列现在的坐席设置（占满右侧，无多余留白） */}
      <div className="flex flex-col lg:flex-row gap-3.5 w-full items-start">
        {/* =================================================================== */}
        {/* 第 1 列：坐席基础设置 */}
        {/* =================================================================== */}
        <div className="w-full lg:w-[380px] xl:w-[410px] flex-none bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          {/* 卡片头部 */}
          <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-slate-800">坐席基础设置</span>
              {scheduleSavedToast && (
                <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded font-medium animate-pulse">
                  已保存生效
                </span>
              )}
            </div>

            {/* 操作按钮：修改 / 保存 */}
            <div className="flex items-center gap-2">
              {isEditingSchedule ? (
                <>
                  <span className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-medium">
                    未保存
                  </span>
                  <button
                    type="button"
                    onClick={handleCancelEditSchedule}
                    className="px-2.5 py-1 border border-slate-300 text-slate-600 rounded text-xs hover:bg-slate-50 transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    disabled={savingSchedule}
                    className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-medium transition cursor-pointer shadow-2xs disabled:opacity-50"
                  >
                    {savingSchedule ? "保存中..." : "保存"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setScheduleForm(JSON.parse(JSON.stringify(scheduleSettings)));
                    setIsEditingSchedule(true);
                  }}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 rounded text-xs font-medium transition cursor-pointer shadow-2xs"
                >
                  修改
                </button>
              )}
            </div>
          </div>

          {/* 卡片内容区 */}
          <div className="p-4 space-y-4 text-xs">
            {/* 说明 */}
            <div className="text-[12px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded border border-slate-200/70">
              设置系统在线坐席接待时间区间，用于后续判定是否分配人工坐席进线接待。非接待时段客户转人工将进入排队状态等待。
            </div>

            {/* 1. 工作日接待时间 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 text-[13px] flex items-center gap-1.5">
                  <span className="w-1.5 h-3.5 bg-teal-600 rounded-xs" />
                  <span>工作日接待时间</span>
                </span>
                {isEditingSchedule && (
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleForm((prev) => ({
                        ...prev,
                        weekday_slots: [...prev.weekday_slots, { start: "09:00", end: "18:00" }],
                      }));
                    }}
                    className="text-teal-600 hover:text-teal-800 text-[11px] font-medium cursor-pointer"
                  >
                    + 添加时段
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {(isEditingSchedule ? scheduleForm.weekday_slots : scheduleSettings.weekday_slots).map(
                  (slot, idx) => {
                    const label = idx === 0 ? "上午：" : idx === 1 ? "下午：" : `时段${idx + 1}：`;
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 bg-slate-50/90 rounded border border-slate-200 text-slate-700"
                      >
                        <span className="text-[12.5px] font-medium text-slate-600 min-w-[50px]">
                          {label}
                        </span>
                        {isEditingSchedule ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="time"
                              value={slot.start}
                              onChange={(e) => {
                                const copy = [...scheduleForm.weekday_slots];
                                copy[idx].start = e.target.value;
                                setScheduleForm({ ...scheduleForm, weekday_slots: copy });
                              }}
                              className="px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                            />
                            <span className="text-slate-400">~</span>
                            <input
                              type="time"
                              value={slot.end}
                              onChange={(e) => {
                                const copy = [...scheduleForm.weekday_slots];
                                copy[idx].end = e.target.value;
                                setScheduleForm({ ...scheduleForm, weekday_slots: copy });
                              }}
                              className="px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                            />
                            {scheduleForm.weekday_slots.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const copy = scheduleForm.weekday_slots.filter((_, i) => i !== idx);
                                  setScheduleForm({ ...scheduleForm, weekday_slots: copy });
                                }}
                                className="text-rose-500 hover:text-rose-700 px-1 text-sm cursor-pointer"
                                title="删除此段"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-[13px] font-medium text-slate-800">
                            {slot.start} ~ {slot.end}
                          </span>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            {/* 2. 节假日 / 周末接待时间 */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 text-[13px] flex items-center gap-1.5">
                  <span className="w-1.5 h-3.5 bg-blue-600 rounded-xs" />
                  <span>节假日 / 周末接待时间</span>
                </span>
                {isEditingSchedule && (
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleForm((prev) => ({
                        ...prev,
                        weekend_slots: [...prev.weekend_slots, { start: "09:00", end: "18:00" }],
                      }));
                    }}
                    className="text-teal-600 hover:text-teal-800 text-[11px] font-medium cursor-pointer"
                  >
                    + 添加时段
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {(isEditingSchedule ? scheduleForm.weekend_slots : scheduleSettings.weekend_slots).map(
                  (slot, idx) => {
                    const label = idx === 0 ? "上午：" : idx === 1 ? "下午：" : `时段${idx + 1}：`;
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 bg-slate-50/90 rounded border border-slate-200 text-slate-700"
                      >
                        <span className="text-[12.5px] font-medium text-slate-600 min-w-[50px]">
                          {label}
                        </span>
                        {isEditingSchedule ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="time"
                              value={slot.start}
                              onChange={(e) => {
                                const copy = [...scheduleForm.weekend_slots];
                                copy[idx].start = e.target.value;
                                setScheduleForm({ ...scheduleForm, weekend_slots: copy });
                              }}
                              className="px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                            />
                            <span className="text-slate-400">~</span>
                            <input
                              type="time"
                              value={slot.end}
                              onChange={(e) => {
                                const copy = [...scheduleForm.weekend_slots];
                                copy[idx].end = e.target.value;
                                setScheduleForm({ ...scheduleForm, weekend_slots: copy });
                              }}
                              className="px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                            />
                            {scheduleForm.weekend_slots.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const copy = scheduleForm.weekend_slots.filter((_, i) => i !== idx);
                                  setScheduleForm({ ...scheduleForm, weekend_slots: copy });
                                }}
                                className="text-rose-500 hover:text-rose-700 px-1 text-sm cursor-pointer"
                                title="删除此段"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-[13px] font-medium text-slate-800">
                            {slot.start} ~ {slot.end}
                          </span>
                        )}
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* 第 2 列：现在的坐席设置（筛选与列表），自适应占满右侧全部区域 */}
        {/* =================================================================== */}
        <div className="flex-1 w-full min-w-0 flex flex-col gap-3.5">
          {/* 筛选条件录入区（参考全部工单页面字体放大、调整录入框高宽） */}
          <div className="bg-white rounded-lg p-3.5 border border-slate-200 shadow-sm flex flex-wrap items-center gap-3 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-medium whitespace-nowrap text-[13px]">姓名：</span>
              <input
                type="text"
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadData()}
                placeholder="录入用户姓名查找"
                className="w-40 h-[34px] px-3 border border-slate-200 rounded text-[13px] focus:outline-none focus:border-teal-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-medium whitespace-nowrap text-[13px]">昵称：</span>
              <input
                type="text"
                value={filterNickname}
                onChange={(e) => setFilterNickname(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadData()}
                placeholder="录入昵称查找"
                className="w-40 h-[34px] px-3 border border-slate-200 rounded text-[13px] focus:outline-none focus:border-teal-600"
              />
            </div>

            {/* 状态多选下拉 */}
            <div className="relative flex items-center gap-2">
              <span className="text-slate-600 font-medium whitespace-nowrap text-[13px]">状态：</span>
              <button
                type="button"
                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                className="w-44 h-[34px] px-3 border border-slate-200 rounded text-left flex items-center justify-between bg-white text-[13px] hover:border-slate-300"
              >
                <span className="truncate text-slate-700">
                  {filterStatuses.join("、")}
                </span>
                <span className="text-slate-400 text-[10px]">▼</span>
              </button>

              {statusDropdownOpen && (
                <div className="absolute top-full left-12 mt-1 w-44 bg-white border border-slate-200 rounded shadow-lg z-30 p-1.5 space-y-1">
                  {STATUS_OPTIONS.map((opt) => {
                    const checked = filterStatuses.includes(opt);
                    return (
                      <label
                        key={opt}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-slate-700 hover:bg-slate-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleStatusToggle(opt)}
                          className="rounded text-teal-600 focus:ring-0"
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={loadData}
                className="h-[34px] px-4 bg-teal-600 text-white rounded text-[13px] font-medium hover:bg-teal-700 transition cursor-pointer shadow-2xs"
              >
                查询
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterName("");
                  setFilterNickname("");
                  setFilterStatuses(["不限"]);
                }}
                className="h-[34px] px-3.5 border border-slate-200 text-slate-600 rounded text-[13px] hover:bg-slate-50 transition cursor-pointer"
              >
                重置
              </button>
            </div>
          </div>

          {/* 功能按钮操作栏 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-1.5 h-[34px] px-3.5 bg-teal-600 text-white rounded text-[13px] font-medium hover:bg-teal-700 transition shadow-sm cursor-pointer"
              >
                <span className="text-sm font-bold">+</span>
                <span>添加坐席</span>
              </button>
              <button
                type="button"
                onClick={handleBatchRemove}
                disabled={selectedIds.length === 0}
                className={`inline-flex items-center gap-1 h-[34px] px-3.5 rounded text-[13px] font-medium transition cursor-pointer ${
                  selectedIds.length > 0
                    ? "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100"
                    : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                }`}
              >
                <span>移除</span>
                {selectedIds.length > 0 && <span>({selectedIds.length})</span>}
              </button>
            </div>
          </div>

          {/* 坐席表格展示区（字体放大，自适应占满右侧） */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden w-full">
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-[13.5px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold text-[13px]">
                    <th className="w-11 px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(agents.map((a) => a.id));
                          else setSelectedIds([]);
                        }}
                        className="rounded text-teal-600 focus:ring-0"
                      />
                    </th>
                    <th className="px-4 py-3 min-w-[140px]">姓名</th>
                    <th className="px-4 py-3 min-w-[140px]">昵称</th>
                    <th className="px-4 py-3 min-w-[130px] text-center">在线接待上限</th>
                    <th className="px-4 py-3 min-w-[110px] text-center">在线状态</th>
                    <th className="px-4 py-3 min-w-[100px] text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400 text-xs">
                        数据加载中...
                      </td>
                    </tr>
                  ) : agents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-14 text-slate-400 text-xs">
                        暂无坐席记录，点击上方【添加坐席】维护
                      </td>
                    </tr>
                  ) : (
                    agents.map((agent) => {
                      const isChecked = selectedIds.includes(agent.id);
                      return (
                        <tr
                          key={agent.id}
                          className={`hover:bg-slate-50/80 transition ${
                            isChecked ? "bg-teal-50/40" : ""
                          }`}
                        >
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedIds([...selectedIds, agent.id]);
                                else setSelectedIds(selectedIds.filter((id) => id !== agent.id));
                              }}
                              className="rounded text-teal-600 focus:ring-0"
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {agent.user_name}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {agent.nickname}
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-medium text-slate-700">
                            {agent.max_concurrent}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium border ${
                                agent.status === "online"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : agent.status === "busy"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-slate-100 text-slate-500 border-slate-200"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  agent.status === "online"
                                    ? "bg-emerald-500"
                                    : agent.status === "busy"
                                    ? "bg-amber-500"
                                    : "bg-slate-400"
                                }`}
                              />
                              <span>
                                {agent.status === "online"
                                  ? "在线"
                                  : agent.status === "busy"
                                  ? "忙碌"
                                  : "离线"}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(agent)}
                              className="text-teal-600 hover:text-teal-800 font-medium transition cursor-pointer text-[13px]"
                            >
                              编辑
                            </button>
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
      </div>

      {/* 右侧抽屉：维护在线接待坐席 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative w-[480px] bg-white shadow-2xl h-full flex flex-col z-10 animate-in slide-in-from-right duration-200">
            {/* 抽屉标题栏 */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-bold text-slate-800">
                {editingAgent ? "编辑在线接待坐席" : "维护在线接待坐席"}
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* 抽屉正文表单 */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {errorMsg && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded">
                  {errorMsg}
                </div>
              )}

              {/* 姓名字段 */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  姓名 <span className="text-rose-500">*</span>
                </label>
                {editingAgent ? (
                  <input
                    type="text"
                    disabled
                    value={editingAgent.user_name}
                    className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded text-slate-500 cursor-not-allowed"
                  />
                ) : (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={userSearchText}
                      onChange={(e) => setUserSearchText(e.target.value)}
                      placeholder="输入姓名或邮箱快速搜索人员..."
                      className="w-full px-3 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                    />
                    <select
                      value={formUserId || ""}
                      onChange={(e) => setFormUserId(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-600 bg-white"
                    >
                      {filteredEligibleUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.role}) {u.email ? `- ${u.email}` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400">
                      数据来源系统基础配置启用状态人员，编辑模式不可修改
                    </p>
                  </div>
                )}
              </div>

              {/* 昵称字段 */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  昵称 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formNickname}
                  onChange={(e) => setFormNickname(e.target.value)}
                  placeholder="请输入在线接待客户可以看到的称呼"
                  maxLength={64}
                  className="w-full px-3 py-2 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-600"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  客户在会话界面看到的坐席对外名称，如「客服小李」、「资深财税顾问」
                </p>
              </div>

              {/* 在线接待上限 */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  在线接待上限 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={formMaxConcurrent}
                  onChange={(e) => setFormMaxConcurrent(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-600 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  允许同时接入的会话数量，达到上限后系统将不会再自动分配新会话进入接待
                </p>
              </div>

              {/* 在线状态（仅编辑时显示切换） */}
              {editingAgent && (
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    当前在线状态
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-600 bg-white"
                  >
                    <option value="online">在线</option>
                    <option value="busy">忙碌</option>
                    <option value="offline">离线</option>
                  </select>
                </div>
              )}

              {/* 底部操作按钮 */}
              <div className="pt-6 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-teal-600 text-white rounded font-medium hover:bg-teal-700 transition shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {submitting ? "保存中..." : "提交"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
