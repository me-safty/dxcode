# @t3tools/plugin-sdk-web

> **Import `effect` from the barrel, not subpaths.** `import { Effect, Schema } from "effect"` ✅ —
> `import * as Effect from "effect/Effect"` ❌ does not resolve in a plugin web bundle. The host
> import map enumerates bare specifiers only. See [Importing `effect`](#importing-effect).

Thin host-surface barrel for plugin web bundles. Plugin builds should treat these runtime modules
as externals and let the host import map resolve them at runtime:

- `react`
- `react-dom`
- `react-dom/client`
- `react/jsx-runtime`
- `react/jsx-dev-runtime`
- `@effect/atom-react`
- `effect`
- `@t3tools/plugin-sdk-web`

## Importing `effect`

The host import map maps the **bare `effect` specifier only** — not its subpaths. Import effect
modules from the barrel:

```ts
import { Effect, Stream, Option } from "effect"; // ✅ resolves via the host import map
```

Do **not** import effect subpaths in a plugin web bundle:

```ts
import * as Effect from "effect/Effect"; // ❌ not in the import map — fails to resolve in the browser
```

(This differs from server plugins, where a Node resolve hook handles subpaths. Web plugins rely on
the native browser import map, which enumerates the bare specifier.)

## Tailwind

Tailwind v4 utilities are emitted by scanning the host build. A separately-built plugin cannot
assume arbitrary Tailwind utility classes will exist in the host CSS. Use host CSS variables such
as `--background`, `--color-*`, and `.dark`, use the exported host design-system components, or
ship compiled plugin CSS for plugin-local classes.
