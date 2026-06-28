import { BUILT_IN_THEMES, DEFAULT_THEME, DEFAULT_THEME_ID } from "./builtin";
import type { ThemeDefinition, ThemeTokens, ThemeVariant } from "./types";

export const CUSTOM_THEMES_STORAGE_KEY = "t3code:custom-themes";
export const ACTIVE_LIGHT_THEME_STORAGE_KEY = "t3code:active-light-theme";
export const ACTIVE_DARK_THEME_STORAGE_KEY = "t3code:active-dark-theme";
export const THEME_STYLE_ELEMENT_ID = "t3code-active-theme";

export { DEFAULT_THEME, DEFAULT_THEME_ID };

const CUSTOM_ID_PREFIX = "custom-";
const FORBIDDEN_VALUE_PATTERN =
  /(?:javascript:|expression\s*\(|<script|url\s*\(\s*['"]?\s*javascript:)/i;

export function isBuiltInThemeId(id: string): boolean {
  return BUILT_IN_THEMES.some((theme) => theme.id === id);
}

export function isValidColorValue(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 200) return false;
  return !FORBIDDEN_VALUE_PATTERN.test(trimmed);
}

export function generateCustomThemeId(sourceId: string): string {
  const base = sourceId.startsWith(CUSTOM_ID_PREFIX) ? sourceId : `${CUSTOM_ID_PREFIX}${sourceId}`;
  const existing = new Set(getAllThemes().map((theme) => theme.id));
  if (!existing.has(base)) return base;
  let attempt = 2;
  while (existing.has(`${base}-${attempt}`)) attempt += 1;
  return `${base}-${attempt}`;
}

/**
 * Tailwind v4's `--alpha(<color> / <pct>%)` is a build-time function — when emitted into a
 * raw `<style>` tag at runtime it resolves to nothing and tokens like `border` collapse to
 * solid white/black. Convert to the runtime-safe `color-mix(in srgb, <color> <pct>%, transparent)`.
 */
export function materializeTokenValue(value: string): string {
  if (typeof value !== "string" || !value.includes("--alpha(")) return value;
  let out = "";
  let i = 0;
  const marker = "--alpha(";
  while (i < value.length) {
    const start = value.indexOf(marker, i);
    if (start === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    let depth = 1;
    let j = start + marker.length;
    while (j < value.length && depth > 0) {
      const ch = value[j];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      if (depth > 0) j += 1;
    }
    if (depth !== 0) {
      out += value.slice(start);
      break;
    }
    const inner = value.slice(start + marker.length, j).trim();
    const slashIdx = inner.lastIndexOf("/");
    if (slashIdx === -1) {
      out += value.slice(start, j + 1);
    } else {
      const color = inner.slice(0, slashIdx).trim();
      const alpha = inner.slice(slashIdx + 1).trim();
      out += `color-mix(in srgb, ${color} ${alpha}, transparent)`;
    }
    i = j + 1;
  }
  return out;
}

export function materializeTokens(tokens: ThemeTokens): ThemeTokens {
  const next: ThemeTokens = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === "string") {
      (next as Record<string, string>)[key] = materializeTokenValue(value);
    }
  }
  return next;
}

export function duplicateTheme(source: ThemeDefinition): ThemeDefinition {
  const id = generateCustomThemeId(source.id);
  const copy: ThemeDefinition = {
    id,
    name: `${source.name} (Copy)`,
    builtIn: false,
  };
  if (source.description) copy.description = source.description;
  // Forking the default theme yields an empty patch — every token falls back through
  // resolveTokens against the live default. The user only sees swatches for tokens they
  // actually change, and the broken `--alpha(...)` re-emission can't happen.
  if (source.id === DEFAULT_THEME_ID) return copy;
  if (source.light) copy.light = materializeTokens(source.light);
  if (source.dark) copy.dark = materializeTokens(source.dark);
  return copy;
}

export function addCustomTheme(theme: ThemeDefinition): void {
  const themes = getCustomThemes();
  setCustomThemes([...themes, theme]);
}

export function updateCustomTheme(id: string, next: ThemeDefinition): void {
  if (id !== next.id && getAllThemes().some((theme) => theme.id === next.id)) {
    throw new Error(`Theme id "${next.id}" already exists`);
  }
  const themes = getCustomThemes();
  const index = themes.findIndex((theme) => theme.id === id);
  if (index === -1) return;
  const replacement: ThemeDefinition = { ...next, builtIn: false };
  const updated = [...themes.slice(0, index), replacement, ...themes.slice(index + 1)];
  setCustomThemes(updated);
  if (id !== next.id) {
    if (getActiveLightThemeId() === id) setActiveLightThemeId(next.id);
    if (getActiveDarkThemeId() === id) setActiveDarkThemeId(next.id);
  }
}

export function deleteCustomTheme(id: string): void {
  if (isBuiltInThemeId(id)) return;
  const themes = getCustomThemes().filter((theme) => theme.id !== id);
  setCustomThemes(themes);
  if (getActiveLightThemeId() === id) setActiveLightThemeId(DEFAULT_THEME_ID);
  if (getActiveDarkThemeId() === id) setActiveDarkThemeId(DEFAULT_THEME_ID);
}

export { isValidTheme };

export function getCustomThemes(): ThemeDefinition[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTheme);
  } catch {
    return [];
  }
}

