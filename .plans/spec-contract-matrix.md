# Orchestration Persistence Contract Map

Status: **Historical matrix; requirements implemented and evolved**
Last reviewed: 2026-07-13

The original W1-W4, E1-E4, P1-P11, and R1-R7 checklist compared an early implementation with a now-removed `SPEC.md`. Keeping its old `to-replace` labels made completed production paths look unfinished.

## Current contract map

| Concern | Current source of truth |
| --- | --- |
| Domain commands, events, snapshots, identities | `packages/contracts/src/orchestration.ts` |
| Append-only event envelope and replay | `apps/server/src/persistence/Services/OrchestrationEventStore.ts` and matching `Layers` implementation |
| Command idempotency/receipts | `apps/server/src/persistence/Services/OrchestrationCommandReceipts.ts` |
| Provider session restart state | `apps/server/src/persistence/ProviderSessionRuntime.ts` |
| Project/thread/message/activity/session/turn/checkpoint projections | `apps/server/src/persistence/Services/Projection*.ts` |
| Transactional projection updates and sequence tracking | `apps/server/src/orchestration/Services/ProjectionPipeline.ts` |
| Snapshot reads and sequence fence | `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` |
| Checkpoint refs and diff blobs | `apps/server/src/checkpointing` plus persistence migrations/repositories |
| Physical SQLite schema and upgrade order | `apps/server/src/persistence/Migrations.ts` and `Migrations/` |

## Invariants retained from the matrix

- Event IDs are unique and event order is globally monotonic.
- Stream versions and command receipts make retries/idempotency explicit.
- JSON payloads are decoded through Effect Schema at repository/transport boundaries.
- Projection writes and their sequence watermark are committed consistently.
- Snapshots expose a sequence fence so incremental replay cannot introduce a gap.
- Provider restart state and checkpoint diffs survive process restart.

## Change checklist

For a persistence contract change, update the schema contract, append a migration, update the repository and projector/query paths, add upgrade and malformed-row tests, and verify restart/replay behavior. The old row IDs are retired; new requirements belong in a new active plan tied to current code.

## Validation

Use `vp run test` for persistence contract changes, then run the repository baseline.
