# Fork-local notes (justingray0/t3code)

Operational notes specific to this fork. Not tracked upstream, so it never
conflicts when syncing `upstream/main`. Auto-loaded by Claude Code alongside
`CLAUDE.md` — keep it to fork-specific gotchas, not general project docs.

## Syncing upstream can break `t3code-rebuild` (frozen lockfile)

This fork customizes `patches/effect@4.0.0-beta.78.patch` (commit `9182e1470`,
the WebSocket ping/pong cadence fix that reduces flapping). `pnpm-lock.yaml`
records that patch's content hash under `patchedDependencies`.

When merging `upstream/main`, `pnpm-lock.yaml` conflicts. Resolving it by taking
upstream's copy wholesale (`git checkout --theirs pnpm-lock.yaml`) records
*upstream's* effect patch hash, which no longer matches our on-disk patch. The
mini's `t3code-rebuild` then fails at `pnpm install --frozen-lockfile` with:

```
ERR_PNPM_LOCKFILE_CONFIG_MISMATCH ... "patchedDependencies" ... doesn't match the value found in the lockfile
```

The rebuild command is **not** the bug — `--frozen-lockfile` is correctly
catching the drift. Do **not** "fix" it by switching to `--no-frozen-lockfile`;
that hides real drift and lets the deploy regenerate the lockfile.

**Fix:** regenerate the lockfile so the effect patch hash matches our patch:

```
pnpm install --lockfile-only --no-frozen-lockfile
git commit --no-verify pnpm-lock.yaml   # vp pre-commit hook errors on a lockfile-only change (no lint targets)
```

The diff is hash-only: the `effect` `patch_hash` plus the two peer digests that
close over it (`alchemy`, `@distilled.cloud/cloudflare-vite-plugin`). No
dependency or version changes. It's deterministic (pnpm 10.24.0), so the mini
regenerates identical hashes. First hit 2026-07-03 after an upstream sync;
fixed in PR #14.
