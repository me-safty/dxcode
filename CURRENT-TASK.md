# CURRENT TASK

## User Summary

- The last attempt to rename this project from `t3code` / `T3 Code` to `tero` appears to have contributed to breaking the installed T3 Code app that was being used to talk here.
- After that breakage, the user manually removed and reinstalled the local app/environment, which fixed the installed app:
  - `/Applications/T3 Code (Alpha).app`
  - `~/.t3`
  - `~/Library/Application Support/t3code`
  - `~/Library/Preferences/com.t3tools.t3code.plist`
- The goal now is to retry the rename carefully and keep a persistent log in this repository so the task can be resumed if context is lost again.
- A second breakage reportedly happened again very quickly, roughly within 2 minutes of starting work on this repo, before any substantial rename pass had even happened.
- On the second recovery attempt, the user did **not** delete the installed app bundle. They removed only local support/state:
  - `~/.t3`
  - `~/Library/Application Support/t3code`
  - `~/Library/Preferences/com.t3tools.t3code.plist`
  - They explicitly kept `/Applications/T3 Code (Alpha).app`
- After deleting only local state, the installed app worked again. This is strong evidence that the `.app` bundle itself was not the thing being damaged.

## Current Objective

- Keep this file updated with a concise running summary of:
  - what the user asked for
  - what was found in the repo
  - what was changed
  - any suspected cause of breakage
  - what remains to do
- Rename scope clarification from user:
  - not only `t3code` / `T3 Code`
  - also project-specific `t3` references should be considered in-scope
  - avoid blindly renaming unrelated third-party/library/framework strings that merely contain `t3`

## Findings So Far

- This repository is not in a clean state. `git status --short` already shows many modified files across `apps/desktop`, `apps/server`, `apps/web`, `packages/shared`, root docs, and scripts.
- There is currently no root `CURRENT-TASK.md` other than this file.
- The rename is only partially complete:
  - some values already use `tero`
  - some values still use `t3code` / `T3 Code`
- There are also still project-specific `t3` references in package scopes, app IDs, repo/org names, storage keys, and test fixture prefixes.
- Examples observed:
  - root [`package.json`](/Users/raulrodrigues/workspace/personal/t3code-ero/package.json) has scripts filtered to `tero`
  - [`apps/desktop/package.json`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/package.json) has `productName: "Tero (Alpha)"`
  - docs like [`README.md`](/Users/raulrodrigues/workspace/personal/t3code-ero/README.md) and [`REMOTE.md`](/Users/raulrodrigues/workspace/personal/t3code-ero/REMOTE.md) still mention `T3 Code`
  - multiple source files still contain `T3 Code`, `t3code`, or old config-path references such as `.t3code-keybindings.json`
- Additional runtime-sensitive leftovers identified during audit:
  - [`apps/server/src/codexAppServerManager.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/codexAppServerManager.ts) still reports Codex client info as `t3code_desktop` / `T3 Code Desktop`
  - [`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts) still uses `t3code` as the worktree branch prefix
  - [`apps/web/src/store.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/store.ts) intentionally keeps old `t3code:*` localStorage keys as legacy migration inputs while writing new `tero:*` keys
  - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) already prefers `TERO_HOME` / `.tero` but still falls back to `T3CODE_HOME` for compatibility
- I have not yet verified the exact prior failure mode. The earlier mention of "effect" is not yet confirmed from the current workspace snapshot.
- The second recovery significantly narrows the problem:
  - removing persisted local state restored the installed app
  - keeping the `.app` bundle in place did not prevent recovery
  - that strongly suggests corrupted or incompatible persisted state, not a permanently broken packaged binary
- Current startup/storage findings relevant to this theory:
  - [`apps/server/src/os-jank.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/os-jank.ts) resolves the default base directory to `~/.tero`
  - [`apps/server/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/main.ts) aliases old `T3CODE_*` env vars into `TERO_*`
  - [`apps/server/src/config.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/config.ts) derives runtime paths such as `userdata/state.sqlite`, `keybindings.json`, logs, attachments, and worktrees from the chosen base dir
  - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) sets `BASE_DIR` from `TERO_HOME`, then `T3CODE_HOME`, then `~/.tero`
  - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) also overrides Electron `userData` selection but still reuses a legacy path if it already exists, specifically to preserve Chromium profile data
