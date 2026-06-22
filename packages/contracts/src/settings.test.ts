import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "./settings.ts";

describe("agent-stop notification settings", () => {
  it("defaults popup + sound on and source to tone when decoding an empty object", () => {
    const decoded = Schema.decodeSync(ClientSettingsSchema)({});
    expect(decoded.notifyOnAgentStopPopup).toBe(true);
    expect(decoded.notifyOnAgentStopSound).toBe(true);
    expect(decoded.notifyOnAgentStopSoundSource).toBe("tone");
  });

  it("exposes the same defaults via DEFAULT_CLIENT_SETTINGS", () => {
    expect(DEFAULT_CLIENT_SETTINGS.notifyOnAgentStopPopup).toBe(true);
    expect(DEFAULT_CLIENT_SETTINGS.notifyOnAgentStopSound).toBe(true);
    expect(DEFAULT_CLIENT_SETTINGS.notifyOnAgentStopSoundSource).toBe("tone");
  });

  it("accepts an explicit system sound source", () => {
    const decoded = Schema.decodeSync(ClientSettingsSchema)({
      notifyOnAgentStopSoundSource: "system",
    });
    expect(decoded.notifyOnAgentStopSoundSource).toBe("system");
  });
});
