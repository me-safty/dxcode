import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

const testEnvironmentId = EnvironmentId.make("environment-1");

const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: testEnvironmentId,
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: null,
};

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it("salvages partially invalid browser client settings", async () => {
    const testWindow = getTestWindow();
    const { CLIENT_SETTINGS_STORAGE_KEY, readBrowserClientSettings } =
      await import("./clientPersistenceStorage");

    testWindow.localStorage.setItem(
      CLIENT_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_CLIENT_SETTINGS,
        confirmThreadArchive: "invalid",
        confirmThreadDelete: false,
        diffWordWrap: true,
        sidebarProjectSortOrder: "manual",
        sidebarThreadSortOrder: "created_at",
        timestampFormat: "24-hour",
      }),
    );

    expect(readBrowserClientSettings()).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: false,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
    expect(JSON.parse(testWindow.localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY)!)).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: false,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
  });

  it("clears corrupt browser client settings payloads", async () => {
    const testWindow = getTestWindow();
    const { CLIENT_SETTINGS_STORAGE_KEY, readBrowserClientSettings } =
      await import("./clientPersistenceStorage");

    testWindow.localStorage.setItem(CLIENT_SETTINGS_STORAGE_KEY, "{");

    expect(readBrowserClientSettings()).toBeNull();
    expect(testWindow.localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("stores browser secrets inline with the saved environment record", async () => {
    const testWindow = getTestWindow();
    const {
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      readBrowserSavedEnvironmentRegistry,
      readBrowserSavedEnvironmentSecret,
      writeBrowserSavedEnvironmentRegistry,
      writeBrowserSavedEnvironmentSecret,
    } = await import("./clientPersistenceStorage");

    writeBrowserSavedEnvironmentRegistry([savedRegistryRecord]);
    expect(writeBrowserSavedEnvironmentSecret(testEnvironmentId, "bearer-token")).toBe(true);
    writeBrowserSavedEnvironmentRegistry([savedRegistryRecord]);

    expect(readBrowserSavedEnvironmentRegistry()).toEqual([savedRegistryRecord]);
    expect(readBrowserSavedEnvironmentSecret(testEnvironmentId)).toBe("bearer-token");
    expect(
      JSON.parse(testWindow.localStorage.getItem(SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY)!),
    ).toEqual({
      version: 1,
      records: [
        {
          ...savedRegistryRecord,
          bearerToken: "bearer-token",
        },
      ],
    });
  });
});
