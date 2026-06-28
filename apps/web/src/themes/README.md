# Theme system

A token-based custom theming layer for the web app. A **theme** is a small JSON
document that overrides CSS custom properties. Built-in themes ship with the app;
custom themes live in `localStorage` and can be edited, imported, and exported.

## How it works

The base palette is declared in `apps/web/src/index.css` as CSS custom properties
(`--background`, `--primary`, `--border`, …) with a light default and a `.dark`
variant. The active themes are applied by injecting a single
`<style id="t3code-active-theme">` tag whose body re-declares those variables:

```css
:root { --primary: #8839ef; … } :root.dark { --primary: #cba6f7; … }
```

Light and dark palettes are selected **independently**: one theme supplies the
`:root` (light-mode) block, another supplies the `:root.dark` block. The existing
`light` / `dark` / `system` color mode still drives the `.dark` class and so decides
which of the two is visible. When both slots are the Default theme nothing is
injected and `index.css` owns the palette.

A single theme provides one or both variants. A theme appears in the light-theme
dropdown if it defines `light` tokens (or no variant at all), and in the dark
dropdown if it defines `dark` tokens (or none) — see `themeSupportsVariant`.

## Code highlighting

Syntax highlighting (chat code blocks, diffs, and file previews) is rendered by
`@pierre/diffs`, which wraps Shiki. A theme may name an official Shiki theme per
variant via its optional `syntax` field; `resolveDiffThemeName` in
`lib/diffRendering.ts` reads the active palette for the current color mode and
returns that Shiki theme so highlighting matches the palette's own guidelines —
e.g. Catppuccin Mocha highlights with `catppuccin-mocha`, Rosé Pine Moon with
`rose-pine-moon`. Palettes that do not define a `syntax` theme for a variant
(Default, High Contrast, most custom themes) fall back to the generic
`pierre-light` / `pierre-dark`. The Shiki themes are bundled and loaded lazily on
first use, so switching palettes pulls in the matching grammar on demand.

## Files

- `types.ts` — `ThemeDefinition`, `ThemeTokens`, and the `THEME_TOKEN_NAMES` allow-list.
- `builtin.ts` — `DEFAULT_THEME` (a verbatim copy of the `index.css` palette) plus
  the shipped presets: Solarized, Nord, Catppuccin (Latte / Frappé / Macchiato /
  Mocha), Rosé Pine (Dawn / Main / Moon), and High Contrast. Catppuccin and Rosé
  Pine are mapped from their official palettes via `catppuccinTokens` /
  `rosePineTokens` helpers; each flavor is a single-variant theme (Latte and Dawn
  are light, the rest dark) so the light/dark dropdowns read naturally.
- `registry.ts` — storage (`localStorage`), CRUD, token resolution, and the
  `applyActiveThemes` / `previewTheme` / `restoreActiveThemes` document appliers.
- `transport.ts` — JSON (de)serialization, import/export, base64, clipboard, file download.

## Schema

```jsonc
{
  "id": "my-theme", // required, unique
  "name": "My Theme", // required
  "description": "Optional.", // optional
  "light": { "primary": "#abc", "background": "#fff" }, // optional token overrides
  "dark": { "primary": "#def" }, // optional token overrides
  "syntax": { "light": "catppuccin-latte", "dark": "catppuccin-mocha" }, // optional Shiki themes
}
```

Only token names in `THEME_TOKEN_NAMES` are honored; unknown keys are ignored on
save. Token values are plain CSS — hex, `rgb()/rgba()`, `oklch()`, `var(...)`,
`color-mix(...)`. Any token left unset falls back to the Default theme's value for
that variant, so a custom theme only needs to specify what it changes.

### A note on `--alpha(...)`

Tailwind v4's `--alpha(<color> / <pct>%)` is a _build-time_ function. It cannot be
emitted into a runtime `<style>` tag — it would resolve to nothing and collapse
e.g. borders to solid white/black. `registry.ts` runs every resolved token through
`materializeTokens`, converting `--alpha(c / p%)` to
`color-mix(in srgb, c p%, transparent)` before injection.
