import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("../Icons", () => ({
  ClaudeAI: () => null,
  CursorIcon: () => null,
  OpenAI: () => null,
  OpenCodeIcon: () => null,
  XAiIcon: () => null,
}));

import { AVAILABLE_PROVIDER_OPTIONS, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils.ts";

describe("providerIconUtils", () => {
  it("exposes Grok Build in available provider options with an icon", () => {
    const grokBuildOption = AVAILABLE_PROVIDER_OPTIONS.find(
      (option) => option.value === "grokBuild",
    );

    expect(grokBuildOption?.label).toBe("Grok Build");
    expect(PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("grokBuild")]).toBeDefined();
  });
});