export function setCustomThemes(themes: ThemeDefinition[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
}

export function getAllThemes(): ThemeDefinition[] {
  return [...BUILT_IN_THEMES, ...getCustomThemes()];
}

export function findTheme(id: string | null | undefined): ThemeDefinition {
  if (!id) return DEFAULT_THEME;
  return getAllThemes().find((theme) => theme.id === id) ?? DEFAULT_THEME;
}

export function getActiveLightThemeId(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  return localStorage.getItem(ACTIVE_LIGHT_THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
}

export function setActiveLightThemeId(id: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ACTIVE_LIGHT_THEME_STORAGE_KEY, id);
}

export function getActiveDarkThemeId(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  return localStorage.getItem(ACTIVE_DARK_THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
}

export function setActiveDarkThemeId(id: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ACTIVE_DARK_THEME_STORAGE_KEY, id);
}

/**
 * Whether a theme can supply the given color-mode palette. A theme is eligible for the light
 * dropdown if it declares `light` tokens (or declares no dark-only specialization), and likewise
 * for dark — so a freshly forked default (empty patch) appears under both, a Latte-only theme
 * only under light, and a dark-only theme like Nord only under dark.
 */
export function themeSupportsVariant(theme: ThemeDefinition, variant: ThemeVariant): boolean {
  if (variant === "light") return theme.light !== undefined || theme.dark === undefined;
  return theme.dark !== undefined || theme.light === undefined;
}

export function resolveTokens(theme: ThemeDefinition, variant: ThemeVariant): ThemeTokens {
  const base = (variant === "dark" ? DEFAULT_THEME.dark : DEFAULT_THEME.light) ?? {};
  const overlay = (variant === "dark" ? theme.dark : theme.light) ?? {};
  return { ...base, ...overlay };
}

export function tokensToCss(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");
}

/**
 * Apply the two independently-selected palettes: the `lightTheme`'s light tokens drive `:root`,
 * the `darkTheme`'s dark tokens drive `:root.dark`. When both are the default we inject nothing
 * and let `index.css` own the palette.
 */
export function applyActiveThemes(lightTheme: ThemeDefinition, darkTheme: ThemeDefinition): void {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  if (lightTheme.id === DEFAULT_THEME_ID && darkTheme.id === DEFAULT_THEME_ID) {
    removeThemeStyleElement();
    return;
  }

  const style = ensureThemeStyleElement();
  const lightCss = tokensToCss(materializeTokens(resolveTokens(lightTheme, "light")));
  const darkCss = tokensToCss(materializeTokens(resolveTokens(darkTheme, "dark")));
  style.textContent = `:root { ${lightCss} } :root.dark { ${darkCss} }`;
}

/** Re-apply whatever light/dark themes are currently persisted. */
export function restoreActiveThemes(): void {
  applyActiveThemes(findTheme(getActiveLightThemeId()), findTheme(getActiveDarkThemeId()));
}

/**
 * Preview a single theme across both color modes — used by the editor's live preview, where the
 * user wants to see the theme they are editing regardless of which slots it is assigned to.
 * Call {@link restoreActiveThemes} afterwards to return to the persisted selection.
 */
export function previewTheme(theme: ThemeDefinition): void {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  const style = ensureThemeStyleElement();
  const lightCss = tokensToCss(materializeTokens(resolveTokens(theme, "light")));
  const darkCss = tokensToCss(materializeTokens(resolveTokens(theme, "dark")));
  style.textContent = `:root { ${lightCss} } :root.dark { ${darkCss} }`;
}

function ensureThemeStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const style = document.createElement("style");
  style.id = THEME_STYLE_ELEMENT_ID;
  document.head.append(style);
  return style;
}

function removeThemeStyleElement(): void {
  const existing = document.getElementById(THEME_STYLE_ELEMENT_ID);
  existing?.remove();
}

function isValidTheme(value: unknown): value is ThemeDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return false;
  if (candidate.light !== undefined && !isTokenMap(candidate.light)) return false;
  if (candidate.dark !== undefined && !isTokenMap(candidate.dark)) return false;
  return true;
}

function isTokenMap(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}
