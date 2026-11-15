import { describe, expect, it } from "vitest";
import { renderMarkdown, scanBlocks } from "./markdown";
import { formatImageMarkdown, resolveImagePath } from "./file-path";

describe("Markdown math rendering", () => {
  it("renders dollar inline and display math", async () => {
    const inline = await renderMarkdown(String.raw`质能公式$E=mc^2$与求和 $\sum_{i=1}^n i$`);
    expect(inline).toContain('class="katex"');
    expect(inline).toContain("<math");

    const display = await renderMarkdown(String.raw`$$
\frac{a}{b} = \sqrt{c}
$$`);
    expect(display).toContain("katex-display");
  });

  it("renders LaTeX inline and display delimiters", async () => {
    const inline = await renderMarkdown(String.raw`欧拉公式 \(e^{i\pi}+1=0\)`);
    expect(inline).toContain('class="katex"');

    const display = await renderMarkdown(String.raw`\[
\begin{matrix}
a & b \\
c & d
\end{matrix}
\]`);
    expect(display).toContain("katex-display");
  });

  it("renders same-line LaTeX display delimiters", async () => {
    const html = await renderMarkdown(String.raw`\[E=mc^2\]`);
    expect(html).toContain("katex-display");
  });

  it("leaves math syntax in code spans and fences untouched", async () => {
    const html = await renderMarkdown("Inline code: `$x$ \\(y\\) \\[z\\]`\n\n```text\n$$\nx\n$$\n\\[\ny\n\\]\n```");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$x$");
  });

  it("does not fail the whole preview for invalid TeX", async () => {
    const html = await renderMarkdown(String.raw`$\definitelyNotACommand{x}$`);
    expect(html).toContain("#cc0000");
    expect(html).toContain("\\definitelyNotACommand");
  });
});

describe("inserted image round trips", () => {
  it("preserves spaces, Unicode, percent escapes, and Windows separators", async () => {
    const cases = [
      "My Doc.images/a (1).png",
      "images/100%20.png",
      "图片/终 稿.png",
      "C:\\images\\a.png",
    ];

    for (const path of cases) {
      const html = await renderMarkdown(formatImageMarkdown(path));
      const encodedSource = html.match(/<img src="([^"]+)"/)?.[1].replace(/&amp;/g, "&");
      expect(encodedSource, html).toBeDefined();
      const resolved = resolveImagePath(encodedSource!, "/docs/note.md", "");
      expect(resolved).toBe(path.startsWith("C:") ? path : `/docs/${path}`);
    }
  });
});

describe("source block scanning", () => {
  it("treats multiline math as single blocks", () => {
    const content = String.raw`# 标题
$$
a
b
$$

普通段落

\[
x
\]

最后`;
    expect(scanBlocks(content)).toEqual([1, 2, 7, 9, 13]);
  });

  it("ignores math delimiters inside backtick and tilde fences", () => {
    const content = "```math\n$$\nx\n$$\n```\n~~~text\n\\[\ny\n\\]\n~~~\n# 后文";
    expect(scanBlocks(content)).toEqual([1, 6, 11]);
  });
});
