import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_THEME, DEFAULT_THEME_ID } from "./builtin";
import {
  ACTIVE_DARK_THEME_STORAGE_KEY,
  ACTIVE_LIGHT_THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  THEME_STYLE_ELEMENT_ID,
  addCustomTheme,
  applyActiveThemes,
  deleteCustomTheme,
  duplicateTheme,
  findTheme,
  generateCustomThemeId,
  getActiveDarkThemeId,
  getActiveLightThemeId,
  getAllThemes,
  getCustomThemes,
  isBuiltInThemeId,
  isValidColorValue,
  isValidTheme,
  materializeTokenValue,
  materializeTokens,
  previewTheme,
  resolveTokens,
  setActiveDarkThemeId,
  setActiveLightThemeId,
  themeSupportsVariant,
  tokensToCss,
  updateCustomTheme,
} from "./registry";
import type { ThemeDefinition } from "./types";

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

function installLocalStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

function uninstallLocalStorage() {
  Reflect.deleteProperty(globalThis, "localStorage");
}

describe("findTheme", () => {
  it("returns the default theme when the id is unknown", () => {
    expect(findTheme("does-not-exist").id).toBe(DEFAULT_THEME_ID);
  });

  it("returns the default theme when the id is null or undefined", () => {
    expect(findTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(findTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it("returns the matching built-in theme when present", () => {
    const found = findTheme("solarized");
    expect(found.id).toBe("solarized");
    expect(found.builtIn).toBe(true);
  });
});

describe("themeSupportsVariant", () => {
  it("treats a both-variant theme as eligible for both dropdowns", () => {
    expect(themeSupportsVariant(DEFAULT_THEME, "light")).toBe(true);
    expect(themeSupportsVariant(DEFAULT_THEME, "dark")).toBe(true);
  });

  it("treats a light-only theme as light-eligible only", () => {
    const latte: ThemeDefinition = { id: "x", name: "X", light: { primary: "#fff" } };
    expect(themeSupportsVariant(latte, "light")).toBe(true);
    expect(themeSupportsVariant(latte, "dark")).toBe(false);
  });

  it("treats a dark-only theme as dark-eligible only", () => {
    const mocha: ThemeDefinition = { id: "x", name: "X", dark: { primary: "#000" } };
    expect(themeSupportsVariant(mocha, "light")).toBe(false);
    expect(themeSupportsVariant(mocha, "dark")).toBe(true);
  });

  it("treats an empty patch (forked default) as eligible for both", () => {
    const empty: ThemeDefinition = { id: "x", name: "X" };
    expect(themeSupportsVariant(empty, "light")).toBe(true);
    expect(themeSupportsVariant(empty, "dark")).toBe(true);
  });
});

describe("resolveTokens", () => {
  it("returns the default tokens when overlay is empty", () => {
    const overlay: ThemeDefinition = { id: "empty", name: "Empty" };
    expect(resolveTokens(overlay, "light")).toEqual(DEFAULT_THEME.light);
    expect(resolveTokens(overlay, "dark")).toEqual(DEFAULT_THEME.dark);
  });

  it("merges overlay tokens on top of the default base", () => {
    const overlay: ThemeDefinition = {
      id: "patchy",
      name: "Patchy",
      light: { primary: "#ff0000" },
    };
    const merged = resolveTokens(overlay, "light");
    expect(merged.primary).toBe("#ff0000");
    expect(merged.foreground).toBe(DEFAULT_THEME.light?.foreground);
    expect(merged.background).toBe(DEFAULT_THEME.light?.background);
  });

  it("falls back to default tokens when the requested variant is undefined on the overlay", () => {
    const overlay: ThemeDefinition = {
      id: "light-only",
      name: "Light Only",
      light: { primary: "#abc123" },
    };
    const dark = resolveTokens(overlay, "dark");
    expect(dark).toEqual(DEFAULT_THEME.dark);
    const light = resolveTokens(overlay, "light");
    expect(light.primary).toBe("#abc123");
  });
});

describe("tokensToCss", () => {
  it("emits each token as `--name: value;` with single-space separators", () => {
    const css = tokensToCss({ primary: "#fff", background: "#000" });
    expect(css).toBe("--primary: #fff; --background: #000;");
  });

  it("returns an empty string when no tokens are provided", () => {
    expect(tokensToCss({})).toBe("");
  });

  it("skips tokens with empty or non-string values", () => {
    const tokens = {
      primary: "#fff",
      background: "",
      foreground: undefined,
    } as unknown as Parameters<typeof tokensToCss>[0];
    expect(tokensToCss(tokens)).toBe("--primary: #fff;");
  });

  it("preserves token name verbatim including dashes", () => {
    const css = tokensToCss({ "scrollbar-thumb": "rgba(0,0,0,0.1)" });
    expect(css).toBe("--scrollbar-thumb: rgba(0,0,0,0.1);");
  });
});

describe("isBuiltInThemeId", () => {
  it("recognizes shipped built-in themes", () => {
    expect(isBuiltInThemeId(DEFAULT_THEME_ID)).toBe(true);
    expect(isBuiltInThemeId("solarized")).toBe(true);
    expect(isBuiltInThemeId("nord")).toBe(true);
    expect(isBuiltInThemeId("catppuccin-latte")).toBe(true);
    expect(isBuiltInThemeId("catppuccin-frappe")).toBe(true);
    expect(isBuiltInThemeId("catppuccin-macchiato")).toBe(true);
    expect(isBuiltInThemeId("catppuccin-mocha")).toBe(true);
    expect(isBuiltInThemeId("rose-pine-dawn")).toBe(true);
    expect(isBuiltInThemeId("rose-pine")).toBe(true);
    expect(isBuiltInThemeId("rose-pine-moon")).toBe(true);
    expect(isBuiltInThemeId("high-contrast")).toBe(true);
  });

  it("returns false for unknown ids", () => {
    expect(isBuiltInThemeId("custom-thing")).toBe(false);
    expect(isBuiltInThemeId("")).toBe(false);
  });
});

describe("isValidColorValue", () => {
  it("accepts ordinary CSS color values", () => {
    expect(isValidColorValue("#fff")).toBe(true);
    expect(isValidColorValue("rgba(0,0,0,0.1)")).toBe(true);
    expect(isValidColorValue("oklch(0.5 0.2 264)")).toBe(true);
    expect(isValidColorValue("var(--color-blue-500)")).toBe(true);
    expect(isValidColorValue("color-mix(in srgb, #000 80%, #fff)")).toBe(true);
  });

  it("rejects empty / non-string / dangerous values", () => {
    expect(isValidColorValue("")).toBe(false);
    expect(isValidColorValue("   ")).toBe(false);
    expect(isValidColorValue("javascript:alert(1)")).toBe(false);
    expect(isValidColorValue("url(javascript:alert(1))")).toBe(false);
    expect(isValidColorValue("expression(alert(1))")).toBe(false);
    expect(isValidColorValue("<script>")).toBe(false);
    expect(isValidColorValue("a".repeat(201))).toBe(false);
  });
});

describe("materializeTokenValue", () => {
  it("passes through values that don't contain --alpha(", () => {
    expect(materializeTokenValue("#fff")).toBe("#fff");
    expect(materializeTokenValue("rgb(0,0,0)")).toBe("rgb(0,0,0)");
    expect(materializeTokenValue("var(--color-blue-500)")).toBe("var(--color-blue-500)");
    expect(materializeTokenValue("")).toBe("");
  });

  it("converts a single --alpha(<color> / <pct>%) to color-mix(...)", () => {
    expect(materializeTokenValue("--alpha(var(--color-blue-500) / 50%)")).toBe(
      "color-mix(in srgb, var(--color-blue-500) 50%, transparent)",
    );
    expect(materializeTokenValue("--alpha(#abc / 25%)")).toBe(
      "color-mix(in srgb, #abc 25%, transparent)",
    );
  });

  it("handles --alpha(...) with surrounding text", () => {
    const result = materializeTokenValue("1px solid --alpha(var(--color-zinc-300) / 60%) inset");
    expect(result).toBe(
      "1px solid color-mix(in srgb, var(--color-zinc-300) 60%, transparent) inset",
    );
  });

  it("converts multiple --alpha(...) instances in the same string", () => {
    const input = "--alpha(#fff / 50%) --alpha(#000 / 25%)";
    expect(materializeTokenValue(input)).toBe(
      "color-mix(in srgb, #fff 50%, transparent) color-mix(in srgb, #000 25%, transparent)",
    );
  });

  it("handles nested parens inside --alpha(...)", () => {
    const result = materializeTokenValue("--alpha(oklch(0.5 0.2 264) / 40%)");
    expect(result).toBe("color-mix(in srgb, oklch(0.5 0.2 264) 40%, transparent)");
  });

  it("leaves --alpha() without a slash separator unchanged-shaped (no conversion)", () => {
    const input = "--alpha(no-slash-here)";
    expect(materializeTokenValue(input)).toBe(input);
  });
});

describe("materializeTokens", () => {
  it("returns an empty bag when given an empty bag", () => {
    expect(materializeTokens({})).toEqual({});
  });

  it("materializes --alpha(...) for each value in the bag", () => {
    const out = materializeTokens({
      primary: "#abc",
      border: "--alpha(var(--color-blue-500) / 50%)",
    });
    expect(out).toEqual({
      primary: "#abc",
      border: "color-mix(in srgb, var(--color-blue-500) 50%, transparent)",
    });
  });
});

describe("isValidTheme", () => {
  it("accepts a minimal valid theme", () => {
    expect(isValidTheme({ id: "x", name: "X" })).toBe(true);
    expect(
      isValidTheme({ id: "x", name: "X", light: { primary: "#fff" }, dark: { primary: "#000" } }),
    ).toBe(true);
  });

  it("rejects malformed themes", () => {
    expect(isValidTheme(null)).toBe(false);
    expect(isValidTheme({})).toBe(false);
    expect(isValidTheme({ id: "x" })).toBe(false);
    expect(isValidTheme({ id: 1, name: "x" })).toBe(false);
    expect(isValidTheme({ id: "", name: "x" })).toBe(false);
    expect(isValidTheme({ id: "x", name: "" })).toBe(false);
    expect(isValidTheme({ id: "x", name: "X", light: { primary: 1 } })).toBe(false);
  });
});

describe("custom theme storage", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  afterEach(() => {
    uninstallLocalStorage();
  });

  it("starts empty", () => {
    expect(getCustomThemes()).toEqual([]);
    expect(getAllThemes().every((theme) => theme.builtIn === true)).toBe(true);
  });

  it("addCustomTheme appends and persists", () => {
    const theme: ThemeDefinition = { id: "alpha", name: "Alpha", builtIn: false };
    addCustomTheme(theme);
    expect(getCustomThemes()).toEqual([theme]);
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([theme]);
  });

  it("getAllThemes lists built-ins first then custom", () => {
    const custom: ThemeDefinition = { id: "alpha", name: "Alpha", builtIn: false };
    addCustomTheme(custom);
    const all = getAllThemes();
    expect(all[0]?.id).toBe(DEFAULT_THEME_ID);
    expect(all.at(-1)?.id).toBe("alpha");
  });

  it("generateCustomThemeId avoids collisions and prefixes built-in ids", () => {
    expect(generateCustomThemeId("default")).toBe("custom-default");
    addCustomTheme({ id: "custom-default", name: "Forked", builtIn: false });
    expect(generateCustomThemeId("default")).toBe("custom-default-2");
    addCustomTheme({ id: "custom-default-2", name: "Forked Again", builtIn: false });
    expect(generateCustomThemeId("default")).toBe("custom-default-3");
    expect(generateCustomThemeId("custom-x")).toBe("custom-x");
  });

  it("duplicateTheme of the default theme yields an empty patch so tokens fall back through resolveTokens", () => {
    const copy = duplicateTheme(DEFAULT_THEME);
    expect(copy.id).not.toBe(DEFAULT_THEME_ID);
    expect(copy.id.startsWith("custom-")).toBe(true);
    expect(copy.builtIn).toBe(false);
    expect(copy.name).toBe(`${DEFAULT_THEME.name} (Copy)`);
    expect(copy.light).toBeUndefined();
    expect(copy.dark).toBeUndefined();
    expect(resolveTokens(copy, "light")).toEqual(DEFAULT_THEME.light);
    expect(resolveTokens(copy, "dark")).toEqual(DEFAULT_THEME.dark);
  });

  it("duplicateTheme of a non-default theme copies the patch and materializes --alpha(...) values", () => {
    const source: ThemeDefinition = {
      id: "fancy",
      name: "Fancy",
      description: "Fancy theme.",
      builtIn: true,
      light: { primary: "#abc", border: "--alpha(var(--color-blue-500) / 50%)" },
      dark: { primary: "#def" },
    };
    const copy = duplicateTheme(source);
    expect(copy.id).not.toBe("fancy");
    expect(copy.builtIn).toBe(false);
    expect(copy.description).toBe("Fancy theme.");
    expect(copy.light?.primary).toBe("#abc");
    expect(copy.light?.border).toBe("color-mix(in srgb, var(--color-blue-500) 50%, transparent)");
    expect(copy.dark).toEqual({ primary: "#def" });
  });

  it("updateCustomTheme replaces the matching entry and forces builtIn=false", () => {
    const seed: ThemeDefinition = { id: "alpha", name: "Alpha", builtIn: false };
    addCustomTheme(seed);
    updateCustomTheme("alpha", { id: "alpha", name: "Alpha v2", light: { primary: "#abc" } });
    const stored = getCustomThemes();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "alpha", name: "Alpha v2", builtIn: false });
    expect(stored[0]?.light).toEqual({ primary: "#abc" });
  });

  it("updateCustomTheme rotates both active slots when the id changes", () => {
    addCustomTheme({ id: "alpha", name: "Alpha", builtIn: false });
    setActiveLightThemeId("alpha");
    setActiveDarkThemeId("alpha");
    updateCustomTheme("alpha", { id: "alpha-renamed", name: "Alpha", builtIn: false });
    expect(getActiveLightThemeId()).toBe("alpha-renamed");
    expect(getActiveDarkThemeId()).toBe("alpha-renamed");
    expect(getCustomThemes().map((theme) => theme.id)).toEqual(["alpha-renamed"]);
  });

  it("updateCustomTheme only rotates the slot that pointed at the renamed theme", () => {
    addCustomTheme({ id: "alpha", name: "Alpha", builtIn: false });
    setActiveLightThemeId("alpha");
    setActiveDarkThemeId(DEFAULT_THEME_ID);
    updateCustomTheme("alpha", { id: "alpha-renamed", name: "Alpha", builtIn: false });
    expect(getActiveLightThemeId()).toBe("alpha-renamed");
    expect(getActiveDarkThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it("updateCustomTheme throws if renaming would collide with another existing theme", () => {
    addCustomTheme({ id: "alpha", name: "Alpha", builtIn: false });
    addCustomTheme({ id: "beta", name: "Beta", builtIn: false });
    expect(() =>
      updateCustomTheme("alpha", { id: "beta", name: "Alpha", builtIn: false }),
    ).toThrow();
    expect(() =>
      updateCustomTheme("alpha", { id: "default", name: "Alpha", builtIn: false }),
    ).toThrow();
  });

  it("deleteCustomTheme removes the entry and resets any slot it occupied to default", () => {
    addCustomTheme({ id: "alpha", name: "Alpha", builtIn: false });
    setActiveLightThemeId("alpha");
    setActiveDarkThemeId("alpha");
    deleteCustomTheme("alpha");
    expect(getCustomThemes()).toEqual([]);
    expect(getActiveLightThemeId()).toBe(DEFAULT_THEME_ID);
    expect(getActiveDarkThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it("deleteCustomTheme refuses to delete built-in themes", () => {
    deleteCustomTheme(DEFAULT_THEME_ID);
    expect(getAllThemes().some((theme) => theme.id === DEFAULT_THEME_ID)).toBe(true);
    expect(localStorage.getItem(ACTIVE_LIGHT_THEME_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_DARK_THEME_STORAGE_KEY)).toBeNull();
  });
});

describe("applyActiveThemes / previewTheme", () => {
  class FakeStyle {
    id = "";
    textContent = "";
  }
  let appended: FakeStyle[];

  beforeEach(() => {
    appended = [];
    Object.defineProperty(globalThis, "HTMLStyleElement", {
      configurable: true,
      value: FakeStyle,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        getElementById: (id: string) => appended.find((node) => node.id === id) ?? null,
        createElement: () => new FakeStyle(),
        head: {
          append: (node: FakeStyle) => {
            appended.push(node);
          },
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "HTMLStyleElement");
  });

  it("injects nothing when both slots are the default theme", () => {
    applyActiveThemes(DEFAULT_THEME, DEFAULT_THEME);
    expect(appended.find((node) => node.id === THEME_STYLE_ELEMENT_ID)).toBeUndefined();
  });

  it("composes the light slot into :root and the dark slot into :root.dark", () => {
    applyActiveThemes(
      { id: "light-x", name: "Light X", builtIn: false, light: { primary: "#ff0000" } },
      { id: "dark-x", name: "Dark X", builtIn: false, dark: { primary: "#0000ff" } },
    );
    const style = appended.find((node) => node.id === THEME_STYLE_ELEMENT_ID);
    expect(style?.textContent).toMatch(/:root \{[^}]*--primary: #ff0000;/);
    expect(style?.textContent).toMatch(/:root\.dark \{[^}]*--primary: #0000ff;/);
  });

  it("never emits raw --alpha(...) into the runtime style tag (would collapse to white/black)", () => {
    previewTheme({ id: "custom-default", name: "Default Copy", builtIn: false });
    const style = appended.find((node) => node.id === THEME_STYLE_ELEMENT_ID);
    expect(style).toBeDefined();
    expect(style?.textContent).not.toMatch(/--alpha\(/);
    expect(style?.textContent).toMatch(/color-mix\(in srgb, /);
  });

  it("converts --alpha() in user-supplied overlay tokens too", () => {
    previewTheme({
      id: "custom-x",
      name: "X",
      builtIn: false,
      light: { primary: "--alpha(#ff0000 / 50%)" },
    });
    const style = appended.find((node) => node.id === THEME_STYLE_ELEMENT_ID);
    expect(style?.textContent).toContain("color-mix(in srgb, #ff0000 50%, transparent)");
    expect(style?.textContent).not.toContain("--alpha(");
  });
});
