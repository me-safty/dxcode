# Provider and Orchestration Integration Coverage

Status: **Completed as a harness strategy; ongoing as a coverage standard**
Last reviewed: 2026-07-13

## Current test boundaries

- Adapter contract and lifecycle behavior is covered beside each adapter in `apps/server/src/provider/Layers`.
- `ProviderService.test.ts`, registry tests, session-directory tests, and reaper tests cover provider-neutral routing and cleanup.
- `apps/server/src/orchestration/Layers/*.test.ts` covers provider command reaction, runtime ingestion, checkpoints, projections, deletion, and completion receipts.
- `apps/server/integration` owns broader runtime scenarios.
- VCS/checkpoint tests use real temporary Git repositories where filesystem semantics matter.

## Harness rules

- Fake only the provider-native edge for generic provider/orchestration tests.
- Use canonical `ProviderRuntimeEvent` fixtures outside provider-specific adapter tests.
- Exercise real SQLite repositories, projections, and Git checkpoint storage when those are the behavior under test.
- Synchronize with readiness barriers and `RuntimeReceiptBus`, not polling or sleeps.
- Cover normal turns, no-op filesystem turns, interrupts, restart/resume, duplicate events, adapter failure, checkpoint failure, and subscriber failure isolation.

## Thin transport coverage

Keep WebSocket/RPC integration assertions focused on schema decoding, authorization, routing, ordered delivery, reconnect/replay, and error mapping. Domain semantics belong in service tests rather than being duplicated through the transport.

## Validation

Run focused integration files with `vp test`. Use `vp run test` after shared provider-event or orchestration-contract changes, then run the repository baseline.
