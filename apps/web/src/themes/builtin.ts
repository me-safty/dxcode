import type { ThemeDefinition, ThemeTokens } from "./types";

export const DEFAULT_THEME_ID = "default";

export const DEFAULT_THEME: ThemeDefinition = {
  id: DEFAULT_THEME_ID,
  name: "Default",
  description: "The built-in T3 Code light & dark palette.",
  builtIn: true,
  light: {
    radius: "0.625rem",
    background: "var(--color-white)",
    "app-chrome-background": "var(--background)",
    foreground: "var(--color-neutral-800)",
    card: "var(--color-white)",
    "card-foreground": "var(--color-neutral-800)",
    popover: "var(--color-white)",
    "popover-foreground": "var(--color-neutral-800)",
    primary: "oklch(0.488 0.217 264)",
    "primary-foreground": "var(--color-white)",
    secondary: "--alpha(var(--color-black) / 4%)",
    "secondary-foreground": "var(--color-neutral-800)",
    muted: "--alpha(var(--color-black) / 4%)",
    "muted-foreground": "color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-black))",
    accent: "--alpha(var(--color-black) / 4%)",
    "accent-foreground": "var(--color-neutral-800)",
    destructive: "var(--color-red-500)",
    "destructive-foreground": "var(--color-red-700)",
    border: "--alpha(var(--color-black) / 8%)",
    input: "--alpha(var(--color-black) / 10%)",
    ring: "oklch(0.488 0.217 264)",
    info: "var(--color-blue-500)",
    "info-foreground": "var(--color-blue-700)",
    success: "var(--color-emerald-500)",
    "success-foreground": "var(--color-emerald-700)",
    warning: "var(--color-amber-500)",
    "warning-foreground": "var(--color-amber-700)",
    "scrollbar-thumb": "rgba(0, 0, 0, 0.15)",
    "scrollbar-thumb-hover": "rgba(0, 0, 0, 0.25)",
    "scrollbar-thumb-thin": "rgba(0, 0, 0, 0.1)",
    "scrollbar-thumb-thin-hover": "rgba(0, 0, 0, 0.2)",
    "noise-opacity": "0.035",
  },
  dark: {
    background: "color-mix(in srgb, var(--color-neutral-950) 95%, var(--color-white))",
    "app-chrome-background": "var(--background)",
    foreground: "var(--color-neutral-100)",
    card: "color-mix(in srgb, var(--background) 98%, var(--color-white))",
    "card-foreground": "var(--color-neutral-100)",
    popover: "color-mix(in srgb, var(--background) 98%, var(--color-white))",
    "popover-foreground": "var(--color-neutral-100)",
    primary: "oklch(0.588 0.217 264)",
    "primary-foreground": "var(--color-white)",
    secondary: "--alpha(var(--color-white) / 4%)",
    "secondary-foreground": "var(--color-neutral-100)",
    muted: "--alpha(var(--color-white) / 4%)",
    "muted-foreground": "color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-white))",
    accent: "--alpha(var(--color-white) / 4%)",
    "accent-foreground": "var(--color-neutral-100)",
    destructive: "color-mix(in srgb, var(--color-red-500) 90%, var(--color-white))",
    "destructive-foreground": "var(--color-red-400)",
    border: "--alpha(var(--color-white) / 6%)",
    input: "--alpha(var(--color-white) / 8%)",
    ring: "oklch(0.588 0.217 264)",
    info: "var(--color-blue-500)",
    "info-foreground": "var(--color-blue-400)",
    success: "var(--color-emerald-500)",
    "success-foreground": "var(--color-emerald-400)",
    warning: "var(--color-amber-500)",
    "warning-foreground": "var(--color-amber-400)",
    "scrollbar-thumb": "rgba(255, 255, 255, 0.1)",
    "scrollbar-thumb-hover": "rgba(255, 255, 255, 0.18)",
    "scrollbar-thumb-thin": "rgba(255, 255, 255, 0.08)",
    "scrollbar-thumb-thin-hover": "rgba(255, 255, 255, 0.15)",
  },
};

