import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { KimiCodeSettings, ProviderDriverKind } from "@t3tools/contracts";

import { KimiCodeDriver } from "./KimiCodeDriver.ts";

const decodeKimiCodeSettings = Schema.decodeSync(KimiCodeSettings);

describe("KimiCodeDriver", () => {
  it("advertises the correct driver kind and metadata", () => {
    expect(KimiCodeDriver.driverKind).toBe(ProviderDriverKind.make("kimiCode"));
    expect(KimiCodeDriver.metadata.displayName).toBe("Kimi Code");
    expect(KimiCodeDriver.metadata.supportsMultipleInstances).toBe(true);
  });

  it("provides a default config with the standard binary path", () => {
    const defaults = KimiCodeDriver.defaultConfig();
    expect(defaults.enabled).toBe(true);
    expect(defaults.binaryPath).toBe("kimi");
    expect(defaults.customModels).toEqual([]);
  });

  it("accepts settings with a custom binary path", () => {
    const decoded = decodeKimiCodeSettings({
      enabled: false,
      binaryPath: "/usr/local/bin/kimi",
      customModels: ["kimi-code/custom"],
    });
    expect(decoded.enabled).toBe(false);
    expect(decoded.binaryPath).toBe("/usr/local/bin/kimi");
    expect(decoded.customModels).toEqual(["kimi-code/custom"]);
  });
});
