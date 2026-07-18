# Domain language

## Desktop flavor

A desktop distribution identity. It owns app naming, operating-system identity, storage paths,
renderer protocol, artifacts, icons, and update policy. It does not own product features.

## DX integration branch

The long-lived branch combining upstream T3 Code with DX-owned modules. Upstream `main` remains an
unmodified comparison point.

## Upstream sync

A temporary-worktree workflow that merges new upstream history into the DX integration branch,
repairs conflicts, and verifies behavior before promotion.
