# Upstream synchronization

Use a temporary branch and worktree for every upstream merge. The workflow never promotes changes into
`dx/main`, pushes, or deletes worktrees.

## Detect only

```bash
bun scripts/sync-upstream.ts --dry-run
```

Defaults:

- source: current repository
- base: `dx/main`
- upstream: `upstream/main`
- branch: `sync/upstream-YYYY-MM-DD`
- worktree: sibling `t3code-upstream-sync-YYYY-MM-DD`

## Create integration worktree

```bash
bun scripts/sync-upstream.ts \
  --branch sync/upstream-2026-07-18 \
  --worktree ../t3code-upstream-sync-2026-07-18
```

The script fetches `upstream`, lists commits in `dx/main..upstream/main`, creates the sync branch from
`dx/main`, adds the worktree, and merges `upstream/main` there. Existing branches and paths are rejected.

Use `--no-fetch` only after fetching separately. Override refs with `--base-ref`, `--upstream-ref`, or
`--upstream-remote`.

## Conflict handling

On conflict, the script reports unresolved paths and exits `2`. Resolve only inside the reported
worktree:

```bash
cd ../t3code-upstream-sync-2026-07-18
git status
# resolve files
git add <resolved-files>
git commit
vp check
vp run typecheck
```

Review functional changes and add targeted tests for affected modules. A textually clean merge is not
proof of semantic compatibility.

## Manual promotion

After review and checks, merge the sync branch into `dx/main` using the team's normal review process.
The script intentionally has no promotion or push command.

Cleanup is also manual after promotion:

```bash
git worktree remove ../t3code-upstream-sync-2026-07-18
git branch -d sync/upstream-2026-07-18
```
