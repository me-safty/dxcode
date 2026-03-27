You are working in this repo:

/Users/raulrodrigues/workspace/personal/t3code-ero

This is an active forensic/debug task around a repeatable app-breakage issue.

Critical context:

- The installed app in `/Applications/T3 Code (Alpha).app` has repeatedly broken while work was being done in this repo.
- Recovery has worked by deleting persisted local state while keeping the app bundle:
  - ~/.t3
  - ~/Library/Application Support/t3code
  - ~/Library/Preferences/com.t3tools.t3code.plist
- That strongly suggests persisted state corruption/incompatibility, not app bundle corruption.
- I will use the installed app from `/Applications` as the probe:
  - you make repo changes
  - you run the repo commands
  - I launch/test the installed app
  - if it breaks, that is evidence
- You are allowed to make code changes in the repo.
- You are expected to run the relevant commands in the repo as part of the investigation.

Primary goal:
Figure out what kinds of repo changes or runtime behavior poison the installed app, and preserve the evidence in CURRENT-TASK.md so the investigation survives future breakage.

Required workflow:

1. Inspect the relevant startup/state code paths.
2. Make careful changes that improve investigation quality, safety, logging, isolation, or path handling.
3. Run the required repo commands after meaningful code changes:
   - `bun fmt`
   - `bun lint`
   - `bun typecheck`
4. If tests are needed, never run `bun test`; use `bun run test`.
5. After each meaningful change set and command run, stop and tell me exactly what to test in the installed app.
6. Update CURRENT-TASK.md continuously with findings, theories, changes, and outcomes.

Important:

- Do not skip the command runs. We need the full real workflow because part of the point is to figure out what behavior or change sequence is triggering the installed app breakage.
- Work in very small, intentional batches. Do not accumulate a large set of changes before stopping.
- Prefer one narrowly scoped change set at a time so any installed-app breakage can be correlated to a small, useful diff.
- After each small batch, run the required commands, summarize the batch, and wait for the installed-app test result before broadening scope.
- Do not use destructive git commands.
- Do not assume the worktree is clean.
- Avoid unrelated cleanup.
- Do not do a blind broad rename pass yet. This is forensic/debug work first.

Focus files first:

- apps/desktop/src/main.ts
- apps/server/src/main.ts
- apps/server/src/config.ts
- apps/server/src/os-jank.ts
- apps/web/src/store.ts
- apps/server/src/codexAppServerManager.ts
- apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
- CURRENT-TASK.md

What I want from you:

- A concise state-path / restore-path matrix covering:
  - packaged app behavior
  - dev behavior
  - legacy t3code paths
  - new tero paths
  - env var fallbacks
  - collision risk
- A ranked list of likely “poison on startup” mechanisms, with code references.
- Code or documentation changes that help the investigation.
- Command results from:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
- Updates to CURRENT-TASK.md after each meaningful finding or change.

Testing workflow:

- After each meaningful small change set and command run, report:
  - what changed
  - why it may or may not affect the installed app
  - whether `bun fmt`, `bun lint`, and `bun typecheck` passed
  - exactly what I should test in `/Applications/T3 Code (Alpha).app`
- I will test the installed app manually.
- If it breaks, treat that exact small change set plus command run sequence as evidence.
- If it does not break, treat that as evidence too and write it down in CURRENT-TASK.md.

When the installed app breaks:

- Update CURRENT-TASK.md with:
  - the exact most recent changes
  - the exact commands that were run
  - what I observed in the installed app
  - whether the app bundle was kept
  - what local state was removed to recover
  - what this implies for the theory
- Narrow the theory based on the latest evidence.

Constraints:

- Follow AGENTS.md.
- Before considering any coding task complete, `bun fmt`, `bun lint`, and `bun typecheck` must pass.
- Never run `bun test`; use `bun run test` if tests are needed.
- Do not use destructive git commands.
- Do not assume the worktree is clean.
- Avoid unrelated cleanup.

Success means:

- CURRENT-TASK.md becomes a reliable incident log.
- We narrow which changes or command sequences correlate with app breakage.
- We identify which persisted-state or startup-restore paths are responsible.
- We get to a concrete mitigation plan before resuming the rename.
