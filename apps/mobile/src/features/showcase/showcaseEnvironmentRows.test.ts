import { EnvironmentId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import { applyShowcaseLocalEnvironmentDisplayUrls } from "./showcaseEnvironmentRows";

function environment(
  environmentId: string,
  environmentLabel: string,
  displayUrl = "http://127.0.0.1:3773/",
): ConnectedEnvironmentSummary {
  return {
    environmentId: EnvironmentId.make(environmentId),
    environmentLabel,
    displayUrl,
    isRelayManaged: false,
    connectionState: "connected",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

it("presents showcase transports as remote endpoints", () => {
  const environments = applyShowcaseLocalEnvironmentDisplayUrls([
    environment("runtime-id-1", "Moonbase Terminal"),
    environment("runtime-id-2", "Suspense Station"),
    environment("runtime-id-3", "Kernel Cabin"),
  ]);

  assert.deepStrictEqual(
    environments.map(({ displayUrl }) => displayUrl),
    [
      "https://moonbase.tail9f3a.ts.net/",
      "https://suspense-vps.hel1.t3.sh/",
      "http://100.82.16.5:3773/",
    ],
  );
});

it("leaves environments outside the showcase fixture unchanged", () => {
  const original = environment(
    "runtime-id-4",
    "My Workstation",
    "https://workstation.example.test/",
  );

  assert.deepStrictEqual(applyShowcaseLocalEnvironmentDisplayUrls([original]), [original]);
});
