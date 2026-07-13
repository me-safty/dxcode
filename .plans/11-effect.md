# Effect Service Migration

Status: **Completed; retained as migration history**
Last reviewed: 2026-07-13

## Original intent

Introduce typed Effect services and errors for providers, Codex, checkpointing, persistence, and server composition, then remove the legacy class-based runtime.

## Current state

The production server is Effect-native:

- service contracts and live layers are separated across `apps/server/src/**/Services` and `**/Layers`
- provider implementations are registered adapters behind `ProviderService`
- checkpoint capture/diff/revert is owned by `apps/server/src/checkpointing` and orchestration reactors
- persistence uses Effect SQL/SQLite services and additive migrations
- protocol clients live in dedicated packages such as `packages/effect-codex-app-server` and `packages/effect-acp`
- startup composes a scoped runtime graph rather than constructing legacy managers in request handlers

## Current design rules

- Use `Schema.TaggedErrorClass` and retain defect causes at external boundaries.
- Acquire subprocesses, streams, workers, and subscriptions in scopes.
- Put interfaces in `Services`, implementations in `Layers`, and composition in explicit runtime-layer modules.
- Avoid adapter layers that merely wrap promises without adding a real boundary.
- Read `.repos/effect-smol/LLMS.md` and inspect vendored Effect examples before new Effect code.

## Validation

Run affected layer tests with `vp test`, then the repository baseline.
