# AGENTS.md

## Legacy Convex Orchestrator

`apps/orchestrator` is legacy code from the retired Convex-backed intake path.
Do not treat Convex as the live orchestrator and do not deploy this package for
the current external-intake flow unless the user explicitly asks to inspect or
migrate historical Convex code.

The active implementation is in `apps/server/src/externalIntake` and uses the
server SQLite database. Current docs live in `docs/orchestrator.md`.
