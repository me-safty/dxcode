# TODO

- Fix broken runtime workspace-package resolution for local entrypoints.
  - Current symptom: scripts and desktop runtime code cannot reliably import workspace packages such as `@tero/shared` at runtime in this checkout.
  - Evidence:
    - `scripts/dev-runner.ts` failed to resolve `@tero/shared/Net`
    - desktop runtime previously failed to resolve `@tero/shared/Net` and related shared imports
  - Current workaround:
    - some runtime imports were switched to direct repo-relative paths
  - Desired fix:
    - restore a proper workspace/runtime linking story so local Node/Electron entrypoints can use workspace package imports without repo-relative fallbacks
  - Why it matters:
    - this is separate from the T3 Code state-poisoning issue
    - it makes local dev fragile and forces temporary path hacks into runtime entrypoints
