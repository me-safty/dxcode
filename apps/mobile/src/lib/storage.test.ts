import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  let preferencesJson: string | null = null;
  let loadPreferencesFails = false;
  let savePreferencesFails = false;
  return {
    clear: () => {
      values.clear();
      preferencesJson = null;
      loadPreferencesFails = false;
      savePreferencesFails = false;
    },
    getStoredValue: (key: string) => values.get(key) ?? null,
    getPreferencesJson: () => preferencesJson,
    setPreferencesJson: (value: string) => {
      preferencesJson = value;
    },
    setDatabaseFailures: (load: boolean, save: boolean) => {
      loadPreferencesFails = load;
      savePreferencesFails = save;
    },
    getItemAsync: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItemAsync: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
    database: {
      closeAsync: vi.fn(() => Promise.resolve()),
      execAsync: vi.fn(() => Promise.resolve()),
      withExclusiveTransactionAsync: vi.fn(
        (run: (transaction: { execAsync: () => Promise<void> }) => Promise<void>) =>
          run({ execAsync: () => Promise.resolve() }),
      ),
      getFirstAsync: vi.fn((sql: string) => {
        if (sql.includes("PRAGMA user_version")) {
          return Promise.resolve({ user_version: 1 });
        }
        if (loadPreferencesFails) {
          return Promise.reject(new Error("database unavailable"));
        }
        return Promise.resolve(preferencesJson === null ? null : { payload: preferencesJson });
      }),
      runAsync: vi.fn((_sql: string, payload?: unknown) => {
        if (savePreferencesFails) {
          return Promise.reject(new Error("database unavailable"));
        }
        if (typeof payload === "string") {
          preferencesJson = payload;
        }
        return Promise.resolve();
      }),
    },
  };
});

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.deleteItemAsync,
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(() => Promise.resolve(mocks.database)),
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

vi.mock("./runtime", () => ({
  runtime: {
    runPromise: vi.fn(),
  },
}));

import {
  loadPreferences,
  loadSavedConnections,
  saveConnection,
  savePreferencesPatch,
} from "./storage";
import { toStableSavedRemoteConnection } from "./connection";

const managedConnection = {
  environmentId: EnvironmentId.make("environment-1"),
  environmentLabel: "Desktop",
  pairingUrl: "https://desktop.example/",
  displayUrl: "https://desktop.example/",
  httpBaseUrl: "https://desktop.example/",
  wsBaseUrl: "wss://desktop.example/",
  bearerToken: null,
  authenticationMethod: "dpop",
  dpopAccessToken: "short-lived-token",
  relayManaged: true,
} as const;

describe("mobile connection storage", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  it("persists relay-managed connections without their ephemeral access token", async () => {
    await saveConnection(managedConnection);

    const savedValue = mocks.setItemAsync.mock.calls[0]?.[1];
    expect(savedValue).toBeDefined();
    expect(JSON.parse(savedValue ?? "")).toEqual({
      connections: [toStableSavedRemoteConnection(managedConnection)],
    });
  });

  it("loads relay-managed connection metadata without a cached access token", async () => {
    await saveConnection(managedConnection);

    await expect(loadSavedConnections()).resolves.toEqual([
      toStableSavedRemoteConnection(managedConnection),
    ]);
  });

  it("preserves secure-storage read failures with operation and key context", async () => {
    const cause = new Error("keychain unavailable");
    mocks.getItemAsync.mockRejectedValueOnce(cause);

    await expect(loadSavedConnections()).rejects.toMatchObject({
      _tag: "MobileSecureStorageError",
      operation: "read",
      key: "t3code.connections",
      cause,
      message: "Mobile secure storage operation read failed for key t3code.connections.",
    });
  });

  it("logs structured decode failures before using the empty fallback", async () => {
    await mocks.setItemAsync("t3code.connections", "{");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadSavedConnections()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[mobile-storage] ignored invalid JSON",
      expect.objectContaining({
        _tag: "MobileStorageDecodeError",
        key: "t3code.connections",
        cause: expect.any(SyntaxError),
        message: "Failed to decode mobile storage value for key t3code.connections.",
      }),
    );

    warn.mockRestore();
  });

  it("loads legacy preferences when SQLite is unavailable", async () => {
    mocks.setDatabaseFailures(true, true);
    await mocks.setItemAsync("t3code.preferences", JSON.stringify({ baseFontSize: 17 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 17 });
    expect(warn).toHaveBeenCalledWith(
      "[mobile-storage] database unavailable, using legacy preferences",
      expect.anything(),
    );

    warn.mockRestore();
  });

  it("falls back to secure storage when SQLite cannot save preferences", async () => {
    mocks.setDatabaseFailures(true, true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(savePreferencesPatch({ baseFontSize: 19 })).resolves.toEqual({ baseFontSize: 19 });
    expect(JSON.parse(mocks.getStoredValue("t3code.preferences") ?? "")).toEqual({
      baseFontSize: 19,
    });
    expect(warn).toHaveBeenCalledWith(
      "[mobile-storage] database unavailable, saving preferences to secure storage",
      expect.anything(),
    );

    warn.mockRestore();
  });

  it("reconciles fallback preferences after SQLite recovers", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 15 }));
    await mocks.setItemAsync("t3code.preferences", JSON.stringify({ baseFontSize: 19 }));

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 19 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 19 });
    expect(mocks.getStoredValue("t3code.preferences")).toBeNull();
  });
});