const SOLARIZED: ThemeDefinition = {
  id: "solarized",
  name: "Solarized",
  description: "Ethan Schoonover's precision palette — Solarized Light and Dark.",
  builtIn: true,
  syntax: { light: "solarized-light", dark: "solarized-dark" },
  light: {
    background: "#fdf6e3",
    "app-chrome-background": "#fdf6e3",
    foreground: "#586e75",
    card: "#fdf6e3",
    "card-foreground": "#586e75",
    popover: "#eee8d5",
    "popover-foreground": "#586e75",
    primary: "#268bd2",
    "primary-foreground": "#fdf6e3",
    secondary: "#eee8d5",
    "secondary-foreground": "#586e75",
    muted: "#eee8d5",
    "muted-foreground": "#93a1a1",
    accent: "#eee8d5",
    "accent-foreground": "#586e75",
    destructive: "#dc322f",
    "destructive-foreground": "#fdf6e3",
    border: "rgba(88, 110, 117, 0.18)",
    input: "rgba(88, 110, 117, 0.22)",
    ring: "#268bd2",
    info: "#268bd2",
    "info-foreground": "#268bd2",
    success: "#859900",
    "success-foreground": "#859900",
    warning: "#b58900",
    "warning-foreground": "#b58900",
    "scrollbar-thumb": "rgba(88, 110, 117, 0.3)",
    "scrollbar-thumb-hover": "rgba(88, 110, 117, 0.45)",
    "scrollbar-thumb-thin": "rgba(88, 110, 117, 0.2)",
    "scrollbar-thumb-thin-hover": "rgba(88, 110, 117, 0.35)",
  },
  dark: {
    background: "#002b36",
    "app-chrome-background": "#002b36",
    foreground: "#93a1a1",
    card: "#073642",
    "card-foreground": "#93a1a1",
    popover: "#073642",
    "popover-foreground": "#93a1a1",
    primary: "#268bd2",
    "primary-foreground": "#002b36",
    secondary: "#073642",
    "secondary-foreground": "#93a1a1",
    muted: "#073642",
    "muted-foreground": "#657b83",
    accent: "#073642",
    "accent-foreground": "#eee8d5",
    destructive: "#dc322f",
    "destructive-foreground": "#fdf6e3",
    border: "rgba(147, 161, 161, 0.14)",
    input: "rgba(147, 161, 161, 0.18)",
    ring: "#268bd2",
    info: "#268bd2",
    "info-foreground": "#2aa198",
    success: "#859900",
    "success-foreground": "#859900",
    warning: "#b58900",
    "warning-foreground": "#b58900",
    "scrollbar-thumb": "rgba(147, 161, 161, 0.18)",
    "scrollbar-thumb-hover": "rgba(147, 161, 161, 0.32)",
    "scrollbar-thumb-thin": "rgba(147, 161, 161, 0.12)",
    "scrollbar-thumb-thin-hover": "rgba(147, 161, 161, 0.24)",
  },
};

const NORD: ThemeDefinition = {
  id: "nord",
  name: "Nord",
  description: "Cool arctic blues inspired by the Nord palette by Arctic Ice Studio.",
  builtIn: true,
  syntax: { dark: "nord" },
  dark: {
    background: "#2e3440",
    "app-chrome-background": "#2e3440",
    foreground: "#d8dee9",
    card: "#3b4252",
    "card-foreground": "#e5e9f0",
    popover: "#3b4252",
    "popover-foreground": "#e5e9f0",
    primary: "#88c0d0",
    "primary-foreground": "#2e3440",
    secondary: "#434c5e",
    "secondary-foreground": "#e5e9f0",
    muted: "#3b4252",
    "muted-foreground": "#7b8794",
    accent: "#434c5e",
    "accent-foreground": "#eceff4",
    destructive: "#bf616a",
    "destructive-foreground": "#eceff4",
    border: "rgba(216, 222, 233, 0.1)",
    input: "rgba(216, 222, 233, 0.14)",
    ring: "#88c0d0",
    info: "#81a1c1",
    "info-foreground": "#8fbcbb",
    success: "#a3be8c",
    "success-foreground": "#a3be8c",
    warning: "#ebcb8b",
    "warning-foreground": "#ebcb8b",
    "scrollbar-thumb": "rgba(216, 222, 233, 0.16)",
    "scrollbar-thumb-hover": "rgba(216, 222, 233, 0.28)",
    "scrollbar-thumb-thin": "rgba(216, 222, 233, 0.12)",
    "scrollbar-thumb-thin-hover": "rgba(216, 222, 233, 0.22)",
  },
};

