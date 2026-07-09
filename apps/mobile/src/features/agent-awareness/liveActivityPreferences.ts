import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";
import { ManagedRelay } from "@t3tools/client-runtime/relay";

import type { SavedRemoteConnection } from "../../lib/connection";
import * as MobileStorage from "../../persistence/mobile-storage";
import { linkEnvironmentToCloudWithPreference } from "../cloud/linkEnvironment";
import { updateAgentAwarenessRegistrationPreferences } from "./remoteRegistration";

export function setLiveActivityUpdatesEnabled(input: {
  readonly enabled: boolean;
  readonly clerkToken: string | null;
  readonly connections: ReadonlyArray<SavedRemoteConnection>;
}): Effect.Effect<
  void,
  unknown,
  HttpClient.HttpClient | ManagedRelay.ManagedRelayClient | MobileStorage.MobileStorage
> {
  return Effect.gen(function* () {
    yield* updateAgentAwarenessRegistrationPreferences({
      liveActivitiesEnabled: input.enabled,
    });

    const clerkToken = input.clerkToken;
    if (!clerkToken) {
      return;
    }

    yield* Effect.forEach(
      input.connections.filter((connection) => connection.bearerToken !== null),
      (connection) =>
        linkEnvironmentToCloudWithPreference({
          clerkToken,
          connection,
          liveActivitiesEnabled: input.enabled,
        }),
      { concurrency: "unbounded" },
    );
  });
}
