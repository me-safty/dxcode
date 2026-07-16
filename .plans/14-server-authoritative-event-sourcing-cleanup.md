# Server-Authoritative Orchestration Architecture

Status: **Completed**
Last reviewed: 2026-07-13

## Outcome

T3 Code now separates transport, orchestration, provider runtime, persistence, and side-effecting reactors:

```text
client-runtime atoms
        |
        v
typed RPC / HTTP boundaries
        |
        v
OrchestrationEngine -> event store -> projection pipeline -> snapshots/events
        |
        +-> ProviderCommandReactor -> ProviderService -> provider adapter
        |
        +-> CheckpointReactor -> checkpoint store/diff query
        |
        +-> RuntimeReceiptBus -> deterministic completion signals
```

Current anchors are `apps/server/src/orchestration`, `apps/server/src/persistence`, `apps/server/src/provider`, `apps/server/src/checkpointing`, and `packages/contracts/src/orchestration.ts`.

## Invariants

- The server is authoritative for durable project and thread state.
- Commands are schema-decoded, validated, idempotent where required, and converted to persisted domain events.
- Projections are derived from persisted facts and expose sequence-aware snapshots.
- Provider-native events are normalized before they enter orchestration.
- Reactors own side effects; the pure decider/projector path remains deterministic.
- Runtime receipts mark async milestones and replace state polling.
- Transport code routes requests and streams results but does not implement domain policy.

## Remaining work policy

This plan is closed. New orchestration work must be scoped as a separate active plan, preserve additive migrations, and include command, projector, reactor, and recovery tests appropriate to the change.

## Validation

Use `vp run test` for orchestration contract or persistence changes, then run the repository baseline.
