import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StableCodeBlockFallback, splitCodeBlockLinesForStableFallback } from "./ChatMarkdown";

describe("ChatMarkdown stable code block fallback", () => {
  it("splits a single-line code block", () => {
    expect(splitCodeBlockLinesForStableFallback("const x = 1;")).toEqual(["const x = 1;"]);
  });

  it("splits a multi-line code block", () => {
    expect(splitCodeBlockLinesForStableFallback("a\nb")).toEqual(["a", "b"]);
  });

  it("preserves a trailing empty line", () => {
    expect(splitCodeBlockLinesForStableFallback("a\n")).toEqual(["a", ""]);
  });

  it("returns one empty line for an empty code block", () => {
    expect(splitCodeBlockLinesForStableFallback("")).toEqual([""]);
  });

  it("renders Shiki-shaped fallback markup with one line span per split line", () => {
    const markup = renderToStaticMarkup(
      <StableCodeBlockFallback code={"a\nb\n"} themeName="pierre-dark" />,
    );

    expect(markup).toContain("chat-markdown-shiki");
    expect(markup).toContain("chat-markdown-shiki-fallback");
    expect(markup).toContain('data-code-highlight-state="fallback"');
    expect(markup).toContain("shiki pierre-dark");
    expect(markup.match(/class="line"/g)).toHaveLength(3);
  });
});
