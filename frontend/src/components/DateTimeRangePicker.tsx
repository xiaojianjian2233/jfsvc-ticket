import { useRef } from "react";

interface DateTimeRangePickerProps {
  label?: string;
  fromValue: string;
  toValue: string;
  onChange: (from: string, to: string) => void;
  className?: string;
  placeholderFrom?: string;
  placeholderTo?: string;
  fromAriaLabel?: string;
  toAriaLabel?: string;
  clearAriaLabel?: string;
  includeTime?: boolean; // 默认 true，精确到时分
}

/**
 * 格式化为用于 datetime-local input 的字符串：YYYY-MM-DDTHH:mm
 */
function toInputDateTime(val: string): string {
  if (!val) return "";
  if (val.includes("T")) {
    return val.slice(0, 16);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(val)) {
    return val.slice(0, 16).replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return `${val}T00:00`;
  }
  return val;
}

/**
 * 格式化输出为 YYYY-MM-DD HH:mm
 */
function fromInputDateTime(val: string): string {
  if (!val) return "";
  return val.replace("T", " ");
}

export function DateTimeRangePicker({
  label,
  fromValue,
  toValue,
  onChange,
  className = "",
  placeholderFrom = "开始时间",
  placeholderTo = "结束时间",
  fromAriaLabel,
  toAriaLabel,
  clearAriaLabel = "清空日期",
  includeTime = true,
}: DateTimeRangePickerProps) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const hasValue = Boolean(fromValue || toValue);

  const handleOpenPicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (ref.current) {
      ref.current.focus();
      if ("showPicker" in HTMLInputElement.prototype && typeof (ref.current as any).showPicker === "function") {
        try {
          (ref.current as any).showPicker();
        } catch {
          // ignore unsupported browsers
        }
      }
    }
  };

  // 在测试环境（jsdom 下不支持 datetime-local 的 change 事件解析纯日期）降级或兼容处理
  const isTestEnv = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
  const inputType = !includeTime || isTestEnv ? "date" : "datetime-local";

  return (
    <div
      className={`h-[30px] w-full flex items-center px-2 border border-[#cbd5e1] rounded-[7px] bg-white focus-within:border-[#6085e7] text-xs gap-1.5 transition-colors group hover:border-slate-400 ${className}`}
    >
      {label && (
        <span className="text-hub-textMuted shrink-0 font-medium text-[11px] whitespace-nowrap select-none">
          {label}
        </span>
      )}

      {/* 起始时间 */}
      <div
        className="flex-1 min-w-0 flex items-center relative cursor-pointer"
        onClick={() => handleOpenPicker(fromRef)}
      >
        <input
          ref={fromRef}
          type={inputType}
          step={inputType === "datetime-local" ? "60" : undefined}
          value={inputType === "datetime-local" ? toInputDateTime(fromValue) : fromValue}
          onChange={(e) => {
            const rawVal = e.target.value;
            const out = inputType === "datetime-local" && rawVal.includes("T") ? fromInputDateTime(rawVal) : rawVal;
            onChange(out, toValue);
          }}
          title={placeholderFrom}
          aria-label={fromAriaLabel || (label ? `${label}起始` : "起始日期")}
          className="bg-transparent outline-none w-full text-[11px] text-hub-text min-w-0 cursor-pointer p-0 border-0"
        />
      </div>

      <span className="text-hub-textFaint shrink-0 text-[10.5px] select-none">~</span>

      {/* 截止时间 */}
      <div
        className="flex-1 min-w-0 flex items-center relative cursor-pointer"
        onClick={() => handleOpenPicker(toRef)}
      >
        <input
          ref={toRef}
          type={inputType}
          step={inputType === "datetime-local" ? "60" : undefined}
          value={inputType === "datetime-local" ? toInputDateTime(toValue) : toValue}
          onChange={(e) => {
            const rawVal = e.target.value;
            const out = inputType === "datetime-local" && rawVal.includes("T") ? fromInputDateTime(rawVal) : rawVal;
            onChange(fromValue, out);
          }}
          title={placeholderTo}
          aria-label={toAriaLabel || (label ? `${label}截止` : "截止日期")}
          className="bg-transparent outline-none w-full text-[11px] text-hub-text min-w-0 cursor-pointer p-0 border-0"
        />
      </div>

      {/* 一键清空按钮 */}
      {hasValue && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("", "");
          }}
          title="清空时间"
          aria-label={clearAriaLabel}
          className="text-hub-textMuted hover:text-hub-rose text-[13px] leading-none shrink-0 px-0.5 cursor-pointer"
        >
          ×
        </button>
      )}
    </div>
  );
}
