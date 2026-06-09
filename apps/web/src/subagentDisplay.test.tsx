import { describe, expect, it } from "vite-plus/test";

import { subagentDurationFallbackLabel } from "./subagentDisplay";

describe("subagentDurationFallbackLabel", () => {
  it("does not report terminal subagents without completion time as completed", () => {
    expect(subagentDurationFallbackLabel("completed")).toBe("duration unknown");
    expect(subagentDurationFallbackLabel("errored")).toBe("duration unknown");
    expect(subagentDurationFallbackLabel("interrupted")).toBe("duration unknown");
    expect(subagentDurationFallbackLabel("stopped")).toBe("duration unknown");
  });

  it("keeps distinct fallback labels for running and unknown relations", () => {
    expect(subagentDurationFallbackLabel("running")).toBe("running");
    expect(subagentDurationFallbackLabel(null)).toBe("status unknown");
  });
});
