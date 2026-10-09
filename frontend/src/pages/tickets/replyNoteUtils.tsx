
export interface TaskNoteItem {
  code: string;
  title: string;
  solution: string;
  type?: string;
  status?: string;
  isDevTransferred?: boolean;
  ticketContent?: string;
}

/** 判断任务是否为需求或Bug类（研发类任务） */
export function isDemandOrBug(type?: string | null): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return (
    t === "demand" ||
    t === "bug_fix" ||
    t === "bug" ||
    t.includes("需求") ||
    t.includes("bug")
  );
}

/** 获取任务类型展示标签：需求 / bug / 应用类 */
export function getTaskTypeLabel(type?: string | null): string {
  if (!type) return "应用类";
  const t = type.toLowerCase();
  if (t === "demand" || t.includes("需求")) return "需求";
  if (t === "bug_fix" || t === "bug" || t.includes("bug")) return "bug";
  return "应用类";
}

/**
 * 清理子任务标题，确保仅保留单行纯净的任务说明，
 * 彻底剥离多行标题中可能附带的客户原始问题描述、AI 诊断提示词头或宿主上下文。
 */
export function sanitizeTaskTitle(
  rawTitle?: string | null,
  ticketContent?: string | null,
): string {
  if (!rawTitle) return "";
  let text = stripHtmlToCleanText(rawTitle).trim();
  if (!text) return "";

  // 若包含 AI 提示词模板中的「标题：xxx」，优先提取标题行
  const titleMatch = text.match(/(?:^|\n)\s*标题[：:]\s*([^\n]+)/);
  if (titleMatch && titleMatch[1]?.trim()) {
    text = titleMatch[1].trim();
  } else {
    // 否则取第一个非提示词头的有效单行，剥离第2行及之后的原始问题正文/宿主上下文
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const validLine = lines.find(
      (l) =>
        !/^请对下面这张工单/.test(l) &&
        !/^你当前处于/.test(l) &&
        !/^#+\s*工单/.test(l) &&
        !/^客户描述[：:]?$/.test(l) &&
        !/^原始问题描述[：:]?$/.test(l),
    );
    text = validLine || lines[0] || "";
  }

  // 剥离可能已带有的类型前缀（避免重复拼接）
  text = text.replace(/^\s*问题\d+[：:]\s*【[^】]+】-[^-]+-/, "");
  text = text.replace(/^\s*【(?:需求|BUG|bug|Bug|应用类)】-?/, "");
  // 剥离内联（宿主上下文：...）后缀
  text = text.replace(/\s*[（(]宿主上下文[：:][\s\S]*$/, "");

  if (ticketContent && ticketContent.trim()) {
    const rawTicket = ticketContent.trim();
    if (text.length > rawTicket.length && text.endsWith(rawTicket)) {
      text = text.slice(0, text.length - rawTicket.length).trim();
    }
  }

  return text.trim();
}

/** 拆解研发类任务解决方案中的【沟通记录】与【产研反馈】/【研发反馈】部分，并过滤混入的客户原始问题 */
export function extractDevSolutionParts(
  solutionText: string | null | undefined,
  ticketContent?: string | null,
): {
  communicationNote: string;
  feedbackNote: string;
} {
  if (!solutionText) return { communicationNote: "", feedbackNote: "" };
  let text = stripHtmlToCleanText(solutionText).trim();

  // 递归剥离可能残留的多任务外层包装（如 问题1:【需求】...）
  text = text.replace(/^工单包含问题数[量]?[：:]?\s*\d+\s*/i, "");
  text = text.replace(/^问题\d+[：:]\s*【[^】]+】[^\n]*\n?/g, "");

  // 剥离可能存在的首行标题（例如 【需求】-任务说明 或 【bug】-任务说明）及紧随其后的原始问题行
  const lines = text.split("\n");
  if (lines.length > 0 && /^\s*【(需求|BUG|bug|Bug|应用类)】-?/.test(lines[0])) {
    lines.shift();
    while (
      lines.length > 0 &&
      !/^\s*【?(沟通记录|产研反馈|研发反馈|解决方案)】?/.test(lines[0]) &&
      lines.some((l) => /^\s*【?(沟通记录|产研反馈|研发反馈)】?/.test(l))
    ) {
      lines.shift();
    }
    text = lines.join("\n").trim();
  }

  // 剥离可能混入的 Markdown 原始问题描述段落或客户描述段落
  text = text.replace(/\n*###\s*📝?\s*原始问题描述[\s\S]*$/i, "").trim();
  text = text.replace(/\n*##\s*工单[\s\S]*$/i, "").trim();
  text = text.replace(/\n*[（(]宿主上下文[：:][\s\S]*$/i, "").trim();

  const commIndex = text.indexOf("【沟通记录】");
  let fbIndex = text.indexOf("【产研反馈】");
  let fbTagLen = "【产研反馈】".length;
  if (fbIndex === -1) {
    fbIndex = text.indexOf("【研发反馈】");
    fbTagLen = "【研发反馈】".length;
  }

  let comm = "";
  let fb = "";

  if (commIndex !== -1 || fbIndex !== -1) {
    if (commIndex !== -1 && fbIndex !== -1) {
      if (commIndex < fbIndex) {
        comm = text.slice(commIndex + "【沟通记录】".length, fbIndex).trim();
        fb = text.slice(fbIndex + fbTagLen).trim();
      } else {
        fb = text.slice(fbIndex + fbTagLen, commIndex).trim();
        comm = text.slice(commIndex + "【沟通记录】".length).trim();
      }
    } else if (commIndex !== -1) {
      comm = text.slice(commIndex + "【沟通记录】".length).trim();
    } else if (fbIndex !== -1) {
      fb = text.slice(fbIndex + fbTagLen).trim();
    }
  } else {
    comm = text;
  }

  comm = comm.replace(/^[：:]\s*/, "").trim();
  fb = fb.replace(/^[：:]\s*/, "").trim();

  // 若沟通记录中混入了客户原始问题内容，将其剔除
  if (ticketContent && ticketContent.trim()) {
    const cleanTicket = stripHtmlToCleanText(ticketContent).trim();
    if (cleanTicket) {
      if (comm === cleanTicket) {
        comm = "";
      } else if (comm.startsWith(cleanTicket + "\n")) {
        comm = comm.slice(cleanTicket.length).trim();
      } else if (comm.endsWith("\n" + cleanTicket)) {
        comm = comm.slice(0, comm.length - cleanTicket.length).trim();
      }
    }
  }

  return { communicationNote: comm, feedbackNote: fb };
}

/** 判断字段是否为空或系统占位符（如 "---", "--", "-", "——", "—", "无", "暂无", "null", "undefined"） */
export function isFieldEmpty(val?: string | null): boolean {
  if (!val) return true;
  const s = val.trim();
  return (
    !s ||
    s === "---" ||
    s === "--" ||
    s === "-" ||
    s === "——" ||
    s === "—" ||
    s === "无" ||
    s === "暂无" ||
    s === "null" ||
    s === "undefined"
  );
}

/** 基础占位词黑名单判断（系统默认内容不是值） */
export function isPlaceholderWord(val?: string | null): boolean {
  if (!val) return true;
  const s = val.trim();
  return (
    !s ||
    s === "---" ||
    s === "--" ||
    s === "-" ||
    s === "——" ||
    s === "—" ||
    s === "无" ||
    s === "暂无" ||
    s === "null" ||
    s === "undefined" ||
    s === "转产研上下文" ||
    s === "录入说明" ||
    s === "请录入" ||
    s === "请填写" ||
    s === "产研分析中暂无回复"
  );
}

/**
 * 将富文本内容转换为纯净文本（剥离 HTML 标签及内联样式，如 <span style="..."> 等，保留正常换行与段落）
 */
export function stripHtmlToCleanText(html: string | null | undefined): string {
  if (!html) return "";
  const raw = html.trim();
  if (!raw) return "";

  // 如果不包含 HTML 标签特征与实体，直接返回
  if (!/<[a-z][\s\S]*>/i.test(raw) && !/&[a-z0-9#]+;/i.test(raw)) {
    return raw;
  }

  // 1. 如果在浏览器或 jsdom 环境中，利用 DOM 解析
  if (typeof document !== "undefined") {
    try {
      const container = document.createElement("div");
      container.innerHTML = raw;

      // 替换 <br> 为换行
      const brs = container.querySelectorAll("br");
      brs.forEach((br) => {
        br.replaceWith("\n");
      });

      // 替换 <li> 为换行+列表符号
      const lis = container.querySelectorAll("li");
      lis.forEach((li) => {
        const text = li.textContent || "";
        li.textContent = `• ${text}\n`;
      });

      // 块级元素后面增加换行
      const blocks = container.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, tr");
      blocks.forEach((block) => {
        block.insertAdjacentText("beforeend", "\n");
      });

      let text = container.textContent || container.innerText || "";
      // 将特殊空格（如 &nbsp; 生成的 \u00a0）替换为普通空格
      text = text.replace(/\u00a0/g, " ");
      // 规整多余连续换行（最多保留2个连续换行）与首尾空白
      text = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return text;
    } catch {
      // fallback to regex below
    }
  }

  // 2. 正则降级解析（在无 DOM 环境或异常时）
  let text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * 判断解决方案内容是否为真实有效的值（过滤系统默认占位符与空模板）
 */
export function isValidSolution(sol?: string | null): boolean {
  if (!sol) return false;
  const clean = stripHtmlToCleanText(sol);
  const raw = clean.trim();
  if (!raw || isPlaceholderWord(raw)) return false;

  // 研发类：如果包含【沟通记录】或【产研反馈】/【研发反馈】标签，拆解剥离后检查实际文字
  if (
    raw.includes("【沟通记录】") ||
    raw.includes("【产研反馈】") ||
    raw.includes("【研发反馈】")
  ) {
    const { communicationNote, feedbackNote } = extractDevSolutionParts(raw);
    const commValid = !isPlaceholderWord(communicationNote);
    const fbValid = !isPlaceholderWord(feedbackNote);
    return commValid || fbValid;
  }

  // 纯解决方案：剥离【解决方案】前缀后检查
  const pure = extractPureSolution(raw);
  if (!pure || isPlaceholderWord(pure)) {
    return false;
  }

  return true;
}

/** 递归剥离模板外层前缀，还原真实纯净解决方案文本，坚决杜绝多次嵌套拼接 */
export function extractPureSolution(text: string | null | undefined): string {
  if (!text) return "";
  let cur = stripHtmlToCleanText(text).trim();
  while (
    cur.includes("解决方案：") ||
    cur.includes("解决方案:") ||
    cur.includes("【解决方案】") ||
    cur.startsWith("工单包含问题数：") ||
    cur.startsWith("工单包含问题数:") ||
    cur.startsWith("工单包含问题数量：") ||
    cur.startsWith("工单包含问题数量:") ||
    cur.startsWith("工单包含问题数量")
  ) {
    const match = cur.match(/【?解决方案】?[：:]?\s*([\s\S]*)$/);
    if (match && match[1] !== undefined) {
      cur = stripHtmlToCleanText(match[1]).trim();
    } else {
      break;
    }
  }
  return cur;
}

/** 判断任务是否处于已转产研/已退回/已完成状态（需要展示【产研反馈】行） */
function shouldShowDevFeedback(t: TaskNoteItem, feedbackNote: string): boolean {
  if (feedbackNote && feedbackNote.trim()) return true;
  if (t.isDevTransferred) return true;
  const st = (t.status || "").toLowerCase();
  return (
    st === "processing" ||
    st === "in_progress" ||
    st === "dev_returned" ||
    st === "returned" ||
    st === "answered" ||
    st === "released" ||
    st === "resolved"
  );
}

/** 判断文本是否为需求/Bug类的模板内容（含【沟通记录】【产研反馈】【研发反馈】或【需求】/【bug】头） */
export function isDevTemplateText(text?: string | null): boolean {
  if (!text) return false;
  const clean = stripHtmlToCleanText(text).trim();
  if (!clean) return false;
  return (
    clean.includes("【沟通记录】") ||
    clean.includes("【产研反馈】") ||
    clean.includes("【研发反馈】") ||
    /^\s*【(?:需求|BUG|bug|Bug)】-?/.test(clean)
  );
}

/** 格式化生成工单处理说明 */
export function formatTasksReplyNote(tasks: TaskNoteItem[]): string {
  if (tasks.length === 0) return "";

  // 1. 单任务场景
  if (tasks.length === 1) {
    const t = tasks[0];
    const isDev = isDemandOrBug(t.type);
    if (!isDev) {
      // 应用类：无有效解决方案或残留了产研模板内容时，清空不显示；有有效方案则直接展示解决方案
      if (!isValidSolution(t.solution) || isDevTemplateText(t.solution)) {
        return "";
      }
      const pureSol = extractPureSolution(t.solution);
      return pureSol && pureSol.trim() ? pureSol.trim() : (t.solution?.trim() || "");
    }

    // 需求或Bug类展示模板：
    // 【bug】-任务说明（严禁附带客户原始问题）
    // 【沟通记录】沟通记录内容
    // 【产研反馈】：产研反馈内容（转产研后无回复显示“产研分析中暂无回复”）
    const typeLabel = getTaskTypeLabel(t.type);
    const cleanTitle = sanitizeTaskTitle(t.title, t.ticketContent) || "---";
    const { communicationNote, feedbackNote } = extractDevSolutionParts(
      t.solution,
      t.ticketContent,
    );
    const lines = [`【${typeLabel}】-${cleanTitle}`];
    lines.push(`【沟通记录】${communicationNote || ""}`);
    if (shouldShowDevFeedback(t, feedbackNote)) {
      const fbText = feedbackNote && feedbackNote.trim() ? feedbackNote.trim() : "产研分析中暂无回复";
      lines.push(`【产研反馈】：${fbText}`);
    }
    return lines.join("\n");
  }

  // 2. 多任务场景（tasks.length > 1）
  const lines: string[] = [`工单包含问题数量${tasks.length}`];
  tasks.forEach((t, idx) => {
    const code = t.code || "---";
    const cleanTitle = sanitizeTaskTitle(t.title, t.ticketContent) || "---";
    const isDev = isDemandOrBug(t.type);
    const typeLabel = getTaskTypeLabel(t.type);

    if (isDev) {
      const { communicationNote, feedbackNote } = extractDevSolutionParts(
        t.solution,
        t.ticketContent,
      );
      lines.push(`问题${idx + 1}:【${typeLabel}】-${code}-${cleanTitle}`);
      lines.push(`【沟通记录】${communicationNote || "---"}`);
      if (shouldShowDevFeedback(t, feedbackNote)) {
        const fbText =
          feedbackNote && feedbackNote.trim() ? feedbackNote.trim() : "产研分析中暂无回复";
        lines.push(`【产研反馈】：${fbText}`);
      }
    } else {
      const pureSol =
        !isValidSolution(t.solution) || isDevTemplateText(t.solution)
          ? ""
          : extractPureSolution(t.solution);
      const sol = pureSol && pureSol.trim() ? pureSol.trim() : "---";
      lines.push(`问题${idx + 1}:【应用类】-${code}-${cleanTitle}`);
      lines.push(`【解决方案】${sol}`);
    }

    if (idx < tasks.length - 1) {
      lines.push(""); // 每个问题之间间隔1行
    }
  });

  return lines.join("\n");
}

/** 回写与回填：将处理说明中的文本按子任务解析回填 */
export function parseReplyNoteSolutions(
  content: string,
  tasks: { code: string; key: string | number; type?: string }[],
): Record<string | number, string> {
  const result: Record<string | number, string> = {};
  if (!content || !content.trim() || tasks.length === 0) return result;

  const trimmed = content.trim();
  const usesLegacyFeedbackTag =
    trimmed.includes("【研发反馈】") && !trimmed.includes("【产研反馈】");
  const fbPrefix = usesLegacyFeedbackTag ? "【研发反馈】" : "【产研反馈】：";

  // 单任务回写解析
  if (tasks.length === 1) {
    const t = tasks[0];
    if (isDemandOrBug(t.type)) {
      const { communicationNote, feedbackNote } = extractDevSolutionParts(trimmed);
      const cleanComm = isPlaceholderWord(communicationNote) ? "" : communicationNote;
      const cleanFb = isPlaceholderWord(feedbackNote) ? "" : feedbackNote;
      if (cleanFb) {
        result[t.key] = `【沟通记录】${cleanComm}\n${fbPrefix}${cleanFb}`;
      } else {
        result[t.key] = cleanComm;
      }
    } else {
      const pure = extractPureSolution(trimmed);
      result[t.key] = isPlaceholderWord(pure) ? "" : pure;
    }
    return result;
  }

  // 多任务回写解析
  const lines = trimmed.split("\n");
  let currentTaskIdx = -1;
  let currentMode: "solution" | "communication" | "feedback" | null = null;
  let solLines: string[] = [];
  let commLines: string[] = [];
  let fbLines: string[] = [];

  const flushCurrentTask = () => {
    if (currentTaskIdx >= 0 && currentTaskIdx < tasks.length) {
      const t = tasks[currentTaskIdx];
      const taskKey = t.key;
      const isDev = isDemandOrBug(t.type);

      if (isDev) {
        const comm = commLines.join("\n").trim();
        const fb = fbLines.join("\n").trim();
        const cleanComm = isPlaceholderWord(comm) ? "" : comm;
        const cleanFb = isPlaceholderWord(fb) ? "" : fb;
        if (cleanFb) {
          result[taskKey] = `【沟通记录】${cleanComm}\n${fbPrefix}${cleanFb}`;
        } else if (cleanComm) {
          result[taskKey] = cleanComm;
        } else if (solLines.length > 0) {
          const sol = solLines.join("\n").trim();
          const pure = extractPureSolution(sol);
          result[taskKey] = isPlaceholderWord(pure) ? "" : pure;
        } else {
          result[taskKey] = "";
        }
      } else {
        const fullSol = solLines.join("\n").trim();
        if (fullSol) {
          const pure = extractPureSolution(fullSol);
          result[taskKey] = isPlaceholderWord(pure) ? "" : pure;
        } else if (commLines.length > 0) {
          const comm = commLines.join("\n").trim();
          result[taskKey] = isPlaceholderWord(comm) ? "" : comm;
        } else {
          result[taskKey] = "";
        }
      }
    }
    currentMode = null;
    solLines = [];
    commLines = [];
    fbLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchProblem = line.match(/^\s*【?问题(\d+)】?[:：]?(.*)$/);
    if (matchProblem) {
      flushCurrentTask();
      const pIdx = parseInt(matchProblem[1], 10) - 1;
      currentTaskIdx = pIdx;
      continue;
    }

    const matchSolution = line.match(/^\s*【?解决方案】?[:：]?(.*)$/);
    if (matchSolution) {
      currentMode = "solution";
      solLines = [matchSolution[1].trim()];
      continue;
    }

    const matchComm = line.match(/^\s*【?沟通记录】?[:：]?(.*)$/);
    if (matchComm) {
      currentMode = "communication";
      commLines = [matchComm[1].trim()];
      continue;
    }

    const matchFeedback = line.match(/^\s*【?(?:产研反馈|研发反馈)】?[:：]?(.*)$/);
    if (matchFeedback) {
      currentMode = "feedback";
      fbLines = [matchFeedback[1].trim()];
      continue;
    }

    if (currentMode === "solution") {
      solLines.push(line);
    } else if (currentMode === "communication") {
      commLines.push(line);
    } else if (currentMode === "feedback") {
      fbLines.push(line);
    }
  }

  flushCurrentTask();

  // 容错兜底：若仅有1个任务且未解析出结果，回退赋值（过滤系统默认占位词）
  if (Object.keys(result).length === 0 && tasks.length === 1) {
    const pure = extractPureSolution(trimmed);
    if (!isPlaceholderWord(pure)) {
      result[tasks[0].key] = pure;
    }
  }

  return result;
}

/** 渲染美化处理说明 */
export function renderFormattedReplyNote(content: string) {
  if (!content) {
    return <span className="text-hub-textFaint">暂无处理说明</span>;
  }
  const cleanContent = stripHtmlToCleanText(content);
  if (!cleanContent) {
    return <span className="text-hub-textFaint">暂无处理说明</span>;
  }
  const lines = cleanContent.split("\n");
  return (
    <div className="space-y-1 text-[12.5px] leading-relaxed select-text font-sans">
      {lines.map((line, idx) => {
        if (!line.trim()) {
          return <div key={idx} className="h-3.5" />;
        }
        const matchTotal = line.match(/^(\s*工单包含问题数[量]?[:：]?\s*\d*)(.*)$/);
        if (matchTotal) {
          return (
            <div key={idx} className="font-bold text-slate-800">
              {line}
            </div>
          );
        }
        const matchSingleHeader = line.match(/^(\s*【(?:需求|BUG|bug|Bug|应用类)】-?)(.*)$/);
        if (matchSingleHeader) {
          return (
            <div key={idx}>
              <strong className="font-bold text-slate-900">{matchSingleHeader[1]}</strong>
              <span className="font-semibold text-slate-800">{matchSingleHeader[2]}</span>
            </div>
          );
        }
        const matchProblem = line.match(/^(\s*【?问题\d+】?[:：]?)(.*)$/);
        if (matchProblem) {
          return (
            <div key={idx}>
              <strong className="font-bold text-slate-900">{matchProblem[1]}</strong>
              <span>{matchProblem[2]}</span>
            </div>
          );
        }
        const matchSolution = line.match(/^(\s*【?解决方案】?[:：]?)(.*)$/);
        if (matchSolution) {
          return (
            <div key={idx}>
              <strong className="font-bold text-slate-900">{matchSolution[1]}</strong>
              <span>{matchSolution[2]}</span>
            </div>
          );
        }
        const matchComm = line.match(/^(\s*【?沟通记录】?[:：]?)(.*)$/);
        if (matchComm) {
          return (
            <div key={idx}>
              <strong className="font-bold text-slate-900">{matchComm[1]}</strong>
              <span>{matchComm[2]}</span>
            </div>
          );
        }
        const matchFeedback = line.match(/^(\s*【?(?:产研反馈|研发反馈)】?[:：]?)(.*)$/);
        if (matchFeedback) {
          return (
            <div key={idx}>
              <strong className="font-bold text-slate-900">{matchFeedback[1]}</strong>
              <span>{matchFeedback[2]}</span>
            </div>
          );
        }
        return (
          <div key={idx} className="text-slate-700">
            {line}
          </div>
        );
      })}
    </div>
  );
}