- There are still branding/identity mismatches in the current snapshot that may matter during startup:
  - [`apps/web/src/branding.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/branding.ts) still says `T3 Code`
  - [`apps/web/index.html`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/index.html) still says `T3 Code (Alpha)`
  - several desktop/web strings and support paths still mention `T3 Code`, `t3code`, or `.t3code-*`

## State Path / Restore Matrix

| Surface                        | Packaged app behavior                                                     | Dev behavior                                                                      | Legacy `t3code` / `t3` path                                                            | New `tero` path                                    | Env fallback                                             | Collision risk                                                                       |
| ------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Server base dir                | Desktop child server gets `TERO_HOME` from desktop main                   | CLI/dev server resolves via `--home-dir` or env                                   | `T3CODE_HOME` is still accepted and aliased in server startup                          | `TERO_HOME`, default `~/.tero`                     | `TERO_HOME ?? T3CODE_HOME ?? ~/.tero`                    | High if installed app and dev runs share `TERO_HOME` or legacy env                   |
| Server state dir               | Packaged server uses `<baseDir>/userdata`                                 | Dev server uses `<baseDir>/dev` when `VITE_DEV_SERVER_URL` is set                 | Old env can still point at old base dir                                                | `<baseDir>/userdata` or `<baseDir>/dev`            | derived from resolved base dir                           | Medium if base dir collides; lower between `userdata` and `dev` themselves           |
| SQLite DB                      | Packaged startup reads `<baseDir>/userdata/state.sqlite`                  | Dev reads `<baseDir>/dev/state.sqlite`                                            | Legacy data can survive if base dir still points at old location                       | `state.sqlite` under resolved state dir            | same as above                                            | High because schema decode/migration failures poison startup immediately             |
| Desktop Chromium `userData`    | Electron overrides to clean app-data dir but reuses legacy dir if present | Dev uses separate `tero-dev` target but still prefers legacy dev dir when present | `~/Library/Application Support/T3 Code (Alpha)` or `T3 Code (Dev)` may still be reused | `~/Library/Application Support/tero` or `tero-dev` | no env here; path selected by platform + existence check | High because packaged app can intentionally reattach to legacy Chromium profile data |
| Web renderer localStorage      | Browser/Electron renderer loads persisted renderer state on startup       | Same codepath in dev renderer                                                     | reads old `t3code:renderer-state:v*` keys only as migration inputs                     | writes `tero:renderer-state:v8`                    | none                                                     | Medium; stale UI state can survive via Chromium profile reuse                        |
| Desktop logs                   | Packaged app writes under `<baseDir>/userdata/logs`                       | Dev logs mostly go to terminal; packaged capture disabled                         | old base dir via env alias still possible                                              | `<baseDir>/userdata/logs`                          | same base-dir fallback                                   | Low for poisoning, high for evidence value                                           |
| Provider metadata / Codex init | Server still identifies as `t3code_desktop`                               | same in dev                                                                       | legacy client name remains                                                             | none yet                                           | none                                                     | Low direct poisoning risk, medium for mixed identity/debug confusion                 |
| Worktree branch prefix         | Packaged and dev server both mint `t3code/...` branches                   | same                                                                              | `t3code/...` still hard-coded                                                          | no `tero/...` yet                                  | none                                                     | Low for startup poisoning, medium for repo-state confusion                           |

## Ranked Startup Poisoning Mechanisms

1. Cross-version SQLite schema incompatibility between the installed app and this repo snapshot.
   - Evidence:
     - repo-launched desktop app ran migration `16_CanonicalizeModelSelections` against `~/.t3`
     - installed app then failed with `ProjectionThreadRepository.getById:query ... no such column: model`
   - Code references:
     - [`apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts)
     - [`apps/server/src/persistence/Layers/ProjectionThreads.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/persistence/Layers/ProjectionThreads.ts)
   - Why highest risk: this is proven, immediate, and breaks the installed app even without a broad rename pass.
2. Persisted orchestration event rows that no longer decode under current schemas.
   - Evidence: previous packaged log contained `OrchestrationEventStore.readFromSequence:rowToEvent: Missing key at ["payload"]["defaultModel"]`.
   - Code references:
     - [`apps/server/src/persistence/Layers/OrchestrationEventStore.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/persistence/Layers/OrchestrationEventStore.ts)
     - [`apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts)
   - Why high risk: startup replays persisted events before the app becomes usable.
3. Installed app reusing legacy Electron `userData`, which preserves localStorage/cookies/session state across rename attempts.
   - Code references:
     - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts)
     - [`apps/web/src/store.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/store.ts)
   - Why high risk: deleting only `~/.t3` would not clear Chromium-side state if `~/Library/Application Support/T3 Code (Alpha)` remains.
