# Postmortem

## Summary

This investigation started as a user-facing app-breakage incident and turned into a forensic/debug task across the installed `T3 Code (Alpha)` app and the local `t3code-ero` repo.

At the start, the visible symptom was that the installed app in `/Applications/T3 Code (Alpha).app` repeatedly became unusable. Recovery worked by deleting local support/state while keeping the app bundle:

- `~/.t3`
- `~/Library/Application Support/t3code`
- `~/Library/Preferences/com.t3tools.t3code.plist`

That was the first major signal that the problem was persisted-state corruption or incompatibility, not damage to the installed app bundle itself.

The investigation then proved a stronger version of that theory:

- launching the repo desktop app could mutate the same persisted database used by the installed app
- the repo snapshot and the installed app were not schema-compatible
- once the repo app touched the installed app's state, the installed app could break immediately on next launch

The rest of the work focused on:

1. proving the exact poisoning mechanism
2. isolating repo runtime state from installed-app state
3. cleaning up the local dev/runtime path so the fix was not just a pile of one-off hacks

## User Impact

Observed user-facing failures included:

- installed app landing on a broken or blank screen
- add-project flow appearing to freeze or silently fail
- file picker closing without the selected project being added
- later clicks on `Add project` doing nothing
- SQL-related failures in the installed app
- backend decode/migration failures from persisted state
- repo dev launches opening unwanted browser tabs
- repo desktop and repo web/dev behavior colliding with installed-app data

## What Happened

### Phase 1: Initial app cleanup was incomplete

The first cleanup removed:

- `/Applications/T3 Code (Alpha).app`
- `~/Library/Application Support/t3code`
- `~/Library/Preferences/com.t3tools.t3code.plist`

That turned out not to be enough, because the critical state also lived under:

- `~/.t3`

Once `~/.t3` was removed, the installed app recovered more reliably.

### Phase 2: The first clear persisted-state failures appeared

Two important failure signatures showed up:

1. Orchestration decode failure from persisted event state

The packaged app logs showed:

- `Decode error in OrchestrationEventStore.readFromSequence:rowToEvent: Missing key at ["payload"]["defaultModel"]`

That established that persisted local data could be unreadable under the current app version.

2. SQLite schema mismatch in `projection_threads`

Later, the installed app failed with:

- `ProjectionThreadRepository.getById:query`
- underlying SQLite error: `no such column: model`

This was the decisive clue that the installed app was hitting a schema shape it no longer expected.

### Phase 3: The repo app was proven to poison the installed app

The most important forensic finding of the whole investigation was this:

- a repo-launched desktop app touched `~/.t3`
- it ran migration `16_CanonicalizeModelSelections`
- that migration removed `projection_threads.model`
- the installed app binary still queried `projection_threads.model`
- the installed app then broke immediately with `no such column: model`

This proved:

- the installed app and repo snapshot were using the same persisted DB
- they were schema-incompatible
- repo runtime work alone could poison the installed app without any large rename pass

This turned the investigation from vague “something is broken” debugging into a concrete cross-version state-isolation problem.

### Phase 4: The repo desktop launch path was not actually isolated

The desktop side had several issues layered on top of each other:

1. The repo desktop app could come up on the installed app's state root instead of a dev-only root.
2. The backend child process could be started in the wrong way.
3. That wrong backend path could behave like a web/server run and open browser tabs.
4. Old Bun resolution made the launcher pick the wrong Bun binary.

Examples of what we observed during that stage:

- repo desktop launch logging `baseDir: /Users/raulrodrigues/.t3`
- unexpected browser tabs opening while trying to launch the repo desktop app
- Electron being used to run the backend entrypoint
- an older Homebrew Bun install being picked up instead of the user's real `~/.bun/bin/bun`

### Phase 5: Desktop isolation was enforced

To stop further poisoning while the investigation continued, the repo desktop runtime was hardened:

- local/unpackaged desktop runs default to `~/.tero-dev`
- local desktop runs use a separate Electron `userData` surface
- backend spawn is forced into explicit desktop mode via CLI flags
- backend spawn is forced to a dedicated home-dir instead of inheriting ambiguous defaults
- backend spawn disables browser-open behavior explicitly

This was intentionally defensive. It was more forceful than the ideal final architecture, but it stopped the repo app from mutating the installed app's `~/.t3` state.

Once that was in place, the repo desktop app finally launched in a stable, isolated way:

- mode: `desktop`
- base dir: `~/.tero-dev`
- `noBrowser: true`

### Phase 6: Web/dev isolation was tightened too

After desktop was contained, attention shifted to the web/dev path.

The root problem there was:

- local repo web/dev defaulted to non-dev state unless explicitly overridden

That was changed so local dev also defaults to:

- `~/.tero-dev`

This brought desktop and web/dev into the same isolation model.

### Phase 7: A second hidden problem surfaced: workspace package resolution was broken

While isolating the runtime, another independent issue became clear:

- runtime workspace imports like `@tero/shared/*` and `@tero/contracts` were not resolving correctly in this checkout

This affected:

- desktop runtime
- `scripts/dev-runner.ts`
- Vite/web runtime
- typechecking in some packages

Initial short-term workarounds used:

- repo-relative imports in desktop runtime and dev-runner
- Vite aliases in `apps/web/vite.config.ts`

