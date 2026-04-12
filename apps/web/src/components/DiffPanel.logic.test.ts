import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { normalizeDiffSurfaceFocus } from "./DiffPanel.logic";

describe("normalizeDiffSurfaceFocus", () => {
  it("keeps conversation focus unchanged", () => {
    expect(normalizeDiffSurfaceFocus({ scope: "conversation" }, [])).toEqual({
      scope: "conversation",
    });
  });

  it("keeps turn focus when the requested turn exists", () => {
    const turnId = TurnId.make("turn-1");

    expect(
      normalizeDiffSurfaceFocus(
        {
          scope: "turn",
          turnId,
          filePath: "src/app.ts",
        },
        [turnId],
      ),
    ).toEqual({
      scope: "turn",
      turnId,
      filePath: "src/app.ts",
    });
  });

  it("falls back to conversation focus when the requested turn no longer exists", () => {
    expect(
      normalizeDiffSurfaceFocus(
        {
          scope: "turn",
          turnId: TurnId.make("missing-turn"),
          filePath: "src/app.ts",
        },
        [TurnId.make("different-turn")],
      ),
    ).toEqual({
      scope: "conversation",
    });
  });
});
