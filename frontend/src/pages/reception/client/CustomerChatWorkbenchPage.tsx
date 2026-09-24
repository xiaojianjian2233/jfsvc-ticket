import { useEffect, useRef, useState } from "react";
import {
  type ClientEvaluationPayload,
  type ClientNoticeItem,
  type ClientSessionsGrouped,
  type ClientTicketItem,
  type MessageItem,
  type SessionItem,
  clientCloseSession,
  clientConfirmTicket,
  clientEvaluateSession,
  clientFetchMessages,
  clientFetchNotices,
  clientFetchSessions,
  clientFetchTickets,
  clientInitSession,
  clientRemindTicket,
  clientSendMessage,
} from "../receptionApi";
import { type CustomerProfile } from "./CustomerInfoCollectionPage";
import { CustomerEvaluationModal } from "./CustomerEvaluationModal";
import { STORAGE_SESSION_KEY } from "./CustomerClientApp";

interface CustomerChatWorkbenchPageProps {
  profile: CustomerProfile;
  initialSession?: SessionItem | null;
  initialMessages?: MessageItem[];
  onBackToLogin: () => void;
}

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

function formatSessionTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const clean = dateStr.replace("T", " ").replace(/\.\d+.*$/, "").trim();
  if (clean.length >= 16) {
    return clean.slice(0, 16);
  }
  return clean;
}

