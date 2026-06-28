export const THEME_TOKEN_NAMES = [
  "background",
  "app-chrome-background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "info",
  "info-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
  "scrollbar-thumb-thin",
  "scrollbar-thumb-thin-hover",
  "noise-opacity",
  "radius",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type ThemeTokens = Partial<Record<ThemeTokenName, string>>;

export type ThemeVariant = "light" | "dark";

/**
 * Names of the Shiki syntax-highlighting theme to pair with each color-mode
 * variant. These are Shiki bundled theme ids (e.g. "catppuccin-mocha") so code
 * blocks, diffs, and file previews match the palette per the theme's own
 * guidelines. A variant left unset falls back to the app's generic Pierre theme.
 */
export type SyntaxThemes = {
  light?: string;
  dark?: string;
};

export type ThemeDefinition = {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  light?: ThemeTokens;
  dark?: ThemeTokens;
  syntax?: SyntaxThemes;
};
