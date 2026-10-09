import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, postByPath, rawRequest } from "@/api/client";
import { PortalSearchSelect } from "@/components/PortalSearchSelect";
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  addKnowledgeItem,
  formatDateTime,
  type KnowledgeAttachment,
  type KnowledgeItem,
  type KnowledgeType,
  type ProductLineOut,
  type CatalogModuleOut,
  KNOWLEDGE_STATUS_LABELS,
} from "./knowledgeBaseStore";
import { stripHtmlToCleanText } from "@/pages/tickets/replyNoteUtils";
import type { TaskAttachment } from "@/pages/tickets/DevContextDrawer";

export interface AnswerMeta {
  title: string;
  productLineCode: string;
  moduleCode: string;
  taskAttachments?: TaskAttachment[];
}

export interface KnowledgeBaseDrawerProps {
  open: boolean;
  onClose: () => void;
  defaultProductLine?: string;
  defaultModule?: string;
  defaultTitle?: string;
  defaultType?: KnowledgeType;
  defaultContent?: string;
  defaultCustomer?: string;
  item?: KnowledgeItem | null;
  mode?: "create" | "view";
  actionType?: "submit_only" | "answer_only" | "both";
  ticketHandlerName?: string;
  ticketId?: number;
  hubIssueId?: number;
  taskCode?: string;
  taskKey?: string | number;
  initialTaskAttachments?: TaskAttachment[];
  // 提供 onAnswerAndSubmit 则显示「作答」相关按钮，并将内容与修改后的属性及附件回传工单
  onAnswerAndSubmit?: (
    content: string,
    meta?: AnswerMeta,
    taskAttachments?: TaskAttachment[],
  ) => void;
  onSubmitSuccess?: (item: KnowledgeItem) => void;
}

const KNOWLEDGE_TYPES: KnowledgeType[] = ["FAQ", "操作手册", "交付配置"];

