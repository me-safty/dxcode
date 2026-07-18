# ADR-0002: Synchronize DX from pinned nightly targets

## Status

Accepted

## Context

Merging every canonical commit creates noisy, irreproducible DX integration work. Dismissal must
survive restart without hiding later upstream work. Git tags may be annotated, local tags may
collide, and remote tags can move.

## Decision

- Default to strict numeric `v*-nightly.YYYYMMDD.BUILD` tags.
- Detect with `git ls-remote --refs --tags` and fetch only exact tags into `refs/dx/`.
- Pin every session to a dereferenced commit and recheck the remote tag object before preparation.
- Derive integration from `git merge-base --is-ancestor` on every check.
- Collapse intervening linear nightlies into the newest target and create one deferred merge.
- Persist dismissal separately from synchronization state.
- Never commit, push, promote, remove a worktree, or retarget an active session automatically.

## Consequences

The Upstream Integration Module owns synchronization safety and persistence behind one Interface.
Git, CLI, in-app, and optional release metadata remain Adapters at internal Seams. Users review a
pinned, uncommitted merge in a dedicated worktree before a PR into `dx/main`.
