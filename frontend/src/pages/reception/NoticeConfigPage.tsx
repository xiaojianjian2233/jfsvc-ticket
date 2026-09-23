import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CreateNoticePayload,
  type NoticeFilterParams,
  type ReceptionNoticeItem,
  type UpdateNoticePayload,
  batchDeleteNotices,
  batchPublishNotices,
  batchUnpublishNotices,
  createNotice,
  fetchNoticeDetail,
  fetchNotices,
  updateNotice,
} from "./receptionApi";

export function NoticeConfigPage() {
  // 列表数据与加载状态
  const [notices, setNotices] = useState<ReceptionNoticeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // 筛选条件：状态、创建时间
  // 状态：支持多选（选项值：不限、上架、下架）
  const [statusFilter, setStatusFilter] = useState<string[]>(["all"]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  // 创建时间区间 (YYYY-MM-DD HH:mm)
  const [startTimeFilter, setStartTimeFilter] = useState<string>("");
  const [endTimeFilter, setEndTimeFilter] = useState<string>("");

  // 悬浮内容 Tooltip 状态
  const [hoveredNotice, setHoveredNotice] = useState<{
    id: number;
    content: string;
    x: number;
    y: number;
  } | null>(null);

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "view" | "edit">("create");
  const [currentNoticeId, setCurrentNoticeId] = useState<number | null>(null);

  // 抽屉表单字段
  const [formTitle, setFormTitle] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formPopupPrompt, setFormPopupPrompt] = useState<boolean>(true);
  const [formContent, setFormContent] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 富文本编辑框引用
  const editorRef = useRef<HTMLDivElement>(null);
  // 生效区间日期输入框引用
  const startDateInputRef = useRef<HTMLInputElement>(null);
  const endDateInputRef = useRef<HTMLInputElement>(null);

  // 打开日期选择器辅助方法
  const openStartDatePicker = () => {
    if (drawerMode !== "view") {
      try {
        startDateInputRef.current?.showPicker();
      } catch {
        startDateInputRef.current?.focus();
      }
    }
  };

  const openEndDatePicker = () => {
    if (drawerMode !== "view") {
      try {
        endDateInputRef.current?.showPicker();
      } catch {
        endDateInputRef.current?.focus();
      }
    }
  };

  // 获取当前系统日期 yyyy-mm-dd
  const getTodayStr = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // 加载列表数据
  const loadNotices = async () => {
    setLoading(true);
    try {
      const filters: NoticeFilterParams = {};
      if (statusFilter.length > 0 && !statusFilter.includes("all")) {
        filters.statuses = statusFilter;
      }
      if (startTimeFilter) {
        filters.start_time = startTimeFilter.replace("T", " ") + ":00";
      }
      if (endTimeFilter) {
        filters.end_time = endTimeFilter.replace("T", " ") + ":59";
      }
      const data = await fetchNotices(filters);
      setNotices(data);
      // 清理选中列表中不存在的项
      const existIds = new Set(data.map((d) => d.id));
      setSelectedIds((prev) => prev.filter((id) => existIds.has(id)));
    } catch (err) {
      console.error("加载消息通知失败", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选区状态多选勾选控制
  const handleToggleStatus = (val: string) => {
    if (val === "all") {
      setStatusFilter(["all"]);
      return;
    }
    let next = statusFilter.filter((s) => s !== "all");
    if (next.includes(val)) {
      next = next.filter((s) => s !== val);
    } else {
      next.push(val);
    }
    if (next.length === 0 || next.length === 2) {
      next = ["all"];
    }
    setStatusFilter(next);
  };

  // 重置筛选
  const handleResetFilter = () => {
    setStatusFilter(["all"]);
    setStartTimeFilter("");
    setEndTimeFilter("");
    setTimeout(() => {
      fetchNotices().then(setNotices);
    }, 0);
  };

  // 表格全选/单选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(notices.map((n) => n.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // 批量上架
  const handleBatchPublish = async () => {
    if (selectedIds.length === 0) {
      alert("请先勾选需要上架的消息记录！");
      return;
    }
    const toPublish = notices.filter(
      (n) => selectedIds.includes(n.id) && n.effective_status === "unpublished"
    );
    if (toPublish.length === 0) {
      alert("所勾选的消息已全部处于上架状态！");
      return;
    }
    try {
      await batchPublishNotices(toPublish.map((n) => n.id));
      await loadNotices();
      alert(`成功上架 ${toPublish.length} 条消息！已生效的消息将展示在客户端重要通知列表。`);
    } catch (err: any) {
      alert(`上架失败: ${err.message || "网络异常"}`);
    }
  };

  // 批量下架
  const handleBatchUnpublish = async () => {
    if (selectedIds.length === 0) {
      alert("请先勾选需要下架的消息记录！");
      return;
    }
    const toUnpublish = notices.filter(
      (n) => selectedIds.includes(n.id) && n.effective_status === "published"
    );
    if (toUnpublish.length === 0) {
      alert("所勾选的消息已全部处于下架状态！");
      return;
    }
    if (!confirm(`确定将选中的 ${toUnpublish.length} 条已上架消息操作下架吗？下架后客户端将不再展示。`)) {
      return;
    }
    try {
      await batchUnpublishNotices(toUnpublish.map((n) => n.id));
      await loadNotices();
      alert(`成功下架 ${toUnpublish.length} 条消息！`);
    } catch (err: any) {
      alert(`下架失败: ${err.message || "网络异常"}`);
    }
  };

  // 批量删除（仅限下架状态）
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      alert("请先勾选需要删除的消息记录！");
      return;
    }
    // 检查是否有上架记录
    const publishedSelected = notices.filter(
      (n) => selectedIds.includes(n.id) && n.effective_status === "published"
    );
    if (publishedSelected.length > 0) {
      alert(`勾选的消息包含处于上架状态的消息（如 ${publishedSelected[0].notice_no}），请先将其下架后再执行删除！`);
      return;
    }
    if (!confirm(`确定删除选中的 ${selectedIds.length} 条下架状态消息记录吗？此操作无法撤销。`)) {
      return;
    }
    try {
      await batchDeleteNotices(selectedIds);
      setSelectedIds([]);
      await loadNotices();
      alert("选中的消息记录已成功删除！");
    } catch (err: any) {
      alert(`删除失败: ${err.message || "网络异常"}`);
    }
  };

  // 打开新建抽屉
  const handleOpenCreateDrawer = () => {
    const today = getTodayStr();
    // 默认结束日期为 7 天后
    const end = new Date(Date.now() + 7 * 86400000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const endStr = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;

    setDrawerMode("create");
    setCurrentNoticeId(null);
    setFormTitle("");
    setFormStartDate(today);
    setFormEndDate(endStr);
    setFormPopupPrompt(true);
    setFormContent("");
    setFormError("");
    setDrawerOpen(true);

    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
  };

  // 点击编号查看消息详情（查看态）
  const handleOpenViewDrawer = async (item: ReceptionNoticeItem) => {
    setCurrentNoticeId(item.id);
    setDrawerMode("view");
    setFormTitle(item.title);
    setFormStartDate(item.start_date);
    setFormEndDate(item.end_date);
    setFormPopupPrompt(item.popup_prompt);
    setFormContent(item.content);
    setFormError("");
    setDrawerOpen(true);

    if (editorRef.current) {
      editorRef.current.innerHTML = item.content;
    }

    try {
      const detail = await fetchNoticeDetail(item.id);
      setFormTitle(detail.title);
      setFormStartDate(detail.start_date);
      setFormEndDate(detail.end_date);
      setFormPopupPrompt(detail.popup_prompt);
      setFormContent(detail.content);
      if (editorRef.current) {
        editorRef.current.innerHTML = detail.content;
      }
    } catch {
      // ignore
    }
  };

  // 点击右上角“编辑”按钮激活编辑状态
  const handleActivateEdit = () => {
    setDrawerMode("edit");
    setFormError("");
  };

  // 关闭抽屉
  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setDrawerMode("create");
    setCurrentNoticeId(null);
    setFormError("");
  };

  // 提交新建或修改
  const handleSubmitForm = async () => {
    const titleTrimmed = formTitle.trim();
    if (!titleTrimmed) {
      setFormError("请输入消息通知标题（不能为空且不超过50字）！");
      return;
    }
    if (titleTrimmed.length > 50) {
      setFormError("标题字数不能超过 50 个字！");
      return;
    }
    if (!formStartDate || !formEndDate) {
      setFormError("生效开始日期和截止时间不能为空，请补全数据！");
      return;
    }
    if (formStartDate > formEndDate) {
      setFormError("生效开始日期不能晚于截止日期！");
      return;
    }

    // 从富文本框同步最新内容
    const currentHtml = editorRef.current ? editorRef.current.innerHTML : formContent;
    if (!currentHtml || currentHtml === "<p><br></p>" || !currentHtml.replace(/<[^>]+>/g, "").trim()) {
      setFormError("请输入消息通知的具体内容！");
      return;
    }

    setSubmitting(true);
    setFormError("");

    try {
      if (drawerMode === "create") {
        const payload: CreateNoticePayload = {
          title: titleTrimmed,
          start_date: formStartDate,
          end_date: formEndDate,
          popup_prompt: formPopupPrompt,
          content: currentHtml,
        };
        const created = await createNotice(payload);
        handleCloseDrawer();
        setStatusFilter(["all"]);
        setStartTimeFilter("");
        setEndTimeFilter("");
        const fresh = await fetchNotices();
        setNotices(fresh);
        alert(`消息【${created.notice_no}】创建并上架成功！`);
      } else if (drawerMode === "edit" && currentNoticeId) {
        const payload: UpdateNoticePayload = {
          title: titleTrimmed,
          start_date: formStartDate,
          end_date: formEndDate,
          popup_prompt: formPopupPrompt,
          content: currentHtml,
        };
        const updated = await updateNotice(currentNoticeId, payload);
        handleCloseDrawer();
        await loadNotices();
        alert(`消息【${updated.notice_no}】已成功修改并更新！`);
      }
    } catch (err: any) {
      setFormError(err.message || "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  // 富文本操作辅助命令
  const execFormat = (cmd: string, val: string | undefined = undefined) => {
    if (drawerMode === "view") return;
    document.execCommand(cmd, false, val);
    if (editorRef.current) {
      setFormContent(editorRef.current.innerHTML);
    }
  };

  const handleInsertLink = () => {
    if (drawerMode === "view") return;
    const url = prompt("请输入要插入的链接地址 (URL):", "https://");
    if (url && url.trim()) {
      execFormat("createLink", url.trim());
    }
  };

  const handleInsertImage = () => {
    if (drawerMode === "view") return;
    const url = prompt("请输入图片直链地址 (URL):", "https://");
    if (url && url.trim()) {
      execFormat("insertImage", url.trim());
    }
  };

  // 计算筛选文本提示
  const statusDisplayLabel = useMemo(() => {
    if (statusFilter.includes("all") || statusFilter.length === 0) return "不限";
    const labels = statusFilter.map((s) => (s === "published" ? "上架" : "下架"));
    return labels.join("、");
  }, [statusFilter]);

  // 全选状态
  const isAllSelected = notices.length > 0 && selectedIds.length === notices.length;

  return (
    <div className="flex flex-col h-full w-full bg-slate-50 overflow-hidden relative select-none">
      {/* 2. 页面标题：消息通知管理，16号字体加粗，添加白色矩形框，宽度填充整个右侧的内容区，高40Px，固定不动，不随页面的上下所有拖动而移动 */}
      <div className="h-[40px] w-full bg-white border-b border-slate-200 px-4 flex items-center flex-none z-20 shadow-2xs">
        <h1 className="text-[16px] font-bold text-slate-800 tracking-tight">
          消息通知管理
        </h1>
      </div>

      {/* 3. 筛选区：支持用户录入筛选条件，查找符合条件的消息记录，包含筛选条件：状态、创建时间 */}
      <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex-none z-10 shadow-2xs">
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          {/* 状态筛选下拉 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">状态:</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setStatusDropdownOpen((prev) => !prev)}
                className="w-[300px] h-[25px] text-[13px] bg-white border border-slate-300 rounded px-2.5 flex items-center justify-between hover:border-[rgb(39,99,207)] transition cursor-pointer text-slate-700"
              >
                <span className="truncate">{statusDisplayLabel}</span>
                <span className="text-[11px] text-slate-400">▼</span>
              </button>

              {statusDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setStatusDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-[28px] w-[300px] bg-white border border-slate-200 rounded shadow-lg p-2 z-40 space-y-1.5 text-[13px]">
                    <label className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={statusFilter.includes("all")}
                        onChange={() => handleToggleStatus("all")}
                        className="rounded text-[rgb(39,99,207)] focus:ring-[rgb(39,99,207)]"
                      />
                      <span>不限</span>
                    </label>
                    <label className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={statusFilter.includes("published")}
                        onChange={() => handleToggleStatus("published")}
                        className="rounded text-[rgb(39,99,207)] focus:ring-[rgb(39,99,207)]"
                      />
                      <span>上架</span>
                    </label>
                    <label className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={statusFilter.includes("unpublished")}
                        onChange={() => handleToggleStatus("unpublished")}
                        className="rounded text-[rgb(39,99,207)] focus:ring-[rgb(39,99,207)]"
                      />
                      <span>下架</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 创建时间区间筛选框 */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">创建时间:</span>
            <div className="w-[300px] h-[25px] border border-slate-300 rounded bg-white flex items-center px-1 text-[13px]">
              <input
                type="datetime-local"
                value={startTimeFilter}
                onClick={(e) => {
                  try {
                    (e.target as HTMLInputElement).showPicker();
                  } catch {}
                }}
                onChange={(e) => setStartTimeFilter(e.target.value)}
                className="w-[138px] text-[12px] bg-transparent outline-none text-slate-700 cursor-pointer"
                title="起始创建时间（年-月-日 时:分）"
              />
              <span className="text-slate-400 px-0.5">~</span>
              <input
                type="datetime-local"
                value={endTimeFilter}
                onClick={(e) => {
                  try {
                    (e.target as HTMLInputElement).showPicker();
                  } catch {}
                }}
                onChange={(e) => setEndTimeFilter(e.target.value)}
                className="w-[138px] text-[12px] bg-transparent outline-none text-slate-700 cursor-pointer"
                title="截止创建时间（年-月-日 时:分）"
              />
            </div>
          </div>

          {/* 筛选触发按钮 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadNotices}
              className="h-[25px] px-3 bg-[rgb(39,99,207)] text-white text-[13px] rounded hover:opacity-90 transition font-medium cursor-pointer"
            >
              查询
            </button>
            <button
              type="button"
              onClick={handleResetFilter}
              className="h-[25px] px-3 border border-slate-300 text-slate-600 text-[13px] rounded hover:bg-slate-50 transition cursor-pointer"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {/* 4. 列表操作按钮：新建、上架、下架、删除、刷新 */}
      <div className="px-4 pt-3 pb-2 flex-none flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpenCreateDrawer}
          className="h-[25px] leading-[25px] px-[6px] text-center bg-[rgb(39,99,207)] text-white text-[13px] rounded-[5px] hover:opacity-95 transition font-medium cursor-pointer shadow-2xs flex items-center gap-1"
        >
          <span>+</span>
          <span>新建</span>
        </button>

        <button
          type="button"
          onClick={handleBatchPublish}
          className="h-[25px] leading-[25px] px-[6px] text-center bg-white border border-emerald-500 text-emerald-600 text-[13px] rounded-[5px] hover:bg-emerald-50 transition font-medium cursor-pointer"
        >
          上架
        </button>

        <button
          type="button"
          onClick={handleBatchUnpublish}
          className="h-[25px] leading-[25px] px-[6px] text-center bg-white border border-amber-500 text-amber-600 text-[13px] rounded-[5px] hover:bg-amber-50 transition font-medium cursor-pointer"
        >
          下架
        </button>

        <button
          type="button"
          onClick={handleBatchDelete}
          className="h-[25px] leading-[25px] px-[6px] text-center bg-white border border-rose-400 text-rose-600 text-[13px] rounded-[5px] hover:bg-rose-50 transition font-medium cursor-pointer"
        >
          删除
        </button>

        <button
          type="button"
          onClick={loadNotices}
          className="h-[25px] leading-[25px] px-[6px] text-center bg-white border border-slate-300 text-slate-700 text-[13px] rounded-[5px] hover:bg-slate-50 transition font-medium cursor-pointer"
        >
          刷新
        </button>

        <div className="ml-auto text-[12px] text-slate-400">
          共 {notices.length} 条记录
          {selectedIds.length > 0 && `（已勾选 ${selectedIds.length} 项）`}
        </div>
      </div>

      {/* 5 & 6. 列表展示区：固定与浏览器底部对齐，只有该展示区可上下或左右拖动 */}
      <div className="flex-1 px-4 pb-4 overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 bg-white border border-slate-200 rounded shadow-xs overflow-auto relative">
          <table
            className="border-separate border-spacing-0 text-left text-[13px]"
            style={{ width: 1694, tableLayout: "fixed" }}
          >
            {/* 列表标题行固定，列表所有字体字号13，标题行加粗 */}
            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-800">
              <tr className="bg-slate-100 h-[38px]">
                {/* 勾选框：固定列 */}
                <th
                  style={{ width: 44, minWidth: 44, maxWidth: 44, left: 0 }}
                  className="sticky top-0 left-0 z-30 bg-slate-100 border-b border-r border-slate-200 px-3 py-2 text-center select-none"
                >
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded text-[rgb(39,99,207)] focus:ring-[rgb(39,99,207)] cursor-pointer"
                  />
                </th>

                {/* 消息编号：固定列 */}
                <th
                  style={{ width: 170, minWidth: 170, maxWidth: 170, left: 44 }}
                  className="sticky top-0 left-[44px] z-30 bg-slate-100 border-b border-r border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  消息编号
                </th>

                <th
                  style={{ width: 220, minWidth: 220, maxWidth: 220 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  标题
                </th>
                <th
                  style={{ width: 280, minWidth: 280, maxWidth: 280 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  内容
                </th>
                <th
                  style={{ width: 240, minWidth: 240, maxWidth: 240 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  生效时间
                </th>
                <th
                  style={{ width: 90, minWidth: 90, maxWidth: 90 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap text-center select-none"
                >
                  弹窗提示
                </th>
                <th
                  style={{ width: 90, minWidth: 90, maxWidth: 90 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap text-center select-none"
                >
                  状态
                </th>
                <th
                  style={{ width: 170, minWidth: 170, maxWidth: 170 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  创建时间
                </th>
                <th
                  style={{ width: 110, minWidth: 110, maxWidth: 110 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  创建人
                </th>
                <th
                  style={{ width: 170, minWidth: 170, maxWidth: 170 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  最后操作时间
                </th>
                <th
                  style={{ width: 110, minWidth: 110, maxWidth: 110 }}
                  className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200/80 px-3 py-2 font-bold whitespace-nowrap select-none"
                >
                  最后操作人
                </th>
              </tr>
            </thead>

            <tbody className="text-slate-700">
              {loading && notices.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 border-b border-slate-200">
                    正在加载消息通知列表...
                  </td>
                </tr>
              ) : notices.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 border-b border-slate-200">
                    暂无符合条件的消息通知记录，请点击左上角【新建】添加。
                  </td>
                </tr>
              ) : (
                notices.map((n) => {
                  const isChecked = selectedIds.includes(n.id);
                  const isPublished = n.effective_status === "published";
                  // 纯文本截取30个字
                  const plainText = (n.content || "").replace(/<[^>]+>/g, "").trim();
                  const displayText =
                    plainText.length > 30 ? plainText.slice(0, 30) + "..." : plainText;

                  return (
                    <tr
                      key={n.id}
                      className={`transition group ${
                        isChecked ? "bg-[#eff6ff]" : "bg-white hover:bg-[#f8fafc]"
                      }`}
                    >
                      {/* 勾选框：固定列（实色背景防止透字重叠） */}
                      <td
                        style={{ width: 44, minWidth: 44, maxWidth: 44, left: 0 }}
                        className={`sticky left-0 z-10 px-3 py-2 text-center border-b border-r border-slate-200/80 ${
                          isChecked
                            ? "bg-[#eff6ff] group-hover:bg-[#dbeafe]"
                            : "bg-white group-hover:bg-[#f8fafc]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(n.id)}
                          className="rounded text-[rgb(39,99,207)] focus:ring-[rgb(39,99,207)] cursor-pointer"
                        />
                      </td>

                      {/* 消息编号：固定列（实色背景+右侧立体投影分隔线，防止拖动时与后续列重叠） */}
                      <td
                        style={{ width: 170, minWidth: 170, maxWidth: 170, left: 44 }}
                        className={`sticky left-[44px] z-10 px-3 py-2 font-mono whitespace-nowrap border-b border-r border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] ${
                          isChecked
                            ? "bg-[#eff6ff] group-hover:bg-[#dbeafe]"
                            : "bg-white group-hover:bg-[#f8fafc]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenViewDrawer(n)}
                          className="text-[rgb(39,99,207)] hover:underline font-semibold cursor-pointer"
                        >
                          {n.notice_no}
                        </button>
                      </td>

                      {/* 标题：一行完整显示，不准换行 */}
                      <td
                        style={{ width: 220, minWidth: 220, maxWidth: 220 }}
                        className="px-3 py-2 whitespace-nowrap font-medium text-slate-800 border-b border-r border-slate-200/80 overflow-hidden max-w-[220px]"
                      >
                        <div className="truncate w-full" title={n.title}>
                          {n.title}
                        </div>
                      </td>

                      {/* 内容：只显示30字，鼠标悬浮显示 500px 顶层浮窗 */}
                      <td
                        style={{ width: 280, minWidth: 280, maxWidth: 280 }}
                        className="px-3 py-2 whitespace-nowrap text-slate-600 cursor-pointer border-b border-r border-slate-200/80 overflow-hidden max-w-[280px]"
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredNotice({
                            id: n.id,
                            content: n.content,
                            x: Math.min(rect.left, window.innerWidth - 530),
                            y: rect.bottom + 4,
                          });
                        }}
                        onMouseLeave={() => setHoveredNotice(null)}
                      >
                        <div className="truncate w-full hover:text-[rgb(39,99,207)] transition" title={plainText}>
                          {displayText}
                        </div>
                      </td>

                      {/* 生效时间：只显示年月日，不显示时分秒，示例：2026-09-01 ~2026-09-30 */}
                      <td
                        style={{ width: 240, minWidth: 240, maxWidth: 240 }}
                        className="px-3 py-2 whitespace-nowrap font-mono text-slate-600 border-b border-r border-slate-200/80 overflow-hidden max-w-[240px]"
                      >
                        {(n.start_date || (n.start_time ? n.start_time.slice(0, 10) : "")).trim()} ~ {(n.end_date || (n.end_time ? n.end_time.slice(0, 10) : "")).trim()}
                      </td>

                      {/* 弹窗提示 */}
                      <td
                        style={{ width: 90, minWidth: 90, maxWidth: 90 }}
                        className="px-3 py-2 whitespace-nowrap text-center border-b border-r border-slate-200/80 overflow-hidden max-w-[90px]"
                      >
                        {n.popup_prompt ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[rgb(39,99,207)] border border-blue-200">
                            是
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500">
                            否
                          </span>
                        )}
                      </td>

                      {/* 状态：上架 / 下架 */}
                      <td
                        style={{ width: 90, minWidth: 90, maxWidth: 90 }}
                        className="px-3 py-2 whitespace-nowrap text-center border-b border-r border-slate-200/80 overflow-hidden max-w-[90px]"
                      >
                        {isPublished ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>上架</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200 inline-flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            <span>下架</span>
                          </span>
                        )}
                      </td>

                      {/* 创建时间 */}
                      <td
                        style={{ width: 170, minWidth: 170, maxWidth: 170 }}
                        className="px-3 py-2 whitespace-nowrap font-mono text-slate-500 border-b border-r border-slate-200/80 overflow-hidden max-w-[170px]"
                      >
                        {n.created_at}
                      </td>

                      {/* 创建人 */}
                      <td
                        style={{ width: 110, minWidth: 110, maxWidth: 110 }}
                        className="px-3 py-2 whitespace-nowrap text-slate-700 border-b border-r border-slate-200/80 overflow-hidden max-w-[110px]"
                      >
                        <div className="truncate w-full" title={n.created_by}>
                          {n.created_by}
                        </div>
                      </td>

                      {/* 最后操作时间 */}
                      <td
                        style={{ width: 170, minWidth: 170, maxWidth: 170 }}
                        className="px-3 py-2 whitespace-nowrap font-mono text-slate-500 border-b border-r border-slate-200/80 overflow-hidden max-w-[170px]"
                      >
                        {n.updated_at}
                      </td>

                      {/* 最后操作人 */}
                      <td
                        style={{ width: 110, minWidth: 110, maxWidth: 110 }}
                        className="px-3 py-2 whitespace-nowrap text-slate-700 border-b border-slate-200/80 overflow-hidden max-w-[110px]"
                      >
                        <div className="truncate w-full" title={n.updated_by}>
                          {n.updated_by}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 悬浮内容 Tooltip：宽度固定500Px，高度随内容自适应，居于顶层 */}
      {hoveredNotice && (
        <div
          style={{ top: `${hoveredNotice.y}px`, left: `${hoveredNotice.x}px` }}
          className="fixed z-50 w-[500px] max-h-[360px] overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-2xl p-4 text-[13px] text-slate-800 leading-relaxed pointer-events-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="font-bold text-slate-900 border-b border-slate-100 pb-1.5 mb-2 flex items-center gap-1.5">
            <span>📄</span>
            <span>通知完整内容</span>
          </div>
          <div
            className="prose prose-sm max-w-none text-slate-700 break-words"
            dangerouslySetInnerHTML={{ __html: hoveredNotice.content }}
          />
        </div>
      )}

      {/* 8 & 9. 消息通知配置子页面（右侧抽屉，宽度 800px） */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-xs transition-opacity"
            onClick={handleCloseDrawer}
          />

          {/* 抽屉容器：宽度 800px */}
          <div className="relative w-[800px] max-w-full h-full bg-white shadow-2xl z-10 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* 抽屉头部 */}
            <div className="px-6 pt-4 pb-3 flex-none flex items-center justify-between">
              {/* 页面标题：消息通知配置，字号14，加粗，颜色纯黑 */}
              <div className="flex items-center gap-3">
                <h2 className="text-[14px] font-bold text-black tracking-tight">
                  消息通知配置
                </h2>
                {drawerMode === "view" && (
                  <span className="text-[12px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                    查看模式
                  </span>
                )}
                {drawerMode === "edit" && (
                  <span className="text-[12px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    编辑模式
                  </span>
                )}
              </div>

              {/* 9. 查看态右上角显示“编辑”操作按钮，长150px 高25px，颜色 rgb(39,99,207) */}
              <div className="flex items-center gap-3">
                {drawerMode === "view" && (
                  <button
                    type="button"
                    onClick={handleActivateEdit}
                    className="w-[150px] h-[25px] leading-[25px] text-center bg-[rgb(39,99,207)] text-white text-[13px] rounded-[5px] hover:opacity-90 transition font-medium cursor-pointer shadow-2xs"
                  >
                    编辑
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 标题下加一条横线和配置正文内容隔开 */}
            <div className="border-b border-slate-200 w-full flex-none" />

            {/* 表单错误提示 */}
            {formError && (
              <div className="mx-6 mt-3 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded text-rose-600 text-[12px] flex items-center gap-2">
                <span>⚠️</span>
                <span>{formError}</span>
              </div>
            )}

            {/* 配置正文内容区（最大化高度） */}
            <div className="flex-1 px-6 py-4 overflow-y-auto flex flex-col space-y-4 text-[13px]">
              {/* 标题：不超过50字，必填 */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  <span className="text-rose-500 mr-1">*</span>标题（不超过50字）:
                </label>
                <input
                  type="text"
                  maxLength={50}
                  disabled={drawerMode === "view"}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="请输入消息通知标题..."
                  className={`w-full h-[32px] px-3 text-[13px] border rounded outline-none transition ${
                    drawerMode === "view"
                      ? "bg-slate-50 border-slate-200 text-slate-600 cursor-not-allowed"
                      : "bg-white border-slate-300 focus:border-[rgb(39,99,207)] focus:ring-1 focus:ring-[rgb(39,99,207)] text-slate-800"
                  }`}
                />
              </div>

              {/* 生效区间：一个单元格内显示开始和结束日期，选择 yyyy-mm-dd */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  <span className="text-rose-500 mr-1">*</span>生效区间:
                </label>
                <div
                  className={`flex items-center gap-2 border rounded px-3 py-1.5 ${
                    drawerMode === "view"
                      ? "bg-slate-50 border-slate-200"
                      : "bg-white border-slate-300"
                  }`}
                >
                  <div
                    onClick={openStartDatePicker}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border transition cursor-pointer ${
                      drawerMode === "view"
                        ? "bg-slate-100/60 border-slate-200 text-slate-500 cursor-not-allowed"
                        : "bg-white border-slate-300 hover:border-[rgb(39,99,207)] shadow-2xs"
                    }`}
                    title="点击选择开始日期"
                  >
                    <span className="text-slate-400 text-[13px]">📅</span>
                    <input
                      ref={startDateInputRef}
                      type="date"
                      disabled={drawerMode === "view"}
                      value={formStartDate}
                      onClick={(e) => {
                        e.stopPropagation();
                        openStartDatePicker();
                      }}
                      onChange={(e) => setFormStartDate(e.target.value)}
                      className="text-[13px] bg-transparent outline-none text-slate-800 cursor-pointer font-mono"
                    />
                  </div>
                  <span className="text-slate-400 font-mono">00:00:00 ~</span>
                  <div
                    onClick={openEndDatePicker}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border transition cursor-pointer ${
                      drawerMode === "view"
                        ? "bg-slate-100/60 border-slate-200 text-slate-500 cursor-not-allowed"
                        : "bg-white border-slate-300 hover:border-[rgb(39,99,207)] shadow-2xs"
                    }`}
                    title="点击选择结束日期"
                  >
                    <span className="text-slate-400 text-[13px]">📅</span>
                    <input
                      ref={endDateInputRef}
                      type="date"
                      disabled={drawerMode === "view"}
                      value={formEndDate}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEndDatePicker();
                      }}
                      onChange={(e) => setFormEndDate(e.target.value)}
                      className="text-[13px] bg-transparent outline-none text-slate-800 cursor-pointer font-mono"
                    />
                  </div>
                  <span className="text-slate-400 font-mono">23:59:59</span>
                  <span className="ml-auto text-[11px] text-slate-400">
                    （后台默认自开始日 00:00:00 生效至截止日 23:59:59）
                  </span>
                </div>
              </div>

              {/* 弹窗提示：下拉选择，默认值是，支持手动修改 */}
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  <span className="text-rose-500 mr-1">*</span>弹窗提示:
                </label>
                <select
                  disabled={drawerMode === "view"}
                  value={formPopupPrompt ? "yes" : "no"}
                  onChange={(e) => setFormPopupPrompt(e.target.value === "yes")}
                  className={`w-[200px] h-[30px] px-2.5 text-[13px] border rounded outline-none transition ${
                    drawerMode === "view"
                      ? "bg-slate-50 border-slate-200 text-slate-600 cursor-not-allowed"
                      : "bg-white border-slate-300 focus:border-[rgb(39,99,207)] text-slate-800 cursor-pointer"
                  }`}
                >
                  <option value="yes">是（客户进入时自动弹出提醒）</option>
                  <option value="no">否（仅在右侧通知列表展示）</option>
                </select>
              </div>

              {/* 消息通知内容：富文本录入框，最大化高度 */}
              <div className="flex-1 flex flex-col min-h-[300px]">
                <label className="block font-semibold text-slate-800 mb-1">
                  <span className="text-rose-500 mr-1">*</span>消息通知内容:
                </label>

                {/* 富文本快捷工具栏（查看态隐藏） */}
                {drawerMode !== "view" && (
                  <div className="flex items-center flex-wrap gap-1 p-1.5 bg-slate-100 border border-slate-300 border-b-0 rounded-t text-[12px]">
                    <button
                      type="button"
                      onClick={() => execFormat("bold")}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded font-bold hover:bg-slate-50"
                      title="加粗"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => execFormat("italic")}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded italic hover:bg-slate-50"
                      title="斜体"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      onClick={() => execFormat("underline")}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded underline hover:bg-slate-50"
                      title="下划线"
                    >
                      U
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => execFormat("insertUnorderedList")}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-50"
                      title="无序列表"
                    >
                      • 列表
                    </button>
                    <button
                      type="button"
                      onClick={() => execFormat("insertOrderedList")}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-50"
                      title="有序列表"
                    >
                      1. 列表
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleInsertLink}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-50 text-[rgb(39,99,207)]"
                      title="插入链接"
                    >
                      🔗 链接
                    </button>
                    <button
                      type="button"
                      onClick={handleInsertImage}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-50 text-emerald-600"
                      title="插入图片"
                    >
                      🖼️ 图片
                    </button>
                    <button
                      type="button"
                      onClick={() => execFormat("removeFormat")}
                      className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-50 text-slate-500"
                      title="清除格式"
                    >
                      清除格式
                    </button>
                  </div>
                )}

                {/* 编辑内容区域（就是维护填写的内容是什么，前端看到的就是什么样的） */}
                <div
                  ref={editorRef}
                  contentEditable={drawerMode !== "view"}
                  onInput={(e) => setFormContent(e.currentTarget.innerHTML)}
                  className={`flex-1 p-4 border rounded ${
                    drawerMode !== "view" ? "rounded-t-none" : ""
                  } overflow-y-auto leading-relaxed outline-none text-[13px] ${
                    drawerMode === "view"
                      ? "bg-slate-50 border-slate-200 text-slate-800"
                      : "bg-white border-slate-300 focus:border-[rgb(39,99,207)] text-slate-900"
                  }`}
                  style={{ minHeight: "260px" }}
                />
              </div>
            </div>

            {/* 抽屉底部按钮区：
                新建或编辑态下显示“取消”、“提交”
                按钮宽150px 高25px，提交颜色 rgb(39,99,207)，5px圆角矩形 */}
            {drawerMode !== "view" && (
              <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3 flex-none">
                <button
                  type="button"
                  onClick={() => {
                    if (drawerMode === "edit") {
                      setDrawerMode("view");
                    } else {
                      handleCloseDrawer();
                    }
                  }}
                  className="w-[150px] h-[25px] leading-[25px] text-center bg-white border border-slate-300 text-slate-700 text-[13px] rounded-[5px] hover:bg-slate-100 transition font-medium cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitForm}
                  className="w-[150px] h-[25px] leading-[25px] text-center bg-[rgb(39,99,207)] text-white text-[13px] rounded-[5px] hover:opacity-90 transition font-medium cursor-pointer disabled:opacity-50 shadow-2xs"
                >
                  {submitting ? "提交中..." : "提交"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
