import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";
import { vi } from "vite-plus/test";

// Single 1920x1080 display; inlined because vi.mock factories are hoisted.
vi.mock("electron", () => ({
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
}));

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopWindowState from "./DesktopWindowState.ts";

const PRIMARY_WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 } as const;

const DEFAULTS: DesktopWindowState.WindowStateDefaults = {
  defaultBounds: { x: 0, y: 0, width: 1100, height: 780 },
  minWidth: 840,
  minHeight: 620,
};

// 1100x780 centered in a 1920x1080 work area.
const EXPECTED_DEFAULT_BOUNDS = { x: 410, y: 150, width: 1100, height: 780 } as const;

// Permissive on purpose so tests can author version mismatches / partial docs.
const TestRectangle = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const TestWindowStateDocument = Schema.Struct({
  version: Schema.Number,
  normalBounds: TestRectangle,
  restoreMode: Schema.String,
  fullscreenOriginBounds: Schema.optionalKey(TestRectangle),
});
const TestWindowStateDocumentJson = Schema.fromJsonString(TestWindowStateDocument);
const encodeTestWindowStateDocument = Schema.encodeEffect(TestWindowStateDocumentJson);
const decodeTestWindowStateDocument = Schema.decodeEffect(TestWindowStateDocumentJson);

function makeEnvironmentLayer(baseDir: string) {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "0.0.27",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
}

const withWindowState = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | DesktopWindowState.DesktopWindowState | DesktopEnvironment.DesktopEnvironment
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-window-state-test-",
    });
    return yield* effect.pipe(
      Effect.provide(
        DesktopWindowState.layer.pipe(
          Layer.provideMerge(makeEnvironmentLayer(baseDir)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

function writeRawWindowStateFile(content: string) {
  return Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
    yield* fileSystem.writeFileString(environment.windowStatePath, content);
  });
}

function writeWindowStateDocument(document: typeof TestWindowStateDocument.Type) {
  return Effect.gen(function* () {
    const encoded = yield* encodeTestWindowStateDocument(document);
    yield* writeRawWindowStateFile(`${encoded}\n`);
  });
}

const loadResolved = Effect.gen(function* () {
  const service = yield* DesktopWindowState.DesktopWindowState;
  return yield* service.load(DEFAULTS);
});

interface FakeWindowState {
  bounds: DesktopWindowState.WindowRectangle;
  maximized: boolean;
  minimized: boolean;
  fullScreen: boolean;
  visible: boolean;
}

function makeFakeWindow(initial: Partial<FakeWindowState> = {}) {
  const state: FakeWindowState = {
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    maximized: false,
    minimized: false,
    fullScreen: false,
    visible: true,
    ...initial,
  };
  const listeners = new Map<string, Array<() => void>>();
  const addListener = (event: string, listener: () => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  };
  const fake = {
    on: addListener,
    once: (event: string, listener: () => void) => {
      const wrapped = () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((existing) => existing !== wrapped),
        );
        listener();
      };
      addListener(event, wrapped);
    },
    isVisible: () => state.visible,
    isFullScreen: () => state.fullScreen,
    isMinimized: () => state.minimized,
    isMaximized: () => state.maximized,
    getBounds: () => state.bounds,
    getNormalBounds: () => state.bounds,
    isDestroyed: () => false,
  };
  const emit = (event: string) => {
    // Copy: once-listeners remove themselves mid-iteration.
    for (const listener of (listeners.get(event) ?? []).slice()) {
      listener();
    }
  };
  return { window: fake as unknown as Electron.BrowserWindow, state, emit };
}

const attachWindow = (window: Electron.BrowserWindow) =>
  Effect.gen(function* () {
    const service = yield* DesktopWindowState.DesktopWindowState;
    yield* service.attach(window);
  });

const readPersistedDocument = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const raw = yield* fileSystem.readFileString(environment.windowStatePath);
  return yield* decodeTestWindowStateDocument(raw);
});

const awaitPersistedDocument = (
  predicate: (document: typeof TestWindowStateDocument.Type) => boolean,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const document = yield* readPersistedDocument.pipe(Effect.option);
      if (Option.isSome(document) && predicate(document.value)) {
        return document.value;
      }
      yield* Effect.sleep(10);
    }
    return yield* Effect.die(new Error("window state document was not persisted in time"));
  });

