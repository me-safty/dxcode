import { describe, expect, it } from "vite-plus/test";

import { resolveBrowserRecordingStopTarget } from "./browserRecordingScope";

describe("resolveBrowserRecordingStopTarget", () => {
  it("only permits stopping the recording owned by the requested tab", () => {
    expect(resolveBrowserRecordingStopTarget("tab-a", "tab-a")).toBe("tab-a");
    expect(resolveBrowserRecordingStopTarget("tab-a", "tab-b")).toBeNull();
    expect(resolveBrowserRecordingStopTarget(null, "tab-b")).toBeNull();
    expect(resolveBrowserRecordingStopTarget("tab-a", null)).toBeNull();
  });
});
