# Orchestration Persistence Cutover

Status: **Historical and completed**
Last reviewed: 2026-07-13

## Context

This plan drove the early hard cutover to a server-authoritative event store, command receipts, projections, checkpoint diff blobs, and provider session runtime persistence. The referenced `SPEC.md` no longer exists, and the database can no longer be treated as disposable.

## Current source of truth

- contracts: `packages/contracts/src/orchestration.ts`
- migrations: `apps/server/src/persistence/Migrations.ts` and `Migrations/`
- repositories/layers: `apps/server/src/persistence/Services`, `Layers`, and `ProviderSessionRuntime.ts`
- event decisions and projection logic: `apps/server/src/orchestration/decider.ts` and `projector.ts`
- snapshot/query services: `apps/server/src/orchestration/Services` and `Layers`
- checkpoint storage/diffs: `apps/server/src/checkpointing`

## Current migration policy

- Migrations are additive, ordered upgrade history; do not rewrite or delete migrations already shipped.
- Schema changes must update codecs, repositories, projections, and tests in the same change.
- Event envelopes and projection sequence semantics remain explicit and typed.
- Command idempotency, snapshot fences, replay, and restart recovery require regression coverage.
- Destructive compatibility breaks require an explicit migration/rollout plan, not the old hard-cutover assumption.

## Validation

Run persistence, migration, projector, snapshot, checkpoint, and restart tests with `vp run test`, then run the repository baseline.
