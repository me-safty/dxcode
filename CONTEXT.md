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

A persisted, pinned nightly target plus its commit counts, temporary branch, worktree, comparison,
conflicts, and guided review thread. A newer target never retargets an active session.

## DX local update

An explicitly approved workflow that reconciles `origin/dx/main` and a pinned upstream sync, verifies
the exact result, publishes one integration commit, builds a provenance-bound DX artifact, and
optionally replaces the running DX application with rollback protection.

## DX build provenance

The immutable `dx/main` source commit, build time, clean-tree assertion, flavor, bundle identity, and
artifact digest embedded into a DX package and its machine-readable manifest.

## DX update session

A persisted phase record for remote reconciliation, upstream review, publication, build, validation,
installation, health confirmation, and recovery. It never authorizes the next irreversible phase.

## Upstream notification cursor

Persistent dismissal, pause, policy, and active-session identity. Integration remains derived from
Git ancestry, never from a stored last-synced commit.
