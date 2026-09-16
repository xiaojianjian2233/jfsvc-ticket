import { describe, it, expect } from "vitest";
import {
  isValidSolution,
  isFieldEmpty,
  isPlaceholderWord,
  parseReplyNoteSolutions,
  stripHtmlToCleanText,
  extractPureSolution,
} from "./replyNoteUtils";

describe("replyNoteUtils 校验与解析工具函数", () => {
  describe("isPlaceholderWord 与 isFieldEmpty", () => {
    it("正确识别系统默认占位词与空字段", () => {
      expect(isPlaceholderWord("")).toBe(true);
      expect(isPlaceholderWord("   ")).toBe(true);
      expect(isPlaceholderWord("---")).toBe(true);
      expect(isPlaceholderWord("--")).toBe(true);
      expect(isPlaceholderWord("-")).toBe(true);
      expect(isPlaceholderWord("——")).toBe(true);
      expect(isPlaceholderWord("—")).toBe(true);
      expect(isPlaceholderWord("无")).toBe(true);
      expect(isPlaceholderWord("暂无")).toBe(true);
      expect(isPlaceholderWord("null")).toBe(true);
      expect(isPlaceholderWord("undefined")).toBe(true);
      expect(isPlaceholderWord("转产研上下文")).toBe(true);
      expect(isPlaceholderWord("录入说明")).toBe(true);

      // 非占位词
      expect(isPlaceholderWord("发票开具失败")).toBe(false);
      expect(isPlaceholderWord("底层接口超时")).toBe(false);
    });

    it("正确识别字段非空与占位符", () => {
      expect(isFieldEmpty(null)).toBe(true);
      expect(isFieldEmpty(undefined)).toBe(true);
      expect(isFieldEmpty("")).toBe(true);
      expect(isFieldEmpty("---")).toBe(true);
      expect(isFieldEmpty("—")).toBe(true);
      expect(isFieldEmpty("无")).toBe(true);
      expect(isFieldEmpty("cloud-erp")).toBe(false);
      expect(isFieldEmpty("发票模块")).toBe(false);
    });
  });

  describe("isValidSolution 解决方案有效值校验", () => {
    it("系统默认内容、空内容或占位符判定为无效", () => {
      expect(isValidSolution(null)).toBe(false);
      expect(isValidSolution(undefined)).toBe(false);
      expect(isValidSolution("")).toBe(false);
      expect(isValidSolution("   \n  ")).toBe(false);
      expect(isValidSolution("---")).toBe(false);
      expect(isValidSolution("--")).toBe(false);
      expect(isValidSolution("-")).toBe(false);
      expect(isValidSolution("无")).toBe(false);
      expect(isValidSolution("暂无")).toBe(false);
      expect(isValidSolution("转产研上下文")).toBe(false);
      expect(isValidSolution("录入说明")).toBe(false);
      expect(isValidSolution("【沟通记录】")).toBe(false);
      expect(isValidSolution("【沟通记录】---")).toBe(false);
      expect(isValidSolution("【沟通记录】无")).toBe(false);
      expect(isValidSolution("【沟通记录】转产研上下文")).toBe(false);
      expect(isValidSolution("【研发反馈】")).toBe(false);
      expect(isValidSolution("【研发反馈】---")).toBe(false);
      expect(isValidSolution("【解决方案】")).toBe(false);
      expect(isValidSolution("【解决方案】---")).toBe(false);
      expect(isValidSolution("【需求】-测试标题\n【沟通记录】")).toBe(false);
      expect(isValidSolution("【需求】-测试标题\n【沟通记录】---")).toBe(false);
      expect(isValidSolution("【沟通记录】---\n【研发反馈】---")).toBe(false);
    });

    it("真实有效的解决方案判定为有效", () => {
      expect(isValidSolution("已与客户电话沟通，数电发票查询无结果因税号录入错误导致")).toBe(true);
      expect(isValidSolution("【沟通记录】已确认底层服务网络波动\n【研发反馈】")).toBe(true);
      expect(isValidSolution("【沟通记录】\n【研发反馈】开发已合并修复补丁上线")).toBe(true);
      expect(isValidSolution("【解决方案】引导客户在发票模块重新录入")).toBe(true);
      expect(isValidSolution("解决方案：建议检查企业开票授权")).toBe(true);
    });
  });

  describe("parseReplyNoteSolutions 逆向回写解析", () => {
    it("过滤单任务中占位符，不把占位内容逆向赋给任务解决方案", () => {
      const tasks = [{ code: "HUB-001", key: "self", type: "Demand" }];
      const note = "【需求】-标题说明\n【沟通记录】---";
      const res = parseReplyNoteSolutions(note, tasks);
      expect(res["self"]).toBe("");
    });

    it("单任务有真实沟通记录时正确回写", () => {
      const tasks = [{ code: "HUB-001", key: "self", type: "Demand" }];
      const note = "【需求】-标题说明\n【沟通记录】已复现报错并提交研发团队排查";
      const res = parseReplyNoteSolutions(note, tasks);
      expect(res["self"]).toBe("已复现报错并提交研发团队排查");
    });

    it("多任务中占位符过滤为字符串空，保留真实内容", () => {
      const tasks = [
        { code: "HUB-001-1", key: 101, type: "Demand" },
        { code: "HUB-001-2", key: 102, type: "Demand" },
      ];
      const note = [
        "工单包含问题数量2",
        "问题1:【需求】-HUB-001-1-任务一",
        "【沟通记录】---",
        "",
        "问题2:【需求】-HUB-001-2-任务二",
        "【沟通记录】任务二已有实质性排查结论",
      ].join("\n");

      const res = parseReplyNoteSolutions(note, tasks);
      expect(res[101]).toBe("");
      expect(res[102]).toBe("任务二已有实质性排查结论");
    });
  });

  describe("stripHtmlToCleanText 富文本及样式标签净化", () => {
    it("剥离生产环境中出现的 span 及内联字体与背景色样式", () => {
      const dirtyHtml =
        '<span style="color: rgb(6, 6, 6); font-family: -apple-system, &quot;system-ui&quot;, 微软雅黑, &quot;Helvetica Neue&quot;, sans-serif; font-size: 14px; white-space: pre-wrap; background-color: rgb(229, 242, 255);">数电票开具异常排查方案：已核实税控端口正常，重启助手服务后已恢复正常开票。</span>';
      const clean = stripHtmlToCleanText(dirtyHtml);
      expect(clean).toBe(
        "数电票开具异常排查方案：已核实税控端口正常，重启助手服务后已恢复正常开票。",
      );
      expect(clean).not.toContain("<span");
      expect(clean).not.toContain("style=");
      expect(clean).not.toContain("background-color");
      expect(clean).not.toContain("rgb(");
    });

    it("正确将段落 <p>、<div>、<br> 与列表 <li> 转换为规范文本换行", () => {
      const html1 = "<p>第一段排查过程</p><p>第二段处理结论</p>";
      expect(stripHtmlToCleanText(html1)).toBe("第一段排查过程\n第二段处理结论");

      const html2 = "<div>步骤一：进入配置</div><div>步骤二：点击保存</div>";
      expect(stripHtmlToCleanText(html2)).toBe("步骤一：进入配置\n步骤二：点击保存");

      const html3 = "行1内容<br>行2内容<br/>行3内容";
      expect(stripHtmlToCleanText(html3)).toBe("行1内容\n行2内容\n行3内容");

      const html4 = "<ul><li>步骤A</li><li>步骤B</li></ul>";
      expect(stripHtmlToCleanText(html4)).toBe("• 步骤A\n• 步骤B");
    });

    it("正确还原常见 HTML 实体并规整空格", () => {
      const html = "&nbsp;测试&lt;xml&gt;&amp;&quot;引号&quot;&nbsp;";
      expect(stripHtmlToCleanText(html)).toBe('测试<xml>&"引号"');
    });

    it("纯文本输入直接原样返回，空值安全返回空串", () => {
      expect(stripHtmlToCleanText("普通纯文本解决方案")).toBe("普通纯文本解决方案");
      expect(stripHtmlToCleanText("")).toBe("");
      expect(stripHtmlToCleanText("   ")).toBe("");
      expect(stripHtmlToCleanText(null)).toBe("");
      expect(stripHtmlToCleanText(undefined)).toBe("");
    });
  });

  describe("extractPureSolution 剥离 HTML 外层标签", () => {
    it("当解决方案包含【解决方案】前缀且带有 span 样式标签时，能还原纯净文本", () => {
      const raw =
        '【解决方案】<span style="color: rgb(0,0,0); font-size: 14px;">经沟通已解决客户开票问题</span>';
      expect(extractPureSolution(raw)).toBe("经沟通已解决客户开票问题");
    });
  });
});
