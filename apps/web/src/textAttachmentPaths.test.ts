import { describe, expect, it } from "vite-plus/test";

import { textAttachmentPaths } from "./textAttachmentPaths";

describe("textAttachmentPaths", () => {
  it("collects unique generated attachment links from a discarded draft", () => {
    const path = "/var/t3-data/attachments/text/12345678-1234-1234-1234-123456789abc/notes.txt";

    expect(textAttachmentPaths(`[notes.txt](${path}) keep [notes.txt](${path})`)).toEqual([path]);
    expect(textAttachmentPaths("ordinary prompt")).toEqual([]);
  });
});
