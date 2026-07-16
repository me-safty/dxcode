# Event and Client-State Regression Coverage

Status: **Completed as a foundation; ongoing as a testing rule**
Last reviewed: 2026-07-13

## Current state

The old renderer reducer is no longer the event boundary. Coverage is distributed with ownership:

- `apps/server/src/orchestration` tests command invariants, deciders, projectors, reactors, projections, and receipts.
- `packages/client-runtime/src/state` tests cross-web/mobile snapshots, reducers, atoms, and command scheduling.
- `apps/web/src/orchestrationRecovery.test.ts` and component logic tests cover reconnect and presentation behavior.
- Provider adapters test provider-native to canonical runtime event mapping.

## Required scenarios for new event work

- duplicate, delayed, and out-of-order delivery
- reconnect snapshot plus incremental replay
- partial stream and interruption
- worker failure without permanent ingestion shutdown
- session restart and stale runtime events
- checkpoint/diff completion before user-visible quiescence
- isolation between environments and threads

Use canonical provider-neutral fixtures outside adapter tests. Prefer runtime receipts and semantic state assertions over polling and sleeps.

## Validation

Run focused tests with `vp test`, use `vp run test` when a cross-package event contract changes, then run the repository baseline.
