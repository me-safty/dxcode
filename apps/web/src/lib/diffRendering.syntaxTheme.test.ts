import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { setActiveDarkThemeId, setActiveLightThemeId } from "../themes/registry";
import { DIFF_THEME_NAMES, resolveDiffThemeName } from "./diffRendering";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("resolveDiffThemeName", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("falls back to the generic Pierre themes for the default palette", () => {
    expect(resolveDiffThemeName("light")).toBe(DIFF_THEME_NAMES.light);
    expect(resolveDiffThemeName("dark")).toBe(DIFF_THEME_NAMES.dark);
  });

  it("uses the active palette's Shiki syntax theme per mode", () => {
    setActiveLightThemeId("catppuccin-latte");
    setActiveDarkThemeId("catppuccin-mocha");

    expect(resolveDiffThemeName("light")).toBe("catppuccin-latte");
    expect(resolveDiffThemeName("dark")).toBe("catppuccin-mocha");
  });

  it("maps each Rosé Pine flavor to its bundled Shiki theme", () => {
    setActiveLightThemeId("rose-pine-dawn");
    setActiveDarkThemeId("rose-pine-moon");

    expect(resolveDiffThemeName("light")).toBe("rose-pine-dawn");
    expect(resolveDiffThemeName("dark")).toBe("rose-pine-moon");
  });

  it("resolves Solarized to the matching light/dark Shiki themes", () => {
    setActiveLightThemeId("solarized");
    setActiveDarkThemeId("solarized");

    expect(resolveDiffThemeName("light")).toBe("solarized-light");
    expect(resolveDiffThemeName("dark")).toBe("solarized-dark");
  });

  it("falls back to Pierre for a variant the active palette does not define", () => {
    // Nord only defines a dark syntax theme; its light slot has none.
    setActiveLightThemeId("nord");
    setActiveDarkThemeId("nord");

    expect(resolveDiffThemeName("light")).toBe(DIFF_THEME_NAMES.light);
    expect(resolveDiffThemeName("dark")).toBe("nord");
  });
});
