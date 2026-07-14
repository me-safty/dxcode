import { describe, expect, it } from "vite-plus/test";

import { describePreviewError } from "./errorCodeMessages";

describe("describePreviewError", () => {
  it("maps a known Chromium error code to its friendly label", () => {
    expect(describePreviewError("ERR_NAME_NOT_RESOLVED")).toBe("DNS address could not be found");
  });

  it("passes an unknown description through unchanged", () => {
    expect(describePreviewError("SOME_UNKNOWN_ERROR")).toBe("SOME_UNKNOWN_ERROR");
  });

  it("falls back to a generic message when the description is empty", () => {
    expect(describePreviewError("")).toBe("Network error");
  });
});
