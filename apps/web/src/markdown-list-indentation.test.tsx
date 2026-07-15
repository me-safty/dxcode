import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vite-plus/test";

import { remarkNormalizeListItemIndentation } from "./markdown-list-indentation";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkNormalizeListItemIndentation]}>{markdown}</ReactMarkdown>,
  );
}

describe("remarkNormalizeListItemIndentation", () => {
  it("renders same-line over-indented list content as list text", () => {
    const html = renderMarkdown(`why did you do this?

-       for (const step of rest.steps) {
-           if (step.request.body) {
-               step.request.body = "<redacted>";
-           }
-       }`);

    expect(html).not.toContain("<pre>");
    expect(html).toContain("<li>for (const step of rest.steps) {</li>");
    expect(html).toContain("<li>if (step.request.body) {</li>");
    expect(html).toContain("<li>step.request.body = &quot;&lt;redacted&gt;&quot;;</li>");
  });

  it("preserves fenced code blocks within list items", () => {
    const html = renderMarkdown(`- \`\`\`ts
  const value = 1;
  \`\`\``);

    expect(html).toContain('<pre><code class="language-ts">const value = 1;');
  });

  it("preserves indented code blocks that start below a list marker", () => {
    const html = renderMarkdown(`-
      const value = 1;`);

    expect(html).toContain("<pre><code>const value = 1;");
  });

  it("preserves same-line code blocks without excess indentation", () => {
    const html = renderMarkdown("-     const value = 1;");

    expect(html).toContain("<pre><code>const value = 1;");
  });
});
