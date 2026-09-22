import { useState } from "react";
import { type ClientEvaluationPayload } from "../receptionApi";

interface CustomerEvaluationModalProps {
  isOpen: boolean;
  sessionId: string;
  onClose: () => void;
  onSubmit: (evaluation: ClientEvaluationPayload) => Promise<void>;
}

const DEFAULT_TAGS = [
  "响应迅速",
  "专业耐心",
  "讲解清晰",
  "态度友好",
  "流程顺畅",
  "问题已解决",
  "方案实用",
  "问题未解决",
];

const RATING_LABELS = [
  "",
  "非常不满意",
  "不满意",
  "一般",
  "满意",
  "非常满意",
];

export function CustomerEvaluationModal({
  isOpen,
  sessionId,
  onClose,
  onSubmit,
}: CustomerEvaluationModalProps) {
  const [score, setScore] = useState<number>(5);
  const [hoverScore, setHoverScore] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>(["响应迅速", "专业耐心"]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        score,
        tags: selectedTags,
        comment: comment.trim(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const activeScore = hoverScore || score;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[460px] max-w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="px-5 py-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">服务满意度评价</h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">会话ID: {sessionId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200/50 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 评价内容区 */}
        <div className="p-6 space-y-5">
          {/* 星级打分 */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverScore(star)}
                  onMouseLeave={() => setHoverScore(0)}
                  onClick={() => setScore(star)}
                  className="text-3xl transition-transform hover:scale-110 cursor-pointer focus:outline-none"
                  title={`${star}星 - ${RATING_LABELS[star]}`}
                >
                  <span
                    className={
                      star <= activeScore ? "text-amber-400" : "text-slate-200"
                    }
                  >
                    ★
                  </span>
                </button>
              ))}
            </div>
            <div className="text-sm font-semibold text-amber-600 h-5">
              {RATING_LABELS[activeScore] || "请为本次服务打分"}
            </div>
          </div>

          {/* 快捷评价标签 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              请选择服务体验标签（支持多选）
            </label>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_TAGS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-full text-xs transition cursor-pointer ${
                      active
                        ? "bg-blue-50 text-[rgb(35,94,212)] border border-[rgb(35,94,212)] font-medium shadow-2xs"
                        : "bg-slate-100 text-slate-600 border border-transparent hover:bg-slate-200"
                    }`}
                  >
                    {active ? `✓ ${tag}` : tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 文本反馈 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              其他意见与建议（选填）
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="请留下您宝贵的意见，帮助我们不断改善服务质量..."
              className="w-full resize-none p-2.5 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[rgb(35,94,212)] focus:ring-1 focus:ring-[rgb(35,94,212)]/30"
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-100 cursor-pointer transition"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="px-5 py-1.5 rounded-md bg-[rgb(35,94,212)] text-white text-xs font-medium hover:opacity-90 cursor-pointer shadow-xs transition disabled:opacity-60"
          >
            {submitting ? "提交中..." : "提交评价"}
          </button>
        </div>
      </div>
    </div>
  );
}