4. Base-dir collisions caused by compatibility env aliases (`TERO_HOME` vs `T3CODE_HOME`) between installed and dev/server runs.
   - Code references:
     - [`apps/server/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/main.ts)
     - [`apps/server/src/os-jank.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/os-jank.ts)
     - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts)
   - Why high risk: one run can silently point another at the same persisted state root.
5. Partial rename drift between packaged identity, storage keys, and protocol/client identifiers.
   - Code references:
     - [`apps/server/src/codexAppServerManager.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/codexAppServerManager.ts)
     - [`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)
   - Why medium risk: likely not the primary poisoner, but it increases ambiguity and complicates recovery.

## Investigation Log

- 2026-03-27 batch 1
  - Scope: static forensic audit only.
  - New findings:
    - Packaged and dev server intentionally diverge only at `userdata` vs `dev` under the same resolved base dir.
    - Packaged desktop intentionally reuses legacy Electron `userData` when the old app-support folder still exists.
    - A migration already exists for the exact old `defaultModel` payload shape implicated by the earlier decode error.
  - Small code changes prepared for better evidence collection:
    - desktop main now logs chosen base dir and whether legacy Electron `userData` was reused
    - server startup now warns if `TERO_*` and `T3CODE_*` env vars conflict
  - Command results:
    - `bun fmt`: passed
    - `bun lint`: passed
    - `bun typecheck`: failed outside this batch in [`packages/shared/src/model.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.ts) and [`packages/shared/src/model.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.test.ts)
    - Failure shape:
      - `Cannot find module '@tero/contracts'`
      - several implicit `any` callback params
      - one `Object is possibly 'undefined'`
  - Installed-app outcome:
    - User reported the installed app "broke" immediately after this batch.
    - Follow-up log inspection did **not** show a backend startup failure.
    - Packaged server evidence:
      - migrations ran successfully
      - orchestration engine started cleanly
      - packaged app resumed a Codex-backed thread for `/Users/raulrodrigues/workspace/personal/t3code-ero`
      - no SQL/decode crash was present in the latest startup logs
    - App bundle status: kept in place.
    - Recovery actions: not yet performed for this occurrence.
    - Updated implication:
      - this occurrence appears different from the earlier decode/crash-loop failure
      - the installed app may be landing on the blank `/_chat/` route ("No active thread") even while backend/session restore succeeded
      - current concrete UI-restore suspect is root bootstrap navigation only redirecting from `/`, not from `/_chat/`
- 2026-03-27 batch 2
  - Scope: narrow UI-restore mitigation based on latest installed-app evidence.
  - New finding:
    - [`apps/web/src/routes/__root.tsx`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/routes/__root.tsx) only auto-navigated into `payload.bootstrapThreadId` when `pathname === "/"`.
    - The empty-state screen the user reported is rendered by [`apps/web/src/routes/_chat.index.tsx`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/routes/_chat.index.tsx), i.e. the `/_chat/` route.
    - That means a successful backend/session restore can still strand the UI on "No active thread" if startup lands on `/_chat/` instead of `/`.
  - Small code change:
    - [`apps/web/src/routes/__root.tsx`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/routes/__root.tsx) now treats `/`, `/_chat`, and `/_chat/` as bootstrap-eligible paths for auto-navigation into the restored thread.
  - Why this matters:
    - It does not change persistence format.
    - It directly targets the latest observed blank-screen mechanism without touching backend state.
  - Command results:
    - `bun fmt`: passed
    - `bun lint`: passed
    - `bun typecheck`: failed with the same pre-existing errors in [`packages/shared/src/model.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.ts) and [`packages/shared/src/model.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.test.ts)
  - Installed-app outcome:
    - User reported the installed app was still broken.
    - User then cleared installed-app support/state again while keeping the app bundle.
    - After relaunch, the app worked.
    - Important clarification:
      - the deleted support folders were expected to be recreated on successful launch
      - their reappearance after recovery is normal and does not mean deletion failed
    - Updated implication:
      - clearing support/state remains a reliable recovery
      - the blank-screen failure is consistent with poisoned restore state rather than permanent bundle damage

