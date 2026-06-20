import { RelayEnvironmentStatusScope } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";

import * as ManagedRelay from "../relay/managedRelay.ts";
import { mapManagedRelayError } from "./errors.ts";
import { ConnectionBlockedError } from "./model.ts";

function proofCreationError(): ManagedRelay.ManagedRelayDpopProofCreationError {
  return new ManagedRelay.ManagedRelayDpopProofCreationError({
    method: "POST",
    url: "https://relay.example.test/v1/client/dpop-token",
    cause: new Error("Proof creation failed."),
  });
}

describe("connection error mapping", () => {
  it("blocks invalid relay configuration", () => {
    const error = mapManagedRelayError(
      new ManagedRelay.ManagedRelayUrlInvalidError({
        relayUrl: "http://relay.example.test",
      }),
    );

    expect(error).toBeInstanceOf(ConnectionBlockedError);
    expect(error).toMatchObject({ reason: "configuration" });
  });

  it("blocks relay credentials with unexpected scopes", () => {
    const error = mapManagedRelayError(
      new ManagedRelay.ManagedRelayAccessTokenScopesUnexpectedError({
        requestedScopes: [RelayEnvironmentStatusScope],
        grantedScope: "unexpected:scope",
      }),
    );

    expect(error).toBeInstanceOf(ConnectionBlockedError);
    expect(error).toMatchObject({ reason: "permission" });
  });

  it.each([
    new ManagedRelay.ManagedRelayDpopKeyLoadError({
      operation: "load-or-create",
      cause: new Error("Key load failed."),
    }),
    new ManagedRelay.ManagedRelayTokenProofCreationError({
      method: "POST",
      url: "https://relay.example.test/v1/client/dpop-token",
      cause: proofCreationError(),
    }),
    new ManagedRelay.ManagedRelayRequestProofCreationError({
      method: "POST",
      url: "https://relay.example.test/v1/client/environments/environment-1/connect",
      cause: proofCreationError(),
    }),
  ])("blocks relay authentication failures ($._tag)", (relayError) => {
    const error = mapManagedRelayError(relayError);

    expect(error).toBeInstanceOf(ConnectionBlockedError);
    expect(error).toMatchObject({ reason: "authentication" });
  });
});
