import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import { CLIENT_SETTINGS_STORAGE_KEY } from "./useSettings";
import { removeLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import {
  __applyWindowZoomLevelForTests,
  __getWindowZoomSnapshotForTests,
  __requestPersistedWindowZoomLevelForTests,
  __resetWindowZoomForTests,
  __syncPersistedWindowZoomLevelForTests,
  applyInitialWindowZoom,
} from "./useWindowZoom";

type TestWindow = Window &
  typeof globalThis & {
    desktopBridge?: Window["desktopBridge"];
  };

function installDomGlobals() {
  const windowStub = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  } as TestWindow;
  const documentStub = {
    body: {
      style: {
        zoom: "",
      },
    },
  } as Document;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: windowStub,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: documentStub,
  });

  return { windowStub, documentStub };
}

describe("window zoom controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installDomGlobals();
    removeLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY);
    document.body.style.zoom = "";
    delete window.desktopBridge;
    __resetWindowZoomForTests();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    removeLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY);
    document.body.style.zoom = "";
    delete window.desktopBridge;
    __resetWindowZoomForTests();
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "window");
  });

  it("applies the persisted browser zoom level before mount", () => {
    setLocalStorageItem(
      CLIENT_SETTINGS_STORAGE_KEY,
      {
        ...DEFAULT_CLIENT_SETTINGS,
        windowZoomLevel: 1,
      },
      ClientSettingsSchema,
    );

    applyInitialWindowZoom();

    expect(document.body.style.zoom).toBe("1.2");
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 1,
      zoomPercent: 120,
    });
  });

  it("shows and auto-hides the scale indicator for browser zoom changes", async () => {
    await __applyWindowZoomLevelForTests(2);

    expect(document.body.style.zoom).toBe("1.44");
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 2,
      zoomPercent: 144,
      indicatorVisible: true,
      indicatorMessage: "UI scale 144%",
    });

    vi.advanceTimersByTime(750);

    expect(__getWindowZoomSnapshotForTests().indicatorVisible).toBe(false);
  });

  it("applies the persisted desktop zoom level through the bridge before mount", () => {
    setLocalStorageItem(
      CLIENT_SETTINGS_STORAGE_KEY,
      {
        ...DEFAULT_CLIENT_SETTINGS,
        windowZoomLevel: 1,
      },
      ClientSettingsSchema,
    );

    const desktopBridge: NonNullable<Window["desktopBridge"]> = {
      setZoomLevel: vi.fn((level: number) => ({
        level,
        factor: 1.2 ** level,
        percent: Math.round(1.2 ** level * 100),
      })),
      getZoomState: vi.fn(() => ({
        level: 0,
        factor: 1,
        percent: 100,
      })),
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: async () => true,
      setTheme: async () => undefined,
      showContextMenu: async () => null,
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => {
        throw new Error("unused in zoom test");
      },
      checkForUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      downloadUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      installUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      onUpdateState: () => () => undefined,
    };
    window.desktopBridge = desktopBridge;

    applyInitialWindowZoom();

    expect(desktopBridge.setZoomLevel).toHaveBeenCalledWith(1);
    expect(document.body.style.zoom).toBe("");
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 1,
      zoomPercent: 120,
    });
  });

  it("uses the desktop bridge as the canonical Electron source of truth", async () => {
    const desktopBridge: NonNullable<Window["desktopBridge"]> = {
      setZoomLevel: vi.fn((_level: number) => ({
        level: -1,
        factor: 0.83,
        percent: 83,
      })),
      getZoomState: vi.fn(() => ({
        level: 0,
        factor: 1,
        percent: 100,
      })),
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: async () => true,
      setTheme: async () => undefined,
      showContextMenu: async () => null,
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => {
        throw new Error("unused in zoom test");
      },
      checkForUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      downloadUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      installUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      onUpdateState: () => () => undefined,
    };
    window.desktopBridge = desktopBridge;

    await __applyWindowZoomLevelForTests(-1);

    expect(desktopBridge.setZoomLevel).toHaveBeenCalledWith(-1);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: -1,
      zoomPercent: 83,
      indicatorVisible: true,
    });
  });

  it("applies repeated desktop zoom updates immediately without stale-state loss", async () => {
    const desktopBridge: NonNullable<Window["desktopBridge"]> = {
      setZoomLevel: vi.fn((level: number) => {
        return {
          level,
          factor: 1.2 ** level,
          percent: Math.round(1.2 ** level * 100),
        };
      }),
      getZoomState: vi.fn(() => ({
        level: 0,
        factor: 1,
        percent: 100,
      })),
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: async () => true,
      setTheme: async () => undefined,
      showContextMenu: async () => null,
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => {
        throw new Error("unused in zoom test");
      },
      checkForUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      downloadUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      installUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      onUpdateState: () => () => undefined,
    };
    window.desktopBridge = desktopBridge;

    await expect(__applyWindowZoomLevelForTests(1)).resolves.toBe(1);
    expect(desktopBridge.setZoomLevel).toHaveBeenNthCalledWith(1, 1);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 1,
      zoomPercent: 120,
      indicatorVisible: true,
    });

    await expect(__applyWindowZoomLevelForTests(2)).resolves.toBe(2);
    expect(desktopBridge.setZoomLevel).toHaveBeenNthCalledWith(2, 2);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 2,
      zoomPercent: 144,
      indicatorVisible: true,
    });

    await expect(__applyWindowZoomLevelForTests(1)).resolves.toBe(1);
    expect(desktopBridge.setZoomLevel).toHaveBeenNthCalledWith(3, 1);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 1,
      zoomPercent: 120,
      indicatorVisible: true,
    });
  });

  it("ignores stale persisted zoom echoes while a newer local zoom is pending", async () => {
    const desktopBridge: NonNullable<Window["desktopBridge"]> = {
      setZoomLevel: vi.fn((level: number) => ({
        level,
        factor: 1.2 ** level,
        percent: Math.round(1.2 ** level * 100),
      })),
      getZoomState: vi.fn(() => ({
        level: 0,
        factor: 1,
        percent: 100,
      })),
      getWsUrl: () => null,
      pickFolder: async () => null,
      confirm: async () => true,
      setTheme: async () => undefined,
      showContextMenu: async () => null,
      openExternal: async () => true,
      onMenuAction: () => () => undefined,
      getUpdateState: async () => {
        throw new Error("unused in zoom test");
      },
      checkForUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      downloadUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      installUpdate: async () => {
        throw new Error("unused in zoom test");
      },
      onUpdateState: () => () => undefined,
    };
    window.desktopBridge = desktopBridge;

    await expect(__applyWindowZoomLevelForTests(1)).resolves.toBe(1);
    expect(__requestPersistedWindowZoomLevelForTests(1)).toBe(true);

    await expect(__applyWindowZoomLevelForTests(0)).resolves.toBe(0);
    expect(__requestPersistedWindowZoomLevelForTests(0)).toBe(true);

    expect(__syncPersistedWindowZoomLevelForTests(1)).toBe(false);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 0,
      zoomPercent: 100,
      indicatorVisible: true,
      indicatorMessage: "UI scale 100%",
    });

    expect(__syncPersistedWindowZoomLevelForTests(0)).toBe(true);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 0,
      zoomPercent: 100,
      indicatorVisible: true,
      indicatorMessage: "UI scale 100%",
    });
  });
});
