# Effect Runtime Cutover

Status: **Completed; supersedes the staged checklist in `11-effect.md`**
Last reviewed: 2026-07-13

## Outcome

The old provider/checkpoint stack is no longer the production path. The server composes Effect services for provider sessions, orchestration, persistence, checkpointing, terminals, VCS, source control, auth, and transport.

Current anchors:

- `apps/server/src/serverRuntimeStartup.ts` and domain `runtimeLayer.ts` modules compose startup ownership.
- `apps/server/src/provider/Layers/ProviderService.ts` coordinates registered provider adapters.
- `apps/server/src/orchestration/Services` and `Layers` separate contracts from implementations.
- `apps/server/src/orchestration/Services/RuntimeReceiptBus.ts` exposes provider-neutral completion signals.
- `apps/server/src/ws.ts` maps the typed RPC group to server services.

## Replaced assumptions

- There is no legacy `ProviderManager` cutover left to schedule.
- Checkpoint correctness is expressed through reactors, persisted projections, and receipts rather than after-the-fact synchronization.
- Provider event fanout is provider-neutral and backpressure-aware.
- Codex protocol lifecycle is isolated in a dedicated package and adapter.
- New migrations must preserve upgrade history; the database is no longer assumed disposable.

## Maintenance rules

- Extend the existing layer graph instead of creating request-local runtimes.
- Keep transport payloads stable and schema-decoded at the edge.
- Make shutdown, cancellation, and worker failure testable without timing sleeps.

## Validation

Use `vp test` for affected services, `vp run test` for cross-runtime changes, then run the repository baseline.
