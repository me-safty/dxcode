# ADR-0003: Publish and install DX updates through explicit phases

## Status

Accepted

## Context

DX Code must reconcile remote `dx/main` changes and pinned T3 nightlies, then build and optionally
install the exact verified result. ADR-0002 forbids automatic commit, push, promotion, and worktree
deletion. Packaging also needs auditable source identity independent of SemVer.

## Decision

- Keep detection read-only and fetch remote branches only into `refs/dx/`.
- Put reconciliation, publication, build, and recovery behind the deep DX Local Update Module.
- Persist the exact planned commits and every irreversible phase.
- Require separate approval for publication and installation.
- Permit commit, push, fast-forward, and install only inside their approved phase.
- Never force-push, silently retarget, delete sync worktrees, or build a dirty DX tree.
- Embed the exact clean `dx/main` commit in the DX application and artifact manifest.
- Replace the currently running DX application path and keep the latest rollback backup.
- Allow unsigned local DX artifacts only after explicit warning; reject production T3 artifacts.

## Consequences

ADR-0002 remains the default safety rule for upstream review. This ADR adds narrowly authorized
Adapters after verification. Callers get one small Interface while Git, packaging, installation, and
recovery retain Locality inside the Module.
