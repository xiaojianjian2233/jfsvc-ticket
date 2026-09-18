import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AgentItem,
  type AssistantSearchItem,
  type MessageItem,
  type ScheduleSettings,
  type SessionItem,
  type WorkbenchQueueData,
  DEFAULT_SCHEDULE_SETTINGS,
  activateSession,
  autoDispatchQueueSessions,
  closeSession,
  fetchAgents,
  fetchScheduleSettings,
  fetchSessionDetail,
  fetchWorkbenchSessions,
  handoverAndOffline,
  inviteSession,
  isWithinReceptionTime,
  searchAssistant,
  sendAgentMessage,
  suspendSession,
  transferTicket,
  updateAgent,
} from "./receptionApi";

type MainTab = "online" | "hotline";
type OnlineSubTab = "in_progress" | "queue" | "pending" | "closed";
type HotlineSubTab = "answered" | "missed";
type AssistantTab = "knowledge" | "ticket" | "order" | "benefit";
type ReceptionStatus = "online" | "busy" | "offline";

export function ReceptionWorkbenchPage() {
  // 顶层与二级切换
  const [mainTab, setMainTab] = useState<MainTab>("online");
  const [onlineSubTab, setOnlineSubTab] = useState<OnlineSubTab>("in_progress");
  const [hotlineSubTab, setHotlineSubTab] = useState<HotlineSubTab>("answered");

  // 当前坐席与接待状态
  const [allAgents, setAllAgents] = useState<AgentItem[]>([]);
  const [currentAgent, setCurrentAgent] = useState<AgentItem | null>(null);
  const [receptionStatus, setReceptionStatus] = useState<ReceptionStatus>("online");
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);

  // 离线确认弹窗
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [transferAgentId, setTransferAgentId] = useState<number | null>(null);
  const [transferSearchText, setTransferSearchText] = useState("");
  const [handoverSubmitting, setHandoverSubmitting] = useState(false);
  const [handoverError, setHandoverError] = useState("");

  // 队列数据与活跃会话
  const [workbenchData, setWorkbenchData] = useState<WorkbenchQueueData | null>(null);
  const [activeSession, setActiveSession] = useState<SessionItem | null>(null);
  const [activeMessages, setActiveMessages] = useState<MessageItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // 输入框与坐席助手
  const [inputMessage, setInputMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("knowledge");
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantResults, setAssistantResults] = useState<AssistantSearchItem[]>([]);
  const [searchingAssistant, setSearchingAssistant] = useState(false);

  // 对话流滚动定位
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  // 初始化加载坐席与时段配置
  const initAgentAndSchedule = async () => {
    try {
      const [agentsRes, scheduleRes] = await Promise.all([
        fetchAgents(),
        fetchScheduleSettings(),
      ]);
      setAllAgents(agentsRes.items);
      setScheduleSettings(scheduleRes);

      // 获取当前用户
      let loggedUser: any = null;
      try {
        loggedUser = JSON.parse(localStorage.getItem("auth_user") || "{}");
      } catch {
        // ignore
      }

      const match =
        agentsRes.items.find(
          (a) =>
            (loggedUser?.id && a.user_id === loggedUser.id) ||
            (loggedUser?.name && a.user_name === loggedUser.name)
        ) || agentsRes.items[0];

      if (match) {
        setCurrentAgent(match);
        // 默认配置了接待上限 > 0 的账号状态是在线
        const initStatus: ReceptionStatus =
          match.status === "offline" && match.max_concurrent > 0 ? "online" : match.status;
        setReceptionStatus(initStatus);
        if (initStatus !== match.status) {
          updateAgent(match.id, { status: initStatus }).catch(() => {});
        }
      }
    } catch {
      // ignore
    }
  };

  const loadWorkbench = async (preserveActiveId?: string) => {
    setLoadingSessions(true);
    try {
      // 先尝试自动轮询分流排队会话
      await autoDispatchQueueSessions().catch(() => {});

      const data = await fetchWorkbenchSessions();
      setWorkbenchData(data);

      // 确定默认选中会话
      let candidateList: SessionItem[] = [];
      if (mainTab === "online") {
        if (onlineSubTab === "in_progress") candidateList = data.sessions.online_in_progress;
        else if (onlineSubTab === "queue") candidateList = data.sessions.online_queue;
        else if (onlineSubTab === "pending") candidateList = data.sessions.online_pending;
        else candidateList = data.sessions.online_closed;
      } else {
        if (hotlineSubTab === "answered") candidateList = data.sessions.hotline_answered;
        else candidateList = data.sessions.hotline_missed;
      }

      if (preserveActiveId) {
        const found =
          data.sessions.online_in_progress.find((x) => x.id === preserveActiveId) ||
          data.sessions.online_queue.find((x) => x.id === preserveActiveId) ||
          data.sessions.online_pending.find((x) => x.id === preserveActiveId) ||
          data.sessions.online_closed.find((x) => x.id === preserveActiveId) ||
          data.sessions.hotline_answered.find((x) => x.id === preserveActiveId) ||
          data.sessions.hotline_missed.find((x) => x.id === preserveActiveId);
        if (found) {
          selectSession(found);
          return;
        }
      }

      if (candidateList.length > 0) {
        selectSession(candidateList[0]);
      } else {
        setActiveSession(null);
        setActiveMessages([]);
      }
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    initAgentAndSchedule();
    loadWorkbench();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadWorkbench();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, onlineSubTab, hotlineSubTab]);

  const selectSession = async (s: SessionItem) => {
    setActiveSession(s);
    setLoadingMessages(true);
    try {
      const res = await fetchSessionDetail(s.id);
      setActiveSession(res.session);
      setActiveMessages(res.messages);
      setTimeout(scrollToBottom, 50);
    } finally {
      setLoadingMessages(false);
    }
  };

  // 坐席助手搜索
  const handleAssistantSearch = async (tab = assistantTab, q = assistantQuery) => {
    setSearchingAssistant(true);
    try {
      const res = await searchAssistant(tab, q);
      setAssistantResults(res);
    } finally {
      setSearchingAssistant(false);
    }
  };

  useEffect(() => {
    handleAssistantSearch(assistantTab, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantTab]);

  // 发送消息
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !activeSession || sendingMessage) return;
    setSendingMessage(true);
    try {
      const newMsg = await sendAgentMessage(activeSession.id, inputMessage);
      setActiveMessages((prev) => [...prev, newMsg]);
      setInputMessage("");
      setTimeout(scrollToBottom, 50);
    } finally {
      setSendingMessage(false);
    }
  };

  // 坐席助手一键发送客户
  const handleSendAssistantAnswer = async (item: AssistantSearchItem) => {
    if (!activeSession) return;
    const contentToSend = `${item.title}\n${item.snippet}`;
    const newMsg = await sendAgentMessage(activeSession.id, contentToSend);
    setActiveMessages((prev) => [...prev, newMsg]);
    setTimeout(scrollToBottom, 50);
  };

  // 操作区：邀请
  const handleInvite = async () => {
    if (!activeSession) return;
    await inviteSession(activeSession.id);
    setOnlineSubTab("in_progress");
    await loadWorkbench(activeSession.id);
  };

  // 操作区：挂起
  const handleSuspend = async () => {
    if (!activeSession) return;
    await suspendSession(activeSession.id);
    setOnlineSubTab("pending");
    await loadWorkbench(activeSession.id);
  };

  // 操作区：激活
  const handleActivate = async () => {
    if (!activeSession) return;
    await activateSession(activeSession.id);
    setOnlineSubTab("in_progress");
    await loadWorkbench(activeSession.id);
  };

  // 操作区：关闭（关闭后自动补位排队会话）
  const handleClose = async () => {
    if (!activeSession) return;
    if (!window.confirm("确认要关闭本次会话吗？")) return;
    await closeSession(activeSession.id);
    // 释放容量后触发自动补位分流
    await autoDispatchQueueSessions().catch(() => {});
    setOnlineSubTab("closed");
    await loadWorkbench(activeSession.id);
  };

  // 操作区：转工单（转工单后自动补位排队会话）
  const handleTransferTicket = async () => {
    if (!activeSession) return;
    if (!window.confirm("确认要将当前会话转工单推送到产研处理吗？")) return;
    await transferTicket(activeSession.id, { title: activeSession.summary || "在线会话转派" });
    // 释放容量后触发自动补位分流
    await autoDispatchQueueSessions().catch(() => {});
    setOnlineSubTab("closed");
    await loadWorkbench(activeSession.id);
  };

  // --------------------------------------------------------------------------
  // 接待状态切换逻辑
  // --------------------------------------------------------------------------
  const handleStatusChangeRequest = async (newStatus: ReceptionStatus) => {
    setStatusDropdownOpen(false);
    if (newStatus === receptionStatus) return;

    if (newStatus === "online") {
      setReceptionStatus("online");
      if (currentAgent) {
        await updateAgent(currentAgent.id, { status: "online" });
      }
      // 上线后立即触发排队分流
      await autoDispatchQueueSessions().catch(() => {});
      await loadWorkbench();
      return;
    }

    if (newStatus === "busy") {
      setReceptionStatus("busy");
      if (currentAgent) {
        await updateAgent(currentAgent.id, { status: "busy" });
      }
      return;
    }

    if (newStatus === "offline") {
      // 切换离线时判断是否有进行中的会话
      const inProgressSessions =
        workbenchData?.sessions.online_in_progress.filter(
          (s) =>
            !currentAgent ||
            s.agent_user_id === currentAgent.user_id ||
            s.agent_name === currentAgent.user_name
        ) || [];

      if (inProgressSessions.length > 0) {
        // 存在进行中会话，弹出转交确认弹窗
        setHandoverError("");
        setTransferSearchText("");

        // 刷新在线坐席候选人
        const agentsRes = await fetchAgents();
        setAllAgents(agentsRes.items);

        // 过滤在线状态的其他人
        const onlineOthers = agentsRes.items.filter(
          (a) => a.id !== currentAgent?.id && a.status === "online"
        );
        if (onlineOthers.length > 0) {
          setTransferAgentId(onlineOthers[0].id);
        } else {
          setTransferAgentId(null);
        }

        setOfflineModalOpen(true);
      } else {
        // 无进行中会话，可直接切换为离线
        setReceptionStatus("offline");
        if (currentAgent) {
          await updateAgent(currentAgent.id, { status: "offline" });
        }
      }
    }
  };

  // 确认转交并置为离线
  const handleConfirmHandoverOffline = async () => {
    if (!currentAgent) return;
    if (!transferAgentId) {
      setHandoverError("请选择在线状态的会话转交人");
      return;
    }

    setHandoverSubmitting(true);
    setHandoverError("");
    try {
      await handoverAndOffline(currentAgent.id, transferAgentId);
      setReceptionStatus("offline");
      setOfflineModalOpen(false);
      await loadWorkbench();
    } catch (err: any) {
      setHandoverError(err?.message || "转交失败，请重试");
    } finally {
      setHandoverSubmitting(false);
    }
  };

  // 可选在线转交人列表
  const availableTransferAgents = useMemo(() => {
    const onlineOthers = allAgents.filter(
      (a) => a.id !== currentAgent?.id && a.status === "online"
    );
    if (!transferSearchText.trim()) return onlineOthers;
    const q = transferSearchText.trim().toLowerCase();
    return onlineOthers.filter(
      (a) =>
        a.user_name.toLowerCase().includes(q) ||
        a.nickname.toLowerCase().includes(q)
    );
  }, [allAgents, currentAgent, transferSearchText]);

  // 当前列表展示的会话卡片列表
  const currentCardList: SessionItem[] = (() => {
    if (!workbenchData) return [];
    if (mainTab === "online") {
      if (onlineSubTab === "in_progress") return workbenchData.sessions.online_in_progress;
      if (onlineSubTab === "queue") return workbenchData.sessions.online_queue;
      if (onlineSubTab === "pending") return workbenchData.sessions.online_pending;
      return workbenchData.sessions.online_closed;
    } else {
      if (hotlineSubTab === "answered") return workbenchData.sessions.hotline_answered;
      return workbenchData.sessions.hotline_missed;
    }
  })();

  const isCurrentInServiceHours = isWithinReceptionTime(scheduleSettings);

  return (
    <div className="h-[calc(100vh-100px)] min-h-[640px] flex font-hub bg-slate-100 text-slate-800 border-t border-slate-200">
      {/* ------------------------------------------------------------------- */}
      {/* 5.1 左侧会话队列导航 */}
      {/* ------------------------------------------------------------------- */}
      <div className="w-[310px] flex-none bg-white border-r border-slate-200 flex flex-col">
        {/* 3.1 账号接待状态控制栏（在线接待、热线接待上面） */}
        <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium">
            <span>接待状态</span>
            {!isCurrentInServiceHours && (
              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded">
                非接待时段
              </span>
            )}
          </div>

          {/* 状态下拉框 */}
          <div className="relative">
            <button
              type="button"
              title="切换接待状态"
              onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:border-slate-300 transition cursor-pointer shadow-2xs"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  receptionStatus === "online"
                    ? "bg-emerald-500"
                    : receptionStatus === "busy"
                    ? "bg-amber-500"
                    : "bg-slate-400"
                }`}
              />
              <span>
                {receptionStatus === "online"
                  ? "在线"
                  : receptionStatus === "busy"
                  ? "忙碌"
                  : "离线"}
              </span>
              <span className="text-[9px] text-slate-400">▼</span>
            </button>

            {statusDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-28 bg-white border border-slate-200 rounded shadow-lg z-40 p-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => handleStatusChangeRequest("online")}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition ${
                    receptionStatus === "online"
                      ? "bg-emerald-50 text-emerald-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>在线</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChangeRequest("busy")}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition ${
                    receptionStatus === "busy"
                      ? "bg-amber-50 text-amber-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>忙碌</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChangeRequest("offline")}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left cursor-pointer transition ${
                    receptionStatus === "offline"
                      ? "bg-slate-100 text-slate-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span>离线</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 一级菜单切换：在线接待 | 热线接待 */}
        <div className="flex items-center border-b border-slate-200 bg-slate-50/70 p-1.5 gap-1">
          <button
            type="button"
            onClick={() => setMainTab("online")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded transition cursor-pointer ${
              mainTab === "online"
                ? "bg-white text-teal-700 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            在线接待
          </button>
          <button
            type="button"
            onClick={() => setMainTab("hotline")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded transition cursor-pointer ${
              mainTab === "hotline"
                ? "bg-white text-teal-700 shadow-2xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            热线接待
          </button>
        </div>

        {/* 二级菜单切换 */}
        {mainTab === "online" ? (
          <div className="grid grid-cols-4 border-b border-slate-200 text-center text-xs bg-slate-50/40">
            <button
              type="button"
              onClick={() => setOnlineSubTab("in_progress")}
              className={`py-2 px-1 border-b-2 font-medium cursor-pointer transition ${
                onlineSubTab === "in_progress"
                  ? "border-teal-600 text-teal-700 bg-white font-semibold"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              进行中 ({workbenchData?.counts.online_in_progress ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setOnlineSubTab("queue")}
              className={`py-2 px-1 border-b-2 font-medium cursor-pointer transition ${
                onlineSubTab === "queue"
                  ? "border-teal-600 text-teal-700 bg-white font-semibold"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              排队中 ({workbenchData?.counts.online_queue ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setOnlineSubTab("pending")}
              className={`py-2 px-1 border-b-2 font-medium cursor-pointer transition ${
                onlineSubTab === "pending"
                  ? "border-teal-600 text-teal-700 bg-white font-semibold"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              挂起 ({workbenchData?.counts.online_pending ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setOnlineSubTab("closed")}
              className={`py-2 px-1 border-b-2 font-medium cursor-pointer transition ${
                onlineSubTab === "closed"
                  ? "border-teal-600 text-teal-700 bg-white font-semibold"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              已结束 ({workbenchData?.counts.online_closed ?? 0})
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 border-b border-slate-200 text-center text-xs bg-slate-50/40">
            <button
              type="button"
              onClick={() => setHotlineSubTab("answered")}
              className={`py-2 border-b-2 font-medium cursor-pointer transition ${
                hotlineSubTab === "answered"
                  ? "border-teal-600 text-teal-700 bg-white font-semibold"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              已接 ({workbenchData?.counts.hotline_answered ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setHotlineSubTab("missed")}
              className={`py-2 border-b-2 font-medium cursor-pointer transition ${
                hotlineSubTab === "missed"
                  ? "border-teal-600 text-teal-700 bg-white font-semibold"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              未接 ({workbenchData?.counts.hotline_missed ?? 0})
            </button>
          </div>
        )}

        {/* 会话卡片列表 */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {loadingSessions ? (
            <div className="text-center py-12 text-slate-400 text-xs">加载会话中...</div>
          ) : currentCardList.length === 0 ? (
            <div className="text-center py-14 text-slate-400 text-xs">
              {onlineSubTab === "queue"
                ? "暂无排队客户"
                : onlineSubTab === "in_progress"
                ? "当前无进行中会话"
                : "暂无会话"}
            </div>
          ) : (
            currentCardList.map((card) => {
              const isSelected = activeSession?.id === card.id;
              return (
                <div
                  key={card.id}
                  onClick={() => selectSession(card)}
                  className={`p-3 cursor-pointer transition flex flex-col gap-1.5 ${
                    isSelected ? "bg-teal-50/70 border-l-3 border-teal-600" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-800 truncate max-w-[190px]">
                      {card.company_name}
                    </span>
                    <span className="text-[10.5px] text-slate-400 font-mono">
                      {(card.last_message_at || card.created_at).slice(11, 16)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate max-w-[210px] text-[11.5px]">
                      {card.last_message || card.summary || "等待消息..."}
                    </span>
                    {card.unread_count > 0 && (
                      <span className="flex-none px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold">
                        {card.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 5.2 中间对话沟通区 */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex-1 flex flex-col bg-slate-50 border-r border-slate-200">
        {activeSession ? (
          <>
            {/* 顶部操作区 */}
            <div className="px-5 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-sm">
                  {activeSession.company_name}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ({activeSession.id})
                </span>
              </div>

              {/* 动态按钮组 */}
              <div className="flex items-center gap-2">
                {activeSession.status === "queue" && (
                  <button
                    type="button"
                    onClick={handleInvite}
                    className="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded font-medium transition cursor-pointer shadow-2xs"
                  >
                    邀请进入接待
                  </button>
                )}

                {activeSession.status === "in_progress" && (
                  <>
                    <button
                      type="button"
                      onClick={handleSuspend}
                      className="px-3 py-1.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs rounded font-medium transition cursor-pointer"
                    >
                      挂起
                    </button>
                    <button
                      type="button"
                      onClick={handleTransferTicket}
                      className="px-3 py-1.5 border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-800 text-xs rounded font-medium transition cursor-pointer"
                    >
                      转工单
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs rounded font-medium transition cursor-pointer"
                    >
                      关闭会话
                    </button>
                  </>
                )}

                {activeSession.status === "pending" && (
                  <button
                    type="button"
                    onClick={handleActivate}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded font-medium transition cursor-pointer shadow-2xs"
                  >
                    重新激活
                  </button>
                )}
              </div>
            </div>

            {/* 对话消息沟通区 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {loadingMessages ? (
                <div className="text-center py-16 text-slate-400 text-xs">
                  对话记录加载中...
                </div>
              ) : activeMessages.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-xs">
                  暂无对话记录
                </div>
              ) : (
                activeMessages.map((msg) => {
                  const isCustomer = msg.sender_type === "customer";
                  const isSystem = msg.sender_type === "system";
                  const isBot = msg.sender_type === "bot";

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="text-center my-2">
                        <span className="inline-block px-3 py-0.5 rounded-full text-[10.5px] bg-slate-200/80 text-slate-600">
                          {msg.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isCustomer ? "items-start" : "items-end"}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[10.5px] text-slate-400">
                        <span>
                          {isCustomer
                            ? `客户 · ${msg.sender_name}`
                            : isBot
                            ? "智能助手 · Agent"
                            : `坐席 · ${msg.sender_name}`}
                        </span>
                        <span>{msg.created_at.slice(11, 16)}</span>
                      </div>
                      <div
                        className={`max-w-[75%] px-4 py-2.5 rounded-lg text-xs leading-relaxed shadow-2xs whitespace-pre-wrap ${
                          isCustomer
                            ? "bg-white text-slate-800 border border-slate-200 rounded-tl-none"
                            : isBot
                            ? "bg-purple-50 text-purple-900 border border-purple-200 rounded-tr-none"
                            : "bg-teal-600 text-white rounded-tr-none"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 坐席端信息录入发送区 */}
            <div className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2">
              <textarea
                rows={3}
                value={inputMessage}
                disabled={activeSession.status === "closed" || activeSession.status === "converted"}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={
                  activeSession.status === "closed" || activeSession.status === "converted"
                    ? "当前会话已结束或已转工单，不可继续发送消息"
                    : "输入回复内容给客户，回车快捷发送，Shift+Enter 换行..."
                }
                className="w-full resize-none border border-slate-200 rounded-md p-2.5 text-xs text-slate-800 focus:outline-none focus:border-teal-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  按 Enter 快捷发送，Shift + Enter 换行
                </span>
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={
                    !inputMessage.trim() ||
                    sendingMessage ||
                    activeSession.status === "closed" ||
                    activeSession.status === "converted"
                  }
                  className="px-4 py-1.5 bg-teal-600 text-white text-xs font-medium rounded hover:bg-teal-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sendingMessage ? "发送中..." : "发送"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
            请从左侧选择一个会话开始接待
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 5.3 右侧分上下结构：上部分基础信息，下部分坐席助手 */}
      {/* ------------------------------------------------------------------- */}
      <div className="w-[360px] flex-none bg-white flex flex-col overflow-hidden">
        {activeSession ? (
          <>
            {/* 上部：客户基础信息 */}
            <div className="p-4 border-b border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800">企业与客户画像</h3>
                <span className="text-[11px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 font-medium">
                  {activeSession.is_in_service || "服务期内"}
                </span>
              </div>

              {/* 5.3.1 归属租户、咨询企业、咨询企业税号 直接显示值，不显示 key */}
              <div className="p-2.5 bg-white rounded border border-slate-200/80 space-y-1">
                <div className="text-xs font-bold text-slate-900 break-words">
                  {activeSession.company_name}
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  税号：{activeSession.tax_no || "—"}
                </div>
                <div className="text-[11px] text-slate-600">
                  租户：{activeSession.tenant_name || activeSession.tenant_no || "—"}
                </div>
              </div>

              {/* 咨询人、联系电话号码、已购产品、是否期内 显示 key: value */}
              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">咨询人：</span>
                  <span className="font-medium text-slate-800">{activeSession.contact_name || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">联系电话：</span>
                  <span className="font-mono text-slate-800">{activeSession.contact_phone || "—"}</span>
                </div>
                <div className="pt-1">
                  <div className="text-slate-400 text-[11px] mb-1">已购产品：</div>
                  <div className="flex flex-col gap-1 pl-1">
                    {(activeSession.purchased_products || ["发票云敏捷版", "数电发票乐企模块"]).map((p) => (
                      <span
                        key={p}
                        className="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 下部：5.3.2 坐席助手 */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 pb-2 border-b border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>坐席助手</span>
                    <span className="text-[10.5px] text-slate-400 font-normal">快速解答</span>
                  </h3>
                </div>

                {/* 5.3.2.1 查询类型 tab */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setAssistantTab("knowledge")}
                    className={`py-1 rounded font-medium transition cursor-pointer ${
                      assistantTab === "knowledge" ? "bg-white text-teal-700 shadow-2xs" : "text-slate-600"
                    }`}
                  >
                    知识库
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantTab("ticket")}
                    className={`py-1 rounded font-medium transition cursor-pointer ${
                      assistantTab === "ticket" ? "bg-white text-teal-700 shadow-2xs" : "text-slate-600"
                    }`}
                  >
                    工单
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantTab("order")}
                    className={`py-1 rounded font-medium transition cursor-pointer ${
                      assistantTab === "order" ? "bg-white text-teal-700 shadow-2xs" : "text-slate-600"
                    }`}
                  >
                    订单
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantTab("benefit")}
                    className={`py-1 rounded font-medium transition cursor-pointer ${
                      assistantTab === "benefit" ? "bg-white text-teal-700 shadow-2xs" : "text-slate-600"
                    }`}
                  >
                    企业权益
                  </button>
                </div>

                {/* 5.3.2.2 查询内容录入框 */}
                <div className="mt-2.5">
                  <input
                    type="text"
                    value={assistantQuery}
                    onChange={(e) => setAssistantQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAssistantSearch()}
                    placeholder="录入查询内容，回车确认检索..."
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                  />
                </div>
              </div>

              {/* 5.3.2.3 查询结果展示 */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
                {searchingAssistant ? (
                  <div className="text-center py-10 text-slate-400 text-xs">搜索中...</div>
                ) : assistantResults.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-xs">未找到相关结果</div>
                ) : (
                  assistantResults.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded hover:border-teal-300 transition space-y-1.5"
                    >
                      <div className="font-semibold text-slate-800 text-[11.5px] leading-snug">
                        {item.title}
                      </div>
                      <div className="text-slate-600 text-[11px] leading-relaxed line-clamp-3">
                        {item.snippet}
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                        <span className="text-[10px] font-mono text-slate-400">{item.id}</span>
                        <button
                          type="button"
                          onClick={() => handleSendAssistantAnswer(item)}
                          className="px-2 py-0.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-[10.5px] font-medium transition cursor-pointer"
                        >
                          发送给客户
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs p-6 text-center">
            选择会话后查看企业画像与知识助手
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* 离线状态切换确认弹窗 */}
      {/* ------------------------------------------------------------------- */}
      {offlineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 w-[480px] max-w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* 弹窗头部 */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <span className="text-amber-600">⚠️</span>
                <span>离线状态切换确认</span>
              </h3>
              <button
                type="button"
                onClick={() => setOfflineModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-base leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="p-5 space-y-4 text-xs">
              {handoverError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded">
                  {handoverError}
                </div>
              )}

              {/* 提示文本 */}
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded leading-relaxed">
                当前存在进行中的会话，建议修改为忙碌，处理完存量会话再改离线，如果确认离线，请在下方录入框录入会话转交人，点击确认。
              </div>

              {/* 转交人选择录入框 */}
              <div className="space-y-1.5">
                <label className="block text-slate-700 font-semibold">
                  会话转交人（必填，仅限在线坐席） <span className="text-rose-500">*</span>
                </label>

                {availableTransferAgents.length === 0 ? (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs">
                    当前系统内暂无其他处于「在线」状态的坐席人员，无法转交会话，暂不能更新为离线状态。请等待其他坐席上线或先处理完当前进行中会话。
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={transferSearchText}
                      onChange={(e) => setTransferSearchText(e.target.value)}
                      placeholder="快速定位/筛选在线坐席..."
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-teal-600"
                    />
                    <select
                      value={transferAgentId || ""}
                      onChange={(e) => setTransferAgentId(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-teal-600 bg-white"
                    >
                      {availableTransferAgents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.user_name}（{ag.nickname}） - 在线（上限 {ag.max_concurrent}）
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400">
                      确认后，您当前所有的进行中会话将自动转交给该坐席，原会话将同步转交通知。
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 弹窗底部操作 */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOfflineModalOpen(false)}
                className="px-3.5 py-1.5 border border-slate-300 text-slate-600 rounded hover:bg-slate-100 transition cursor-pointer text-xs"
              >
                取消
              </button>
              <button
                type="button"
                disabled={availableTransferAgents.length === 0 || handoverSubmitting || !transferAgentId}
                onClick={handleConfirmHandoverOffline}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-medium transition cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {handoverSubmitting ? "正在转交并离线..." : "确认转交并离线"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
