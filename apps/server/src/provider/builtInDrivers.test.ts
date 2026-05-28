import { describe, expect, it } from "vitest";
import { ProviderDriverKind } from "@t3tools/contracts";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";

describe("built-in provider drivers", () => {
  it("registers DeepSeek as a first-party provider driver", () => {
    const deepseek = BUILT_IN_DRIVERS.find(
      (driver) => driver.driverKind === ProviderDriverKind.make("deepseek"),
    );

    expect(deepseek?.metadata).toEqual({
      displayName: "DeepSeek",
      supportsMultipleInstances: true,
    });
  });
});
