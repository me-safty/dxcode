# Pre-Commit Formatting and Linting

Status: **Completed**
Last reviewed: 2026-07-13

## Current state

Vite+ installs the repository hooks during `prepare`. `.vite-hooks/pre-commit` runs:

```bash
vp staged
```

Formatting and lint configuration therefore remains centralized in Vite+ instead of Husky, lint-staged, Lefthook, Biome, or custom per-package hooks.

## Maintenance rules

- Keep the hook fast and limited to staged files.
- Keep full-repository correctness in CI (`vp check` and typecheck), not in pre-commit.
- Do not add a second hook manager.
- When changing formatting or lint rules, verify both `vp staged` behavior and a full `vp check`.

## Validation

Stage representative supported file types, run `vp staged`, and finish with the repository baseline.