describe("DesktopWindowState geometry helpers", () => {
  it("rejects rectangles with non-positive or non-finite dimensions", () => {
    assert.isTrue(DesktopWindowState.hasUsableDimensions({ x: 0, y: 0, width: 10, height: 10 }));
    assert.isFalse(DesktopWindowState.hasUsableDimensions({ x: 0, y: 0, width: 0, height: 10 }));
    assert.isFalse(DesktopWindowState.hasUsableDimensions({ x: 0, y: 0, width: -5, height: 10 }));
    assert.isFalse(
      DesktopWindowState.hasUsableDimensions({ x: Number.NaN, y: 0, width: 10, height: 10 }),
    );
  });

  it("rounds position and clamps dimensions up to the minimums", () => {
    assert.deepEqual(
      DesktopWindowState.sanitizeBounds({ x: 12.4, y: 8.6, width: 200, height: 100 }, 840, 620),
      { x: 12, y: 9, width: 840, height: 620 },
    );
    assert.deepEqual(
      DesktopWindowState.sanitizeBounds({ x: 100, y: 100, width: 1300.2, height: 850.9 }, 840, 620),
      { x: 100, y: 100, width: 1300, height: 851 },
    );
  });

  it("computes intersection area, returning zero for disjoint rectangles", () => {
    assert.equal(
      DesktopWindowState.intersectionArea(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ),
      2_500,
    );
    assert.equal(
      DesktopWindowState.intersectionArea(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 200, width: 100, height: 100 },
      ),
      0,
    );
  });

  it("treats a window as visible only when it overlaps a display enough", () => {
    assert.isTrue(
      DesktopWindowState.isWindowVisibleEnough({ x: 100, y: 100, width: 800, height: 600 }, [
        PRIMARY_WORK_AREA,
      ]),
    );
    assert.isFalse(
      DesktopWindowState.isWindowVisibleEnough({ x: 6_000, y: 6_000, width: 800, height: 600 }, [
        PRIMARY_WORK_AREA,
      ]),
    );
  });

  it("centers bounds within a work area", () => {
    assert.deepEqual(
      DesktopWindowState.centerBoundsInWorkArea(PRIMARY_WORK_AREA, 1100, 780),
      EXPECTED_DEFAULT_BOUNDS,
    );
  });
});

describe("DesktopWindowState.load", () => {
  it.effect("returns the centered default when no window-state file exists", () =>
    withWindowState(
      Effect.gen(function* () {
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved, {
          bounds: EXPECTED_DEFAULT_BOUNDS,
          restoreMode: "normal",
        });
      }),
    ),
  );

  it.effect("falls back to the default when the file is malformed", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeRawWindowStateFile("{ this is not json");
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved.bounds, EXPECTED_DEFAULT_BOUNDS);
        assert.equal(resolved.restoreMode, "normal");
      }),
    ),
  );

  it.effect("falls back to the default on a version mismatch", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 2,
          normalBounds: { x: 100, y: 100, width: 1300, height: 850 },
          restoreMode: "normal",
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved.bounds, EXPECTED_DEFAULT_BOUNDS);
      }),
    ),
  );

  it.effect("restores persisted normal bounds", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 120, y: 90, width: 1300, height: 850 },
          restoreMode: "normal",
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved, {
          bounds: { x: 120, y: 90, width: 1300, height: 850 },
          restoreMode: "normal",
        });
      }),
    ),
  );

  it.effect("clamps restored bounds up to the minimum window size", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 120, y: 90, width: 300, height: 200 },
          restoreMode: "normal",
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved.bounds, { x: 120, y: 90, width: 840, height: 620 });
      }),
    ),
  );

  it.effect("restores the maximized restore mode", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 120, y: 90, width: 1300, height: 850 },
          restoreMode: "maximized",
        });
        const resolved = yield* loadResolved;
        assert.equal(resolved.restoreMode, "maximized");
        assert.deepEqual(resolved.bounds, { x: 120, y: 90, width: 1300, height: 850 });
      }),
    ),
  );

  it.effect("restores a maximized fullscreen session at its normal bounds", () =>
    withWindowState(
      Effect.gen(function* () {
        // Origin bounds must not become the creation bounds here, or they would
        // replace the real normal bounds once the window re-maximizes.
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 10, y: 20, width: 1400, height: 900 },
          restoreMode: "maximized",
          fullscreenOriginBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved, {
          bounds: { x: 10, y: 20, width: 1400, height: 900 },
          restoreMode: "maximized",
        });
      }),
    ),
  );

  it.effect("restores the fullscreen origin frame even when normal bounds are off-screen", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 6_000, y: 6_000, width: 1400, height: 900 },
          restoreMode: "normal",
          fullscreenOriginBounds: { x: 60, y: 50, width: 1200, height: 800 },
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved.bounds, { x: 60, y: 50, width: 1200, height: 800 });
      }),
    ),
  );

  it.effect("ignores off-screen fullscreen origin bounds and restores normal bounds", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 120, y: 90, width: 1300, height: 850 },
          restoreMode: "normal",
          fullscreenOriginBounds: { x: 6_000, y: 6_000, width: 1200, height: 800 },
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved.bounds, { x: 120, y: 90, width: 1300, height: 850 });
      }),
    ),
  );

  it.effect("falls back when persisted bounds are off-screen", () =>
    withWindowState(
      Effect.gen(function* () {
        yield* writeWindowStateDocument({
          version: 1,
          normalBounds: { x: 6_000, y: 6_000, width: 1100, height: 780 },
          restoreMode: "normal",
        });
        const resolved = yield* loadResolved;
        assert.deepEqual(resolved.bounds, EXPECTED_DEFAULT_BOUNDS);
      }),
    ),
  );
});

