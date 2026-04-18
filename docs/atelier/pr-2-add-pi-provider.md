# PR 2: Add pi as a First-Class Backend

This document expands the `PR 2` milestone in `docs/atelier/implementation-plan.md`.

## Goal

Add `pi` to the existing provider architecture as a first-class backend without introducing a parallel abstraction.

By the end of this PR:

- `pi` is a valid `ProviderKind`
- server provider snapshots include `pi`
- the server can start and manage a `pi`-backed session through the existing provider adapter contract
- canonical runtime events continue to flow through the current `ProviderService` pipeline

## Why This PR Exists

`PR 1` established the fork baseline. `PR 2` is the first product-specific backend change for Atelier.

The current codebase already has the right separation:

- provider discovery/auth/model snapshots live behind `ServerProviderShape`
- runtime session behavior lives behind `ProviderAdapterShape`
- provider routing is centralized in `ProviderRegistry` and `ProviderAdapterRegistry`

The right move is to extend those contracts for `pi`, not build an Atelier-only agent abstraction on top.

## Scope

In scope:

- extend shared contracts to recognize `pi`
- expose `pi` in provider defaults and display-name metadata
- implement a `PiProvider` snapshot layer
- implement a `PiAdapter` runtime layer
- register `pi` in the server provider registries
- add focused tests for contract, snapshot, and adapter behavior

Out of scope:

- Atelier UI reframing work
- setup wizard UX
- hiding Cursor/OpenCode surfaces
- artifact preview work
- renaming `thread` to `task` in persisted backend models

## Implementation Shape

### 1. Extend shared contracts

Primary files:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/model.ts`
- `packages/contracts/src/server.ts`

Work:

- add `pi` to `ProviderKind`
- add `PiModelOptions` only if `pi` exposes provider-specific model controls that need to round-trip through contracts
- add default model entries to:
  - `DEFAULT_MODEL_BY_PROVIDER`
  - `DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER` if applicable
  - `MODEL_SLUG_ALIASES_BY_PROVIDER` if alias normalization is needed
  - `PROVIDER_DISPLAY_NAMES`
- ensure `ModelSelection` includes a `pi` branch if model selection needs provider-specific options

Notes:

- Keep contracts schema-first.
- Do not add runtime helper logic to `packages/contracts`.

### 2. Add provider snapshot support

Primary files:

- `apps/server/src/provider/Services/PiProvider.ts`
- `apps/server/src/provider/Layers/PiProvider.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/providerSnapshot.ts`

Work:

- implement `PiProvider` as a `ServerProviderShape`
- detect whether the `pi` runtime/CLI is installed
- detect authentication state
- surface version information
- surface model availability and reasonable defaults
- return a stable `ServerProvider` snapshot with:
  - `provider: "pi"`
  - `installed`
  - `version`
  - `status`
  - `auth`
  - `message`
  - `models`

Important constraints:

- snapshot refresh must degrade cleanly when `pi` is missing or unauthenticated
- errors should become structured provider status, not process crashes
- model capability metadata should be preserved the same way existing providers do

### 3. Add runtime adapter support

Primary files:

- `apps/server/src/provider/Services/PiAdapter.ts`
- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Errors.ts`

Work:

- implement `ProviderAdapterShape` for `pi`
- support:
  - `startSession`
  - `sendTurn`
  - `interruptTurn`
  - `respondToRequest`
  - `respondToUserInput`
  - `stopSession`
  - `listSessions`
  - `hasSession`
  - `readThread`
  - `rollbackThread` if supported, otherwise fail predictably with an existing unsupported-path error
  - `stopAll`
  - `streamEvents`
- normalize `pi` output into canonical `ProviderRuntimeEvent` values

Decision rule:

- prefer the integration path that gives the cleanest event fidelity and recoverability under load
- if the `pi` SDK does not emit enough structured runtime information, use its process/RPC path instead of forcing a lossy shim

### 4. Register `pi` through the existing provider graph

Primary files:

- `apps/server/src/provider/Layers/ProviderRegistry.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- any provider ordering/cache helpers that assume the current provider set

Work:

- register `PiProvider` in snapshot aggregation
- register `PiAdapter` in adapter lookup
- update provider ordering or cache-id lists if they are currently fixed to the four existing providers
- verify provider status streaming still works when `pi` is added to the set

### 5. Validate persistence and recovery expectations

Primary files:

- `apps/server/src/provider/Services/ProviderSessionDirectory.ts`
- `apps/server/src/provider/Services/ProviderService.ts`
- any `pi` adapter/session state helpers introduced in this PR

Work:

- confirm `pi` sessions can be keyed by `threadId` like the existing providers
- ensure reconnect/restart behavior is predictable
- document any known recovery gaps if `pi` cannot yet fully resume active sessions

## Proposed Delivery Slices

### Slice 1: Contract plumbing

- add `pi` to shared schemas and defaults
- get type-level provider routing compiling again

### Slice 2: Snapshot-only integration

- implement `PiProvider`
- expose `pi` in provider status payloads
- prove install/auth/version/model discovery

### Slice 3: Runtime spike

- implement a minimal `PiAdapter`
- start a session and send a turn
- map native events into canonical runtime events

### Slice 4: Robustness pass

- fill in interruption, approvals, user input, stop, and session listing semantics
- tighten error mapping and restart behavior
- cover edge cases with tests

## Testing Requirements

This repo requires all of the following before the task is considered complete:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Targeted tests to add or update:

- contract tests covering `ProviderKind` / model selection changes
- provider snapshot tests for installed, missing, unauthenticated, and authenticated `pi` states
- adapter tests for session start, turn send, event streaming, and stop behavior
- registry tests proving `pi` is discoverable from both provider registries

Use `bun run test` for any test execution. Do not use `bun test`.

## Exit Criteria

- `pi` appears in provider status/config payloads
- `pi` can be selected as a backend through the existing provider path
- a `pi`-backed thread can start and stream canonical runtime events
- missing-install and unauthenticated states are represented as provider status, not unhandled failures
- formatting, lint, and typecheck all pass

## Open Questions

- Should `pi` use SDK embedding or a process/RPC boundary for the first implementation?
- Does `pi` support enough structured event detail to faithfully populate `ProviderRuntimeEvent`?
- What model list and default model should Atelier expose for `pi` on day one?
- Does `pi` support rollback semantics, or should rollback be explicitly unsupported in the first pass?
- Does `pi` require new provider-specific model options in contracts, or can the first pass use a plain model slug only?

## Recommended File Name

If future PR plans are split out the same way, keep the naming pattern:

- `docs/atelier/pr-2-add-pi-provider.md`
- `docs/atelier/pr-3-...`
- `docs/atelier/pr-4-...`
