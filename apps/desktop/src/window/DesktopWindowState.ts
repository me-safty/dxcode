import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

const WINDOW_STATE_VERSION = 1;
const WINDOW_VISIBILITY_THRESHOLD = 0.2;
const WINDOW_STATE_PERSIST_DEBOUNCE_MS = 250;

export interface WindowRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PersistedWindowRestoreMode = "normal" | "maximized";

export interface ResolvedWindowState {
  readonly bounds: WindowRectangle;
  readonly restoreMode: PersistedWindowRestoreMode;
}

export interface WindowStateDefaults {
  readonly defaultBounds: WindowRectangle;
  readonly minWidth: number;
  readonly minHeight: number;
}

const WindowRectangleSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const PersistedWindowRestoreModeSchema = Schema.Literals(["normal", "maximized"]);

const PersistedWindowStateDocument = Schema.Struct({
  version: Schema.Literal(WINDOW_STATE_VERSION),
  normalBounds: WindowRectangleSchema,
  restoreMode: PersistedWindowRestoreModeSchema,
  // Present when the window was in macOS fullscreen: the pre-fullscreen frame
  // we reopen at to avoid re-entering fullscreen (and its white startup flash).
  // Kept separate from restoreMode so a maximized window that entered
  // fullscreen still restores as maximized.
  fullscreenOriginBounds: Schema.optionalKey(WindowRectangleSchema),
});
type PersistedWindowStateDocument = typeof PersistedWindowStateDocument.Type;

const PersistedWindowStateJson = fromLenientJson(PersistedWindowStateDocument);
const decodePersistedWindowStateJson = Schema.decodeEffect(PersistedWindowStateJson);
const encodePersistedWindowStateJson = Schema.encodeEffect(PersistedWindowStateJson);

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function hasUsableDimensions(rect: WindowRectangle): boolean {
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function sanitizeBounds(
  bounds: WindowRectangle,
  minWidth: number,
  minHeight: number,
): WindowRectangle {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(minWidth, Math.round(bounds.width)),
    height: Math.max(minHeight, Math.round(bounds.height)),
  };
}

export function intersectionArea(a: WindowRectangle, b: WindowRectangle): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

export function isWindowVisibleEnough(
  bounds: WindowRectangle,
  workAreas: readonly WindowRectangle[],
): boolean {
  const totalArea = bounds.width * bounds.height;
  if (totalArea <= 0) {
    return false;
  }

  const bestVisibleArea = workAreas.reduce(
    (best, workArea) => Math.max(best, intersectionArea(bounds, workArea)),
    0,
  );

  return bestVisibleArea / totalArea >= WINDOW_VISIBILITY_THRESHOLD;
}

