# CI Quality Gates

Status: **Completed**
Last reviewed: 2026-07-13

## Current state

`.github/workflows/ci.yml` uses `voidzero-dev/setup-vp` and separates the main gates into:

- `vp check`
- workspace typechecking
- desktop build/preload verification
- `vp run test`
- macOS mobile-native static analysis via `vp run lint:mobile`
- release-only smoke coverage

Release workflows repeat the appropriate Vite+ checks before publishing artifacts. CI uses the Node engine declared in `package.json` and the repository lockfile; Bun/Turbo setup is no longer part of the toolchain.

## Maintenance rules

- Keep local completion commands aligned with CI and `AGENTS.md`.
- Add a focused gate only when it protects a distinct platform or artifact boundary.
- Prefer deterministic tests and explicit readiness signals over retries or timing sleeps.
- Update workflow caches through `setup-vp`; do not introduce a second package-manager cache path.

## Validation

Workflow changes must be exercised on a PR. Locally, run the repository baseline and any changed workflow-equivalent script.
