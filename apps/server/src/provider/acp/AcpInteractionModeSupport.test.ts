import { describe, expect, it } from "vite-plus/test";

import { findAcpModeByAliases, resolveAcpInteractionModeId } from "./AcpInteractionModeSupport.ts";

describe("AcpInteractionModeSupport", () => {
  const modeState = {
    currentModeId: "ask",
    availableModes: [
      { id: "ask", name: "Ask" },
      { id: "architect", name: "Architect" },
      { id: "code", name: "Code" },
    ],
  };

  it("resolves plan interaction mode to architect-style modes", () => {
    expect(
      resolveAcpInteractionModeId({
        interactionMode: "plan",
        runtimeMode: "full-access",
        modeState,
      }),
    ).toBe("architect");
  });

  it("resolves default interaction mode to implementation modes", () => {
    expect(
      resolveAcpInteractionModeId({
        interactionMode: "default",
        runtimeMode: "full-access",
        modeState,
      }),
    ).toBe("code");
  });

  it("finds modes by id or name aliases", () => {
    expect(findAcpModeByAliases(modeState.availableModes, ["code"])?.id).toBe("code");
  });
});
