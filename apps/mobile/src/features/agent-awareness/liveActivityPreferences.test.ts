import { beforeEach, vi } from "vite-plus/test";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { EnvironmentId } from "@t3tools/contracts";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import type { SavedRemoteConnection } from "../../lib/connection";
import { MobilePreferencesStore } from "../../persistence/mobile-preferences";
import { MobileStorage } from "../../persistence/mobile-storage";
import { linkEnvironmentToCloud } from "../cloud/linkEnvironment";
import { setLiveActivityUpdatesEnabled } from "./liveActivityPreferences";
import { refreshAgentAwarenessRegistration } from "./remoteRegistration";

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

const savePreferencesPatch = vi.fn((patch: Record<string, unknown>) => Effect.succeed(patch));

vi.mock("../cloud/linkEnvironment", () => ({
  linkEnvironmentToCloud: vi.fn(() => Effect.void),
}));

vi.mock("./remoteRegistration", () => ({
  refreshAgentAwarenessRegistration: vi.fn(() => Effect.void),
}));

const connection: SavedRemoteConnection = {
  environmentId: "env-1" as EnvironmentId,
  environmentLabel: "Desktop",
  pairingUrl: "https://desktop.example.test/",
  displayUrl: "https://desktop.example.test/",
  httpBaseUrl: "https://desktop.example.test/",
  wsBaseUrl: "wss://desktop.example.test/ws",
  bearerToken: "local-bearer",
};

const testLayer = Layer.mergeAll(
  Layer.succeed(ManagedRelay.ManagedRelayClient, null as never),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("unexpected HTTP request")),
  ),
  Layer.succeed(
    MobilePreferencesStore,
    MobilePreferencesStore.of({
      load: Effect.succeed({}),
      savePatch: savePreferencesPatch,
      update: () => Effect.succeed({}),
    }),
  ),
  Layer.succeed(
    MobileStorage,
    MobileStorage.of({
      loadSavedConnections: Effect.succeed([]),
      saveConnection: () => Effect.void,
      clearSavedConnection: () => Effect.void,
      loadOrCreateAgentAwarenessDeviceId: Effect.succeed("device-1"),
      loadAgentAwarenessDeviceId: Effect.succeed("device-1"),
      loadAgentAwarenessRegistrationRecord: Effect.succeed(null),
      saveAgentAwarenessRegistrationRecord: () => Effect.void,
      clearAgentAwarenessRegistrationRecord: Effect.void,
    }),
  ),
);

describe("liveActivityPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect("pushes disabled Live Activity preferences to relay registrations", () =>
    Effect.gen(function* () {
      yield* setLiveActivityUpdatesEnabled({
        enabled: false,
        clerkToken: "clerk-token",
        connections: [connection],
      });

      expect(savePreferencesPatch).toHaveBeenCalledWith({ liveActivitiesEnabled: false });
      expect(refreshAgentAwarenessRegistration).toHaveBeenCalledTimes(1);
      expect(linkEnvironmentToCloud).toHaveBeenCalledWith({
        clerkToken: "clerk-token",
        connection,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("pushes enabled Live Activity preferences to relay registrations", () =>
    Effect.gen(function* () {
      yield* setLiveActivityUpdatesEnabled({
        enabled: true,
        clerkToken: "clerk-token",
        connections: [connection],
      });

      expect(savePreferencesPatch).toHaveBeenCalledWith({ liveActivitiesEnabled: true });
      expect(refreshAgentAwarenessRegistration).toHaveBeenCalledTimes(1);
      expect(linkEnvironmentToCloud).toHaveBeenCalledWith({
        clerkToken: "clerk-token",
        connection,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps local preferences refreshable when signed out", () =>
    Effect.gen(function* () {
      yield* setLiveActivityUpdatesEnabled({
        enabled: false,
        clerkToken: null,
        connections: [connection],
      });

      expect(savePreferencesPatch).toHaveBeenCalledWith({ liveActivitiesEnabled: false });
      expect(refreshAgentAwarenessRegistration).toHaveBeenCalledTimes(1);
      expect(linkEnvironmentToCloud).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("does not try to re-link managed relay connections without bearer credentials", () => {
    const managedConnection: SavedRemoteConnection = {
      ...connection,
      bearerToken: null,
    };

    return Effect.gen(function* () {
      yield* setLiveActivityUpdatesEnabled({
        enabled: true,
        clerkToken: "clerk-token",
        connections: [connection, managedConnection],
      });

      expect(linkEnvironmentToCloud).toHaveBeenCalledTimes(1);
      expect(linkEnvironmentToCloud).toHaveBeenCalledWith({
        clerkToken: "clerk-token",
        connection,
      });
    }).pipe(Effect.provide(testLayer));
  });
});
