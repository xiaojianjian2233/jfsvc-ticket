import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { KnowledgeBaseDrawer } from "./KnowledgeBaseDrawer";

const server = setupServer(
  http.get("*/api/admin/product-lines", () =>
    HttpResponse.json([
      { code: "pl-invoice", name: "数电票/全电发票系统", is_active: true },
    ]),
  ),
  http.get("*/api/hub-issues/catalog/modules", () =>
    HttpResponse.json([
      { code: "m-issue", name: "发票开具与开票服务", product_line_code: "pl-invoice" },
    ]),
  ),
  http.post("*/api/knowledge-base", () =>
    HttpResponse.json({ success: true }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

function renderDrawer(props: Partial<React.ComponentProps<typeof KnowledgeBaseDrawer>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KnowledgeBaseDrawer
        open={true}
        onClose={vi.fn()}
        defaultProductLine="pl-invoice"
        defaultModule="m-issue"
        actionType="answer_only"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("KnowledgeBaseDrawer 知识库面板与富文本样式净化", () => {
  it("点击【仅作答】时，剥离富文本 span 字体与背景色样式，向工单回写纯净文本", async () => {
    const onAnswerAndSubmit = vi.fn();
    const onClose = vi.fn();

    const dirtyContent =
      '<span style="color: rgb(6, 6, 6); font-family: -apple-system, &quot;system-ui&quot;, 微软雅黑, &quot;Helvetica Neue&quot;, sans-serif; font-size: 14px; white-space: pre-wrap; background-color: rgb(229, 242, 255);">数电票开具异常已排查完毕，税控组件端口已释放。</span>';

    renderDrawer({
      defaultTitle: "数电票开具异常处理方案",
      defaultContent: dirtyContent,
      actionType: "answer_only",
      onAnswerAndSubmit,
      onClose,
    });

    const answerOnlyBtn = await screen.findByRole("button", { name: "仅作答" });
    expect(answerOnlyBtn).toBeInTheDocument();

    fireEvent.click(answerOnlyBtn);

    expect(onAnswerAndSubmit).toHaveBeenCalledTimes(1);
    const submitted = onAnswerAndSubmit.mock.calls[0][0];

    // 验证回写内容纯净，无富文本标签
    expect(submitted).toBe("数电票开具异常已排查完毕，税控组件端口已释放。");
    expect(submitted).not.toContain("<span");
    expect(submitted).not.toContain("style=");
    expect(submitted).not.toContain("background-color");
    expect(submitted).not.toContain("font-family");
    expect(onClose).toHaveBeenCalled();
  });

  it("点击【作答并新增知识库】时，同时向知识库与工单提交纯净文本", async () => {
    const onAnswerAndSubmit = vi.fn();
    const onClose = vi.fn();
    const onSubmitSuccess = vi.fn();

    const dirtyContent =
      '<p><span style="color: red; font-size: 14px;">第一步：核验网络</span></p><p><span style="background-color: yellow;">第二步：重新授权</span></p>';

    renderDrawer({
      defaultTitle: "发票服务授权重新绑定指南",
      defaultContent: dirtyContent,
      actionType: "both",
      onAnswerAndSubmit,
      onClose,
      onSubmitSuccess,
    });

    const bothBtn = await screen.findByRole("button", { name: "作答并新增知识库" });
    expect(bothBtn).toBeInTheDocument();

    fireEvent.click(bothBtn);

    await waitFor(() => {
      expect(onAnswerAndSubmit).toHaveBeenCalledTimes(1);
    });

    const submitted = onAnswerAndSubmit.mock.calls[0][0];
    expect(submitted).toBe("第一步：核验网络\n第二步：重新授权");
    expect(submitted).not.toContain("<span");
    expect(submitted).not.toContain("<p");

    expect(onSubmitSuccess).toHaveBeenCalledTimes(1);
    const newItem = onSubmitSuccess.mock.calls[0][0];
    expect(newItem.content).toBe("第一步：核验网络\n第二步：重新授权");
    expect(onClose).toHaveBeenCalled();
  });

  it("在 RichTextEditor 中粘贴文本时，拦截外部 HTML 并提取纯文本", async () => {
    const { RichTextEditor } = await import("@/components/RichTextEditor");
    const onChange = vi.fn();
    render(<RichTextEditor value="" onChange={onChange} />);

    const editor = screen.getByRole("textbox", { name: "富文本知识内容" });
    expect(editor).toBeInTheDocument();

    const clipboardData = {
      getData: vi.fn((format: string) => {
        if (format === "text/plain") return "纯文本粘贴内容";
        if (format === "text/html") return '<span style="color: blue;">纯文本粘贴内容</span>';
        return "";
      }),
      files: [],
    };

    fireEvent.paste(editor, { clipboardData });

    expect(clipboardData.getData).toHaveBeenCalledWith("text/plain");
  });
});