- 2026-03-27 batch 3
  - Scope: welcome/bootstrap evidence logging.
  - New finding:
    - The renderer can only auto-enter a restored thread if `server.welcome` includes `bootstrapThreadId`.
    - Current server tests cover IDs being present for auto-bootstrap paths, but runtime logs did not yet explicitly say whether welcome omitted them.
  - Small code change:
    - [`apps/server/src/wsServer.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/wsServer.ts) now logs `server.welcome prepared` with:
      - `bootstrapSource`
      - whether bootstrap project/thread IDs were present
      - the IDs themselves when present
  - Why this matters:
    - On the next incident, we can distinguish:
      - server offered a valid bootstrap thread and the UI still stranded itself
      - server never offered bootstrap IDs at all
  - Command results:
    - `bun fmt`: passed
    - `bun lint`: passed
    - `bun typecheck`: failed with the same pre-existing errors in [`packages/shared/src/model.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.ts) and [`packages/shared/src/model.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.test.ts)
  - Installed-app outcome: pending user test after this batch.

- 2026-03-27 batch 4
  - Scope: fallback thread restore when `server.welcome` omits bootstrap ids.
  - New finding:
    - Packaged startup logs previously showed `autoBootstrapProjectFromCwd: false`.
    - In that mode, the server may legitimately send `server.welcome` without `bootstrapProjectId` / `bootstrapThreadId`.
    - Before this batch, the renderer did nothing in that case, even if the freshly synced snapshot already contained non-deleted threads.
  - Small code change:
    - [`apps/web/src/routes/__root.tsx`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/routes/__root.tsx) now falls back to the most recently updated non-deleted thread from the synced snapshot when:
      - current route is `/`, `/_chat`, or `/_chat/`
      - `server.welcome` does not provide bootstrap ids
  - Why this matters:
    - It directly targets the “backend/session exists but UI stays on No active thread” failure mode.
    - It still does not change SQLite shape, migrations, or support-folder layout.
  - Command results:
    - `bun fmt`: passed
    - `bun lint`: passed
    - `bun typecheck`: failed with the same pre-existing errors in [`packages/shared/src/model.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.ts) and [`packages/shared/src/model.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.test.ts)
  - Installed-app outcome: pending user test after this batch.

- 2026-03-27 incident A
  - Trigger:
    - The repo desktop app was launched from [`apps/desktop/scripts/start-electron.mjs`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/scripts/start-electron.mjs) using `TERO_HOME=/tmp/tero-dev-probe`.
  - Critical finding:
    - Despite the isolated env var, the launched repo app actually came up on `baseDir: /Users/raulrodrigues/.t3`.
    - The repo app therefore touched the **same** SQLite state as the installed `/Applications/T3 Code (Alpha).app`.
  - Evidence:
    - Repo-run server log showed:
      - `baseDir: '/Users/raulrodrigues/.t3'`
      - `Running all migrations...`
      - `Migrations ran successfully { migrations: [ '16_CanonicalizeModelSelections' ] }`
    - Shortly after that, the installed app failed with:
      - `Error: SQL error in ProjectionThreadRepository.getById:query`
      - underlying SQLite error: `no such column: model`
  - Schema implication:
    - Migration 16 in [`apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/persistence/Migrations/016_CanonicalizeModelSelections.ts) drops `projection_threads.model`.
    - The installed app binary still appears to query that old column in its packaged `ProjectionThreadRepository.getById`.
    - Therefore the installed app and this repo snapshot are on **incompatible DB schemas**.
  - What this proves:
    - Launching the repo app can poison the installed app **even without any broad rename pass**, simply by sharing `~/.t3`.
    - The breakage is not hypothetical and not just UI state; it is a concrete cross-version SQLite schema incompatibility.
  - Recovery:
    - Keep the installed app bundle.
    - Delete supporting state (`~/.t3`, `~/Library/Application Support/t3code`, preference plist).
    - Relaunch the installed app.
  - New top-priority mitigation:
    - Never run the repo desktop app against `~/.t3`.
    - Before any further repo desktop probing, guarantee isolated runtime state at both:
      - server base dir / SQLite path
      - Electron `userData` / Chromium profile path

