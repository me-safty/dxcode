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
});