const HIGH_CONTRAST: ThemeDefinition = {
  id: "high-contrast",
  name: "High Contrast",
  description: "Maximum-contrast monochrome with yellow accents for accessibility.",
  builtIn: true,
  light: {
    background: "#ffffff",
    "app-chrome-background": "#ffffff",
    foreground: "#000000",
    card: "#ffffff",
    "card-foreground": "#000000",
    popover: "#ffffff",
    "popover-foreground": "#000000",
    primary: "#0000ee",
    "primary-foreground": "#ffffff",
    secondary: "#f5f5f5",
    "secondary-foreground": "#000000",
    muted: "#f0f0f0",
    "muted-foreground": "#1a1a1a",
    accent: "#ffeb3b",
    "accent-foreground": "#000000",
    destructive: "#cc0000",
    "destructive-foreground": "#ffffff",
    border: "#000000",
    input: "#000000",
    ring: "#0000ee",
    info: "#0000ee",
    "info-foreground": "#0000aa",
    success: "#006400",
    "success-foreground": "#003200",
    warning: "#996600",
    "warning-foreground": "#664400",
    "scrollbar-thumb": "rgba(0, 0, 0, 0.55)",
    "scrollbar-thumb-hover": "rgba(0, 0, 0, 0.8)",
    "scrollbar-thumb-thin": "rgba(0, 0, 0, 0.45)",
    "scrollbar-thumb-thin-hover": "rgba(0, 0, 0, 0.7)",
    "noise-opacity": "0",
  },
  dark: {
    background: "#000000",
    "app-chrome-background": "#000000",
    foreground: "#ffffff",
    card: "#000000",
    "card-foreground": "#ffffff",
    popover: "#000000",
    "popover-foreground": "#ffffff",
    primary: "#ffff00",
    "primary-foreground": "#000000",
    secondary: "#1a1a1a",
    "secondary-foreground": "#ffffff",
    muted: "#0d0d0d",
    "muted-foreground": "#e6e6e6",
    accent: "#ffff00",
    "accent-foreground": "#000000",
    destructive: "#ff5555",
    "destructive-foreground": "#000000",
    border: "#ffffff",
    input: "#ffffff",
    ring: "#ffff00",
    info: "#5fd7ff",
    "info-foreground": "#5fd7ff",
    success: "#5fff5f",
    "success-foreground": "#5fff5f",
    warning: "#ffff5f",
    "warning-foreground": "#ffff5f",
    "scrollbar-thumb": "rgba(255, 255, 255, 0.55)",
    "scrollbar-thumb-hover": "rgba(255, 255, 255, 0.85)",
    "scrollbar-thumb-thin": "rgba(255, 255, 255, 0.4)",
    "scrollbar-thumb-thin-hover": "rgba(255, 255, 255, 0.7)",
    "noise-opacity": "0",
  },
};

// Catppuccin — https://catppuccin.com. Each flavor is a verbatim copy of the
// official palette. We pair the light flavor (Latte) with each dark flavor so
// the theme stays coherent when the color mode toggles.
type CatppuccinPalette = {
  base: string;
  mantle: string;
  text: string;
  subtext0: string;
  surface0: string;
  surface1: string;
  surface2: string;
  overlay0: string;
  mauve: string;
  blue: string;
  red: string;
  green: string;
  yellow: string;
};

