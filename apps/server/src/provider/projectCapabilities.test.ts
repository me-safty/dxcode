import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import { makeProviderProjectCapabilitiesError } from "./projectCapabilities.ts";

it("uses provider capability failure detail before the generic message", () => {
  const error = makeProviderProjectCapabilitiesError({
    provider: ProviderDriverKind.make("opencode"),
    instanceId: ProviderInstanceId.make("opencode"),
    cwd: "/repo",
    cause: {
      detail: "OpenCode server refused the command list request.",
      message: "Wrapper message",
    },
  });

  assert.equal(error.detail, "OpenCode server refused the command list request.");
});
