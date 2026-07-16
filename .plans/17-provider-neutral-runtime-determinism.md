# Provider-Neutral Runtime Determinism

Status: **Completed and expanded beyond the original scope**
Last reviewed: 2026-07-13

## Outcome

The runtime no longer assumes a single Codex provider. Registered server adapters now include Codex, Claude, Cursor, Grok, and OpenCode. Provider-neutral contracts, orchestration commands/events, ordered RPC streams, scoped workers, and completion receipts isolate provider-native behavior.

Current anchors:

- `packages/contracts/src/provider.ts` and `providerRuntime.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- adapter/registry/session layers in `apps/server/src/provider/Layers`
- `apps/server/src/orchestration/Services/RuntimeReceiptBus.ts`
- `packages/client-runtime/src/rpc` and `packages/client-runtime/src/state`

## Guardrails

- Provider-native payloads, ordering quirks, cursors, and subprocess behavior stay inside adapters.
- Generic orchestration tests use canonical provider runtime events.
- Capabilities and provider-instance metadata express differences; shared code must not grow provider-name conditionals.
- Readiness and quiescence are server-owned concepts, never inferred from one provider's event sequence.
- Queued work exposes deterministic drain/completion signals and survives individual item failure.
- Reconnect behavior must rebuild semantic state from snapshots plus ordered incremental events.

## Validation

Run adapter-specific tests for native changes and `vp run test` for shared provider contracts or orchestration changes, then run the repository baseline.
