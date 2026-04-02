import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, readFileSyncMock, writeFileSyncMock, mkdirSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
  mkdirSync: mkdirSyncMock,
}));

// ws is required by remoteAccess but we don't spin up real sockets in these tests.
vi.mock("ws", () => ({
  WebSocket: class {
    readyState = 0;
  },
  WebSocketServer: class {
    clients = [];
    close(cb?: () => void) {
      cb?.();
    }
  },
}));

import {
  DEFAULT_DESKTOP_REMOTE_PORT,
  DesktopRemoteManager,
  loadDesktopRemoteSettings,
} from "./remoteAccess";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(
  overrides?: Partial<{ getBackendPort: () => number; getBackendAuthToken: () => string }>,
) {
  return {
    settingsPath: "/fake/settings.json",
    getBackendPort: () => 8080,
    getBackendAuthToken: () => "backend-secret",
    ...overrides,
  };
}

function setupFsForConstruction(settings: object | null) {
  if (settings === null) {
    existsSyncMock.mockReturnValue(false);
  } else {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify(settings));
  }
  mkdirSyncMock.mockReturnValue(undefined);
  writeFileSyncMock.mockReturnValue(undefined);
}

// ---------------------------------------------------------------------------
// DEFAULT_DESKTOP_REMOTE_PORT
// ---------------------------------------------------------------------------

describe("DEFAULT_DESKTOP_REMOTE_PORT", () => {
  it("is a valid port number", () => {
    expect(DEFAULT_DESKTOP_REMOTE_PORT).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_DESKTOP_REMOTE_PORT).toBeLessThanOrEqual(65_535);
    expect(Number.isInteger(DEFAULT_DESKTOP_REMOTE_PORT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadDesktopRemoteSettings
// ---------------------------------------------------------------------------

describe("loadDesktopRemoteSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns defaults when the file does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    const settings = loadDesktopRemoteSettings("/no/such/file.json");

    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(DEFAULT_DESKTOP_REMOTE_PORT);
    expect(typeof settings.token).toBe("string");
    expect(settings.token.length).toBeGreaterThan(0);
  });

  it("parses enabled, port, and token from the file", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ enabled: true, port: 4242, token: "my-secret" }),
    );

    const settings = loadDesktopRemoteSettings("/fake/settings.json");

    expect(settings.enabled).toBe(true);
    expect(settings.port).toBe(4242);
    expect(settings.token).toBe("my-secret");
  });

  it("falls back to defaults when the file contains invalid JSON", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("{ not valid json }");

    const settings = loadDesktopRemoteSettings("/fake/settings.json");

    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(DEFAULT_DESKTOP_REMOTE_PORT);
  });

  it("rejects an out-of-range port and substitutes the default", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ enabled: false, port: 99_999, token: "tok" }),
    );

    const settings = loadDesktopRemoteSettings("/fake/settings.json");

    expect(settings.port).toBe(DEFAULT_DESKTOP_REMOTE_PORT);
  });

  it("generates a fresh token when the stored token is blank", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ enabled: false, port: 3773, token: "   " }));

    const settings = loadDesktopRemoteSettings("/fake/settings.json");

    expect(settings.token).toBeTruthy();
    expect(settings.token.trim()).not.toBe("");
  });

  it("falls back to defaults when the file read throws", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const settings = loadDesktopRemoteSettings("/fake/settings.json");

    expect(settings.enabled).toBe(false);
    expect(settings.port).toBe(DEFAULT_DESKTOP_REMOTE_PORT);
  });
});

// ---------------------------------------------------------------------------
// DesktopRemoteManager — construction and getState()
// ---------------------------------------------------------------------------

describe("DesktopRemoteManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("constructs without throwing when the settings file is absent", () => {
    setupFsForConstruction(null);

    expect(() => new DesktopRemoteManager(makeOptions())).not.toThrow();
  });

  it("constructs without throwing when the settings file is present", () => {
    setupFsForConstruction({ enabled: false, port: 3773, token: "abc" });

    expect(() => new DesktopRemoteManager(makeOptions())).not.toThrow();
  });

  it("getState reflects persisted enabled=false", () => {
    setupFsForConstruction({ enabled: false, port: 3773, token: "mytoken" });

    const manager = new DesktopRemoteManager(makeOptions());
    const state = manager.getState();

    expect(state.enabled).toBe(false);
    expect(state.listening).toBe(false);
    expect(state.token).toBe("mytoken");
    expect(state.port).toBe(3773);
  });

  it("getState reflects persisted enabled=true (server not yet started)", () => {
    setupFsForConstruction({ enabled: true, port: 3773, token: "mytoken" });

    const manager = new DesktopRemoteManager(makeOptions());
    const state = manager.getState();

    // enabled=true but server hasn't been started yet via startIfEnabled()
    expect(state.enabled).toBe(true);
    expect(state.listening).toBe(false);
  });

  it("getState.errorMessage is null before any start attempt", () => {
    setupFsForConstruction(null);

    const manager = new DesktopRemoteManager(makeOptions());

    expect(manager.getState().errorMessage).toBeNull();
  });

  it("getState.endpoints is an array", () => {
    setupFsForConstruction(null);

    const manager = new DesktopRemoteManager(makeOptions());

    expect(Array.isArray(manager.getState().endpoints)).toBe(true);
  });

  it("subscribe returns an unsubscribe function that stops future emissions", async () => {
    setupFsForConstruction({ enabled: false, port: 3773, token: "tok" });

    const manager = new DesktopRemoteManager(makeOptions());
    const listener = vi.fn();

    const unsubscribe = manager.subscribe(listener);
    unsubscribe();

    // setToken with the same value is a no-op; use a different one to force emit
    await manager.setToken("new-token-value");

    // Listener was removed before the emit, so it must not have been called.
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribe listener fires when setToken changes the token", async () => {
    setupFsForConstruction({ enabled: false, port: 3773, token: "old" });
    // saveDesktopRemoteSettings will be called again on setToken
    writeFileSyncMock.mockReturnValue(undefined);

    const manager = new DesktopRemoteManager(makeOptions());
    const listener = vi.fn();
    manager.subscribe(listener);

    await manager.setToken("brand-new-token");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ token: "brand-new-token" });
  });
});
