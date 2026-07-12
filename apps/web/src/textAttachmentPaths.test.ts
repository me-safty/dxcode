import { describe, expect, it } from "vite-plus/test";

import { removedTextAttachmentPaths } from "./textAttachmentPaths";

const attachmentPath =
  "/var/t3-data/attachments/text/12345678-1234-1234-1234-123456789abc/notes.txt";
const attachmentLink = `[notes.txt](${attachmentPath})`;

describe("removedTextAttachmentPaths", () => {
  it("returns generated attachments removed from the prompt", () => {
    expect(removedTextAttachmentPaths(`${attachmentLink} keep `, "keep ")).toEqual([
      attachmentPath,
    ]);
  });

  it("retains attachments that remain in the prompt", () => {
    expect(
      removedTextAttachmentPaths(`${attachmentLink} keep `, `${attachmentLink} next `),
    ).toEqual([]);
  });
});