- 2026-03-27 incident B
  - Trigger:
    - Controlled local repo desktop launches via [`apps/desktop/package.json`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/package.json) `start`.
  - New evidence:
    - The Electron main process now correctly identifies local-dev mode and logs `baseDir: /Users/raulrodrigues/.tero-dev`.
    - Despite that, process inspection showed the backend child still running as:
      - `.../electron/dist/Electron.app/Contents/MacOS/Electron /Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/dist/index.mjs`
    - This matches the user-visible symptom where a browser tab opens while the Electron app also runs.
  - Updated implication:
    - The remaining isolation failure is no longer the desktop main base-dir selection.
    - The remaining failure is backend child process resolution: local-dev desktop runs must not fall back to Electron's own `process.execPath`, because that spawns another Electron-hosted server process.
  - Small code change:
    - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) now resolves the backend executable differently in local-dev mode:
      - prefer explicit `TERO_DESKTOP_SERVER_EXECUTABLE`
      - otherwise try `BUN`, `npm_node_execpath`, then `which bun`, then `which node`
      - only fall back to `process.execPath` as a last resort
    - The same file now logs the exact backend executable choice for local-dev probes.
  - Why this matters:
    - It directly targets the browser-tab symptom and the risk of a second unintended Electron-hosted server process.

- 2026-03-27 batch 5
  - Scope: force backend child into desktop mode via CLI, not only env.
  - New finding:
    - After the previous local-dev executable fix, the spawned backend still logged:
      - `mode: "web"`
      - `baseDir: "/Users/raulrodrigues/.t3"`
      - `noBrowser: false`
    - That proves the backend child was not reliably honoring the intended desktop env contract.
  - Small code change:
    - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) now spawns the backend with explicit CLI args:
      - `--mode desktop`
      - `--no-browser`
      - `--port <backendPort>`
      - `--home-dir <BASE_DIR>`
      - `--auth-token <backendAuthToken>`
  - Why this matters:
    - Even if env propagation is partially broken under the local Electron/Bun launch path, these flags should still force the backend into the safe desktop state and prevent browser auto-open plus `~/.t3` reuse.
  - Probe outcome:
    - After rebuilding and relaunching, the repo desktop app logged:
      - `mode: "desktop"`
      - `baseDir: "/Users/raulrodrigues/.tero-dev"`
      - `noBrowser: true`
      - `autoBootstrapProjectFromCwd: false`
    - No separate `web`-mode `~/.t3` server appeared in the observed process tree for this run.
    - A repeat launch after clearing the installed app support folders again produced the same safe result:
      - no browser tab opened
      - backend still ran in desktop mode
      - backend still stayed on `~/.tero-dev`
  - Updated implication:
    - The local repo desktop launch path now appears isolated from the installed app's `~/.t3` state.
    - The next required probe is whether the installed `/Applications/T3 Code (Alpha).app` stays healthy after this isolated repo launch.

- 2026-03-27 batch 5
  - Scope: default local desktop isolation.
  - New finding:
    - Local repo desktop runs were still defaulting to the same identity surfaces as the installed app.
    - In particular, unpackaged local desktop runs could still fall back to the packaged defaults for:
      - base dir (`~/.tero` / legacy `~/.t3`)
      - Electron `userData` profile (`tero` / legacy `Tero (Alpha)`)
  - Small code change:
    - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) now separates packaged vs unpackaged defaults using `app.isPackaged`:
      - packaged default base dir: `~/.tero`
      - unpackaged default base dir: `~/.tero-dev`
      - packaged userData dir: `tero`
      - unpackaged userData dir: `tero-dev`
      - display name also follows packaged vs unpackaged mode
    - startup path logging now records:
      - `packaged`
      - `rendererDevServer`
      - chosen base dir / state dir / userData path
  - Why this matters:
    - It is a direct mitigation against rerunning the repo desktop app into the installed app’s live state when env overrides are absent or ineffective.
    - It narrows the next probe to one question: whether unpackaged repo runs still somehow land on `~/.t3` after this change.
  - Command results:
    - `bun fmt`: passed
    - `bun lint`: passed
    - `bun typecheck`: failed with the same pre-existing errors in [`packages/shared/src/model.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.ts) and [`packages/shared/src/model.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.test.ts)
  - Installed-app outcome: pending user validation after state reset.