export function CustomerChatWorkbenchPage({
  profile,
  initialSession = null,
  initialMessages = [],
  onBackToLogin,
}: CustomerChatWorkbenchPageProps) {
  // 同步活动会话到当前操作窗口的 sessionStorage（保证窗口未关闭前状态绝对不丢）
  const syncSessionToStorage = (session: SessionItem | null) => {
    try {
      if (session && session.status !== "closed" && session.status !== "converted") {
        sessionStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(STORAGE_SESSION_KEY);
      }
    } catch (e) {
      console.warn("Failed to sync session to sessionStorage", e);
    }
  };

  // 当前进行中的会话与消息流（窗口生命周期内持久锚定）
  const [currentSession, setCurrentSession] = useState<SessionItem | null>(() => {
    if (initialSession) return initialSession;
    try {
      const saved = sessionStorage.getItem(STORAGE_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.status !== "closed" && parsed.status !== "converted") {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  });
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // 会话列表（24小时内未关闭 vs 已结束）
  const [sessionsGroup, setSessionsGroup] = useState<ClientSessionsGrouped>(() => {
    const active =
      initialSession ||
      (() => {
        try {
          const saved = sessionStorage.getItem(STORAGE_SESSION_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.status !== "closed" && parsed.status !== "converted") {
              return parsed;
            }
          }
        } catch {
          // ignore
        }
        return null;
      })();
    return {
      recent_open: active ? [active] : [],
      closed: [],
    };
  });

  // 输入框与附件
  const [inputMessage, setInputMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 大图预览与评价弹窗
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [evaluationModalOpen, setEvaluationModalOpen] = useState(false);

  // 移动端折叠控制
  const [mobileDrawerTab, setMobileDrawerTab] = useState<"chat" | "list" | "info">("chat");

  // 会话列表折叠/展开控制（默认进行中的会话展开）
  const [expandedSections, setExpandedSections] = useState<{
    ongoing: boolean;
    unclosed: boolean;
    closed: boolean;
  }>({
    ongoing: true, // 默认进行中的会话展开
    unclosed: false,
    closed: false,
  });

  const toggleSection = (key: "ongoing" | "unclosed" | "closed") => {
    setExpandedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // 左侧面板 Tab 切换（顺序：客户信息 -> 重要通知 -> 工单信息）
  const [rightTab, setRightTab] = useState<"profile" | "notices" | "tickets">("notices");
  const [notices, setNotices] = useState<ClientNoticeItem[]>([]);
  const [selectedNotice, setSelectedNotice] = useState<ClientNoticeItem | null>(null);

  // 工单信息状态
  const [tickets, setTickets] = useState<ClientTicketItem[]>([]);
  const [, setLoadingTickets] = useState(false);
  const [ticketSubTab, setTicketSubTab] = useState<"processing" | "reviewing" | "closed">("processing");
  const [selectedConfirmTicket, setSelectedConfirmTicket] = useState<ClientTicketItem | null>(null);
  const [selectedViewTicket, setSelectedViewTicket] = useState<ClientTicketItem | null>(null);
  const [showReturnInput, setShowReturnInput] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [remindFeedback, setRemindFeedback] = useState<{
    title: string;
    ticketNumber: string;
    message: string;
    isSuccess: boolean;
  } | null>(null);

  // 引用回复状态
  const [quotedMessage, setQuotedMessage] = useState<MessageItem | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleQuoteMessage = (msg: MessageItem) => {
    setQuotedMessage(msg);
    textareaRef.current?.focus();
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 刷新当前手机号的所有会话并同步当前会话的最新状态
  const refreshSessions = async () => {
    try {
      const res = await clientFetchSessions(profile.contact_phone);
      setSessionsGroup(res);
      setCurrentSession((prev) => {
        if (!prev) return null;
        const all = [...(res.recent_open || []), ...(res.closed || [])];
        const updated = all.find((s) => s.id === prev.id);
        const next = updated ? { ...prev, ...updated } : prev;
        syncSessionToStorage(next);
        return next;
      });
      return res;
    } catch (err) {
      console.error("刷新会话失败:", err);
      return null;
    }
  };

  // 定时轮询：实时同步会话最新状态（如坐席端接入后 status 从 queue 变为 in_progress）及新消息
  // 核心保障：只要当前操作窗口未关闭，即便超过 10 分钟或更久，当前进行中会话也绝不自动降级或移入未关闭列表
  useEffect(() => {
    if (!currentSession?.id) return;
    if (currentSession.status === "closed" || currentSession.status === "converted") return;

    let isPolling = true;
    const intervalId = setInterval(async () => {
      try {
        const [sessionsRes, msgs] = await Promise.all([
          clientFetchSessions(profile.contact_phone),
          clientFetchMessages(currentSession.id),
        ]);

        if (!isPolling) return;

        setSessionsGroup(sessionsRes);
        const allSessions = [...(sessionsRes.recent_open || []), ...(sessionsRes.closed || [])];
        const updated = allSessions.find((s) => s.id === currentSession.id);
        if (updated) {
          setCurrentSession((prev) => {
            if (!prev) return updated;
            if (
              prev.status !== updated.status ||
              prev.agent_name !== updated.agent_name ||
              prev.updated_at !== updated.updated_at
            ) {
              const next = { ...prev, ...updated };
              syncSessionToStorage(next);
              return next;
            }
            return prev;
          });
        }

        if (msgs && msgs.length > 0) {
          setMessages((prev) => {
            if (
              msgs.length !== prev.length ||
              msgs[msgs.length - 1]?.id !== prev[prev.length - 1]?.id
            ) {
              setTimeout(scrollToBottom, 50);
              return msgs;
            }
            return prev;
          });
        }
      } catch {
        // 静默捕获
      }
    }, 2500);

    return () => {
      isPolling = false;
      clearInterval(intervalId);
    };
  }, [currentSession?.id, currentSession?.status, profile.contact_phone]);

  const loadTickets = async () => {
    if (!profile.contact_phone) return;
    setLoadingTickets(true);
    try {
      const list = await clientFetchTickets(profile.contact_phone);
      setTickets(list);
    } catch (err) {
      console.error("加载工单列表失败:", err);
    } finally {
      setLoadingTickets(false);
    }
  };

  const handleRemind = async (t: ClientTicketItem) => {
    try {
      const res = await clientRemindTicket(t.id, profile.contact_phone);
      setRemindFeedback({
        title: res.notified ? "催单成功" : "催单提示",
        ticketNumber: t.ticket_number,
        message: res.message,
        isSuccess: res.notified,
      });
    } catch (e: any) {
      setRemindFeedback({
        title: "催单提示",
        ticketNumber: t.ticket_number,
        message: e?.message || "催单请求已记录，工作人员正在加快处理中。",
        isSuccess: true,
      });
    }
  };

  const handleDoConfirm = async (t: ClientTicketItem) => {
    setActionLoading(true);
    try {
      const res = await clientConfirmTicket(t.id, profile.contact_phone, "confirm");
      setSelectedConfirmTicket(null);
      setRemindFeedback({
        title: "确认解决成功",
        ticketNumber: t.ticket_number,
        message: res.message,
        isSuccess: true,
      });
      await loadTickets();
      setTicketSubTab("closed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDoReturn = async (t: ClientTicketItem) => {
    setActionLoading(true);
    try {
      const res = await clientConfirmTicket(t.id, profile.contact_phone, "return", returnReason);
      setSelectedConfirmTicket(null);
      setShowReturnInput(false);
      setReturnReason("");
      setRemindFeedback({
        title: "退回跟进成功",
        ticketNumber: t.ticket_number,
        message: res.message,
        isSuccess: true,
      });
      await loadTickets();
      setTicketSubTab("processing");
    } finally {
      setActionLoading(false);
    }
  };

  // 初始化工作台：拉取会话列表、重要通知与工单信息
  useEffect(() => {
    let isMounted = true;
    const initData = async () => {
      try {
        const [sessionsRes, noticesRes, ticketsRes] = await Promise.all([
          clientFetchSessions(profile.contact_phone),
          clientFetchNotices().catch(() => []),
          clientFetchTickets(profile.contact_phone).catch(() => []),
        ]);

        if (!isMounted) return;
        setSessionsGroup(sessionsRes);
        if (ticketsRes) {
          setTickets(ticketsRes);
        }

        const validNotices = noticesRes || [];
        setNotices(validNotices);

        // 需求2：如果后端没有上架状态的消息（通知数为0），则默认选中客户信息；只要有≥1条信息，默认选中重要通知
        if (validNotices.length === 0) {
          setRightTab("profile");
        } else {
          setRightTab("notices");
          const popupNotice = validNotices.find((n) => n.popup_prompt);
          if (popupNotice) {
            setSelectedNotice(popupNotice);
          }
        }

        // 1. 尝试识别当前操作窗口绑定的活动会话（页面刷新/重载/未关闭窗口生命周期）
        let activeSessionInWindow = initialSession;
        if (!activeSessionInWindow) {
          try {
            const saved = sessionStorage.getItem(STORAGE_SESSION_KEY);
            if (saved) {
              const parsed = JSON.parse(saved);
              if (parsed && parsed.status !== "closed" && parsed.status !== "converted") {
                activeSessionInWindow = parsed;
              }
            }
          } catch {
            activeSessionInWindow = null;
          }
        }

        // 2. 如果当前窗口存在绑定的活动会话，且服务端属于未结束会话：
        // 核心规则：页面没有关闭前，进行中的会话（即便超过 10 分钟或页面刷新），绝不进入 24 小时未关闭会话列表，始终停留在「进行中会话」
        if (activeSessionInWindow) {
          const fresh =
            sessionsRes.recent_open.find((s) => s.id === activeSessionInWindow.id) ||
            sessionsRes.closed.find((s) => s.id === activeSessionInWindow.id);
          if (fresh && fresh.status !== "closed" && fresh.status !== "converted") {
            setCurrentSession(fresh);
            syncSessionToStorage(fresh);
            const msgs = await clientFetchMessages(fresh.id);
            if (isMounted) setMessages(msgs.length ? msgs : initialMessages);
            setTimeout(scrollToBottom, 50);
            return;
          } else if (!fresh) {
            // 如果刚从录入页建立会话或服务端尚未落库，优先激活当前窗口绑定的初始会话
            if (initialSession && initialSession.id === activeSessionInWindow.id) {
              setCurrentSession(initialSession);
              syncSessionToStorage(initialSession);
              if (initialMessages && initialMessages.length > 0) {
                setMessages(initialMessages);
              }
              setTimeout(scrollToBottom, 50);
              return;
            }
            sessionStorage.removeItem(STORAGE_SESSION_KEY);
            setCurrentSession(null);
          }
        }

        // 3. 只有在当前窗口真正被关闭后重新进入（即 sessionStorage 销毁，无活跃窗口绑定），且服务端存在 24 小时内未关闭会话：
        // 历史未结会话才进入「24小时内未关闭会话」列表，并触发系统助手未结会话提示
        const hasUnclosed = sessionsRes.recent_open && sessionsRes.recent_open.length > 0;
        const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);

        if (hasUnclosed) {
          // 存在 24 小时未关闭会话（窗口已关闭后重新进入）
          const promptMsg: MessageItem = {
            id: Date.now(),
            session_id: "SYSTEM_CHECK",
            sender_type: "system",
            sender_name: "系统助手",
            content:
              "您好！欢迎使用金蝶发票云在线支持，系统检测到你存在没有结束的会话，如果你要继续之前的会话，在右侧24小时未结束回话列表点击历史会话，可继续沟通，如需发起新的会话，可直接发送您遇到的问题",
            is_read: true,
            created_at: nowStr,
          };
          setCurrentSession(null);
          syncSessionToStorage(null);
          setMessages([promptMsg]);
        } else {
          // 不存在 24 小时未关闭会话
          const promptMsg: MessageItem = {
            id: Date.now(),
            session_id: "SYSTEM_WELCOME",
            sender_type: "system",
            sender_name: "系统助手",
            content:
              "你好，欢迎使用金蝶发票云在线支持，有什么可以帮助您？你可以直接给我发送您遇到的问题。",
            is_read: true,
            created_at: nowStr,
          };
          setCurrentSession(null);
          syncSessionToStorage(null);
          setMessages([promptMsg]);
        }
        setTimeout(scrollToBottom, 50);
      } catch (err) {
        console.error("加载客户端数据失败:", err);
      }
    };

    initData();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.contact_phone]);

  // 切换会话时加载其消息（若为未结束会话，则成为当前窗口绑定的活动会话）
  const handleSelectSession = async (session: SessionItem) => {
    setCurrentSession(session);
    syncSessionToStorage(session);
    setMobileDrawerTab("chat");
    setLoadingMessages(true);
    try {
      const msgs = await clientFetchMessages(session.id);
      setMessages(msgs);
      setTimeout(scrollToBottom, 50);
    } finally {
      setLoadingMessages(false);
    }
  };

  // 附件选择/拖拽
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

  // 剪贴板粘贴
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles: File[] = [];
    if (e.clipboardData?.items) {
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) clipboardFiles.push(file);
        }
      }
    }
    if (clipboardFiles.length > 0) {
      e.preventDefault();
      handleFiles(clipboardFiles);
    }
  };

  // 发送消息与附件：若当前没有进行中会话，则自动在后台生成一行新的会话记录
  const handleSendMessage = async () => {
    if ((!inputMessage.trim() && stagedAttachments.length === 0) || sending) {
      return;
    }

    if (currentSession && (currentSession.status === "closed" || currentSession.status === "converted")) {
      return;
    }

    setSending(true);
    try {
      let activeSession = currentSession;

      // 核心业务逻辑：若处于提示状态（未选中历史会话），客户直接发送新消息则在后端生成新会话记录
      if (!activeSession) {
        const initRes = await clientInitSession({
          contact_name: profile.contact_name,
          contact_phone: profile.contact_phone,
          company_name: profile.company_name,
          tax_no: profile.tax_no,
          tenant_name: profile.tenant_name,
          tenant_no: profile.tenant_no,
          purchased_products: profile.purchased_products,
          is_historical: profile.is_historical,
        });

        activeSession = initRes.session;
        setCurrentSession(activeSession);
        syncSessionToStorage(activeSession);
      }

      // 发送文本消息
      if (inputMessage.trim()) {
        let textToSend = inputMessage.trim();
        if (quotedMessage) {
          const quoteSender =
            quotedMessage.sender_name ||
            (quotedMessage.sender_type === "customer" ? "客户" : "客服");
          const quoteContent = quotedMessage.content.replace(/\n/g, " ").slice(0, 100);
          textToSend = `「引用 ${quoteSender}: ${quoteContent}」\n${textToSend}`;
        }
        try {
          const textMsg = await clientSendMessage(
            activeSession.id,
            textToSend,
            profile.contact_name
          );
          setMessages((prev) => [...prev, textMsg]);
          setQuotedMessage(null);
        } catch (sendErr: any) {
          // 如果发送消息报会话不存在（比如本地旧的异常假会话），则自动重新初始化真实会话并重试发送！
          if (
            sendErr?.status === 404 ||
            sendErr?.message?.includes("会话不存在") ||
            sendErr?.message?.includes("404")
          ) {
            const reInit = await clientInitSession({
              contact_name: profile.contact_name,
              contact_phone: profile.contact_phone,
              company_name: profile.company_name,
              tax_no: profile.tax_no,
              tenant_name: profile.tenant_name,
              tenant_no: profile.tenant_no,
              purchased_products: profile.purchased_products,
              is_historical: false,
            });
            activeSession = reInit.session;
            setCurrentSession(activeSession);
            syncSessionToStorage(activeSession);
            const retryMsg = await clientSendMessage(
              activeSession.id,
              textToSend,
              profile.contact_name
            );
            setMessages((prev) => [...prev, retryMsg]);
            setQuotedMessage(null);
          } else {
            throw sendErr;
          }
        }
      }

      // 发送附件
      if (stagedAttachments.length > 0) {
        for (const att of stagedAttachments) {
          const content =
            att.isImage && att.dataUrl
              ? `[图片: ${att.name}]\n${att.dataUrl}`
              : `[文件: ${att.name} (${formatFileSize(att.size)})]`;
          const attMsg = await clientSendMessage(
            activeSession.id,
            content,
            profile.contact_name
          );
          setMessages((prev) => [...prev, attMsg]);
        }
      }

      setInputMessage("");
      setStagedAttachments([]);
      setTimeout(scrollToBottom, 50);
      await refreshSessions();
    } catch (err) {
      console.error("发送消息失败:", err);
      alert("消息发送失败，请重试");
    } finally {
      setSending(false);
    }
  };

  // 结束会话
  const handleCloseSession = async () => {
    if (!currentSession) return;
    if (!window.confirm("确定要结束当前会话吗？结束后可对本次服务进行评价。")) return;
    try {
      await clientCloseSession(currentSession.id);
      const closed: SessionItem = { ...currentSession, status: "closed" as const };
      setCurrentSession(closed);
      syncSessionToStorage(closed);
      const newMsgs = await clientFetchMessages(currentSession.id);
      setMessages(newMsgs);
      await refreshSessions();
      setEvaluationModalOpen(true);
    } catch (err) {
      console.error("结束会话失败:", err);
      alert("结束会话失败，请重试");
    }
  };

  // 提交服务评价
  const handleSubmitEvaluation = async (evaluation: ClientEvaluationPayload) => {
    if (!currentSession) return;
    await clientEvaluateSession(currentSession.id, evaluation);
    const newMsgs = await clientFetchMessages(currentSession.id);
    setMessages(newMsgs);
    setTimeout(scrollToBottom, 50);
  };

  // 解析并渲染消息内容（支持引用、图片/文件/文本，字体加2个号）
  const renderMessageContent = (content: string, isCustomer: boolean) => {
    // 检查是否包含引用：格式为 「引用 发送人: 引用内容」\n回复正文
    const quoteMatch = content.match(/^「引用\s+([^:：]+)[:：]\s*([\s\S]*?)」\n([\s\S]*)$/);

    const renderBody = (body: string) => {
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
              className="max-w-[280px] max-h-[200px] rounded-lg object-cover cursor-zoom-in border border-black/10 hover:opacity-95 transition"
            />
            <div className="text-[12px] opacity-80 flex items-center gap-1">
              <span>🖼️</span>
              <span className="truncate max-w-[240px]" title={imgName}>
                {imgName}
              </span>
            </div>
          </div>
        );
      }

      if (body.startsWith("data:image/")) {
        return (
          <img
            src={body}
            alt="图片"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewImage(body);
            }}
            className="max-w-[280px] max-h-[200px] rounded-lg object-cover cursor-zoom-in border border-black/10 hover:opacity-95 transition"
          />
        );
      }

      const fileMatch = body.match(/^\[文件:\s*([^\]]+)\]/);
      if (fileMatch) {
        const fileInfo = fileMatch[1];
        return (
          <div
            className={`flex items-center gap-2.5 p-3 rounded-lg border ${
              isCustomer
                ? "bg-white/20 border-white/30 text-white"
                : "bg-slate-50 border-slate-200 text-slate-800"
            }`}
          >
            <span className="text-2xl">📄</span>
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
        <div className="space-y-2">
          <div
            className={`text-[12px] px-2.5 py-1.5 rounded-md border-l-2 mb-1.5 ${
              isCustomer
                ? "bg-black/15 border-white/70 text-white/90"
                : "bg-slate-100 border-[rgb(35,94,212)] text-slate-600"
            }`}
          >
            <div className="font-semibold text-[11px] opacity-80 mb-0.5">
              引用 {quoteSender}
            </div>
            <div className="line-clamp-2 truncate text-[12px] opacity-90">
              {quoteText}
            </div>
          </div>
          <div>{renderBody(replyBody)}</div>
        </div>
      );
    }

    return renderBody(content);
  };

  const isClosed =
    currentSession !== null &&
    (currentSession.status === "closed" || currentSession.status === "converted");

  // 左侧“24小时内未关闭会话”列表过滤掉正在进行中的会话
  const otherRecentOpenSessions = currentSession
    ? sessionsGroup.recent_open.filter((s) => s.id !== currentSession.id)
    : sessionsGroup.recent_open;

  return (
    <div className="h-screen w-screen bg-slate-100 flex flex-col font-hub overflow-hidden select-none">
      {/* 顶部全局导航栏 */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20 flex-none shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[rgb(35,94,212)] text-white flex items-center justify-center font-bold text-sm shadow-xs">
            云
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-slate-800 leading-tight">
              发票云售后在线支持
            </h1>
          </div>
        </div>

        {/* 移动端切换 Tab 按钮 */}
        <div className="flex md:hidden items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setMobileDrawerTab("info")}
            className={`px-2.5 py-1 rounded-md transition ${
              mobileDrawerTab === "info"
                ? "bg-white text-[rgb(35,94,212)] font-bold shadow-2xs"
                : "text-slate-600"
            }`}
          >
            通知/信息
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawerTab("chat")}
            className={`px-2.5 py-1 rounded-md transition ${
              mobileDrawerTab === "chat"
                ? "bg-white text-[rgb(35,94,212)] font-bold shadow-2xs"
                : "text-slate-600"
            }`}
          >
            沟通区
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawerTab("list")}
            className={`px-2.5 py-1 rounded-md transition ${
              mobileDrawerTab === "list"
                ? "bg-white text-[rgb(35,94,212)] font-bold shadow-2xs"
                : "text-slate-600"
            }`}
          >
            会话列表
          </button>
        </div>

        {/* 右侧客户身份与返回 */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-[14px] text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="font-medium text-slate-800">{profile.contact_name}</span>
            <span className="text-slate-400 font-mono">({profile.contact_phone})</span>
          </div>
          <button
            type="button"
            onClick={onBackToLogin}
            className="text-[13px] text-slate-600 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded px-3 py-1 transition cursor-pointer"
          >
            切换身份
          </button>
        </div>
      </header>

      {/* 3 栏主体结构 */}
      <div className="flex-1 flex overflow-hidden">
        {/* ================================================================= */}
        {/* 1. 左侧：信息展示区（重要通知、客户信息，默认选中重要通知） */}
        {/* ================================================================= */}
        <aside
          className={`w-full md:w-[500px] flex-none bg-white border-r border-slate-200 flex flex-col z-10 ${
            mobileDrawerTab === "info" ? "flex" : "hidden md:flex"
          }`}
        >
          {/* 顶部多标签切换 Table：调整顺序为：客户信息、重要通知、工单信息 */}
          <div className="h-12 border-b border-slate-200 bg-slate-50/80 px-4 flex items-center gap-6 flex-none">
            <button
              type="button"
              onClick={() => setRightTab("profile")}
              className={`h-full border-b-2 text-[15px] font-bold transition cursor-pointer flex items-center gap-2 ${
                rightTab === "profile"
                  ? "border-[rgb(35,94,212)] text-[rgb(35,94,212)]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>🏢 客户信息</span>
            </button>

            <button
              type="button"
              onClick={() => setRightTab("notices")}
              className={`h-full border-b-2 text-[15px] font-bold transition cursor-pointer flex items-center gap-2 ${
                rightTab === "notices"
                  ? "border-[rgb(35,94,212)] text-[rgb(35,94,212)]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>📢 重要通知</span>
              {notices.filter((n) => n.is_important).length > 0 && (
                <span className="bg-rose-500 text-white text-[11px] px-1.5 py-0.2 rounded-full font-mono font-medium">
                  {notices.filter((n) => n.is_important).length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setRightTab("tickets")}
              className={`h-full border-b-2 text-[15px] font-bold transition cursor-pointer flex items-center gap-2 ${
                rightTab === "tickets"
                  ? "border-[rgb(35,94,212)] text-[rgb(35,94,212)]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>📋 工单信息</span>
              {tickets.filter((t) => ["processing", "reviewing"].includes(t.client_category || t.category || "")).length > 0 && (
                <span className="bg-amber-500 text-white text-[11px] px-1.5 py-0.2 rounded-full font-mono font-medium">
                  {tickets.filter((t) => ["processing", "reviewing"].includes(t.client_category || t.category || "")).length}
                </span>
              )}
            </button>
          </div>

          {/* 1.1 Tab 1：客户与企业信息展示 */}
          {rightTab === "profile" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-white">
              {/* 企业信息卡片 */}
              <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-slate-500 uppercase tracking-wider">
                    咨询企业
                  </span>
                  <span className="text-[12px] text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded border border-teal-200 font-medium">
                    {currentSession?.is_in_service || "服务期内"}
                  </span>
                </div>
                <div className="text-[16px] font-bold text-slate-900 leading-snug break-words">
                  {currentSession?.company_name || profile.company_name}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px] pt-1">
                  <div className="text-slate-600 font-mono">
                    <span className="text-slate-400">统一信用代码: </span>
                    <span className="font-semibold text-slate-800">
                      {currentSession?.tax_no || profile.tax_no || "—"}
                    </span>
                  </div>
                  <div className="text-slate-600">
                    <span className="text-slate-400">归属租户: </span>
                    <span className="font-medium text-slate-800">
                      {currentSession?.tenant_name || profile.tenant_name || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 咨询人与联系方式 */}
              <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/90 space-y-3">
                <div className="text-[12.5px] font-semibold text-slate-500 uppercase tracking-wider">
                  咨询人信息
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[14px]">
                  <div>
                    <span className="text-slate-400 text-[13px] block mb-0.5">咨询人姓名</span>
                    <span className="font-medium text-slate-800">
                      {currentSession?.contact_name || profile.contact_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[13px] block mb-0.5">联系电话</span>
                    <span className="font-mono font-medium text-slate-800">
                      {currentSession?.contact_phone || profile.contact_phone}
                    </span>
                  </div>
                </div>
              </div>

              {/* 已购发票云产品 */}
              <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200/90 space-y-2.5">
                <div className="text-[12.5px] font-semibold text-slate-500 uppercase tracking-wider">
                  已购产品与服务模块
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    currentSession?.purchased_products ||
                    profile.purchased_products || [
                      "发票云标准版",
                      "数电发票乐企直连模块",
                      "自动勾选认证插件",
                    ]
                  ).map((p) => (
                    <span
                      key={p}
                      className="inline-block px-3 py-1 rounded-lg text-[13px] bg-white text-slate-800 border border-slate-200 shadow-2xs font-medium"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 1.2 Tab 2：重要通知卡片列表（标题、部分内容、特别重要加标签，点击弹窗看完整内容） */}
          {rightTab === "notices" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/40">
              {notices.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[260px] text-slate-400 py-12 select-none">
                  <div className="text-4xl mb-2 opacity-40">📢</div>
                  <div className="text-[14px] font-medium text-slate-500">暂无重要通知</div>
                  <div className="text-[12px] text-slate-400 mt-1">当前没有上架生效的重要通知</div>
                </div>
              ) : (
                notices.map((notice) => (
                  <div
                    key={notice.id}
                    onClick={() => setSelectedNotice(notice)}
                    className="p-4 bg-white rounded-xl border border-slate-200/90 hover:border-[rgb(35,94,212)]/60 hover:shadow-md cursor-pointer transition space-y-2.5 group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[15px] font-bold text-slate-800 group-hover:text-[rgb(35,94,212)] transition leading-snug line-clamp-1">
                        {notice.title}
                      </h3>
                      {notice.is_important && (
                        <span className="flex-none px-2 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[12px] font-bold flex items-center gap-1 shadow-2xs">
                          <span>⚡</span>
                          <span>重要</span>
                        </span>
                      )}
                    </div>

                    <p className="text-[13px] text-[#666666] line-clamp-2 leading-relaxed">
                      {notice.content.replace(/<[^>]+>/g, "").trim()}
                    </p>

                    <div className="flex items-center justify-between text-[12px] text-slate-400 pt-1.5 border-t border-slate-100">
                      <span className="font-mono">{notice.publish_time}</span>
                      <span className="text-[rgb(35,94,212)] font-medium group-hover:underline">
                        查看完整通知 &gt;
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 1.3 Tab 3：工单信息（二级切换菜单：处理中、待确认、已关闭；固定表头列表） */}
          {rightTab === "tickets" && (
            <div className="flex-1 flex flex-col min-h-0 bg-white">
              {/* 二级切换菜单：处理中、已答复待确认、已关闭（水平占满宽度，字号13px） */}
              <div className="grid grid-cols-3 gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex-none w-full">
                <button
                  type="button"
                  onClick={() => setTicketSubTab("processing")}
                  className={`w-full py-2 px-1 text-[13px] font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    ticketSubTab === "processing"
                      ? "bg-[rgb(35,94,212)] text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span>处理中</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[11px] ${
                      ticketSubTab === "processing"
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tickets.filter((t) => (t.client_category || t.category) === "processing").length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setTicketSubTab("reviewing")}
                  className={`w-full py-2 px-1 text-[13px] font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    ticketSubTab === "reviewing"
                      ? "bg-[rgb(35,94,212)] text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span className="truncate">已答复待确认</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[11px] flex-none ${
                      ticketSubTab === "reviewing"
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tickets.filter((t) => (t.client_category || t.category) === "reviewing").length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setTicketSubTab("closed")}
                  className={`w-full py-2 px-1 text-[13px] font-semibold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    ticketSubTab === "closed"
                      ? "bg-[rgb(35,94,212)] text-white shadow-2xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span>已关闭</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[11px] ${
                      ticketSubTab === "closed"
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tickets.filter((t) => (t.client_category || t.category) === "closed").length}
                  </span>
                </button>
              </div>

              {/* 工单列表展示区：固定表头，列表内部横纵双向自适应滚动 */}
              <div className="flex-1 overflow-auto">
                {tickets.filter((t) => (t.client_category || t.category) === ticketSubTab).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full min-h-[220px] text-slate-400 py-12 select-none">
                    <div className="text-3xl mb-2 opacity-40">📋</div>
                    <div className="text-[13px] font-medium text-slate-500">
                      暂无{ticketSubTab === "processing" ? "处理中" : ticketSubTab === "reviewing" ? "已答复待确认" : "已关闭"}工单
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">当前联系人暂无此状态工单记录</div>
                  </div>
                ) : (
                  <table className="w-full min-w-[480px] border-collapse text-left text-[12px]">
                    <thead className="sticky top-0 bg-slate-100 z-10 border-b border-slate-200 text-slate-600 font-semibold shadow-2xs text-[12px]">
                      <tr>
                        <th className="py-3 px-3 whitespace-nowrap">工单号</th>
                        <th className="py-3 px-3 whitespace-nowrap">提单渠道</th>
                        <th className="py-3 px-3 whitespace-nowrap">处理人</th>
                        <th className="py-3 px-3 whitespace-nowrap">提单时间</th>
                        <th className="py-3 px-3 text-center whitespace-nowrap">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[12px]">
                      {tickets
                        .filter((t) => (t.client_category || t.category) === ticketSubTab)
                        .map((ticket) => (
                          <tr key={ticket.id} className="hover:bg-slate-50/80 transition">
                            <td
                              className="py-3.5 px-3 max-w-[150px] align-top"
                              title={ticket.source_ticket_id || ticket.ticket_number}
                            >
                              <div className="font-mono font-semibold text-slate-900 leading-snug line-clamp-1">
                                {ticket.source_ticket_id || ticket.ticket_number}
                              </div>
                              {ticket.title && (
                                <div
                                  className="text-[12px] text-slate-400 font-normal truncate mt-1 leading-normal"
                                  title={ticket.title}
                                >
                                  {ticket.title.length > 12 ? `${ticket.title.slice(0, 12)}...` : ticket.title}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-3 whitespace-nowrap align-top">
                              <span className="inline-block px-2 py-0.5 rounded text-[12px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                {ticket.source_name || ticket.source_code || "客户渠道"}
                              </span>
                            </td>
                            <td className="py-3.5 px-3 whitespace-nowrap text-slate-700 align-top">
                              <div className="font-medium text-slate-800 leading-snug">
                                {ticket.handler_display_name || ticket.handler_name}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-1">
                                {ticket.process_stage || (ticket.stage === "rd" ? "产研环节" : "服务环节")}
                              </div>
                            </td>
                            <td className="py-3.5 px-3 whitespace-nowrap font-mono text-[12px] text-slate-500 align-top">
                              {ticket.created_at}
                            </td>
                            <td className="py-3.5 px-3 whitespace-nowrap text-center align-top">
                              {(ticket.client_category || ticket.category) === "processing" && (
                                <button
                                  type="button"
                                  onClick={() => handleRemind(ticket)}
                                  className="px-3 py-1.5 text-[12px] font-semibold rounded bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100 transition cursor-pointer shadow-2xs"
                                >
                                  催单
                                </button>
                              )}
                              {(ticket.client_category || ticket.category) === "reviewing" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedConfirmTicket(ticket);
                                    setShowReturnInput(false);
                                    setReturnReason("");
                                  }}
                                  className="px-3 py-1.5 text-[12px] font-semibold rounded bg-[rgb(35,94,212)] text-white hover:opacity-90 transition cursor-pointer shadow-2xs"
                                >
                                  查看确认
                                </button>
                              )}
                              {(ticket.client_category || ticket.category) === "closed" && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedViewTicket(ticket)}
                                  className="px-3 py-1.5 text-[12px] font-semibold rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition cursor-pointer"
                                >
                                  查看
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* ================================================================= */}
        {/* 2. 中间：信息查看和发送沟通区（两侧为500px，中间同步缩小自适应） */}
        {/* ================================================================= */}
        <main
          className={`flex-1 min-w-0 flex flex-col bg-slate-50/60 overflow-hidden ${
            mobileDrawerTab === "chat" ? "flex" : "hidden md:flex"
          }`}
        >
          {/* 中间头部：会话信息与【结束】、【评价】操作栏 */}
          <div className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 flex-none shadow-2xs">
            <div className="flex items-center gap-3">
              {currentSession ? (
                <>
                  <span className="text-[15px] font-mono font-bold text-slate-800">
                    会话: {currentSession.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[12.5px] font-medium ${
                      currentSession.status === "in_progress"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : isClosed
                        ? "bg-slate-100 text-slate-600 border border-slate-200"
                        : "bg-cyan-50 text-cyan-700 border border-cyan-200"
                    }`}
                  >
                    {currentSession.status === "in_progress"
                      ? "坐席在线沟通中"
                      : isClosed
                      ? "已结束（只读）"
                      : "排队中，客服正接入..."}
                  </span>
                  <span className="hidden sm:inline text-[13px] text-slate-400">
                    接待人: {currentSession.agent_name || "在线待分配"}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[15px] font-bold text-slate-800">
                    发票云在线支持 · 准备咨询
                  </span>
                  <span className="px-2 py-0.5 rounded text-[12.5px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    在线客服随时就绪
                  </span>
                </>
              )}
            </div>

            {/* 顶部操作按钮：结束、评价 */}
            <div className="flex items-center gap-2">
              {currentSession && !isClosed && (
                <button
                  type="button"
                  onClick={handleCloseSession}
                  className="px-3.5 py-1 border border-rose-300 text-rose-600 rounded-md text-[13px] font-medium hover:bg-rose-50 cursor-pointer transition shadow-2xs"
                >
                  结束会话
                </button>
              )}

              {currentSession && (
                <button
                  type="button"
                  onClick={() => setEvaluationModalOpen(true)}
                  className={`px-3.5 py-1 rounded-md text-[13px] font-medium cursor-pointer transition shadow-2xs ${
                    isClosed
                      ? "bg-[rgb(35,94,212)] text-white hover:opacity-90"
                      : "border border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  ⭐ 服务评价
                </button>
              )}
            </div>
          </div>

          {/* 对话消息流展示区（字体整体加2个号） */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingMessages ? (
              <div className="text-center py-16 text-slate-400 text-[14px]">加载历史消息中...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-[14px]">暂无对话记录</div>
            ) : (
              messages.map((msg) => {
                const isCustomer = msg.sender_type === "customer";
                const isSystem = msg.sender_type === "system";

                if (isSystem) {
                  return (
                    <div key={msg.id} className="text-center my-3">
                      <span className="inline-block px-4 py-2 rounded-xl text-[13px] bg-blue-50/90 text-slate-700 border border-blue-100 max-w-[90%] leading-relaxed shadow-2xs text-left">
                        {msg.content}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col group ${isCustomer ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-2 mb-1 text-[12.5px] text-slate-400">
                      <span>{isCustomer ? "我" : `客服 · ${msg.sender_name}`}</span>
                      <span>{msg.created_at.slice(11, 16)}</span>
                    </div>
                    <div
                      onClick={() => {
                        if (!isCustomer && !isClosed) {
                          handleQuoteMessage(msg);
                        }
                      }}
                      className={`relative max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-xl text-[14px] leading-relaxed shadow-2xs whitespace-pre-wrap transition ${
                        isCustomer
                          ? "bg-[rgb(35,94,212)] text-white rounded-tr-none"
                          : "bg-white text-slate-800 border border-slate-200/90 rounded-tl-none hover:border-[rgb(35,94,212)]/50 cursor-pointer"
                      } ${
                        quotedMessage?.id === msg.id
                          ? "ring-2 ring-[rgb(35,94,212)] border-[rgb(35,94,212)]"
                          : ""
                      }`}
                      title={!isCustomer && !isClosed ? "点击可引用回复此消息" : undefined}
                    >
                      <div>{renderMessageContent(msg.content, isCustomer)}</div>

                      {/* 对应消息右下角：引用回复操作按钮 */}
                      {!isCustomer && !isClosed && (
                        <div className="flex justify-end mt-2 pt-1.5 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuoteMessage(msg);
                            }}
                            className={`inline-flex items-center gap-1 text-[11.5px] rounded px-2 py-0.5 font-medium transition cursor-pointer shadow-2xs ${
                              quotedMessage?.id === msg.id
                                ? "bg-[rgb(35,94,212)] text-white border border-[rgb(35,94,212)]"
                                : "text-[rgb(35,94,212)] hover:text-blue-700 bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80"
                            }`}
                            title="引用此消息"
                            aria-label="引用此消息"
                          >
                            <svg
                              className="w-3.5 h-3.5"
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

          {/* 底部信息录入区 */}
          {isClosed ? (
            <div className="p-4 bg-slate-100 border-t border-slate-200 text-center space-y-2 flex-none">
              <p className="text-[14px] text-slate-600">
                当前会话已结束。如需发起新的咨询，请直接在下方发送新问题自动建立新会话。
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentSession(null);
                    syncSessionToStorage(null);
                    setMessages([
                      {
                        id: Date.now(),
                        session_id: "SYSTEM_NEW",
                        sender_type: "system",
                        sender_name: "系统助手",
                        content:
                          "你好，欢迎使用金蝶发票云在线支持，有什么可以帮助您？你可以直接给我发送您遇到的问题。",
                        is_read: true,
                        created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
                      },
                    ]);
                  }}
                  className="px-4 py-1.5 bg-[rgb(35,94,212)] text-white rounded-md text-[13px] font-medium hover:opacity-90 cursor-pointer shadow-xs transition"
                >
                  咨询新问题
                </button>
                <button
                  type="button"
                  onClick={() => setEvaluationModalOpen(true)}
                  className="px-4 py-1.5 border border-slate-300 text-slate-700 bg-white rounded-md text-[13px] font-medium hover:bg-slate-50 cursor-pointer transition shadow-2xs"
                >
                  服务满意度评价
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-white border-t border-slate-200 flex flex-col gap-2 flex-none">
              {/* 工具栏：附件按钮 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title="添加附件（支持图片、文件；也可直接拖拽至录入框或 Ctrl+V 粘贴）"
                    aria-label="添加附件"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-slate-600 hover:text-[rgb(35,94,212)] hover:bg-blue-50 transition cursor-pointer text-[13px]"
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
                  <span className="text-[12.5px] text-[#666666]">
                    支持勾选、拖拽或 Ctrl+V 粘贴图片与文档
                  </span>
                </div>
              </div>

              {/* 暂存附件列表 */}
              {stagedAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 bg-slate-50 rounded border border-slate-200">
                  {stagedAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded text-[13px] shadow-2xs"
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
                        className="max-w-[160px] truncate text-slate-700 font-medium text-[12px]"
                        title={att.name}
                      >
                        {att.name}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
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
                <div className="flex items-center justify-between px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-md text-[13px] text-slate-700">
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-[rgb(35,94,212)] font-semibold flex-none text-[12px]">
                      💬 引用 {quotedMessage.sender_name || (quotedMessage.sender_type === "customer" ? "客户" : "客服")}:
                    </span>
                    <span className="truncate text-slate-600 text-[12px] max-w-[360px] md:max-w-[500px]">
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

              {/* 录入框容器 */}
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
                  onChange={(e) => setInputMessage(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="请输入您遇到的问题，按 Enter 快捷发送，Shift+Enter 换行；支持拖拽或 Ctrl+V 粘贴截图与文件..."
                  className="w-full h-[95px] min-h-[95px] resize-none border border-slate-200 rounded-md p-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[rgb(35,94,212)] focus:ring-1 focus:ring-[rgb(35,94,212)]/30"
                />

                {isDragging && (
                  <div className="absolute inset-0 bg-blue-50/90 border-2 border-dashed border-[rgb(35,94,212)] rounded-md flex items-center justify-center pointer-events-none text-[14px] font-medium text-[rgb(35,94,212)]">
                    松开鼠标即可添加附件或图片
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-[#666666]">
                  按 Enter 快捷发送，Shift + Enter 换行
                </span>
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={(!inputMessage.trim() && stagedAttachments.length === 0) || sending}
                  className="px-6 py-1.5 bg-[rgb(35,94,212)] text-white text-[14px] font-semibold rounded-lg hover:opacity-90 transition cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? "发送中..." : "发送"}
                </button>
              </div>
            </div>
          )}
        </main>

        {/* ================================================================= */}
        {/* 3. 右侧：会话列表（宽度调整为 300px，增加折叠/展开图标，与分类明确区分） */}
        {/* ================================================================= */}
        <aside
          className={`w-full md:w-[300px] flex-none bg-white border-l border-slate-200 flex flex-col z-10 transition-all ${
            mobileDrawerTab === "list" ? "flex" : "hidden md:flex"
          }`}
        >
          {/* 会话分组列表（折叠/展开菜单体系） */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-3 text-[13px]">
            {/* 3.1 进行中会话（默认展开） */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => toggleSection("ongoing")}
                className="w-full px-2.5 py-1.5 bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 rounded-lg flex items-center justify-between text-left transition cursor-pointer select-none group shadow-2xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-slate-500 group-hover:text-slate-800 transition-transform duration-200 inline-block text-[11px] ${
                      expandedSections.ongoing ? "rotate-0" : "-rotate-90"
                    }`}
                  >
                    ▼
                  </span>
                  <span className="text-[14px] font-bold text-[rgb(72,80,95)]">进行中会话</span>
                </div>
                {currentSession && !isClosed ? (
                  <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono text-[11px] border border-emerald-200 font-medium">
                    当前活跃
                  </span>
                ) : (
                  <span className="bg-slate-200/70 text-slate-500 px-1.5 py-0.2 rounded font-mono text-[11px]">
                    0
                  </span>
                )}
              </button>

              {expandedSections.ongoing && (
                <div className="mt-1.5 ml-2 pl-2 border-l-2 border-slate-200/90 space-y-1.5">
                  {currentSession && !isClosed ? (
                    <div className="p-2.5 rounded-lg border border-[rgb(35,94,212)] bg-blue-50/80 text-slate-800 shadow-2xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-slate-900 text-[13px]">
                          {currentSession.id}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                            currentSession.status === "in_progress"
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-cyan-100 text-cyan-800 border border-cyan-300"
                          }`}
                        >
                          {currentSession.status === "in_progress" ? "服务中" : "排队中"}
                        </span>
                      </div>
                      <div
                        className="text-[13px] text-slate-600 truncate block"
                        title={currentSession.last_message || "正在沟通中..."}
                      >
                        {currentSession.last_message || "正在沟通中..."}
                      </div>
                      <div className="text-[12px] text-slate-400 font-mono">
                        {formatSessionTime(currentSession.created_at)}
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-2.5 text-center text-slate-400 text-[13px] bg-slate-50/70 rounded-lg border border-dashed border-slate-200">
                      暂无进行中会话
                      <div className="text-[11.5px] text-slate-400 mt-0.5">（发送新问题自动开启）</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3.2 24小时内未关闭会话 */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => toggleSection("unclosed")}
                className="w-full px-2.5 py-1.5 bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 rounded-lg flex items-center justify-between text-left transition cursor-pointer select-none group shadow-2xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-slate-500 group-hover:text-slate-800 transition-transform duration-200 inline-block text-[11px] ${
                      expandedSections.unclosed ? "rotate-0" : "-rotate-90"
                    }`}
                  >
                    ▼
                  </span>
                  <span className="text-[14px] font-bold text-[rgb(72,80,95)]">24小时内未关闭会话</span>
                </div>
                <span className="bg-blue-50 text-[rgb(35,94,212)] px-1.5 py-0.5 rounded font-mono text-[11px] border border-blue-200/70 font-semibold">
                  {otherRecentOpenSessions.length}
                </span>
              </button>

              {expandedSections.unclosed && otherRecentOpenSessions.length > 0 && (
                <div className="mt-1.5 ml-2 pl-2 border-l-2 border-slate-200/90 space-y-1.5">
                  {otherRecentOpenSessions.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectSession(item)}
                      className="p-2.5 rounded-lg border border-slate-200 hover:border-[rgb(35,94,212)]/60 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer transition space-y-1 shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-slate-800 text-[13px]">
                          {item.id}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                          未关闭
                        </span>
                      </div>
                      <div
                        className="text-[13px] text-slate-500 truncate block"
                        title={item.last_message || "会话记录"}
                      >
                        {item.last_message || "会话记录"}
                      </div>
                      <div className="text-[12px] text-slate-400 font-mono">
                        {formatSessionTime(item.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3.3 已结束会话 */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => toggleSection("closed")}
                className="w-full px-2.5 py-1.5 bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 rounded-lg flex items-center justify-between text-left transition cursor-pointer select-none group shadow-2xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-slate-500 group-hover:text-slate-800 transition-transform duration-200 inline-block text-[11px] ${
                      expandedSections.closed ? "rotate-0" : "-rotate-90"
                    }`}
                  >
                    ▼
                  </span>
                  <span className="text-[14px] font-bold text-[rgb(72,80,95)]">已结束会话</span>
                </div>
                <span className="bg-slate-200/70 text-slate-600 px-1.5 py-0.5 rounded font-mono text-[11px] border border-slate-300/70 font-semibold">
                  {sessionsGroup.closed.length}
                </span>
              </button>

              {expandedSections.closed && sessionsGroup.closed.length > 0 && (
                <div className="mt-1.5 ml-2 pl-2 border-l-2 border-slate-200/90 space-y-1.5">
                  {sessionsGroup.closed.map((item) => {
                    const isSelected = currentSession?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleSelectSession(item)}
                        className={`p-2.5 rounded-lg border text-[13px] cursor-pointer transition space-y-1 ${
                          isSelected
                            ? "bg-slate-200/70 border-slate-400 text-slate-900 shadow-2xs"
                            : "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-600 shadow-2xs"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-slate-700 text-[13px]">{item.id}</span>
                          <span className="px-1.5 py-0.2 rounded text-[11px] bg-slate-100 text-slate-500 border border-slate-200">
                            {item.status === "converted" ? "已转工单" : "已结束"}
                          </span>
                        </div>
                        <div
                          className="text-[13px] text-slate-400 truncate block"
                          title={item.last_message || "咨询已结束"}
                        >
                          {item.last_message || "咨询已结束"}
                        </div>
                        <div className="text-[12px] text-slate-400 font-mono">
                          {formatSessionTime(item.closed_at || item.created_at)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* 重要通知完整内容弹窗（居中，宽度 800px，高度 1000px） */}
      {selectedNotice && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedNotice(null)}
        >
          <div
            className="relative w-full max-w-[800px] md:w-[800px] h-[1000px] max-h-[95vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-200 bg-slate-50/50 flex-none">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {selectedNotice.is_important && (
                    <span className="px-2.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-200 rounded text-[12px] font-bold">
                      ⚡ 重要通知
                    </span>
                  )}
                  <span className="text-[12px] text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-medium">
                    {selectedNotice.category || "系统维护"}
                  </span>
                </div>
                <h2 className="text-[20px] font-bold text-slate-900 leading-snug">
                  {selectedNotice.title}
                </h2>
                <div className="text-[13px] text-slate-500 font-mono flex items-center gap-4">
                  <span>发布时间: {selectedNotice.publish_time}</span>
                  {selectedNotice.publisher && <span>发布方: {selectedNotice.publisher}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNotice(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center text-sm cursor-pointer transition flex-none"
              >
                ✕
              </button>
            </div>

            {/* 弹窗正文（自适应滚动，支持富文本/HTML格式） */}
            <div
              className="flex-1 overflow-y-auto p-8 text-[15px] text-slate-700 leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: selectedNotice.content }}
            />

            {/* 弹窗底部操作 */}
            <div className="border-t border-slate-200 px-6 py-4 flex justify-end bg-slate-50 flex-none">
              <button
                type="button"
                onClick={() => setSelectedNotice(null)}
                className="px-6 py-2 bg-[rgb(35,94,212)] text-white rounded-lg text-[14px] font-medium hover:opacity-90 transition cursor-pointer shadow-xs"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 评价弹窗 */}
      {currentSession && (
        <CustomerEvaluationModal
          isOpen={evaluationModalOpen}
          sessionId={currentSession.id}
          onClose={() => setEvaluationModalOpen(false)}
          onSubmit={handleSubmitEvaluation}
        />
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
      {/* 催单与工单操作反馈模态窗 */}
      {remindFeedback && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-[500px] max-w-[95vw] -translate-y-[40px] shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 text-[rgb(35,94,212)] flex items-center justify-center text-2xl">
                {remindFeedback.isSuccess ? "🔔" : "ℹ️"}
              </div>
              <h3 className="text-[15px] font-bold text-slate-900">{remindFeedback.title}</h3>
              <p className="text-[13px] text-slate-500 font-mono">工单号: {remindFeedback.ticketNumber}</p>
              <div className="text-[13px] text-slate-600 bg-slate-50 p-3.5 rounded-lg border border-slate-100 leading-relaxed text-left">
                {remindFeedback.message}
              </div>
            </div>
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-center">
              <button
                type="button"
                onClick={() => setRemindFeedback(null)}
                className="w-full py-2 bg-[rgb(35,94,212)] text-white rounded-lg text-[13px] font-medium hover:opacity-90 transition cursor-pointer shadow-2xs"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 待确认工单：查看确认与退回模态窗 */}
      {selectedConfirmTicket && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-[500px] max-w-[95vw] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between flex-none">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    待确认
                  </span>
                  <span className="text-xs font-mono font-semibold text-slate-700">
                    工单号: {selectedConfirmTicket.source_ticket_id || selectedConfirmTicket.ticket_number}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {selectedConfirmTicket.title || "工单答复确认"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedConfirmTicket(null);
                  setShowReturnInput(false);
                  setReturnReason("");
                }}
                className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-sm cursor-pointer transition flex-none"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[13px]">
              {/* 提单信息 */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="font-semibold text-slate-800 text-[13px] flex items-center justify-between">
                  <span>提单信息</span>
                  <span className="text-slate-400 font-mono text-[12px]">{selectedConfirmTicket.created_at}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600 text-[13px]">
                  <div>渠道: <span className="font-medium text-slate-800">{selectedConfirmTicket.source_name || selectedConfirmTicket.source_code || selectedConfirmTicket.source_system_cn}</span></div>
                  <div>联系人: <span className="font-medium text-slate-800">{selectedConfirmTicket.contact_name} ({selectedConfirmTicket.contact_phone})</span></div>
                </div>
                <div className="pt-1 text-slate-700">
                  <div className="text-slate-400 mb-0.5 text-[12px]">问题描述:</div>
                  <div className="bg-white p-2.5 rounded border border-slate-200 text-slate-800 leading-relaxed whitespace-pre-wrap text-[13px]">
                    {selectedConfirmTicket.description || selectedConfirmTicket.title || "无详细问题描述"}
                  </div>
                </div>
              </div>

              {/* 答复信息 */}
              <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-200 space-y-2">
                <div className="font-semibold text-blue-900 text-[13px] flex items-center justify-between">
                  <span>处理答复</span>
                  <span className="text-blue-700 font-medium">处理人: {selectedConfirmTicket.handler_display_name || selectedConfirmTicket.handler_name}</span>
                </div>
                <div className="pt-1 text-slate-700">
                  <div className="text-blue-800/80 mb-0.5 text-[12px]">答复方案 / 处理说明:</div>
                  <div className="bg-white p-2.5 rounded border border-blue-100 text-slate-800 leading-relaxed whitespace-pre-wrap text-[13px]">
                    {selectedConfirmTicket.reply_content || "处理人员已处理完毕，请确认问题是否已妥善解决。"}
                  </div>
                </div>
                {selectedConfirmTicket.resolved_at && (
                  <div className="text-[12px] text-slate-400 text-right font-mono">
                    答复时间: {selectedConfirmTicket.resolved_at}
                  </div>
                )}
              </div>

              {/* 退回原因输入区 */}
              {showReturnInput && (
                <div className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-200 space-y-2 animate-in fade-in duration-150">
                  <div className="font-semibold text-rose-800 text-[13px]">
                    请输入未解决退回原因
                  </div>
                  <textarea
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="请详细说明问题为何未解决，以便处理人继续跟进..."
                    rows={3}
                    className="w-full p-2.5 bg-white rounded border border-rose-200 text-[13px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3 flex-none">
              {!showReturnInput ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowReturnInput(true)}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-lg text-[13px] font-medium text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition cursor-pointer"
                  >
                    未解决退回
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDoConfirm(selectedConfirmTicket)}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-teal-600 hover:bg-teal-700 transition cursor-pointer shadow-2xs flex items-center gap-1.5"
                  >
                    <span>✓</span>
                    <span>确认已解决</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReturnInput(false);
                      setReturnReason("");
                    }}
                    disabled={actionLoading}
                    className="px-3.5 py-1.5 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-200 transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDoReturn(selectedConfirmTicket)}
                    disabled={actionLoading || !returnReason.trim()}
                    className="px-4 py-1.5 rounded-lg text-[13px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer shadow-2xs"
                  >
                    {actionLoading ? "提交中..." : "确认退回给处理人"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 已关闭工单：查看详情模态窗 */}
      {selectedViewTicket && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-[500px] max-w-[95vw] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between flex-none">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                    已关闭
                  </span>
                  <span className="text-xs font-mono font-semibold text-slate-700">
                    工单号: {selectedViewTicket.source_ticket_id || selectedViewTicket.ticket_number}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {selectedViewTicket.title || "工单详情"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedViewTicket(null)}
                className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-sm cursor-pointer transition flex-none"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-[13px]">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="font-semibold text-slate-800 text-[13px] flex items-center justify-between">
                  <span>提单详情</span>
                  <span className="text-slate-400 font-mono text-[12px]">{selectedViewTicket.created_at}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600 text-[13px]">
                  <div>渠道: <span className="font-medium text-slate-800">{selectedViewTicket.source_name || selectedViewTicket.source_code || selectedViewTicket.source_system_cn}</span></div>
                  <div>提单联系人: <span className="font-medium text-slate-800">{selectedViewTicket.contact_name}</span></div>
                </div>
                <div className="pt-1 text-slate-700">
                  <div className="text-slate-400 mb-0.5 text-[12px]">问题描述:</div>
                  <div className="bg-white p-2.5 rounded border border-slate-200 text-slate-800 leading-relaxed whitespace-pre-wrap text-[13px]">
                    {selectedViewTicket.description || selectedViewTicket.title || "无详细问题描述"}
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-200 space-y-2">
                <div className="font-semibold text-emerald-900 text-[13px] flex items-center justify-between">
                  <span>处理与解决结果</span>
                  <span className="text-emerald-700 font-medium">处理人: {selectedViewTicket.handler_display_name || selectedViewTicket.handler_name}</span>
                </div>
                <div className="pt-1 text-slate-700">
                  <div className="text-emerald-800/80 mb-0.5 text-[12px]">解决答复:</div>
                  <div className="bg-white p-2.5 rounded border border-emerald-100 text-slate-800 leading-relaxed whitespace-pre-wrap text-[13px]">
                    {selectedViewTicket.reply_content || "工单已处理完成并关闭。"}
                  </div>
                </div>
                {selectedViewTicket.resolved_at && (
                  <div className="text-[12px] text-slate-400 text-right font-mono">
                    关闭时间: {selectedViewTicket.resolved_at}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end flex-none">
              <button
                type="button"
                onClick={() => setSelectedViewTicket(null)}
                className="px-5 py-1.5 rounded-lg text-[13px] font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition cursor-pointer shadow-2xs"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerChatWorkbenchPage;
