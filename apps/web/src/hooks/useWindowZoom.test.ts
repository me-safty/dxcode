import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import { CLIENT_SETTINGS_STORAGE_KEY } from "./useSettings";
import { removeLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import {
  __applyWindowZoomLevelForTests,
  __getWindowZoomSnapshotForTests,
  __resetWindowZoomForTests,
  applyInitialWindowZoom,
} from "./useWindowZoom";

type TestWindow = Window &
  typeof globalThis & {
    desktopBridge?: Window["desktopBridge"];
  };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

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

  it("uses the desktop bridge as the canonical Electron source of truth", async () => {
    const desktopBridge: NonNullable<Window["desktopBridge"]> = {
      setZoomLevel: vi.fn(async () => ({
        level: -1,
        factor: 0.83,
        percent: 83,
      })),
      getZoomState: vi.fn(async () => ({
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

  it("serializes desktop zoom updates and keeps the latest optimistic level visible", async () => {
    const firstZoom = createDeferred<{ level: number; factor: number; percent: number }>();
    const secondZoom = createDeferred<{ level: number; factor: number; percent: number }>();
    const desktopBridge: NonNullable<Window["desktopBridge"]> = {
      setZoomLevel: vi.fn((level: number) => {
        if (level === 1) {
          return firstZoom.promise;
        }
        if (level === 2) {
          return secondZoom.promise;
        }
        return Promise.reject(new Error(`unexpected zoom level ${level}`));
      }),
      getZoomState: vi.fn(async () => ({
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

    const firstApply = __applyWindowZoomLevelForTests(1);
    const secondApply = __applyWindowZoomLevelForTests(2);

    await vi.waitFor(() => {
      expect(desktopBridge.setZoomLevel).toHaveBeenCalledTimes(1);
    });
    expect(desktopBridge.setZoomLevel).toHaveBeenNthCalledWith(1, 1);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 2,
      zoomPercent: 144,
      indicatorVisible: true,
    });

    firstZoom.resolve({ level: 1, factor: 1.2, percent: 120 });

    await vi.waitFor(() => {
      expect(desktopBridge.setZoomLevel).toHaveBeenCalledTimes(2);
    });
    expect(desktopBridge.setZoomLevel).toHaveBeenNthCalledWith(2, 2);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 2,
      zoomPercent: 144,
      indicatorVisible: true,
    });

    secondZoom.resolve({ level: 2, factor: 1.44, percent: 144 });

    await expect(firstApply).resolves.toBe(1);
    await expect(secondApply).resolves.toBe(2);
    expect(__getWindowZoomSnapshotForTests()).toMatchObject({
      zoomLevel: 2,
      zoomPercent: 144,
      indicatorVisible: true,
    });
  });
});
