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

## Nightly target

The newest valid canonical T3 nightly tag and its immutable commit. Detection groups intervening
nightlies and prepares only this target.

## Upstream sync session

A persisted, pinned nightly target plus its temporary branch, worktree, comparison, conflicts, and
guided review thread. A newer target never retargets an active session.

## Upstream notification cursor

Persistent dismissal, pause, policy, and active-session identity. Integration remains derived from
Git ancestry, never from a stored last-synced commit.