// The debounce uses the wall clock, so these run under it.live.
describe("DesktopWindowState.attach", () => {
  it.live("drops persist events fired before the window is first shown", () =>
    withWindowState(
      Effect.gen(function* () {
        const fake = makeFakeWindow({ visible: false, maximized: true });
        yield* attachWindow(fake.window);

        fake.emit("resize");
        fake.emit("close");
        yield* Effect.sleep(100);
        assert.isTrue(Option.isNone(yield* readPersistedDocument.pipe(Effect.option)));

        fake.state.visible = true;
        fake.emit("show");
        fake.emit("close");
        const document = yield* awaitPersistedDocument(() => true);
        assert.equal(document.restoreMode, "maximized");
      }),
    ),
  );

  it.live("persists bounds and restore mode durably before the close handler returns", () =>
    withWindowState(
      Effect.gen(function* () {
        const fake = makeFakeWindow({ bounds: { x: 40, y: 30, width: 1000, height: 700 } });
        yield* attachWindow(fake.window);

        fake.emit("close");
        // No polling: the close save must be synchronous.
        const document = yield* readPersistedDocument;
        assert.deepEqual(document.normalBounds, { x: 40, y: 30, width: 1000, height: 700 });
        assert.equal(document.restoreMode, "normal");
        assert.isUndefined(document.fullscreenOriginBounds);
      }),
    ),
  );

  it.live("quitting while in fullscreen keeps the pre-fullscreen frame and mode", () =>
    withWindowState(
      Effect.gen(function* () {
        const preFullscreen = { x: 60, y: 50, width: 1200, height: 800 };
        const fake = makeFakeWindow({ bounds: preFullscreen, maximized: true });
        yield* attachWindow(fake.window);

        fake.state.fullScreen = true;
        fake.state.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
        fake.emit("enter-full-screen");
        fake.emit("close");

        const document = yield* awaitPersistedDocument(
          (candidate) => candidate.fullscreenOriginBounds !== undefined,
        );
        assert.deepEqual(document.fullscreenOriginBounds, preFullscreen);
        assert.deepEqual(document.normalBounds, preFullscreen);
        assert.equal(document.restoreMode, "maximized");
      }),
    ),
  );

  it.live("captures a resize that lands inside the debounce window before fullscreen", () =>
    withWindowState(
      Effect.gen(function* () {
        const fake = makeFakeWindow({ bounds: { x: 100, y: 100, width: 1000, height: 700 } });
        yield* attachWindow(fake.window);

        // Fullscreen entry before the debounce fires must still capture the
        // resized frame as the origin.
        const resized = { x: 60, y: 50, width: 1200, height: 800 };
        fake.state.bounds = resized;
        fake.emit("resize");
        fake.state.fullScreen = true;
        fake.state.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
        fake.emit("enter-full-screen");
        fake.emit("close");

        const document = yield* awaitPersistedDocument(
          (candidate) => candidate.fullscreenOriginBounds !== undefined,
        );
        assert.deepEqual(document.fullscreenOriginBounds, resized);
        assert.deepEqual(document.normalBounds, resized);
      }),
    ),
  );

  it.live("close right after leave-full-screen keeps the fullscreen snapshot", () =>
    withWindowState(
      Effect.gen(function* () {
        const preFullscreen = { x: 60, y: 50, width: 1200, height: 800 };
        const fake = makeFakeWindow({ bounds: preFullscreen });
        yield* attachWindow(fake.window);

        fake.state.fullScreen = true;
        fake.state.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
        fake.emit("enter-full-screen");

        // Quit sequence: close lands before the debounced post-exit save.
        fake.state.fullScreen = false;
        fake.state.bounds = { x: 12, y: 8, width: 1740, height: 1002 };
        fake.emit("leave-full-screen");
        fake.emit("close");

        const document = yield* awaitPersistedDocument(
          (candidate) => candidate.fullscreenOriginBounds !== undefined,
        );
        assert.deepEqual(document.fullscreenOriginBounds, preFullscreen);
        yield* Effect.sleep(350);
        const settled = yield* readPersistedDocument;
        assert.deepEqual(settled.fullscreenOriginBounds, preFullscreen);
      }),
    ),
  );

  it.live("keeps the fullscreen snapshot through exit-transition resizes", () =>
    withWindowState(
      Effect.gen(function* () {
        const preFullscreen = { x: 60, y: 50, width: 1200, height: 800 };
        const fake = makeFakeWindow({ bounds: preFullscreen });
        yield* attachWindow(fake.window);

        fake.state.fullScreen = true;
        fake.state.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
        fake.emit("enter-full-screen");

        // Quit sequence with the macOS exit animation emitting resize/move
        // before close lands: none of it may demote the snapshot.
        fake.state.fullScreen = false;
        fake.emit("leave-full-screen");
        fake.state.bounds = { x: 30, y: 25, width: 1560, height: 940 };
        fake.emit("resize");
        fake.emit("move");
        fake.emit("close");

        yield* Effect.sleep(350);
        const settled = yield* readPersistedDocument;
        assert.deepEqual(settled.fullscreenOriginBounds, preFullscreen);
        assert.deepEqual(settled.normalBounds, preFullscreen);
      }),
    ),
  );

  it.live("does not demote a maximized window persisted while minimized", () =>
    withWindowState(
      Effect.gen(function* () {
        const frame = { x: 40, y: 30, width: 1000, height: 700 };
        const fake = makeFakeWindow({ bounds: frame, maximized: true });
        yield* attachWindow(fake.window);
        fake.emit("maximize");

        // Windows: isMaximized() is false while minimized and the window is
        // parked off-screen; neither may reach the saved state.
        fake.state.minimized = true;
        fake.state.maximized = false;
        fake.state.bounds = { x: -32_000, y: -32_000, width: 160, height: 28 };
        fake.emit("move");
        fake.emit("close");

        yield* Effect.sleep(350);
        const settled = yield* readPersistedDocument;
        assert.equal(settled.restoreMode, "maximized");
        assert.deepEqual(settled.normalBounds, frame);
      }),
    ),
  );

  it.live("an immediate save is never overwritten by an earlier pending one", () =>
    withWindowState(
      Effect.gen(function* () {
        const fake = makeFakeWindow({ bounds: { x: 100, y: 100, width: 1000, height: 700 } });
        yield* attachWindow(fake.window);

        // A pending debounced resize save must not overwrite the maximize save.
        fake.emit("resize");
        fake.state.maximized = true;
        fake.emit("maximize");

        const immediate = yield* readPersistedDocument;
        assert.equal(immediate.restoreMode, "maximized");
        yield* Effect.sleep(350);
        const settled = yield* readPersistedDocument;
        assert.equal(settled.restoreMode, "maximized");
      }),
    ),
  );

  it.live("a window that stays open after leaving fullscreen persists its live state", () =>
    withWindowState(
      Effect.gen(function* () {
        const preFullscreen = { x: 60, y: 50, width: 1200, height: 800 };
        const fake = makeFakeWindow({ bounds: preFullscreen });
        yield* attachWindow(fake.window);

        fake.state.fullScreen = true;
        fake.state.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
        fake.emit("enter-full-screen");

        const postExit = { x: 80, y: 70, width: 1100, height: 750 };
        fake.state.fullScreen = false;
        fake.state.bounds = postExit;
        fake.emit("leave-full-screen");

        const document = yield* awaitPersistedDocument(
          (candidate) => candidate.fullscreenOriginBounds === undefined,
        );
        assert.deepEqual(document.normalBounds, postExit);
        assert.equal(document.restoreMode, "normal");
      }),
    ),
  );
});
