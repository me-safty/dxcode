import { describe, expect, it } from "vite-plus/test";

import { markdownLinkDestinations } from "./markdownLinks.ts";

describe("markdownLinkDestinations", () => {
  it("parses adjacent punctuation and balanced destination parentheses", () => {
    expect(
      markdownLinkDestinations(
        "prefix[one](/tmp/attachments/text/id/one.txt),[two](/tmp/a(b)/two.txt).",
      ),
    ).toEqual(["/tmp/attachments/text/id/one.txt", "/tmp/a(b)/two.txt"]);
  });

  it("requires balanced unescaped labels and destinations", () => {
    expect(
      markdownLinkDestinations(
        String.raw`missing](/missing) \[escaped](/escaped) [label]\(/escaped-open) [nested [label]](/a(b)/c)`,
      ),
    ).toEqual(["/a(b)/c"]);
  });

  it("ignores links inside inline and fenced code", () => {
    expect(
      markdownLinkDestinations(
        [
          "`[inline](/inline)` [real](/real)",
          "```md",
          "[fenced](/fenced)",
          "```",
          "~~~",
          "[tilde](/tilde)",
          "~~~",
        ].join("\n"),
      ),
    ).toEqual(["/real"]);
    expect(markdownLinkDestinations("unmatched ` [still-real](/real)")).toEqual(["/real"]);
  });
});