function catppuccinTokens(p: CatppuccinPalette): ThemeTokens {
  return {
    background: p.base,
    "app-chrome-background": p.mantle,
    foreground: p.text,
    card: p.surface0,
    "card-foreground": p.text,
    popover: p.surface0,
    "popover-foreground": p.text,
    primary: p.mauve,
    "primary-foreground": p.base,
    secondary: p.surface0,
    "secondary-foreground": p.text,
    muted: p.surface0,
    "muted-foreground": p.subtext0,
    accent: p.surface1,
    "accent-foreground": p.text,
    destructive: p.red,
    "destructive-foreground": p.base,
    border: p.surface1,
    input: p.surface2,
    ring: p.mauve,
    info: p.blue,
    "info-foreground": p.blue,
    success: p.green,
    "success-foreground": p.green,
    warning: p.yellow,
    "warning-foreground": p.yellow,
    "scrollbar-thumb": p.surface2,
    "scrollbar-thumb-hover": p.overlay0,
    "scrollbar-thumb-thin": p.surface1,
    "scrollbar-thumb-thin-hover": p.surface2,
  };
}

const CATPPUCCIN_LATTE: CatppuccinPalette = {
  base: "#eff1f5",
  mantle: "#e6e9ef",
  text: "#4c4f69",
  subtext0: "#6c6f85",
  surface0: "#ccd0da",
  surface1: "#bcc0cc",
  surface2: "#acb0be",
  overlay0: "#9ca0b0",
  mauve: "#8839ef",
  blue: "#1e66f5",
  red: "#d20f39",
  green: "#40a02b",
  yellow: "#df8e1d",
};

const CATPPUCCIN_FRAPPE: CatppuccinPalette = {
  base: "#303446",
  mantle: "#292c3c",
  text: "#c6d0f5",
  subtext0: "#a5adce",
  surface0: "#414559",
  surface1: "#51576d",
  surface2: "#626880",
  overlay0: "#737994",
  mauve: "#ca9ee6",
  blue: "#8caaee",
  red: "#e78284",
  green: "#a6d189",
  yellow: "#e5c890",
};

const CATPPUCCIN_MACCHIATO: CatppuccinPalette = {
  base: "#24273a",
  mantle: "#1e2030",
  text: "#cad3f5",
  subtext0: "#a5adcb",
  surface0: "#363a4f",
  surface1: "#494d64",
  surface2: "#5b6078",
  overlay0: "#6e738d",
  mauve: "#c6a0f6",
  blue: "#8aadf4",
  red: "#ed8796",
  green: "#a6da95",
  yellow: "#eed49f",
};

const CATPPUCCIN_MOCHA: CatppuccinPalette = {
  base: "#1e1e2e",
  mantle: "#181825",
  text: "#cdd6f4",
  subtext0: "#a6adc8",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  mauve: "#cba6f7",
  blue: "#89b4fa",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
};

const CATPPUCCIN_LATTE_THEME: ThemeDefinition = {
  id: "catppuccin-latte",
  name: "Catppuccin Latte",
  description: "Catppuccin's warm light flavor.",
  builtIn: true,
  syntax: { light: "catppuccin-latte" },
  light: catppuccinTokens(CATPPUCCIN_LATTE),
};

const CATPPUCCIN_FRAPPE_THEME: ThemeDefinition = {
  id: "catppuccin-frappe",
  name: "Catppuccin Frappé",
  description: "Catppuccin's gentle, low-contrast dark flavor.",
  builtIn: true,
  syntax: { dark: "catppuccin-frappe" },
  dark: catppuccinTokens(CATPPUCCIN_FRAPPE),
};

const CATPPUCCIN_MACCHIATO_THEME: ThemeDefinition = {
  id: "catppuccin-macchiato",
  name: "Catppuccin Macchiato",
  description: "Catppuccin's medium-contrast dark flavor.",
  builtIn: true,
  syntax: { dark: "catppuccin-macchiato" },
  dark: catppuccinTokens(CATPPUCCIN_MACCHIATO),
};

const CATPPUCCIN_MOCHA_THEME: ThemeDefinition = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  description: "Catppuccin's vivid, high-contrast dark flavor.",
  builtIn: true,
  syntax: { dark: "catppuccin-mocha" },
  dark: catppuccinTokens(CATPPUCCIN_MOCHA),
};

// Rosé Pine — https://rosepinetheme.com. Dawn is the light variant; Main and
// Moon are the dark variants.
type RosePinePalette = {
  base: string;
  surface: string;
  overlay: string;
  muted: string;
  subtle: string;
  text: string;
  love: string;
  gold: string;
  pine: string;
  foam: string;
  iris: string;
  highlightMed: string;
  highlightHigh: string;
};