export function KnowledgeBaseDrawer({
  open,
  onClose,
  defaultProductLine = "",
  defaultModule = "",
  defaultTitle = "",
  defaultType = "FAQ",
  defaultContent = "",
  defaultCustomer = "全部客户",
  item,
  mode = item ? "view" : "create",
  onAnswerAndSubmit,
  actionType = onAnswerAndSubmit ? "answer_only" : "submit_only",
  ticketHandlerName,
  ticketId,
  hubIssueId,
  taskCode,
  taskKey,
  initialTaskAttachments,
  onSubmitSuccess,
}: KnowledgeBaseDrawerProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<KnowledgeType>("FAQ");
  const [productLineCode, setProductLineCode] = useState("");
  const [moduleCode, setModuleCode] = useState("");
  const [applicableCustomer, setApplicableCustomer] = useState("全部客户");
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newlyUploadedIdsRef = useRef<Set<string>>(new Set());
  const removedServerIdsRef = useRef<Set<string>>(new Set());

  // 1. 获取启用的产品线
  const productLinesQuery = useQuery({
    queryKey: ["admin", "product-lines"],
    queryFn: () => api.get("/api/admin/product-lines") as Promise<ProductLineOut[]>,
    staleTime: 60_000,
  });

  const activeProductLines = useMemo(
    () => (productLinesQuery.data ?? []).filter((p) => p.is_active !== false),
    [productLinesQuery.data],
  );

  const productLineOptions = useMemo(
    () => activeProductLines.map((p) => ({ code: p.code, name: p.name })),
    [activeProductLines],
  );

  // 2. 获取启用的问题模块（与产品线二级联动）
  const modulesQuery = useQuery({
    queryKey: ["catalog-modules", productLineCode],
    queryFn: () =>
      api.get("/api/hub-issues/catalog/modules", {
        product_line_code: productLineCode,
      }) as Promise<CatalogModuleOut[]>,
    staleTime: 30_000,
    enabled: !!productLineCode,
  });

  const activeModules = useMemo(
    () => (modulesQuery.data ?? []).filter((m) => (m as any).is_active !== false),
    [modulesQuery.data],
  );

  const moduleOptions = useMemo(() => {
    const list = activeModules.map((m) => ({ code: m.code, name: m.name }));
    if (moduleCode && !list.some((m) => m.code === moduleCode || m.name === moduleCode)) {
      list.push({ code: moduleCode, name: moduleCode });
    }
    return list;
  }, [activeModules, moduleCode]);

  // 打开抽屉时初始化默认值
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle || "");
      setType(defaultType || "FAQ");
      setContent(defaultContent || "");
      setApplicableCustomer(defaultCustomer || "全部客户");
      if (initialTaskAttachments && initialTaskAttachments.length > 0) {
        const seen = new Set<string>();
        const mappedInitial: KnowledgeAttachment[] = [];
        initialTaskAttachments.forEach((att, idx) => {
          const id = att.id || `${Date.now()}-init-${idx}`;
          if (seen.has(id)) return;
          seen.add(id);
          mappedInitial.push({
            id,
            name: att.name,
            displayName:
              att.displayName ||
              (taskCode && taskCode.trim() ? `${taskCode.trim()}-${idx + 1}` : undefined),
            originalName: att.originalName || att.name,
            size: att.size,
            type: att.type?.startsWith("video/") ? "video" : "image",
            mime: att.type,
            url: att.url,
            file: att.file,
            uploadedAt: att.uploadedAt,
            taskCode: att.taskCode || taskCode,
            taskKey: att.taskKey ?? taskKey,
          });
        });
        setAttachments(mappedInitial);
      } else {
        setAttachments([]);
      }
      newlyUploadedIdsRef.current = new Set();
      removedServerIdsRef.current = new Set();
      setUploadError(null);
      setFormError(null);

      // 默认等于工单/任务的产品线（多值取第一个）
      const rawPlc = defaultProductLine ? defaultProductLine.split(",")[0].trim() : "";
      const rawMod = defaultModule ? defaultModule.split(",")[0].trim() : "";

      const matchedPl = productLineOptions.find(
        (p) => p.code === rawPlc || p.name === rawPlc,
      );
      const targetPlc = matchedPl
        ? matchedPl.code
        : rawPlc || (productLineOptions.length > 0 ? productLineOptions[0].code : "");

      setProductLineCode(targetPlc);
      setModuleCode(rawMod);
    }
  }, [
    open,
    defaultProductLine,
    defaultModule,
    defaultTitle,
    defaultType,
    defaultContent,
    defaultCustomer,
    initialTaskAttachments,
    taskCode,
    taskKey,
  ]);

  // 当 productLineOptions 加载完成后，若指定了 defaultProductLine，确保映射为正确 code；若未指定且尚未选择，则默认首项
  useEffect(() => {
    if (!open || productLineOptions.length === 0) return;
    const rawPlc = defaultProductLine ? defaultProductLine.split(",")[0].trim() : "";
    if (rawPlc) {
      const matched = productLineOptions.find(
        (p) => p.code === rawPlc || p.name === rawPlc,
      );
      if (matched && productLineCode !== matched.code) {
        setProductLineCode(matched.code);
      }
    } else if (!productLineCode) {
      setProductLineCode(productLineOptions[0].code);
    }
  }, [open, productLineOptions, defaultProductLine, productLineCode]);

  // 当 activeModules 加载完成后，若指定了 defaultModule，确保对齐 moduleCode
  useEffect(() => {
    if (!open || activeModules.length === 0) return;
    const rawMod = defaultModule ? defaultModule.split(",")[0].trim() : "";
    if (rawMod && (!moduleCode || moduleCode === rawMod)) {
      const matchedMod = activeModules.find(
        (m) => m.code === rawMod || m.name === rawMod,
      );
      if (matchedMod && moduleCode !== matchedMod.code) {
        setModuleCode(matchedMod.code);
      }
    }
  }, [open, activeModules, defaultModule, moduleCode]);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const handledPasteEventsRef = useRef<WeakSet<Event>>(new WeakSet());

  // 统一附件上传处理（支持本地选择、拖拽上传、Ctrl+V 粘贴上传；图片 < 1M，视频 < 50M；命名规则与转产研上下文补充一致：任务编号-流水号）
  const processAttachmentFiles = async (fileList: FileList | File[]) => {
    setUploadError(null);
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const validEntries: Array<{ file: File; isVideo: boolean }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo =
        file.type.startsWith("video/") || /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(file.name);
      if (isVideo) {
        // 视频需 < 50MB
        if (file.size >= 50 * 1024 * 1024) {
          setUploadError(
            `视频「${file.name}」大小 ${(file.size / 1024 / 1024).toFixed(2)}MB 超过限制，视频需 < 50MB`,
          );
          continue;
        }
        validEntries.push({ file, isVideo: true });
      } else {
        // 图片需 < 1MB
        if (file.size >= 1 * 1024 * 1024) {
          setUploadError(
            `图片「${file.name}」大小 ${(file.size / 1024 / 1024).toFixed(2)}MB 超过限制，图片需 < 1MB`,
          );
          continue;
        }
        validEntries.push({ file, isVideo: false });
      }
    }

    if (validEntries.length === 0) return;

    const hasTaskContext = Boolean((taskCode && taskCode.trim()) || onAnswerAndSubmit);
    const basePrefix = taskCode && taskCode.trim() ? taskCode.trim() : "HUB-TASK";
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    const readBase64 = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const b64 = res.includes(",") ? res.split(",")[1] : res;
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    const newItems: KnowledgeAttachment[] = [];
    for (let idx = 0; idx < validEntries.length; idx++) {
      const { file: f, isVideo } = validEntries[idx];
      const seq = attachments.length + idx + 1;
      const origName =
        f.name || (isVideo ? `粘贴视频_${Date.now()}.mp4` : `粘贴图片_${Date.now()}.png`);
      const ext = origName.includes(".") ? origName.slice(origName.lastIndexOf(".")) : "";
      const displayName = hasTaskContext ? `${basePrefix}-${seq}` : undefined;
      const fullName = displayName ? `${displayName}${ext}` : origName;

      let attachId = `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
      let downloadUrl: string | undefined = undefined;

      if (ticketId) {
        try {
          const b64 = await readBase64(f);
          const res = await postByPath(
            "/api/tickets/{ticket_id}/attachments/upload",
            { ticket_id: ticketId },
            {
              filename: fullName,
              content_base64: b64,
              hub_issue_id: hubIssueId ?? undefined,
              mime: f.type || undefined,
            },
          );
          attachId = String(res.id);
          downloadUrl = res.download_url;
          newlyUploadedIdsRef.current.add(attachId);
        } catch (err) {
          console.error("Failed to upload knowledge attachment to ticket", err);
        }
      }

      newItems.push({
        id: attachId,
        name: hasTaskContext && taskCode ? fullName : origName,
        displayName,
        originalName: origName,
        size: f.size,
        type: isVideo ? "video" : "image",
        mime: f.type || (isVideo ? "video/mp4" : "image/png"),
        url:
          downloadUrl ||
          (typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(f)
            : undefined),
        file: f,
        uploadedAt: timeStr,
        taskCode: taskCode || "",
        taskKey,
      });
    }

    setAttachments((prev) => [...prev, ...newItems]);
  };

  const handleUploadAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    void processAttachmentFiles(files);
    e.target.value = "";
  };

  const extractClipboardFiles = (clipboardData: DataTransfer | null | undefined): File[] => {
    if (!clipboardData) return [];
    const files: File[] = [];
    if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) {
            const rawExt = f.type ? f.type.split("/")[1] : "";
            const ext = (rawExt ? rawExt.replace(/[^a-zA-Z0-9]/g, "") : "") || "png";
            const hasExt = Boolean(f.name && f.name.includes("."));
            const named = hasExt
              ? f
              : new File([f], f.name ? `${f.name}.${ext}` : `粘贴附件_${Date.now()}.${ext}`, {
                  type: f.type || "image/png",
                });
            files.push(named);
          }
        }
      }
    } else if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const f = clipboardData.files[i];
        if (f) {
          const rawExt = f.type ? f.type.split("/")[1] : "";
          const ext = (rawExt ? rawExt.replace(/[^a-zA-Z0-9]/g, "") : "") || "png";
          const hasExt = Boolean(f.name && f.name.includes("."));
          const named = hasExt
            ? f
            : new File([f], f.name ? `${f.name}.${ext}` : `粘贴附件_${Date.now()}.${ext}`, {
                type: f.type || "image/png",
              });
          files.push(named);
        }
      }
    }
    return files;
  };

  const handleAttachmentPaste = (e: React.ClipboardEvent) => {
    if (mode === "view") return;
    const nativeEvt = e.nativeEvent;
    if (nativeEvt && handledPasteEventsRef.current.has(nativeEvt)) return;
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length > 0) {
      if (nativeEvt) handledPasteEventsRef.current.add(nativeEvt);
      e.preventDefault();
      e.stopPropagation();
      void processAttachmentFiles(files);
    }
  };

  useEffect(() => {
    if (!open || mode === "view") return;
    const onDocPaste = (e: ClipboardEvent) => {
      if (handledPasteEventsRef.current.has(e)) return;
      const files = extractClipboardFiles(e.clipboardData);
      if (files.length > 0) {
        handledPasteEventsRef.current.add(e);
        e.preventDefault();
        e.stopPropagation();
        void processAttachmentFiles(files);
      }
    };
    document.addEventListener("paste", onDocPaste);
    return () => {
      document.removeEventListener("paste", onDocPaste);
    };
  });

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => {
      const target = prev[idx];
      if (target?.id && /^\d+$/.test(target.id)) {
        removedServerIdsRef.current.add(target.id);
      }
      if (target?.url && target.url.startsWith("blob:") && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleCancel = () => {
    if (ticketId && newlyUploadedIdsRef.current.size > 0) {
      for (const attId of newlyUploadedIdsRef.current) {
        if (/^\d+$/.test(attId)) {
          void rawRequest(`/api/tickets/${ticketId}/attachments/${attId}`, {
            method: "DELETE",
          }).catch(() => {});
        }
      }
    }
    onClose();
  };

  const flushRemovedServerAttachments = () => {
    if (ticketId && removedServerIdsRef.current.size > 0) {
      for (const attId of removedServerIdsRef.current) {
        if (/^\d+$/.test(attId)) {
          void rawRequest(`/api/tickets/${ticketId}/attachments/${attId}`, {
            method: "DELETE",
          }).catch(() => {});
        }
      }
    }
  };

  const buildTaskAttachments = (): TaskAttachment[] => {
    const basePrefix = taskCode && taskCode.trim() ? taskCode.trim() : "HUB-TASK";
    const now = new Date();
    const fallbackTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const seen = new Set<string>();
    const result: TaskAttachment[] = [];
    attachments.forEach((att, idx) => {
      const seq = idx + 1;
      const origName = att.originalName || att.name || `attachment_${seq}`;
      const ext = origName.includes(".") ? origName.slice(origName.lastIndexOf(".")) : "";
      const displayName = att.displayName || `${basePrefix}-${seq}`;
      const fullName = displayName.endsWith(ext) && ext ? displayName : `${displayName}${ext}`;
      const id = att.id || `${Date.now()}-${idx}`;
      if (seen.has(id)) return;
      seen.add(id);
      result.push({
        id,
        name: fullName,
        displayName,
        originalName: origName,
        size: att.size,
        type: att.mime || (att.type === "video" ? "video/mp4" : "image/png"),
        url: att.url,
        file: att.file,
        uploadedAt: att.uploadedAt || fallbackTime,
        taskCode: att.taskCode || taskCode || "",
        taskKey: att.taskKey ?? taskKey,
      });
    });
    return result;
  };

  const handleSave = (answerCurrentTicket: boolean) => {
    setFormError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("请录入知识标题");
      return;
    }
    if (trimmedTitle.length > 200) {
      setFormError("标题最多录入 200 字");
      return;
    }
    if (!productLineCode) {
      setFormError("请选择适用的产品线");
      return;
    }
    if (!moduleCode) {
      setFormError("请选择适用的问题模块");
      return;
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setFormError("请录入详细的知识内容");
      return;
    }
    const cleanContent = stripHtmlToCleanText(trimmedContent);
    if (!cleanContent) {
      setFormError("请录入详细的知识内容");
      return;
    }
    if (cleanContent.length > 2000) {
      setFormError("知识内容最多录入 2000 字");
      return;
    }

    flushRemovedServerAttachments();

    const selectedPl = productLineOptions.find((p) => p.code === productLineCode || p.name === productLineCode);
    const selectedMod = moduleOptions.find((m) => m.code === moduleCode || m.name === moduleCode);
    const creator = ticketHandlerName || (JSON.parse(localStorage.getItem("auth_user") || "null")?.name ?? "当前用户");

    const payload = {
      title: trimmedTitle,
      type,
      product_line_code: productLineCode,
      product_line_name: selectedPl?.name ?? productLineCode,
      module_code: moduleCode,
      module_name: selectedMod?.name ?? moduleCode,
      applicable_customer: applicableCustomer.trim() || "全部客户",
      content: cleanContent,
      status: "pending_review",
      created_by: creator,
      ticket_id: ticketId,
      attachments,
    };

    // 优先向后端提交真实持久化数据
    try {
      api.post("/api/knowledge-base", payload).catch((err) => {
        console.warn("Backend knowledge-base API error:", err);
      });
    } catch (e) {
      console.warn("api.post sync error", e);
    }

    const newItem = addKnowledgeItem({
      title: trimmedTitle,
      type,
      product_line_code: productLineCode,
      product_line_name: selectedPl?.name ?? productLineCode,
      module_code: moduleCode,
      module_name: selectedMod?.name ?? moduleCode,
      applicable_customer: applicableCustomer.trim() || "全部客户",
      content: cleanContent,
      status: "pending_review",
      attachments,
      created_by: creator,
    });

    if (answerCurrentTicket && onAnswerAndSubmit) {
      const taskAtts = buildTaskAttachments();
      const includeInMeta = taskAtts.length > 0 || initialTaskAttachments !== undefined;
      onAnswerAndSubmit(
        cleanContent,
        includeInMeta
          ? {
              title: trimmedTitle,
              productLineCode,
              moduleCode,
              taskAttachments: taskAtts,
            }
          : {
              title: trimmedTitle,
              productLineCode,
              moduleCode,
            },
        taskAtts,
      );
    }

    onSubmitSuccess?.(newItem);
    onClose();
  };

  // 3.8 仅作答：不向知识库接口发请求，不写入知识库列表，仅回写当前工单任务解决方案、修改后的标题/分类/模块及上传附件并关闭
  const handleAnswerOnly = () => {
    setFormError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("请录入知识标题");
      return;
    }
    if (trimmedTitle.length > 200) {
      setFormError("标题最多录入 200 字");
      return;
    }
    if (!productLineCode) {
      setFormError("请选择适用的产品线");
      return;
    }
    if (!moduleCode) {
      setFormError("请选择适用的问题模块");
      return;
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setFormError("请录入详细的知识/答复内容");
      return;
    }
    const cleanContent = stripHtmlToCleanText(trimmedContent);
    if (!cleanContent) {
      setFormError("请录入详细的知识/答复内容");
      return;
    }
    if (cleanContent.length > 2000) {
      setFormError("内容最多录入 2000 字");
      return;
    }
    flushRemovedServerAttachments();
    if (onAnswerAndSubmit) {
      const taskAtts = buildTaskAttachments();
      const includeInMeta = taskAtts.length > 0 || initialTaskAttachments !== undefined;
      onAnswerAndSubmit(
        cleanContent,
        includeInMeta
          ? {
              title: trimmedTitle,
              productLineCode,
              moduleCode,
              taskAttachments: taskAtts,
            }
          : {
              title: trimmedTitle,
              productLineCode,
              moduleCode,
            },
        taskAtts,
      );
    }
    onClose();
  };
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 半透明遮罩 */}
      <div
        className="fixed inset-0 bg-black/40 transition-opacity"
        onClick={handleCancel}
        aria-hidden="true"
      />

      {/* 800px 宽度右侧滑出抽屉 */}
      <div
        className="relative z-10 w-[800px] max-w-[95vw] h-full bg-white shadow-2xl flex flex-col font-hub text-slate-800 animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-drawer-title"
        onPaste={handleAttachmentPaste}
      >
        {/* 抽屉头部：标题 + 横线分隔 */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-hub-borderLight flex-none">
          {mode === "view" && item ? (
            <div className="flex items-center gap-2 max-w-[420px] min-w-0">
              <h2 id="knowledge-drawer-title" className="m-0 text-[15px] font-bold text-slate-900 whitespace-nowrap">
                知识库操作面板
              </h2>
              <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                {item.id}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${
                  item.status === "active"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : item.status === "pending_review"
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : item.status === "rejected"
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {KNOWLEDGE_STATUS_LABELS[item.status] ?? item.status}
              </span>
            </div>
          ) : (
            <h2 id="knowledge-drawer-title" className="m-0 text-[15px] font-bold text-slate-900">
              维护知识库
            </h2>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer transition-colors text-[18px] leading-none ml-2"
            aria-label="关闭抽屉"
          >
            ✕
          </button>
        </div>

        {/* 抽屉内容区 */}
        {mode === "view" && item ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[12.5px]">
            {/* 标题 */}
            <div>
              <div className="font-semibold text-slate-500 text-[11.5px] mb-1">知识标题</div>
              <div className="text-[14px] font-bold text-slate-900 leading-snug break-words">
                {item.title}
              </div>
            </div>

            {/* 类型、产品线、问题模块、适用客户 */}
            <div className="grid grid-cols-4 gap-2 bg-slate-50 p-3 rounded-[8px] border border-slate-200/80 text-[12px]">
              <div>
                <div className="text-slate-400 text-[11px] mb-0.5">知识类型</div>
                <span className="inline-block font-semibold text-slate-800 px-1.5 py-0.5 bg-white rounded border border-slate-200 text-[11.5px]">
                  {item.type}
                </span>
              </div>
              <div>
                <div className="text-slate-400 text-[11px] mb-0.5">适用产品线</div>
                <div className="font-medium text-slate-800 truncate" title={item.product_line_name}>
                  {item.product_line_name}
                </div>
              </div>
              <div>
                <div className="text-slate-400 text-[11px] mb-0.5">适用问题模块</div>
                <div className="font-medium text-slate-800 truncate" title={item.module_name}>
                  {item.module_name}
                </div>
              </div>
              <div>
                <div className="text-slate-400 text-[11px] mb-0.5">适用客户</div>
                <div className="font-medium text-slate-800 truncate" title={item.applicable_customer || "全部客户"}>
                  {item.applicable_customer || "全部客户"}
                </div>
              </div>
            </div>

            {/* 详细知识内容 */}
            <div>
              <div className="font-semibold text-slate-500 text-[11.5px] mb-1.5">详细知识内容</div>
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-[8px] whitespace-pre-wrap break-words leading-relaxed text-[12.5px] text-slate-800 max-h-[300px] overflow-y-auto select-text">
                {item.content}
              </div>
            </div>

            {/* 附件列表 */}
            {item.attachments && item.attachments.length > 0 && (
              <div>
                <div className="font-semibold text-slate-500 text-[11.5px] mb-1.5">
                  附件列表 ({item.attachments.length})
                </div>
                <div className="space-y-2">
                  {item.attachments.map((att, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-[6px] border border-slate-200 bg-white"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span>{att.type === "image" ? "🖼️" : "🎞️"}</span>
                        <span className="text-slate-800 font-medium truncate max-w-[280px]" title={att.name}>
                          {att.name}
                        </span>
                        <span className="text-slate-400 font-mono text-[10.5px]">
                          ({(att.size / 1024).toFixed(0)}KB)
                        </span>
                      </div>
                      {att.url && (
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-hub-teal hover:underline text-[11.5px] flex-none"
                        >
                          查看
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 元数据卡片 */}
            <div className="border-t border-slate-100 pt-3">
              <div className="font-semibold text-slate-500 text-[11.5px] mb-2">流转与调用记录</div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px] bg-slate-50/70 p-3 rounded-[8px] border border-slate-200/80">
                <div>
                  <span className="text-slate-400 mr-1.5">创建人:</span>
                  <span className="text-slate-700 font-medium">{item.created_by}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">创建时间:</span>
                  <span className="text-slate-600 font-mono">{formatDateTime(item.created_at)}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">审核人:</span>
                  <span className="text-slate-700 font-medium">{item.reviewed_by ?? "—"}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">审核时间:</span>
                  <span className="text-slate-600 font-mono">{formatDateTime(item.reviewed_at)}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">总调用次数:</span>
                  <span className="text-slate-900 font-mono font-bold">{item.total_calls}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1.5">近60天调用:</span>
                  <span className="text-slate-900 font-mono font-bold">{item.recent_calls}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[12.5px]">
            {formError && (
              <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-[6px]">
                {formError}
              </div>
            )}

            {/* 3.1 标题 (最多 200 字，字数统计 0/200) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-semibold text-slate-700">
                  <span className="text-rose-500 mr-1">*</span>标题
                </label>
                <span className="text-[11.5px] text-slate-400 font-mono">
                  {title.length}/200
                </span>
              </div>
              <input
                type="text"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="简短说明本次知识的概要或者对应的问题..."
                className="w-full text-[12.5px] border border-hub-border rounded-[7px] px-3 py-1.5 outline-none focus:border-hub-teal transition-colors"
              />
            </div>

            {/* 3.2 知识类型：下拉勾选 FAQ、操作手册、交付配置 */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                <span className="text-rose-500 mr-1">*</span>知识类型
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as KnowledgeType)}
                className="w-full text-[12.5px] border border-hub-border rounded-[7px] px-2.5 py-1.5 bg-white outline-none focus:border-hub-teal cursor-pointer h-[34px]"
              >
                {KNOWLEDGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* 3.3 产品线：适用产品线、顶层搜索下拉 */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                <span className="text-rose-500 mr-1">*</span>适用产品线
              </label>
              <PortalSearchSelect
                ariaLabel="知识库产品线"
                value={productLineCode}
                onChange={(val) => {
                  setProductLineCode(val);
                  setModuleCode("");
                }}
                options={productLineOptions}
                placeholder="选择适用产品线"
                width="100%"
                loading={productLinesQuery.isLoading}
              />
            </div>

            {/* 3.4 问题模块：适用模块、二级联动、顶层搜索下拉 */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                <span className="text-rose-500 mr-1">*</span>适用问题模块
              </label>
              <PortalSearchSelect
                ariaLabel="知识库问题模块"
                value={moduleCode}
                onChange={(val) => setModuleCode(val)}
                options={moduleOptions}
                placeholder={!productLineCode ? "请先选择产品线" : "选择适用模块"}
                width="100%"
                disabled={!productLineCode}
                loading={modulesQuery.isLoading}
              />
            </div>

            {/* 适用客户：手动录入，默认内容：全部客户，支持修改为指定的客户 */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                适用客户
              </label>
              <input
                type="text"
                value={applicableCustomer}
                onChange={(e) => setApplicableCustomer(e.target.value)}
                placeholder="请输入适用客户（默认：全部客户）"
                className="w-full text-[12.5px] border border-hub-border rounded-[7px] px-3 py-1.5 outline-none focus:border-hub-teal transition-colors"
              />
            </div>

            {/* 3.5 知识内容：详细内容、2000 字、富文本录入框（高度增至原 2 倍，minHeight=320） */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-semibold text-slate-700">
                  <span className="text-rose-500 mr-1">*</span>知识内容
                </label>
              </div>
              <RichTextEditor
                value={content}
                onChange={setContent}
                placeholder="详细录入该知识点解答内容、标准解决方案或操作步骤，支持加粗、插入超链接、图片等..."
                maxLength={2000}
                minHeight={320}
              />

              {/* 附件上传区域：支持本地上传、拖拽上传、Ctrl+V 粘贴上传 */}
              <div
                data-testid="kb-attachment-upload-zone"
                tabIndex={0}
                onPaste={handleAttachmentPaste}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isDraggingOver) setIsDraggingOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(false);
                  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                    void processAttachmentFiles(e.dataTransfer.files);
                  }
                }}
                className={`mt-2.5 p-3 rounded-[8px] border border-dashed transition-colors outline-none ${
                  isDraggingOver
                    ? "border-hub-teal bg-teal-50/40"
                    : "border-slate-300 hover:border-hub-teal bg-slate-50/60"
                }`}
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    data-testid="kb-attachment-file-input"
                    className="hidden"
                    onChange={handleUploadAttachment}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-[6px] border border-hub-border bg-white hover:bg-slate-100 cursor-pointer text-slate-700 shadow-xs"
                  >
                    <span>📎 上传附件</span>
                  </button>

                  <span style={{ color: "#666666" }} className="text-[11.5px] select-none">
                    图片&lt;1M,视频&lt;50M
                  </span>

                  <span className="text-[11.5px] text-slate-400 select-none">
                    支持本地上传、将文件拖拽至此处上传，或按 Ctrl+V / ⌘+V 黏贴上传
                  </span>
                </div>

                {uploadError && (
                  <p className="mt-1.5 text-[11px] text-rose-500 font-medium">{uploadError}</p>
                )}

                {/* 已上传附件列表 */}
                {attachments.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-500">
                      已选附件 <span className="text-slate-400 font-normal">({attachments.length})</span>：
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((att, idx) => (
                        <div
                          key={att.id || idx}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] bg-white text-[11px] border border-slate-200"
                        >
                          {att.displayName ? (
                            <>
                              <span>{att.type === "image" ? "🖼️" : "🎞️"}</span>
                              <span
                                className="font-bold text-slate-800 font-mono truncate max-w-[160px]"
                                title={att.name}
                              >
                                {att.displayName}
                              </span>
                              {att.originalName && att.originalName !== att.name && (
                                <span
                                  className="text-slate-400 truncate max-w-[140px]"
                                  title={att.originalName}
                                >
                                  ({att.originalName})
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="truncate max-w-[180px]" title={att.name}>
                              {att.type === "image" ? "🖼️" : "🎞️"} {att.name}
                            </span>
                          )}
                          <span className="text-slate-400 font-mono text-[10px]">
                            ({(att.size / 1024).toFixed(0)}KB)
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(idx)}
                            className="text-slate-400 hover:text-rose-500 ml-1 cursor-pointer font-bold"
                            title="删除附件"
                            aria-label={`删除附件 ${att.displayName || att.name}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 操作按钮区：上移至附件上传区域的下方，不放在抽屉最底部 */}
              <div
                data-testid="kb-action-buttons"
                className="mt-4 pt-3 border-t border-hub-borderLight flex items-center justify-end gap-3"
              >
                {/* 1. 仅作答：橙色填充，不在知识库列表生成记录，直接将录入内容回写当前工单任务解决方案并关闭抽屉 */}
                {(actionType === "answer_only" || actionType === "both") && (
                  <button
                    type="button"
                    onClick={handleAnswerOnly}
                    className="min-w-[50px] px-3.5 py-1.5 text-[12px] font-semibold rounded-[7px] bg-orange-500 hover:bg-orange-600 text-white cursor-pointer shadow-sm transition-colors whitespace-nowrap"
                  >
                    仅作答
                  </button>
                )}

                {/* 2. 作答并新增知识库：在知识库生成记录，并将知识内容回写当前工单任务解决方案 */}
                {(actionType === "answer_only" || actionType === "both") && (
                  <button
                    type="button"
                    onClick={() => handleSave(true)}
                    className="min-w-[50px] px-3.5 py-1.5 text-[12px] font-semibold rounded-[7px] bg-[#6085e7] text-white hover:brightness-95 cursor-pointer shadow-sm whitespace-nowrap"
                  >
                    作答并新增知识库
                  </button>
                )}

                {/* 提交：在知识库生成记录，不回写当前工单处理说明（独立新增知识库场景） */}
                {actionType === "submit_only" && (
                  <button
                    type="button"
                    onClick={() => handleSave(false)}
                    className="min-w-[50px] px-3.5 py-1.5 text-[12px] font-semibold rounded-[7px] bg-hub-teal text-white hover:brightness-95 cursor-pointer shadow-sm whitespace-nowrap"
                  >
                    提交
                  </button>
                )}

                {/* 3. 取消 */}
                <button
                  type="button"
                  onClick={handleCancel}
                  className="min-w-[50px] px-3.5 py-1.5 text-[12px] font-semibold rounded-[7px] border border-hub-border bg-white text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 只读查看模式下保留关闭按钮栏 */}
        {mode === "view" && (
          <div className="px-5 py-3 border-t border-hub-borderLight flex items-center justify-end gap-3 flex-none bg-slate-50">
            <button
              type="button"
              onClick={onClose}
              className="min-w-[50px] px-4 py-1.5 text-[12px] font-semibold rounded-[7px] border border-hub-border bg-white text-slate-700 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