- 2026-03-27 batch 6
  - Scope: unblock desktop runtime probing by removing broken workspace-package resolution from the desktop app.
  - New finding:
    - Rebuilt desktop runtime initially failed before startup with:
      - `Cannot find module '@tero/shared/Net'`
    - Root cause: this checkout does not currently have working workspace links for `@tero/shared` / `@tero/contracts` in `node_modules`, so the desktop runtime could not resolve those runtime imports.
  - Small code change:
    - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts) now imports shared runtime modules via direct repo-relative paths:
      - `../../../packages/shared/src/Net`
      - `../../../packages/shared/src/logging`
    - [`apps/desktop/src/syncShellEnvironment.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/syncShellEnvironment.ts) now imports:
      - `../../../packages/shared/src/shell`
    - Desktop bundle was rebuilt successfully after that change.
  - Why this matters:
    - It removes the immediate launch blocker so we can continue testing desktop state isolation.
    - It does not by itself address the installed-app poisoning issue; it only restores the ability to probe the repo desktop runtime.
  - Command results:
    - desktop rebuild: passed
    - `bun fmt`: passed
    - `bun lint`: passed
    - `bun typecheck`: failed with the same pre-existing errors in [`packages/shared/src/model.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.ts) and [`packages/shared/src/model.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/packages/shared/src/model.test.ts)
  - Installed-app outcome: not re-tested yet after this batch.

- 2026-03-27 batch 7
  - Scope: isolate non-desktop dev paths by default.
  - New finding:
    - Desktop local-dev probes are now isolated on `~/.tero-dev`, but the generic dev runner and direct server dev path still defaulted to the production-style home unless explicitly overridden.
    - That meant `dev`, `dev:web`, and direct `VITE_DEV_SERVER_URL` server runs were still weaker from a state-isolation perspective.
  - Small code changes:
    - [`scripts/dev-runner.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/dev-runner.ts) now defaults local dev runs to `~/.tero-dev`.
    - [`apps/server/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/main.ts) now defaults to `~/.tero-dev` whenever a dev URL is active and no explicit home-dir / `TERO_HOME` is provided.
    - Added/updated tests in:
      - [`scripts/dev-runner.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/dev-runner.test.ts)
      - [`apps/server/src/main.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/main.test.ts)
  - Why this matters:
    - It makes local repo web/dev behavior match the desktop isolation model more closely.
    - It reduces the risk that a plain dev server run can silently collide with packaged-app state.
  - Follow-up finding:
    - A direct `bun run dev:web` probe still failed before launch because [`scripts/dev-runner.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/dev-runner.ts) could not resolve the runtime import `@tero/shared/Net` in this checkout.
  - Follow-up code change:
    - [`scripts/dev-runner.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/dev-runner.ts) now imports the shared runtime net service via a direct repo-relative path: `../packages/shared/src/Net`.
  - Updated implication:
    - The next web probe should test the actual isolated dev behavior instead of failing at startup due to broken workspace-package linking.
  - Additional follow-up:
    - Node ESM resolution for the direct import also required the file extension in this script entrypoint.
    - [`scripts/dev-runner.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/dev-runner.ts) now uses `../packages/shared/src/Net.ts`.
  - Web-specific follow-up:
    - The web dev server could start, but Vite still failed dependency resolution for:
      - `@tero/contracts`
      - `@tero/shared/model`
      - `@tero/shared/schemaJson`
      - `@tero/shared/git`
    - [`apps/web/vite.config.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/vite.config.ts) now defines explicit source aliases for:
      - `@tero/contracts`
      - `@tero/shared/*`
    - This is a targeted frontend workaround for the same broken workspace runtime-linking issue tracked in [`TODO.md`](/Users/raulrodrigues/workspace/personal/t3code-ero/TODO.md).

- 2026-03-27 batch 8
  - Scope: replace runtime import hacks with an actual workspace-link fix.
  - New finding:
    - The underlying problem was not limited to one app. Root `node_modules` simply lacked the workspace package links entirely:
      - no `node_modules/@tero/contracts`
      - no `node_modules/@tero/shared`
      - no `node_modules/@tero/*` scope directory at all
  - Small code changes:
    - Added [`scripts/sync-workspace-links.mjs`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/sync-workspace-links.mjs)
      - scans monorepo workspaces
      - creates root `node_modules` symlinks for workspace packages
      - uses platform-correct symlink type (`dir` on macOS/Linux, `junction` on Windows)
    - Added root [`package.json`](/Users/raulrodrigues/workspace/personal/t3code-ero/package.json) `postinstall` hook:
      - `node scripts/sync-workspace-links.mjs`
    - Reverted temporary runtime workarounds back to package imports in:
      - [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts)
      - [`apps/desktop/src/syncShellEnvironment.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/syncShellEnvironment.ts)
      - [`scripts/dev-runner.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/scripts/dev-runner.ts)
      - [`apps/web/vite.config.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/vite.config.ts)
  - Verification so far:
    - running the sync script now creates:
      - `node_modules/@tero/contracts`
      - `node_modules/@tero/shared`
      - other workspace package links under `node_modules/@tero/*`
    - With the links present, workspace typecheck now progresses past the old `@tero/*` resolution errors and reports real app-level issues instead.
  - Follow-up type fix:
    - [`apps/web/src/routes/__root.tsx`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/web/src/routes/__root.tsx) now correctly types `flushSnapshotSync()` as returning `OrchestrationReadModel | null` because it can early-return when the effect is already disposed.
    - [`apps/server/src/main.test.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/main.test.ts) now imports `homedir` for the new `~/.tero-dev` default-path assertion.
  - Why this matters:
    - It replaces the repo-relative import and Vite alias debt with a shared runtime fix at the workspace boundary.
  - Cleanup follow-up:
    - Removed the temporary forensic logs that were added only to chase the poisoning issue:
      - local desktop startup / backend-spawn console dumps in [`apps/desktop/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/desktop/src/main.ts)
      - `server.welcome prepared` logging in [`apps/server/src/wsServer.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/wsServer.ts)
    - Kept the conflicting-env warning in [`apps/server/src/main.ts`](/Users/raulrodrigues/workspace/personal/t3code-ero/apps/server/src/main.ts) as an intentional guardrail.

## Working Hypothesis

- The repo currently looks like it was renamed inconsistently. A mixed state like this could plausibly break runtime assumptions, persisted paths, desktop bundle identity, or string-based protocol/config references.
- Some old identifiers should probably remain temporarily as compatibility fallbacks rather than being hard-removed immediately, especially persisted storage keys and environment-variable fallbacks.
- The earlier theory that the problem might have been a late validation freeze is now weaker.
- The stronger current theory is that working on this repo causes the app to write or read incompatible persisted state very early in startup, and that stale state then poisons the next launch until it is deleted.
- More concrete sub-theories:
  - the installed app and the in-repo/dev environment may still be sharing or colliding on the same logical state directories
  - a partial rename may be causing startup code to write to one path and restore from another
  - an incompatible SQLite/session/config payload may be getting restored on launch
  - a bad project/thread/session associated with this repo may be restored eagerly and wedge the app
- Based on the second recovery, the current best guess is **not** "the app bundle was damaged". The best guess is "persisted state became incompatible/corrupted, and deleting that state cleared the failure."

## Constraints

- Before considering the task complete, `bun fmt`, `bun lint`, and `bun typecheck` must pass.
- Per repo instructions, never run `bun test`; use `bun run test` if tests are needed.
- Be careful not to make changes that could interfere with the installed T3 Code app outside this repository.
- New practical safety constraint from user: avoid running this project in dev during this investigation unless absolutely necessary, because doing so may break the very Codex/T3 Code instance being used to work on the repo and terminate the session.
- Until proven otherwise, assume local dev startup is a high-risk action that can poison shared persisted state.

## Next Steps

- Treat this as a forensic/debug task first, not a broad rename pass.
- Identify exactly which persisted files/directories are read on startup and which ones could poison relaunch.
- If the app breaks again, preserve/copy the broken state before deleting it so logs and DB contents can be inspected.
- Focus especially on:
  - SQLite state under the derived `userdata` directory
  - keybindings/config files
  - provider/session restore paths
  - Electron userData/profile directories
  - any place where legacy `t3code` and new `tero` paths/keys may be mixed
- Avoid launching the app/dev stack casually while collecting evidence; prefer static inspection first.
- Only after the startup/persistence risk is understood should the rename resume.
- Update this file as findings and changes accumulate.
