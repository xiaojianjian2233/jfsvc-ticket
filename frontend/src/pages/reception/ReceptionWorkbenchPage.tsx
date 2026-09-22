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

interface StagedAttachment {
  id: string;
  name: string;
  size: number;
  isImage: boolean;
  dataUrl?: string;
  file: File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

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
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("knowledge");
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantResults, setAssistantResults] = useState<AssistantSearchItem[]>([]);
  const [searchingAssistant, setSearchingAssistant] = useState(false);

  // 引用回复状态
  const [quotedMessage, setQuotedMessage] = useState<MessageItem | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleQuoteMessage = (msg: MessageItem) => {
    setQuotedMessage(msg);
    textareaRef.current?.focus();
  };

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

  // 附件选择/拖拽上传处理
  const handleFiles = (files: File[]) => {
    if (!files || files.length === 0) return;
    files.forEach((file) => {
      const isImage = file.type.startsWith("image/");
      const attId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          setStagedAttachments((prev) => [
            ...prev,
            {
              id: attId,
              name: file.name,
              size: file.size,
              isImage: true,
              dataUrl,
              file,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setStagedAttachments((prev) => [
          ...prev,
          {
            id: attId,
            name: file.name,
            size: file.size,
            isImage: false,
            file,
          },
        ]);
      }
    });
  };

  const removeStagedAttachment = (id: string) => {
    setStagedAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // 剪贴板粘贴处理（支持 Ctrl+V / Cmd+V 粘贴截图与文件）
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles: File[] = [];
    if (e.clipboardData?.items) {
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            clipboardFiles.push(file);
          }
        }
      }
    }
    if (clipboardFiles.length > 0) {
      e.preventDefault();
      handleFiles(clipboardFiles);
    }
  };

  // 渲染消息气泡内容（支持引用、图片与文件卡片）
  const renderMessageContent = (content: string, isSelfAgent: boolean) => {
    // 检查是否包含引用：格式为 「引用 发送人: 引用内容」\n回复正文
    const quoteMatch = content.match(/^「引用\s+([^:：]+)[:：]\s*([\s\S]*?)」\n([\s\S]*)$/);

    const renderBody = (body: string) => {
      // 匹配图片消息
      const imageMatch = body.match(/^\[图片:\s*([^\]]+)\]\n(data:image\/[^\s]+)/s);
      if (imageMatch) {
        const imgName = imageMatch[1];
        const imgUrl = imageMatch[2];
        return (
          <div className="space-y-1">
            <img
              src={imgUrl}
              alt={imgName}
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(imgUrl);
              }}
              className="max-w-[280px] max-h-[200px] rounded object-cover cursor-zoom-in border border-black/10 hover:opacity-95 transition"
            />
            <div className="text-[10px] opacity-80 flex items-center gap-1">
              <span>🖼️</span>
              <span className="truncate max-w-[240px]" title={imgName}>
                {imgName}
              </span>
            </div>
          </div>
        );
      }

      // 纯 base64 图片格式
      if (body.startsWith("data:image/")) {
        return (
          <img
            src={body}
            alt="图片"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewImage(body);
            }}
            className="max-w-[280px] max-h-[200px] rounded object-cover cursor-zoom-in border border-black/10 hover:opacity-95 transition"
          />
        );
      }

      // 匹配文件消息
      const fileMatch = body.match(/^\[文件:\s*([^\]]+)\]/);
      if (fileMatch) {
        const fileInfo = fileMatch[1];
        return (
          <div
            className={`flex items-center gap-2 p-2 rounded border ${
              isSelfAgent
                ? "bg-white/15 border-white/20 text-white"
                : "bg-slate-50 border-slate-200 text-slate-800"
            }`}
          >
            <span className="text-xl">📄</span>
            <div className="text-[14px]">
              <div className="font-medium truncate max-w-[220px]">{fileInfo}</div>
              <div className="text-[12px] opacity-75">附件文档</div>
            </div>
          </div>
        );
      }

      return body;
    };

    if (quoteMatch) {
      const quoteSender = quoteMatch[1].trim();
      const quoteText = quoteMatch[2].trim();
      const replyBody = quoteMatch[3];

      return (
        <div className="space-y-1.5">
          <div
            className={`text-[13px] px-2.5 py-1.5 rounded border-l-2 mb-1 ${
              isSelfAgent
                ? "bg-black/15 border-white/70 text-white/90"
                : "bg-slate-100 border-teal-600 text-slate-600"
            }`}
          >
            <div className="font-semibold text-[12px] opacity-80 mb-0.5">
              引用 {quoteSender}
            </div>
            <div className="line-clamp-2 truncate text-[13px] opacity-90">
              {quoteText}
            </div>
          </div>
          <div>{renderBody(replyBody)}</div>
        </div>
      );
    }

    return renderBody(content);
  };

  // 发送消息及附件
  const handleSendMessage = async () => {
    if (
      (!inputMessage.trim() && stagedAttachments.length === 0) ||
      !activeSession ||
      sendingMessage
    ) {
      return;
    }
    setSendingMessage(true);
    try {
      // 1. 如果有输入文本，先发送文本消息
      if (inputMessage.trim()) {
        let textToSend = inputMessage.trim();
        if (quotedMessage) {
          const quoteSender =
            quotedMessage.sender_name ||
            (quotedMessage.sender_type === "customer" ? "客户" : "客服");
          const quoteContent = quotedMessage.content.replace(/\n/g, " ").slice(0, 100);
          textToSend = `「引用 ${quoteSender}: ${quoteContent}」\n${textToSend}`;
        }
        const textMsg = await sendAgentMessage(activeSession.id, textToSend);
        setActiveMessages((prev) => [...prev, textMsg]);
        setQuotedMessage(null);
      }
      // 2. 如果有暂存附件，发送附件
      if (stagedAttachments.length > 0) {
        for (const att of stagedAttachments) {
          const content =
            att.isImage && att.dataUrl
              ? `[图片: ${att.name}]\n${att.dataUrl}`
              : `[文件: ${att.name} (${formatFileSize(att.size)})]`;
          const attMsg = await sendAgentMessage(activeSession.id, content);
          setActiveMessages((prev) => [...prev, attMsg]);
        }
      }
      setInputMessage("");
      setStagedAttachments([]);
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
            s.agent_name === currentAgent.user_name ||
            s.agent_name === currentAgent.nickname
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
      <div className="w-[320px] flex-none bg-white border-r border-slate-200 flex flex-col">
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
                    <span className="font-semibold text-[14px] text-slate-800 truncate max-w-[200px]">
                      {card.company_name}
                    </span>
                    <span className="text-[12.5px] text-slate-400 font-mono">
                      {(card.last_message_at || card.created_at).slice(11, 16)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="truncate max-w-[220px] text-[13.5px]">
                      {card.last_message || card.summary || "等待消息..."}
                    </span>
                    {card.unread_count > 0 && (
                      <span className="flex-none px-1.5 py-0.2 rounded-full text-[12px] bg-rose-500 text-white font-bold">
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
                activeMessages.map((msg, index) => {
                  const isCustomer = msg.sender_type === "customer";
                  const isSystem = msg.sender_type === "system";
                  const isBot = msg.sender_type === "bot";

                  if (isSystem) {
                    return (
                      <div key={`sys_${msg.id}_${index}`} className="text-center my-2">
                        <span className="inline-block px-3 py-0.5 rounded-full text-[10.5px] bg-slate-200/80 text-slate-600">
                          {msg.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`msg_${msg.id}_${index}`}
                      className={`flex flex-col group ${isCustomer ? "items-start" : "items-end"}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[12.5px] text-slate-400">
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
                        onClick={() => {
                          if (
                            isCustomer &&
                            activeSession.status !== "closed" &&
                            activeSession.status !== "converted"
                          ) {
                            handleQuoteMessage(msg);
                          }
                        }}
                        className={`max-w-[75%] px-4 py-2.5 rounded-lg text-[14px] leading-relaxed shadow-2xs whitespace-pre-wrap transition ${
                          isCustomer
                            ? "bg-white text-slate-800 border border-slate-200 rounded-tl-none hover:border-teal-500/50 cursor-pointer"
                            : isBot
                            ? "bg-purple-50 text-purple-900 border border-purple-200 rounded-tr-none"
                            : "bg-teal-600 text-white rounded-tr-none"
                        } ${
                          quotedMessage?.id === msg.id
                            ? "ring-2 ring-teal-500 border-teal-500"
                            : ""
                        }`}
                        title={
                          isCustomer &&
                          activeSession.status !== "closed" &&
                          activeSession.status !== "converted"
                            ? "点击可引用回复此消息"
                            : undefined
                        }
                      >
                        <div>{renderMessageContent(msg.content, !isCustomer && !isBot)}</div>

                        {/* 对应消息右下角：引用回复操作按钮 */}
                        {isCustomer &&
                          activeSession.status !== "closed" &&
                          activeSession.status !== "converted" && (
                            <div className="flex justify-end mt-1.5 pt-1 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuoteMessage(msg);
                                }}
                                className={`inline-flex items-center gap-1 text-[12.5px] rounded px-2 py-0.5 font-medium transition cursor-pointer shadow-2xs ${
                                  quotedMessage?.id === msg.id
                                    ? "bg-teal-600 text-white border border-teal-600"
                                    : "text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200/80"
                                }`}
                                title="引用此消息"
                                aria-label="引用此消息"
                              >
                                <svg
                                  className="w-3 h-3"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                <span>{quotedMessage?.id === msg.id ? "已引用" : "引用回复"}</span>
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 坐席端信息录入发送区 */}
            <div className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2">
              {/* 工具栏：附件按钮 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title="添加附件（支持图片、文件；也可直接拖拽至录入框或 Ctrl+V 粘贴）"
                    aria-label="添加附件"
                    disabled={activeSession.status === "closed" || activeSession.status === "converted"}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-slate-600 hover:text-[rgb(35,94,212)] hover:bg-blue-50 transition cursor-pointer text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg
                      className="w-4 h-4 text-slate-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                      />
                    </svg>
                    <span className="font-medium">附件</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFiles(Array.from(e.target.files));
                        e.target.value = "";
                      }
                    }}
                    className="hidden"
                  />
                  <span className="text-[11px] text-slate-400">
                    支持勾选、拖拽或 Ctrl+V 粘贴图片与文件
                  </span>
                </div>
              </div>

              {/* 暂存附件预览列表 */}
              {stagedAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 bg-slate-50 rounded border border-slate-200">
                  {stagedAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded text-xs shadow-2xs"
                    >
                      {att.isImage && att.dataUrl ? (
                        <img
                          src={att.dataUrl}
                          alt={att.name}
                          className="w-5 h-5 rounded object-cover"
                        />
                      ) : (
                        <span className="text-slate-400">📄</span>
                      )}
                      <span
                        className="max-w-[140px] truncate text-slate-700 font-medium text-[11px]"
                        title={att.name}
                      >
                        {att.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        ({formatFileSize(att.size)})
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStagedAttachment(att.id)}
                        className="text-slate-400 hover:text-red-500 ml-1 cursor-pointer font-bold text-xs"
                        title="移除附件"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 引用消息提示条 */}
              {quotedMessage && (
                <div className="flex items-center justify-between px-3 py-1 bg-teal-50 border border-teal-200 rounded-md text-[13.5px] text-slate-700">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-teal-700 font-semibold flex-none text-[13px]">
                      💬 引用 {quotedMessage.sender_name || (quotedMessage.sender_type === "customer" ? "客户" : "客服")}:
                    </span>
                    <span className="truncate text-slate-600 text-[13px] max-w-[360px] md:max-w-[500px]">
                      {quotedMessage.content.replace(/\n/g, " ").slice(0, 80)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuotedMessage(null)}
                    className="text-slate-400 hover:text-slate-600 ml-2 font-bold cursor-pointer text-xs"
                    title="取消引用"
                    aria-label="取消引用"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* 录入框容器（支持拖拽覆盖与高度在原来基础上加30px：原3行约75px -> h-[105px] min-h-[105px]） */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFiles(Array.from(e.dataTransfer.files));
                  }
                }}
                className="relative rounded-md"
              >
                <textarea
                  ref={textareaRef}
                  value={inputMessage}
                  disabled={activeSession.status === "closed" || activeSession.status === "converted"}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={
                    activeSession.status === "closed" || activeSession.status === "converted"
                      ? "当前会话已结束或已转工单，不可继续发送消息"
                      : "输入回复内容给客户，回车快捷发送，Shift+Enter 换行；支持拖拽或 Ctrl+V 粘贴图片与文件..."
                  }
                  className="w-full h-[105px] min-h-[105px] resize-none border border-slate-200 rounded-md p-2.5 text-[14px] text-slate-800 focus:outline-none focus:border-teal-600 disabled:bg-slate-100 disabled:cursor-not-allowed"
                />

                {isDragging && (
                  <div className="absolute inset-0 bg-blue-50/90 border-2 border-dashed border-[rgb(35,94,212)] rounded-md flex items-center justify-center pointer-events-none text-xs font-medium text-[rgb(35,94,212)]">
                    松开鼠标即可添加附件或图片
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  按 Enter 快捷发送，Shift + Enter 换行
                </span>
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={
                    (!inputMessage.trim() && stagedAttachments.length === 0) ||
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
      <div className="w-[360px] flex-none bg-white flex flex-col overflow-y-auto">
        {activeSession ? (
          <>
            {/* 上部：企业与客户画像 */}
            <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/50 space-y-2 flex-none">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-slate-800">企业与客户画像</h3>
                <span className="text-[11px] text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200 font-medium whitespace-nowrap">
                  {activeSession.is_in_service || "服务期内"}
                </span>
              </div>

              {/* 租户、咨询企业、税号、咨询人、联系电话：全部key+值左右结构，key左对齐在一起不隔开，值右对齐，字号统一12号，严禁换行 */}
              <div className="px-3 py-2 bg-white rounded-lg border border-slate-200/90 space-y-1.5">
                <div className="flex items-center justify-between text-[12px] whitespace-nowrap gap-2">
                  <span className="text-slate-500 text-left flex-none text-[12px] whitespace-nowrap">租户：</span>
                  <span
                    className="font-medium text-slate-800 text-right truncate max-w-[220px] text-[12px] whitespace-nowrap"
                    title={activeSession.tenant_name || activeSession.tenant_no || "—"}
                  >
                    {activeSession.tenant_name || activeSession.tenant_no || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px] whitespace-nowrap gap-2">
                  <span className="text-slate-500 text-left flex-none text-[12px] whitespace-nowrap">咨询企业：</span>
                  <span
                    className="font-medium text-slate-800 text-right truncate max-w-[220px] text-[12px] whitespace-nowrap"
                    title={activeSession.company_name || "—"}
                  >
                    {activeSession.company_name || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px] whitespace-nowrap gap-2">
                  <span className="text-slate-500 text-left flex-none text-[12px] whitespace-nowrap">税号：</span>
                  <span
                    className="font-mono text-slate-800 text-right truncate max-w-[220px] text-[12px] whitespace-nowrap"
                    title={activeSession.tax_no || "—"}
                  >
                    {activeSession.tax_no || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px] whitespace-nowrap gap-2">
                  <span className="text-slate-500 text-left flex-none text-[12px] whitespace-nowrap">咨询人：</span>
                  <span
                    className="font-medium text-slate-800 text-right truncate max-w-[220px] text-[12px] whitespace-nowrap"
                    title={activeSession.contact_name || "—"}
                  >
                    {activeSession.contact_name || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px] whitespace-nowrap gap-2">
                  <span className="text-slate-500 text-left flex-none text-[12px] whitespace-nowrap">联系电话：</span>
                  <span
                    className="font-mono text-slate-800 text-right truncate max-w-[220px] text-[12px] whitespace-nowrap"
                    title={activeSession.contact_phone || "—"}
                  >
                    {activeSession.contact_phone || "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* 中部：已购产品（独立模块，与企业与客户画像和坐席助手同等级） */}
            <div className="px-3.5 py-2 border-b border-slate-200 bg-white space-y-1.5 flex-none">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
                  <span>已购产品</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    ({(activeSession.purchased_products || ["发票云敏捷版", "数电发票乐企模块"]).length}项)
                  </span>
                </h3>
              </div>

              {/* 3列表格呈现数据：产品、状态、到期时间；紧凑单行无折叠，节省坐席助手空间 */}
              <div className="w-full overflow-hidden">
                <table className="w-full text-left border-collapse table-fixed">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 font-normal text-[12px]">
                      <th className="pb-1 px-1 font-normal text-left whitespace-nowrap text-[12px]">产品</th>
                      <th className="pb-1 px-1 font-normal text-center w-[54px] whitespace-nowrap text-[12px]">状态</th>
                      <th className="pb-1 px-1 font-normal text-right w-[90px] whitespace-nowrap text-[12px]">到期时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeSession.purchased_products || ["发票云敏捷版", "数电发票乐企模块"]).map(
                      (productItem, idx) => {
                        const name = typeof productItem === "string" ? productItem : (productItem as any).name;
                        const status = typeof productItem === "string" ? "服务中" : ((productItem as any).status || "服务中");
                        const expireDate = typeof productItem === "string" ? "2027-12-31" : ((productItem as any).expire_date || "2027-12-31");
                        return (
                          <tr key={idx} className="hover:bg-slate-50/60 transition">
                            <td className="py-1 px-1 text-[12px] text-slate-700 font-normal truncate whitespace-nowrap" title={name}>
                              {name}
                            </td>
                            <td className="py-1 px-1 text-center whitespace-nowrap">
                              <span className="inline-block px-1.5 py-0.5 rounded text-[12px] bg-emerald-50 text-emerald-700 font-normal whitespace-nowrap">
                                {status}
                              </span>
                            </td>
                            <td className="py-1 px-1 text-right font-mono text-slate-600 text-[12px] font-normal whitespace-nowrap">
                              {expireDate}
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 下部：5.3.2 坐席助手 */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 pb-2 border-b border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5">
                    <span>坐席助手</span>
                    <span className="text-[10.5px] text-slate-400 font-normal">快速解答</span>
                  </h3>
                </div>

                {/* 5.3.2.1 查询类型 tab（修改为12号字体，选中状态填充 RGB:35,94,212） */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded text-center text-[12px]">
                  <button
                    type="button"
                    onClick={() => setAssistantTab("knowledge")}
                    className={`py-1 px-0.5 rounded font-medium transition cursor-pointer text-[12px] whitespace-nowrap ${
                      assistantTab === "knowledge"
                        ? "bg-[rgb(35,94,212)] text-white shadow-xs font-semibold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                    }`}
                  >
                    知识库
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantTab("ticket")}
                    className={`py-1 px-0.5 rounded font-medium transition cursor-pointer text-[12px] whitespace-nowrap ${
                      assistantTab === "ticket"
                        ? "bg-[rgb(35,94,212)] text-white shadow-xs font-semibold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                    }`}
                  >
                    工单
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantTab("order")}
                    className={`py-1 px-0.5 rounded font-medium transition cursor-pointer text-[12px] whitespace-nowrap ${
                      assistantTab === "order"
                        ? "bg-[rgb(35,94,212)] text-white shadow-xs font-semibold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                    }`}
                  >
                    订单
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssistantTab("benefit")}
                    className={`py-1 px-0.5 rounded font-medium transition cursor-pointer text-[12px] whitespace-nowrap ${
                      assistantTab === "benefit"
                        ? "bg-[rgb(35,94,212)] text-white shadow-xs font-semibold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                    }`}
                  >
                    企业权益
                  </button>
                </div>

                {/* 5.3.2.2 查询内容录入框（标记醒目突出颜色与搜索图标，快速定位） */}
                <div className="mt-2.5 relative flex items-center">
                  <span className="absolute left-2.5 text-[rgb(35,94,212)] pointer-events-none">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={assistantQuery}
                    onChange={(e) => setAssistantQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAssistantSearch()}
                    placeholder="录入查询内容，回车确认检索..."
                    className="w-full pl-8 pr-2.5 py-1.5 border-2 border-[rgb(35,94,212)] bg-blue-50/50 rounded text-xs text-slate-800 placeholder:text-blue-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[rgb(35,94,212)]/30 transition shadow-xs"
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
                          className="px-2.5 py-1 bg-[rgb(35,94,212)] hover:opacity-90 text-white rounded text-[11px] font-medium transition cursor-pointer shadow-2xs"
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

      {/* 图片放大预览模态窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-lg p-2 shadow-2xl overflow-hidden cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-900 text-white flex items-center justify-center text-sm shadow cursor-pointer transition"
              title="关闭预览"
            >
              ✕
            </button>
            <img
              src={previewImage}
              alt="图片预览"
              className="max-w-full max-h-[85vh] rounded object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