Those were necessary to keep the investigation moving, but they were not the right final fix.

### Phase 8: The runtime hack debt was replaced with a workspace-link fix

The underlying issue turned out to be that the root workspace package links were simply missing from `node_modules`.

There was no functioning:

- `node_modules/@tero/contracts`
- `node_modules/@tero/shared`
- or even `node_modules/@tero/*` scope directory

That explained why so many runtime entrypoints were failing.

The final fix for that was:

- add `scripts/sync-workspace-links.mjs`
- wire it into root `package.json` `postinstall`
- recreate proper root `node_modules/@tero/*` symlinks for workspace packages

After that:

- normal package imports worked again
- repo-relative runtime import hacks were removed
- temporary Vite aliases were removed
- the cleanup could be completed on top of a proper shared fix instead of app-specific workarounds

## Root Causes

### Primary root cause

The installed app and the local repo runtime were sharing persisted state that was not schema-compatible.

Most importantly:

- the installed app used `~/.t3`
- repo runtime could also end up using `~/.t3`
- both sides expected different DB/event shapes

### Secondary root cause

The desktop launch/runtime contract was too implicit and too easy to drift into the wrong mode.

Examples:

- desktop backend could behave like a generic web server
- browser-open behavior could happen unexpectedly
- base-dir selection depended on fragile runtime assumptions

### Tertiary root cause

Workspace package linking in the checkout was broken, which caused local runtime entrypoints to fail to resolve internal packages.

That issue did not directly cause the installed-app poisoning, but it made the investigation and the local dev story much more fragile.

## Evidence Collected

Key evidence gathered during the investigation included:

- deleting support/state restored the installed app while keeping the bundle
- logs showing decode failure on persisted orchestration state
- logs showing SQL error `no such column: model`
- proof that repo desktop launch had touched `~/.t3`
- proof that repo desktop launch had run migration `16_CanonicalizeModelSelections`
- proof that local repo desktop later ran safely on `~/.tero-dev`
- proof that local repo web/dev later ran safely on `~/.tero-dev`
- proof that browser auto-open disappeared once the backend path was corrected
- proof that `node_modules/@tero/*` links were missing and then restored

## What Was Changed

### Isolation and runtime safety

- local desktop runs now isolate to `~/.tero-dev`
- local web/dev runs now isolate to `~/.tero-dev`
- local desktop backend launch explicitly forces:
  - `--mode desktop`
  - `--no-browser`
  - `--home-dir <BASE_DIR>`
  - `--auth-token <token>`
- desktop runtime now uses the correct Bun binary from `~/.bun/bin/bun`

### Startup / restore handling

- web startup restore flow was improved so the UI is less likely to strand on `No active thread`

### Workspace runtime fix

- added `scripts/sync-workspace-links.mjs`
- added root `postinstall` hook to sync workspace package links
- restored normal package imports in:
  - desktop runtime
  - desktop shell env helper
  - dev-runner
  - web/Vite path

### Investigation artifacts

- `CURRENT-TASK.md` was maintained as the running incident log
- `TODO.md` was added to track the broader workspace-link follow-up
- temporary forensic logging was added when needed and removed once the system stabilized

## Recovery Procedure That Worked

When the installed app was poisoned, the reliable recovery was:

1. keep `/Applications/T3 Code (Alpha).app`
2. delete:
   - `~/.t3`
   - `~/Library/Application Support/t3code`
   - `~/Library/Preferences/com.t3tools.t3code.plist`
3. relaunch the installed app

This consistently restored the installed app without needing to replace the bundle itself.

## What Was Misleading During The Investigation

Several early signals were real but incomplete:

- reinstalling the app bundle sometimes seemed to help, but the real issue was persisted local state
- the add-project bug looked like a pure file-picker failure, but at least part of it was a stalled or poisoned downstream flow
- browser tabs opening during repo runs looked like “maybe this is expected web dev behavior,” but for this repo it was actually evidence that the wrong runtime path was being used
- some failures looked like product bugs when they were actually the result of cross-version state collision

## Final State

At the end of the cleanup:

- repo desktop app runs in isolated desktop mode on `~/.tero-dev`
- repo web/dev runs on `~/.tero-dev`
- the unwanted browser-open path is no longer part of the validated repo dev flow
- workspace package links under `node_modules/@tero/*` exist again
- temporary runtime import hacks were removed
- temporary Vite alias hacks were removed
- `bun fmt` passes
- `bun lint` passes
- `bun typecheck` passes

## Lessons

1. State isolation between installed apps and local repo/dev runs must be explicit, not inferred.
2. Cross-version SQLite/event-schema compatibility is a hard boundary. If two runtimes can point at the same DB, that boundary must be enforced.
3. Temporary forensic hardening is acceptable during containment, but it should be cleaned up after the root cause is understood.
4. Broken workspace linking creates wide, misleading failure surfaces. Fixing it centrally is much better than app-by-app import hacks.
5. When repeated recovery is “delete local state, keep the app bundle,” treat persisted-state poisoning as the default theory until disproven.

## Follow-up

Remaining follow-up is mostly structural, not incident-response:

- keep `CURRENT-TASK.md` as the detailed incident log for this task history
- keep `TODO.md` for broader workspace/runtime cleanup tracking
- if desired later, simplify the desktop launch path further now that the isolation and workspace-link layers are stable
