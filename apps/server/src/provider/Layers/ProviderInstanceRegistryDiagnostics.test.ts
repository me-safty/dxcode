import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProviderDriver } from "../ProviderDriver.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";

const SensitiveProviderConfig = Schema.Struct({
  serverPassword: Schema.String,
});

const sensitiveDriverKind = ProviderDriverKind.make("sensitiveTestDriver");
const sensitiveDriver: ProviderDriver<typeof SensitiveProviderConfig.Type> = {
  driverKind: sensitiveDriverKind,
  metadata: { displayName: "Sensitive test driver" },
  configSchema: SensitiveProviderConfig,
  defaultConfig: () => ({ serverPassword: "" }),
  create: () => Effect.die("invalid provider config must not reach driver creation"),
};

it.live("keeps rejected provider config values out of unavailable diagnostics", () =>
  Effect.gen(function* () {
    const secret = "provider-config-secret-sentinel";
    const instanceId = ProviderInstanceId.make("sensitive_test");
    const configMap: ProviderInstanceConfigMap = {
      [instanceId]: {
        driver: sensitiveDriverKind,
        config: { serverPassword: { secret } },
      },
    };

    const { registry } = yield* makeProviderInstanceRegistry({
      drivers: [sensitiveDriver],
      configMap,
    });
    const unavailable = yield* registry.listUnavailable;

    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.unavailableReason).toContain("Invalid type");
    expect(unavailable[0]?.unavailableReason).toContain('["serverPassword"]');
    expect(unavailable[0]?.unavailableReason).not.toContain(secret);
  }),
);
