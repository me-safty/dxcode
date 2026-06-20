import { describe, expect, it } from "vite-plus/test";

import {
  buildGrokCliProcessEnv,
  extractGrokAcpAvailableModels,
  mapGrokAcpModelIdToSlug,
  mapGrokSlugToAcpModelId,
  parseGrokBuildResume,
  parseGrokAcpAvailableModels,
} from "./GrokAcpSupport.ts";

describe("GrokAcpSupport", () => {
  it("parses resume cursors with the expected schema version", () => {
    expect(parseGrokBuildResume(undefined)).toBeUndefined();
    expect(parseGrokBuildResume({ schemaVersion: 2, sessionId: "abc" })).toBeUndefined();
    expect(parseGrokBuildResume({ schemaVersion: 1, sessionId: "  session-1  " })).toEqual({
      sessionId: "session-1",
    });
  });

  it("maps Grok model ids and UI slugs in both directions", () => {
    expect(mapGrokAcpModelIdToSlug("grok-composer-2.5-fast")).toBe("composer-2.5");
    expect(mapGrokSlugToAcpModelId("composer-2.5")).toBe("grok-composer-2.5-fast");
    expect(mapGrokSlugToAcpModelId(undefined)).toBe("grok-build");
  });

  it("extracts available models from initialize and session payloads", () => {
    const models = extractGrokAcpAvailableModels({
      initializeResult: {
        protocolVersion: 1,
        _meta: {
          modelState: {
            availableModels: [{ modelId: "grok-build", name: "Grok Build" }],
          },
        },
      },
      sessionSetupResult: {
        sessionId: "session-1",
        models: {
          currentModelId: "grok-composer-2.5-fast",
          availableModels: [{ modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" }],
        },
      },
    });

    expect(models).toEqual([
      { modelId: "grok-build", name: "Grok Build" },
      { modelId: "grok-composer-2.5-fast", name: "Composer 2.5 Fast" },
    ]);
  });

  it("merges instance environment and envJson overrides for CLI calls", () => {
    const env = buildGrokCliProcessEnv(
      { INSTANCE_VAR: "instance", SHARED: "instance-wins" },
      { ENV_JSON_VAR: "override", SHARED: "env-json-wins" },
    );

    expect(env.INSTANCE_VAR).toBe("instance");
    expect(env.ENV_JSON_VAR).toBe("override");
    expect(env.SHARED).toBe("env-json-wins");
  });

  it("parses available model arrays defensively", () => {
    expect(parseGrokAcpAvailableModels(null)).toEqual([]);
    expect(
      parseGrokAcpAvailableModels([
        { modelId: "grok-build", name: "Grok Build", description: "xAI" },
      ]),
    ).toEqual([{ modelId: "grok-build", name: "Grok Build", description: "xAI" }]);
  });
});
