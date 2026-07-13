# Claude Provider Integration

Status: **Completed**
Last reviewed: 2026-07-13

## Outcome

Claude is a first-class provider behind the same provider-neutral orchestration path as Codex:

- `apps/server/src/provider/Layers/ClaudeProvider.ts` owns provider registration and configuration.
- `apps/server/src/provider/Layers/ClaudeAdapter.ts` owns SDK/session lifecycle and canonical event translation.
- `apps/server/src/textGeneration/ClaudeTextGeneration.ts` owns Claude-backed text-generation use cases.
- shared provider/model contracts and client-runtime state expose Claude without a provider-specific transport channel.
- web provider/model selection consumes provider instances and capabilities rather than hard-coded Codex UI.

## Maintenance rules

- Keep Anthropic SDK values and resume semantics inside the Claude adapter.
- Map SDK events into canonical provider runtime events before orchestration.
- Implement interrupt, stop, restart, and stale-event rejection with scoped cleanup.
- Capability-gate unsupported rewind/checkpoint behavior; do not fake parity.
- Cover SDK stream termination, partial output, permission requests, resume failure, and subscriber isolation in adapter tests.

## Validation

Run Claude adapter/provider/text-generation tests with `vp test`, then the repository baseline.
