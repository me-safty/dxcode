# Kiro Provider + Appearance Diff Review

Date: 2026-05-20
Scope: Full local diff against `main`, including Kiro ACP steering/stop behavior, appearance settings, chat typography, and desktop artifact tweaks.
Skills: `diff-review`, `architecture-standards`

## Result

No open blocking findings remain.

## Findings Resolved

- F-001: Active ACP prompt registration happened after `turn.started`, leaving a short window where a Kiro follow-up could be routed as a second `session/prompt` instead of `_message/send`.
  - Fixed by validating prompt content first, then registering `ctx.activePrompt`, `ctx.activeTurnId`, and session state before emitting `turn.started`.

- F-002: Kiro active-prompt follow-ups are intentionally attached to the existing turn, so the UI local-dispatch guard did not clear when the server acknowledged a follow-up on the same running turn.
  - Fixed by treating an updated running session on the same active turn as acknowledgement for active-turn steering.

- F-003: The mobile collapsed composer send button lost the environment-unavailable disable guard while enabling running follow-ups.
  - Fixed by restoring `environmentUnavailable !== null` to the collapsed send-button disabled state.

- F-004: ACP interrupt completion was locally raced against `session/prompt`, so an interrupted turn could be marked cancelled before the provider acknowledged prompt termination.
  - Fixed by keeping `ctx.activePrompt` registered until `session/prompt` itself returns after `session/cancel`, with a controlled-runtime regression test that holds the provider prompt open after cancel.

- F-005: ACP interrupt skipped `session/cancel` when no local active prompt was registered, leaving resumed/desynced remote prompts unstoppable.
  - Fixed by always forwarding `session/cancel` on interrupt after settling local pending requests, with a controlled-runtime regression test for the no-local-active-prompt path.

## External Finding Triage

| Source          | Finding                                                                    | Current status | Bug class                   | Missed invariant/variant                                                                 | Action |
| --------------- | -------------------------------------------------------------------------- | -------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| Codex PR review | Interrupted ACP turns completed locally before provider prompt termination | fixed          | Lifecycle / async ownership | ACP owns prompt completion; cancel request must not synthesize `session/prompt` response | F-004  |
| Codex PR review | Interrupt skipped remote cancel when `activePrompt` was missing locally    | fixed          | Lifecycle / reconnect state | Remote provider work may outlive local prompt bookkeeping after reconnect/resume         | F-005  |

Sibling sweep: `ctx.activePrompt` is owned only by `StandardAcpAdapter`; `rg` found no remaining local `Deferred` race or `ctx.activePrompt.cancel` completion path, and interrupt now forwards `session/cancel` regardless of local active-prompt bookkeeping.

## Architecture Notes

- Kiro-specific behavior remains isolated in `apps/server/src/provider/Layers/KiroAdapter.ts`.
- The shared ACP layer only knows about an optional provider-supplied active-prompt hook and a provider-supplied method name.
- ACP prompt lifecycle ownership stays in `apps/server/src/provider/acp/StandardAcpAdapter.ts`; provider adapters can request cancel, but they do not synthesize prompt completion.
- Provider settings continue to use the existing schema annotation and instance-registry architecture rather than adding page-local provider form logic.
- Appearance settings are client settings in `packages/contracts`; runtime application stays in the web app bootstrap and CSS variables.

## Validation

- `bun fmt`
- `bun lint` (passes with 9 existing warnings)
- `bun run typecheck`
- `bun run test src/provider/acp/StandardAcpAdapter.test.ts`
- `bun run test src/provider/acp/AcpAdapterSupport.test.ts`
- `bun run test src/provider/acp/KiroAcpSupport.test.ts src/provider/Layers/KiroProvider.test.ts src/provider/Drivers/KiroHome.test.ts src/provider/Layers/ProviderInstanceRegistryLive.test.ts`
- `bun run test src/components/ChatView.logic.test.ts`
- `bun run test -- --configLoader runner src/settings.test.ts`
- `bun run test -- --configLoader runner src/settings/DesktopClientSettings.test.ts`
- `git diff --check`

Browser smoke was attempted, but the browser automation tool was not available in this session and sandboxed `curl` could not connect to localhost despite both local ports being open.
