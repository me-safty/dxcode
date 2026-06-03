import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("../Icons", () => ({
  ClaudeAI: () => null,
  CursorIcon: () => null,
  OpenAI: () => null,
  OpenCodeIcon: () => null,
  XAiIcon: () => null,
}));

import { getDriverOption, PROVIDER_CLIENT_DEFINITION_BY_VALUE } from "./providerDriverMeta.ts";

describe("providerDriverMeta", () => {
  it("registers Grok Build as a client-visible driver", () => {
    const driver = ProviderDriverKind.make("grokBuild");
    const definition = PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver];

    expect(definition).toBeDefined();
    expect(definition?.label).toBe("Grok Build");
    expect(getDriverOption(driver)).toBe(definition);
  });
});
