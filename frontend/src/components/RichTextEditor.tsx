import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface RichTextEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  maxLength?: number;
  minHeight?: number;
  maxHeight?: number;
  autoGrow?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "详细录入内容，支持加粗、插入超链接、插入图片等...",
  maxLength = 2000,
  minHeight = 160,
  maxHeight,
  autoGrow = false,
  disabled = false,
  ariaLabel = "富文本知识内容",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [fontSize, setFontSize] = useState("");
  const [fontColor, setFontColor] = useState("");
  const [customColor, setCustomColor] = useState("#2563eb");
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncEditorHeight = useCallback(() => {
    const el = editorRef.current;
    if (!el || !autoGrow) return;
    const cap = maxHeight ?? 800;
    el.style.height = "auto";
    const sh = el.scrollHeight;
    if (sh > minHeight) {
      el.style.height = `${Math.min(sh, cap)}px`;
    } else {
      el.style.height = "";
    }
  }, [autoGrow, maxHeight, minHeight]);

  // 同步外部 value 变化到 contentEditable（避免光标跳动，仅在不一致时更新）
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
    }
    syncEditorHeight();
  }, [value, syncEditorHeight]);

  const handleInput = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    syncEditorHeight();
    // 如果只有空标签则视为清空
    if (html === "<br>" || html === "<p><br></p>") {
      onChange("");
    } else {
      onChange(html);
    }
  };

  const insertHtmlAtCursor = (htmlSnippet: string) => {
    if (disabled || !editorRef.current) return;
    const root = editorRef.current;
    root.focus();
    const before = root.innerHTML;
    let executed = false;
    if (typeof document.execCommand === "function") {
      try {
        executed = document.execCommand("insertHTML", false, htmlSnippet);
      } catch {
        executed = false;
      }
    }
    if (!executed || root.innerHTML === before) {
      root.innerHTML = `${before}${htmlSnippet}`;
    }
    handleInput();
  };

  const applyInlineStyleOrTag = (
    command: string,
    cmdValue: string | undefined,
    fallbackWrap: (inner: string) => string,
    postProcess?: (root: HTMLElement) => void,
  ) => {
    if (disabled || !editorRef.current) return;
    const root = editorRef.current;
    root.focus();
    const before = root.innerHTML;
    let executed = false;
    if (typeof document.execCommand === "function") {
      try {
        executed = document.execCommand(command, false, cmdValue);
      } catch {
        executed = false;
      }
    }
    if (postProcess) {
      postProcess(root);
    }
    if (!executed || root.innerHTML === before) {
      const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
      if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode) && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const selectedText = range.toString();
        range.deleteContents();
        const temp = document.createElement("div");
        temp.innerHTML = fallbackWrap(selectedText);
        const frag = document.createDocumentFragment();
        while (temp.firstChild) {
          frag.appendChild(temp.firstChild);
        }
        range.insertNode(frag);
      } else if (root.innerHTML.trim()) {
        root.innerHTML = fallbackWrap(root.innerHTML);
      } else {
        root.innerHTML = fallbackWrap("");
      }
    }
    handleInput();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (disabled || !editorRef.current) return;

    // 检查是否有图片文件直接粘贴
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        if (file.size > 1 * 1024 * 1024) {
          alert("单张图片大小不能超过 1MB");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            insertHtmlAtCursor(
              `<img src="${reader.result}" alt="${file.name}" style="max-width: 100%; border-radius: 6px; margin: 4px 0;" /> `,
            );
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }

    // 纯文本粘贴，彻底阻止剪贴板携带的外部 <span>, <font>, inline style (如 background-color, font-family 等) 污染编辑器
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      document.execCommand("insertText", false, text);
    } else {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    handleInput();
  };

  const exec = (command: string, cmdValue: string | undefined = undefined) => {
    if (disabled || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, cmdValue);
    handleInput();
  };

  const handleBold = () => {
    applyInlineStyleOrTag("bold", undefined, (inner) => `<strong>${inner}</strong>`);
  };

  const handleFontSizeChange = (sizePx: string) => {
    setFontSize(sizePx);
    if (!sizePx) return;
    applyInlineStyleOrTag(
      "fontSize",
      "7",
      (inner) => `<span style="font-size: ${sizePx};">${inner}</span>`,
      (root) => {
        const fonts = root.querySelectorAll('font[size="7"]');
        fonts.forEach((f) => {
          const span = document.createElement("span");
          span.style.fontSize = sizePx;
          span.innerHTML = f.innerHTML;
          f.replaceWith(span);
        });
      },
    );
  };

  const applyColor = (color: string) => {
    if (!color) return;
    applyInlineStyleOrTag(
      "foreColor",
      color,
      (inner) => `<span style="color: ${color};">${inner}</span>`,
      (root) => {
        const fonts = root.querySelectorAll("font[color]");
        fonts.forEach((f) => {
          const c = f.getAttribute("color") || color;
          const span = document.createElement("span");
          span.style.color = c;
          span.innerHTML = f.innerHTML;
          f.replaceWith(span);
        });
      },
    );
  };

  const handleFontColorSelect = (color: string) => {
    setFontColor(color);
    if (!color) return;
    setCustomColor(color);
    applyColor(color);
  };

  const handleInsertLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    const url = linkUrl.trim().startsWith("http") ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    const text = linkText.trim() || url;
    insertHtmlAtCursor(
      `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #2b5ed1; text-decoration: underline;">${text}</a> `,
    );
    setShowLinkModal(false);
    setLinkUrl("");
    setLinkText("");
  };

  const handleInsertImage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl.trim()) return;
    insertHtmlAtCursor(
      `<img src="${imageUrl.trim()}" alt="插入图片" style="max-width: 100%; border-radius: 6px; margin: 4px 0;" /> `,
    );
    setShowImageModal(false);
    setImageUrl("");
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1 * 1024 * 1024) {
      alert("单张图片大小不能超过 1MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        insertHtmlAtCursor(
          `<img src="${reader.result}" alt="${file.name}" style="max-width: 100%; border-radius: 6px; margin: 4px 0;" /> `,
        );
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // 纯文本长度统计
  const textLength = value ? value.replace(/<[^>]+>/g, "").length : 0;

  return (
    <div
      className={`border rounded-[7px] bg-white transition-colors overflow-hidden flex flex-col ${
        isFocused ? "border-hub-teal ring-1 ring-hub-teal/20" : "border-hub-border"
      } ${disabled ? "opacity-60 cursor-not-allowed bg-slate-50" : ""}`}
    >
      {/* 辅助隐藏 textarea：保持 placeholder 查询与 disabled 状态断言向后兼容 */}
      <textarea
        tabIndex={-1}
        aria-hidden="true"
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          if (disabled) return;
          onChange(e.target.value);
        }}
        className="sr-only"
      />

      {/* 顶部操作工具栏 */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-hub-borderLight bg-slate-50/90 text-slate-600 select-none flex-wrap text-[12px]">
        {/* 字体大小 (Font Size) */}
        <select
          aria-label="字体大小"
          title="设置字体大小"
          disabled={disabled}
          value={fontSize}
          onChange={(e) => handleFontSizeChange(e.target.value)}
          className="h-[24px] px-1.5 rounded border border-slate-200 bg-white text-slate-700 text-[11.5px] outline-none hover:border-slate-300 cursor-pointer disabled:cursor-not-allowed"
        >
          <option value="">字号</option>
          <option value="12px">12px</option>
          <option value="14px">14px</option>
          <option value="16px">16px</option>
          <option value="18px">18px</option>
          <option value="20px">20px</option>
          <option value="24px">24px</option>
        </select>

        {/* 加粗 (Bold) */}
        <button
          type="button"
          disabled={disabled}
          onClick={handleBold}
          className="p-1 px-1.5 rounded hover:bg-slate-200 font-bold transition-colors cursor-pointer text-[12.5px] leading-none"
          title="加粗 (Ctrl+B)"
          aria-label="加粗"
        >
          B
        </button>

        {/* 斜体 (Italic) */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => exec("italic")}
          className="p-1 px-1.5 rounded hover:bg-slate-200 italic font-serif transition-colors cursor-pointer text-[12.5px] leading-none"
          title="斜体 (Ctrl+I)"
          aria-label="斜体"
        >
          I
        </button>

        {/* 字体颜色 (Font Color) */}
        <div className="inline-flex items-center gap-1">
          <select
            aria-label="字体颜色"
            title="设置字体颜色"
            disabled={disabled}
            value={fontColor}
            onChange={(e) => handleFontColorSelect(e.target.value)}
            className="h-[24px] px-1.5 rounded border border-slate-200 bg-white text-slate-700 text-[11.5px] outline-none hover:border-slate-300 cursor-pointer disabled:cursor-not-allowed"
          >
            <option value="">颜色</option>
            <option value="#1e293b">默认黑</option>
            <option value="#ef4444">红色</option>
            <option value="#f97316">橙色</option>
            <option value="#eab308">黄色</option>
            <option value="#10b981">绿色</option>
            <option value="#2563eb">蓝色</option>
            <option value="#7c3aed">紫色</option>
            <option value="#64748b">灰色</option>
          </select>
          <input
            type="color"
            aria-label="自定义字体颜色"
            title="自定义字体颜色"
            disabled={disabled}
            value={customColor}
            onChange={(e) => {
              setCustomColor(e.target.value);
              setFontColor(e.target.value);
              applyColor(e.target.value);
            }}
            className="w-5 h-5 p-0 border border-slate-200 rounded cursor-pointer bg-white disabled:cursor-not-allowed"
          />
        </div>

        {/* 无序列表 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => exec("insertUnorderedList")}
          className="p-1 px-1.5 rounded hover:bg-slate-200 transition-colors cursor-pointer text-[12px] leading-none"
          title="无序列表"
          aria-label="无序列表"
        >
          • 列表
        </button>

        <span className="h-3.5 w-px bg-slate-300 mx-1" />

        {/* 插入超链接 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowLinkModal(true)}
          className="p-1 px-1.5 rounded hover:bg-slate-200 transition-colors cursor-pointer flex items-center gap-1 text-[11.5px]"
          title="插入超链接"
          aria-label="插入超链接"
        >
          <span>🔗</span>
          <span>链接</span>
        </button>

        {/* 插入图片 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="p-1 px-1.5 rounded hover:bg-slate-200 transition-colors cursor-pointer flex items-center gap-1 text-[11.5px]"
          title="本地图片插入"
          aria-label="插入图片"
        >
          <span>🖼️</span>
          <span>图片</span>
        </button>

        {typeof document !== "undefined"
          ? createPortal(
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                data-testid="rich-text-image-input"
                className="hidden"
                onChange={handleImageFileUpload}
              />,
              document.body,
            )
          : null}

        {/* 图片 URL 弹窗按钮 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowImageModal(true)}
          className="p-1 px-1 rounded hover:bg-slate-200 transition-colors cursor-pointer text-[11px] text-slate-500"
          title="插入网络图片链接"
          aria-label="网络图片"
        >
          (URL)
        </button>

        <span className="h-3.5 w-px bg-slate-300 mx-1" />

        {/* 清空格式 */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => exec("removeFormat")}
          className="p-1 px-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors cursor-pointer text-[11px]"
          title="清除选中文本样式"
          aria-label="清除格式"
        >
          清样式
        </button>
      </div>

      {/* 富文本编辑区域 */}
      <div className="relative flex-1 p-3">
        {(!value || value === "<br>") && !isFocused && (
          <div className="absolute top-3 left-3 text-slate-400 text-[12.5px] pointer-events-none select-none">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          onInput={handleInput}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            minHeight,
            ...(maxHeight ? { maxHeight } : {}),
          }}
          className={`outline-none text-[12.5px] text-slate-800 leading-relaxed break-words whitespace-pre-wrap select-text [&_a]:text-[#2b5ed1] [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ${
            maxHeight ? "overflow-y-auto" : ""
          }`}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
        />
      </div>

      {/* 底部字数统计 */}
      <div className="px-3 py-1 bg-slate-50/60 border-t border-hub-borderLight text-right text-[11px] text-slate-400 font-mono">
        <span className={textLength > maxLength ? "text-rose-500 font-bold" : ""}>
          {textLength}
        </span>
        /{maxLength}
      </div>

      {/* 插入链接 Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/40">
          <form
            onSubmit={handleInsertLink}
            className="bg-white rounded-[10px] shadow-xl border border-hub-border p-4 w-[340px] max-w-full space-y-3 font-hub text-[12.5px]"
          >
            <div className="font-bold text-[13.5px] text-slate-900">插入超链接</div>
            <div>
              <label className="block text-slate-600 mb-1 text-[11.5px]">链接地址 (URL)</label>
              <input
                type="text"
                autoFocus
                required
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="w-full h-[32px] border border-hub-border rounded-[6px] px-2.5 outline-none focus:border-hub-teal text-[12px]"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1 text-[11.5px]">显示文本 (可选)</label>
              <input
                type="text"
                placeholder="若不填默认显示网址"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                className="w-full h-[32px] border border-hub-border rounded-[6px] px-2.5 outline-none focus:border-hub-teal text-[12px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="px-3 py-1 border border-hub-border rounded-[6px] text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3 py-1 bg-hub-teal text-white rounded-[6px] font-semibold hover:brightness-95 cursor-pointer"
              >
                插入
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 插入图片 URL Modal */}
      {showImageModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/40">
          <form
            onSubmit={handleInsertImage}
            className="bg-white rounded-[10px] shadow-xl border border-hub-border p-4 w-[340px] max-w-full space-y-3 font-hub text-[12.5px]"
          >
            <div className="font-bold text-[13.5px] text-slate-900">插入网络图片</div>
            <div>
              <label className="block text-slate-600 mb-1 text-[11.5px]">图片链接 (URL)</label>
              <input
                type="url"
                autoFocus
                required
                placeholder="https://example.com/image.png"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full h-[32px] border border-hub-border rounded-[6px] px-2.5 outline-none focus:border-hub-teal text-[12px]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                className="px-3 py-1 border border-hub-border rounded-[6px] text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3 py-1 bg-hub-teal text-white rounded-[6px] font-semibold hover:brightness-95 cursor-pointer"
              >
                插入
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
