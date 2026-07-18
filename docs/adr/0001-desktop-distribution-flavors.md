# ADR-0001: Isolate desktop distributions with flavors

## Status

Accepted

## Context

T3 Code production, live development, and packaged DX builds must run concurrently without sharing
operating-system identity, settings, credentials, backend state, protocols, or update behavior. DX
also needs to absorb future upstream history with small conflicts.

## Decision

- Keep production defaults unchanged.
- Resolve distribution behavior through one desktop-flavor module.
- Give production, development, and DX unique identities and storage paths.
- Disable upstream updates in development and DX.
- Keep product features in domain-specific modules; flavors only select distribution behavior.
- Keep `main` aligned with upstream and integrate owned work through `dx/main`.
- Perform upstream synchronization in temporary worktrees and promote only after verification.

## Consequences

Packaging and desktop runtime share one small interface. Upstream-facing edits stay limited to seams
that resolve flavor behavior. DX feature implementation remains independent from branding and can be
reviewed, tested, or removed without changing distribution identity.
