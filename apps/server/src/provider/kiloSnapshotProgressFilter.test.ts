import { describe, expect, it } from "@effect/vitest";

import { isKiloSnapshotProgressText } from "./kiloSnapshotProgressFilter.ts";

describe("isKiloSnapshotProgressText", () => {
  it("matches single-frame spinner progress with U+2026 ellipsis", () => {
    expect(isKiloSnapshotProgressText("⠋ Initializing snapshot…")).toBe(true);
    expect(isKiloSnapshotProgressText("⠹ Initializing snapshot…")).toBe(true);
  });

  it("matches progress with ASCII three-dot ellipsis", () => {
    expect(isKiloSnapshotProgressText(" Initializing snapshot...")).toBe(true);
    expect(isKiloSnapshotProgressText("⠋ Initializing snapshot.")).toBe(true);
  });

  it("matches progress with multiple braille frames", () => {
    expect(isKiloSnapshotProgressText("⠋⠙ Initializing snapshot…")).toBe(true);
  });

  it("matches progress with leading or trailing whitespace", () => {
    expect(isKiloSnapshotProgressText("  ⠋ Initializing snapshot…  ")).toBe(true);
  });

  it("does not match plain assistant text", () => {
    expect(isKiloSnapshotProgressText("Hi")).toBe(false);
  });

  it("does not match when the phrase appears mid-sentence", () => {
    expect(isKiloSnapshotProgressText("Initializing snapshot… done")).toBe(false);
    expect(isKiloSnapshotProgressText("Step 1: Initializing snapshot…")).toBe(false);
  });

  it("does not match when the ellipsis suffix is missing", () => {
    expect(isKiloSnapshotProgressText("⠋ Initializing snapshot")).toBe(false);
    expect(isKiloSnapshotProgressText("Initializing snapshot")).toBe(false);
  });

  it("does not match spinner characters outside the braille block", () => {
    // U+2026 (ellipsis) used as the spinner; the spinner block must be U+2800..U+28FF.
    expect(isKiloSnapshotProgressText("… Initializing snapshot…")).toBe(false);
  });
});
