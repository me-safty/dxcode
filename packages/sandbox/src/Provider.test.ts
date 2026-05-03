import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeFakeSandboxProvider } from "./FakeSandboxProvider.ts";
import { makeSandboxProviderRegistry } from "./Provider.ts";

describe("SandboxProviderRegistry", () => {
  it("resolves registered providers by kind", async () => {
    const provider = makeFakeSandboxProvider({ providerKind: "local" });
    const registry = makeSandboxProviderRegistry([provider]);

    await expect(Effect.runPromise(registry.get("local"))).resolves.toBe(provider);
  });

  it("fails with a stable SandboxError when provider is missing", async () => {
    const registry = makeSandboxProviderRegistry([]);
    const exit = await Effect.runPromiseExit(registry.get("modal"));

    expect(exit._tag).toBe("Failure");
  });
});
