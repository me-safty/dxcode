import { describe, expect, it } from "vite-plus/test";

import {
  buildGrokBuildPresentationFromProbe,
  buildGrokModelsFromAcpProbe,
  buildGrokModelsFromCliModels,
  parseGrokModelsCliOutput,
} from "./GrokBuildProvider.ts";

describe("GrokBuildProvider", () => {
  it("parses auth and models from grok models output", () => {
    const parsed = parseGrokModelsCliOutput(`
You are logged in with grok.com.

Default model: grok-composer-2.5-fast

Available models:
  - grok-build
  * grok-composer-2.5-fast (default)
`);

    expect(parsed.auth).toEqual({
      status: "authenticated",
      label: "grok.com",
      type: "grok.com",
    });
    expect(parsed.models).toEqual([
      { modelId: "grok-build", name: "grok-build" },
      { modelId: "grok-composer-2.5-fast", name: "Composer 2.5" },
    ]);
  });

  it("detects unauthenticated grok models output", () => {
    const parsed = parseGrokModelsCliOutput(
      "You are not logged in.\nRun `grok login` to continue.",
    );
    expect(parsed.auth.status).toBe("unauthenticated");
    expect(parsed.models).toEqual([]);
  });

  it("maps CLI and ACP discovered models to server provider models", () => {
    const cliModels = buildGrokModelsFromCliModels([
      { modelId: "grok-build", name: "Grok Build" },
      { modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
    ]);
    expect(cliModels.map((model) => model.slug)).toEqual(["grok-build", "composer-2.5"]);

    const acpModels = buildGrokModelsFromAcpProbe({
      initializeResult: { protocolVersion: 1 },
      sessionSetupResult: {
        sessionId: "session-1",
        models: {
          currentModelId: "grok-build",
          availableModels: [{ modelId: "grok-build", name: "Grok Build" }],
        },
      },
      configOptions: [],
      sessionId: "session-1",
    });
    expect(acpModels).toEqual([
      expect.objectContaining({ slug: "grok-build", name: "Grok Build", isCustom: false }),
    ]);
  });

  it("detects standard ACP session modes without config options", () => {
    expect(
      buildGrokBuildPresentationFromProbe({
        configOptions: [],
        sessionSetupResult: {
          sessionId: "session-1",
          modes: {
            currentModeId: "ask",
            availableModes: [
              { id: "ask", name: "Ask" },
              { id: "code", name: "Code" },
            ],
          },
        },
      }),
    ).toEqual({
      displayName: "Grok Build",
      showInteractionModeToggle: true,
      requiresNewThreadForModelChange: true,
    });
  });
});