function rosePineTokens(p: RosePinePalette): ThemeTokens {
  return {
    background: p.base,
    "app-chrome-background": p.base,
    foreground: p.text,
    card: p.surface,
    "card-foreground": p.text,
    popover: p.surface,
    "popover-foreground": p.text,
    primary: p.iris,
    "primary-foreground": p.base,
    secondary: p.overlay,
    "secondary-foreground": p.text,
    muted: p.overlay,
    "muted-foreground": p.subtle,
    accent: p.overlay,
    "accent-foreground": p.text,
    destructive: p.love,
    "destructive-foreground": p.base,
    border: p.highlightMed,
    input: p.highlightHigh,
    ring: p.iris,
    info: p.foam,
    "info-foreground": p.foam,
    success: p.pine,
    "success-foreground": p.pine,
    warning: p.gold,
    "warning-foreground": p.gold,
    "scrollbar-thumb": p.highlightHigh,
    "scrollbar-thumb-hover": p.muted,
    "scrollbar-thumb-thin": p.highlightMed,
    "scrollbar-thumb-thin-hover": p.highlightHigh,
  };
}

const ROSE_PINE_DAWN: RosePinePalette = {
  base: "#faf4ed",
  surface: "#fffaf3",
  overlay: "#f2e9e1",
  muted: "#9893a5",
  subtle: "#797593",
  text: "#575279",
  love: "#b4637a",
  gold: "#ea9d34",
  pine: "#286983",
  foam: "#56949f",
  iris: "#907aa9",
  highlightMed: "#dfdad9",
  highlightHigh: "#cecacd",
};

const ROSE_PINE_MAIN: RosePinePalette = {
  base: "#191724",
  surface: "#1f1d2e",
  overlay: "#26233a",
  muted: "#6e6a86",
  subtle: "#908caa",
  text: "#e0def4",
  love: "#eb6f92",
  gold: "#f6c177",
  pine: "#31748f",
  foam: "#9ccfd8",
  iris: "#c4a7e7",
  highlightMed: "#403d52",
  highlightHigh: "#524f67",
};

const ROSE_PINE_MOON_PALETTE: RosePinePalette = {
  base: "#232136",
  surface: "#2a273f",
  overlay: "#393552",
  muted: "#6e6a86",
  subtle: "#908caa",
  text: "#e0def4",
  love: "#eb6f92",
  gold: "#f6c177",
  pine: "#3e8fb0",
  foam: "#9ccfd8",
  iris: "#c4a7e7",
  highlightMed: "#44415a",
  highlightHigh: "#56526e",
};

const ROSE_PINE_DAWN_THEME: ThemeDefinition = {
  id: "rose-pine-dawn",
  name: "Rosé Pine Dawn",
  description: "Rosé Pine's soft, warm light variant.",
  builtIn: true,
  syntax: { light: "rose-pine-dawn" },
  light: rosePineTokens(ROSE_PINE_DAWN),
};

const ROSE_PINE_THEME: ThemeDefinition = {
  id: "rose-pine",
  name: "Rosé Pine",
  description: "All natural pine, faux fur and a bit of soho vibes.",
  builtIn: true,
  syntax: { dark: "rose-pine" },
  dark: rosePineTokens(ROSE_PINE_MAIN),
};

const ROSE_PINE_MOON_THEME: ThemeDefinition = {
  id: "rose-pine-moon",
  name: "Rosé Pine Moon",
  description: "A softer, dreamier take on Rosé Pine.",
  builtIn: true,
  syntax: { dark: "rose-pine-moon" },
  dark: rosePineTokens(ROSE_PINE_MOON_PALETTE),
};

export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  DEFAULT_THEME,
  SOLARIZED,
  NORD,
  CATPPUCCIN_LATTE_THEME,
  CATPPUCCIN_FRAPPE_THEME,
  CATPPUCCIN_MACCHIATO_THEME,
  CATPPUCCIN_MOCHA_THEME,
  ROSE_PINE_DAWN_THEME,
  ROSE_PINE_THEME,
  ROSE_PINE_MOON_THEME,
  HIGH_CONTRAST,
];
