# Upstream synchronization

DX synchronization defaults to the newest valid canonical nightly tag. It validates named remotes,
fetches only the selected tag into `refs/dx/upstream-nightlies/`, pins its commit, and creates one
temporary branch/worktree merge with `--no-commit`.

## Detect only

```bash
bun scripts/sync-upstream.ts --dry-run
```

Select an exact nightly when reproducing a prior check:

```bash
bun scripts/sync-upstream.ts --dry-run --tag v0.0.29-nightly.20260719.828
```

`upstream/main` is an advanced manual action:

```bash
bun scripts/sync-upstream.ts --dry-run --upstream-main
```

## Prepare

```bash
bun scripts/sync-upstream.ts
```

The merge target is the pinned commit, not the tag name. Clean merges remain uncommitted. Conflicts
are reported and left in the sync worktree.

## Verify and promote

```bash
vp check
vp run typecheck
```

Commit only after approval. Push the sync branch and open a PR into `dx/main`. Cleanup stays manual;
the Module never pushes, promotes, deletes worktrees, or deletes branches.