export function centerBoundsInWorkArea(
  workArea: WindowRectangle,
  width: number,
  height: number,
): WindowRectangle {
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

function getDisplayWorkAreas(): readonly WindowRectangle[] {
  return Electron.screen.getAllDisplays().map((display) => display.workArea);
}

function getPrimaryWorkArea(): WindowRectangle {
  return Electron.screen.getPrimaryDisplay().workArea;
}

function readRestorableState(window: Electron.BrowserWindow): PersistedWindowStateDocument {
  return {
    version: WINDOW_STATE_VERSION,
    normalBounds: window.getNormalBounds(),
    restoreMode: window.isMaximized() ? "maximized" : "normal",
  };
}

export class DesktopWindowState extends Context.Service<
  DesktopWindowState,
  {
    readonly load: (defaults: WindowStateDefaults) => Effect.Effect<ResolvedWindowState>;
    readonly attach: (window: Electron.BrowserWindow) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopWindowState") {}

const { logWarning } = makeComponentLogger("desktop-window-state");

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const context = yield* Effect.context<
    DesktopEnvironment.DesktopEnvironment | FileSystem.FileSystem | Path.Path
  >();
  const runFork = Effect.runForkWith(context);

  const windowStatePath = environment.windowStatePath;

  const buildDefault = (defaults: WindowStateDefaults): ResolvedWindowState => {
    const width = Math.max(defaults.minWidth, Math.round(defaults.defaultBounds.width));
    const height = Math.max(defaults.minHeight, Math.round(defaults.defaultBounds.height));
    return {
      bounds: centerBoundsInWorkArea(getPrimaryWorkArea(), width, height),
      restoreMode: "normal",
    };
  };

  const load = (defaults: WindowStateDefaults): Effect.Effect<ResolvedWindowState> =>
    Effect.gen(function* () {
      const fallback = buildDefault(defaults);

      const raw = yield* fileSystem.readFileString(windowStatePath).pipe(Effect.option);
      if (Option.isNone(raw)) {
        return fallback;
      }

      const decoded = yield* decodePersistedWindowStateJson(raw.value).pipe(Effect.option);
      if (Option.isNone(decoded)) {
        return fallback;
      }
      const parsed = decoded.value;
      const workAreas = getDisplayWorkAreas();

      if (
        parsed.fullscreenOriginBounds !== undefined &&
        hasUsableDimensions(parsed.fullscreenOriginBounds)
      ) {
        const originBounds = sanitizeBounds(
          parsed.fullscreenOriginBounds,
          defaults.minWidth,
          defaults.minHeight,
        );
        if (isWindowVisibleEnough(originBounds, workAreas)) {
          return { bounds: originBounds, restoreMode: parsed.restoreMode };
        }
      }

      if (!hasUsableDimensions(parsed.normalBounds)) {
        return fallback;
      }
      const normalBounds = sanitizeBounds(
        parsed.normalBounds,
        defaults.minWidth,
        defaults.minHeight,
      );
      if (!isWindowVisibleEnough(normalBounds, workAreas)) {
        return fallback;
      }
      return { bounds: normalBounds, restoreMode: parsed.restoreMode };
    });

  let persistSequence = 0;

  const persist = (document: PersistedWindowStateDocument): Effect.Effect<void> =>
    Effect.gen(function* () {
      const directory = path.dirname(windowStatePath);
      persistSequence += 1;
      const tempPath = `${windowStatePath}.${process.pid}.${persistSequence}.tmp`;
      const encoded = yield* encodePersistedWindowStateJson(document);
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      yield* fileSystem.writeFileString(tempPath, `${encoded}\n`);
      yield* fileSystem.rename(tempPath, windowStatePath);
    }).pipe(
      Effect.catch((error) =>
        logWarning("failed to persist window state", { error: error.message }),
      ),
    );

  const attach = (window: Electron.BrowserWindow): Effect.Effect<void> =>
    Effect.sync(() => {
      let debounceFiber: Fiber.Fiber<void> | undefined;
      // Saved state is applied at first reveal, so drop persists from a window
      // that was never shown — they would clobber good on-disk state with the
      // pre-restore defaults (e.g. quit during the connecting splash).
      let armed = window.isVisible();
      // In fullscreen, getNormalBounds() returns the fullscreen frame, so keep
      // the last non-fullscreen frame around to persist instead.
      let lastRestorable: PersistedWindowStateDocument = readRestorableState(window);
      let lastVisibleBounds: WindowRectangle = window.getBounds();
      // macOS quit-from-fullscreen fires leave-full-screen before close; hold
      // the fullscreen snapshot through the exit transition so the close-time
      // save doesn't demote it with mid-transition bounds.
      let fullscreenExitPending = false;

      if (!armed) {
        window.once("show", () => {
          armed = true;
          lastRestorable = readRestorableState(window);
          lastVisibleBounds = window.getBounds();
        });
      }

      const resolveDocument = (): PersistedWindowStateDocument => {
        if (window.isFullScreen() || fullscreenExitPending) {
          return {
            ...lastRestorable,
            fullscreenOriginBounds: lastVisibleBounds,
          };
        }
        lastRestorable = readRestorableState(window);
        lastVisibleBounds = window.getBounds();
        return lastRestorable;
      };

      const persistEffect = Effect.suspend(() => persist(resolveDocument()));

      const cancelDebounce = () => {
        if (debounceFiber === undefined) {
          return;
        }
        const fiber = debounceFiber;
        debounceFiber = undefined;
        runFork(Fiber.interrupt(fiber));
      };

      const schedulePersist = () => {
        if (!armed) {
          return;
        }
        cancelDebounce();
        debounceFiber = runFork(
          Effect.sleep(WINDOW_STATE_PERSIST_DEBOUNCE_MS).pipe(
            Effect.andThen(
              Effect.sync(() => {
                fullscreenExitPending = false;
              }),
            ),
            Effect.andThen(persistEffect),
            Effect.ensuring(
              Effect.sync(() => {
                debounceFiber = undefined;
              }),
            ),
          ),
        );
      };

      const persistNow = () => {
        if (!armed) {
          return;
        }
        fullscreenExitPending = false;
        cancelDebounce();
        runFork(persistEffect);
      };

      // Unlike persistNow, keeps fullscreenExitPending: a close right after
      // leave-full-screen is the quit sequence, and must save the fullscreen
      // snapshot rather than the half-transitioned window.
      const persistOnClose = () => {
        if (!armed) {
          return;
        }
        cancelDebounce();
        runFork(persistEffect);
      };

      window.on("resize", schedulePersist);
      window.on("move", schedulePersist);
      window.on("maximize", persistNow);
      window.on("unmaximize", persistNow);
      window.on("enter-full-screen", persistNow);
      window.on("leave-full-screen", () => {
        if (!armed) {
          return;
        }
        fullscreenExitPending = true;
        schedulePersist();
      });
      window.on("close", persistOnClose);
    });

  return DesktopWindowState.of({ load, attach });
});

export const layer = Layer.effect(DesktopWindowState, make);
