# CI quality gates

- `.github/workflows/ci.yml` runs the desktop-core quality path on pull requests and pushes to `main`.
  - filtered `vp run ... typecheck`
  - filtered `vp run ... test`
- The core path covers the desktop app, server, shared web renderer, shared packages, scripts, and local lint plugin. Mobile and marketing surfaces are pruned from this fork.
- Local aliases for the same scope are available with `pnpm run typecheck:core`, `pnpm run test:core`, and `pnpm run quality:core`.
- Whole-repo checks are still available locally with `pnpm run typecheck:full`, `pnpm run test:full`, and `pnpm run quality:full`.
- `.github/workflows/release.yml` is manual-only for now. It can still publish GitHub Release desktop artifacts when run through `workflow_dispatch`, but it does not run from tags or normal CI.
- The release workflow auto-enables signing only when platform credentials are present. Without signing credentials, it still releases unsigned artifacts.
- See [Release Checklist](./release.md) for the full release/signing setup checklist.
