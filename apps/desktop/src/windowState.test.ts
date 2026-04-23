import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WINDOW_STATE,
  readWindowState,
  resolveWindowBounds,
  writeWindowState,
} from "./windowState.ts";
import type { WindowState } from "./windowState.ts";

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => [
      {
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      {
        workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
      },
    ],
  },
}));

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeStatePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marcode-window-state-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "window-state.json");
}

describe("windowState", () => {
  describe("readWindowState / writeWindowState", () => {
    it("returns defaults when no state file exists", () => {
      expect(readWindowState(makeStatePath())).toEqual(DEFAULT_WINDOW_STATE);
    });

    it("persists and reloads window bounds", () => {
      const statePath = makeStatePath();
      const state: WindowState = { x: 1920, y: 100, width: 1200, height: 800, isMaximized: false };

      writeWindowState(statePath, state);

      expect(readWindowState(statePath)).toEqual(state);
    });

    it("persists and reloads maximized state", () => {
      const statePath = makeStatePath();
      const state: WindowState = { x: 50, y: 50, width: 1100, height: 780, isMaximized: true };

      writeWindowState(statePath, state);

      expect(readWindowState(statePath)).toEqual(state);
    });

    it("falls back to defaults when state file is malformed", () => {
      const statePath = makeStatePath();
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, "{not-json", "utf8");

      expect(readWindowState(statePath)).toEqual(DEFAULT_WINDOW_STATE);
    });

    it("falls back to defaults for invalid numeric fields", () => {
      const statePath = makeStatePath();
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(
        statePath,
        JSON.stringify({ x: "foo", y: null, width: -5, height: Infinity }),
        "utf8",
      );

      const result = readWindowState(statePath);
      expect(result.x).toBe(DEFAULT_WINDOW_STATE.x);
      expect(result.y).toBe(DEFAULT_WINDOW_STATE.y);
      expect(result.width).toBe(DEFAULT_WINDOW_STATE.width);
      expect(result.height).toBe(DEFAULT_WINDOW_STATE.height);
    });
  });

  describe("resolveWindowBounds", () => {
    it("omits x/y for default sentinel values (-1, -1)", () => {
      const bounds = resolveWindowBounds(DEFAULT_WINDOW_STATE);
      expect(bounds).toEqual({ width: 1100, height: 780 });
      expect(bounds).not.toHaveProperty("x");
      expect(bounds).not.toHaveProperty("y");
    });

    it("returns stored x/y when visible on primary display", () => {
      const bounds = resolveWindowBounds({
        x: 100,
        y: 200,
        width: 1100,
        height: 780,
        isMaximized: false,
      });
      expect(bounds).toEqual({ x: 100, y: 200, width: 1100, height: 780 });
    });

    it("returns stored x/y when visible on secondary display", () => {
      const bounds = resolveWindowBounds({
        x: 2000,
        y: 100,
        width: 1200,
        height: 800,
        isMaximized: false,
      });
      expect(bounds).toEqual({ x: 2000, y: 100, width: 1200, height: 800 });
    });

    it("omits x/y when window would be completely off-screen", () => {
      const bounds = resolveWindowBounds({
        x: 9999,
        y: 9999,
        width: 1100,
        height: 780,
        isMaximized: false,
      });
      expect(bounds).toEqual({ width: 1100, height: 780 });
      expect(bounds).not.toHaveProperty("x");
      expect(bounds).not.toHaveProperty("y");
    });
  });

  describe("regression guard: window position persistence must exist", () => {
    it("exports readWindowState function", () => {
      expect(typeof readWindowState).toBe("function");
    });

    it("exports writeWindowState function", () => {
      expect(typeof writeWindowState).toBe("function");
    });

    it("exports resolveWindowBounds function", () => {
      expect(typeof resolveWindowBounds).toBe("function");
    });

    it("WindowState interface has all required position fields", () => {
      const state: WindowState = {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        isMaximized: false,
      };
      expect(state).toHaveProperty("x");
      expect(state).toHaveProperty("y");
      expect(state).toHaveProperty("width");
      expect(state).toHaveProperty("height");
      expect(state).toHaveProperty("isMaximized");
    });

    it("round-trips a full window state through write→read", () => {
      const statePath = makeStatePath();
      const original: WindowState = {
        x: 1920,
        y: 50,
        width: 1400,
        height: 900,
        isMaximized: false,
      };

      writeWindowState(statePath, original);
      const restored = readWindowState(statePath);

      expect(restored).toEqual(original);
    });
  });
});
