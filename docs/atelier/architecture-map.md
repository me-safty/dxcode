# Atelier Architecture Map

Snapshot date: 2026-04-18

Upstream references:

- T3 Code `main` at `9df3c640210fecccb58f7fbc735f81ca0ee011bd`
- License: MIT
- Claude Cowork help article: https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
- pi coding agent package: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent

## What T3 actually is today

T3 is already a provider-agnostic monorepo, not a Claude/Codex-only app with ad hoc integrations.

- Monorepo: Bun + Turbo with `apps/web`, `apps/server`, `apps/desktop`, `apps/marketing`, plus shared packages under `packages/`.
- Server runtime: Effect-based service graph in `apps/server/src/server.ts`.
- UI: React + TanStack Router in `apps/web`, with a sidebar/thread/chat layout built around long-lived project-scoped threads.
- Shared contracts: provider/session/runtime event schemas live in `packages/contracts`.

## Important corrections to the brief

### 1. The provider abstraction already exists

The closest existing contract to the proposed `AgentBackend` is `ProviderAdapterShape` in `apps/server/src/provider/Services/ProviderAdapter.ts`.

It already standardizes:

- session start/stop
- turn send / interrupt
- approval responses
- structured user input responses
- thread read / rollback
- canonical runtime event streaming

This means Atelier should evolve the current provider layer, not introduce a parallel abstraction on top of it.

### 2. Auth is not part of the runtime adapter contract

T3 separates:

- runtime adapters: `ClaudeAdapter`, `CodexAdapter`, `CursorAdapter`, `OpenCodeAdapter`
- provider status/auth/model discovery: `ClaudeProvider`, `CodexProvider`, `CursorProvider`, `OpenCodeProvider`

That split is useful and should stay. The brief's `login()` method does not belong on the runtime adapter. For Atelier, setup/login should live in a setup-wizard metadata layer.

### 3. The canonical event stream already exists

T3 already normalizes provider-native output into `ProviderRuntimeEvent` in `packages/contracts/src/providerRuntime.ts`.

The event vocabulary is broad enough for Atelier:

- session lifecycle
- thread lifecycle
- turn lifecycle
- content streaming
- tool/item progress
- approvals
- structured user input
- plan updates
- files persisted
- runtime warnings/errors

For Atelier, the main work is filtering and re-presenting these events as progress/artifact UX, not inventing a new event model.

### 4. T3 currently ships more than Claude and Codex

Current `ProviderKind` values are:

- `codex`
- `claudeAgent`
- `cursor`
- `opencode`

So the fork point is broader than the brief assumed. Adding pi should follow the same pattern as the existing providers.

### 5. "Session" in T3 maps to thread/task state, not an opaque backend session id

T3 keys provider runtime around `threadId`. A provider session is associated with a thread and can be recovered via persisted runtime state. The right Atelier mapping is:

- T3 `thread` -> Atelier `task`
- T3 `project` -> Atelier `folder workspace`
- provider session state remains internal

### 6. The current UI is already close to the underlying mental model we need

The current product is developer-biased, but structurally useful:

- left sidebar for projects/threads
- center thread/task view
- composer with provider/model/runtime controls
- optional right-side/context panels

Atelier should keep the shell and replace the visible affordances:

- hide git, diff, terminal, and code-first details by default
- promote folder context, progress feed, and artifact previews
- relabel thread/project concepts in user-facing copy

## Concrete architecture recommendation

Do not replace `ProviderAdapterShape`. Build Atelier on top of the existing contracts with one added descriptor layer.

### Keep as core runtime contract

Use the existing runtime adapter shape as the base contract for all backends, including pi:

```ts
interface AgentBackendRuntime {
  readonly provider: ProviderKind | "pi";
  readonly capabilities: {
    readonly sessionModelSwitch: "in-session" | "unsupported";
  };
  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, AgentBackendError>;
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, AgentBackendError>;
  readonly interruptTurn: (
    threadId: ThreadId,
    turnId?: TurnId,
  ) => Effect.Effect<void, AgentBackendError>;
  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, AgentBackendError>;
  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, AgentBackendError>;
  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, AgentBackendError>;
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;
  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;
  readonly readThread: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderThreadSnapshot, AgentBackendError>;
  readonly rollbackThread: (
    threadId: ThreadId,
    numTurns: number,
  ) => Effect.Effect<ProviderThreadSnapshot, AgentBackendError>;
  readonly stopAll: () => Effect.Effect<void, AgentBackendError>;
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}
```

### Add a setup/status descriptor for non-technical UX

This is the missing piece for Atelier:

```ts
interface AgentBackendDescriptor {
  readonly id: ProviderKind | "pi";
  readonly displayName: string;
  readonly install: {
    readonly detected: boolean;
    readonly command?: string;
    readonly helpUrl?: string;
  };
  readonly auth: {
    readonly status: "authenticated" | "unauthenticated" | "unknown";
    readonly loginCommand?: string;
    readonly accountLabel?: string;
    readonly detail?: string;
  };
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly supports: {
    readonly images: boolean;
    readonly webResearch: boolean;
    readonly artifactWorkflows: boolean;
  };
}
```

Mapping:

- `ServerProvider` already covers most of this today for built-in providers.
- Atelier should enrich that snapshot with install/login/setup copy suitable for the wizard.

## Recommended implementation shape

### Phase 1

1. Keep upstream provider runtime contracts untouched.
2. Extend `ProviderKind` and related contracts to add `pi`.
3. Add `PiProvider` for detection/auth/model snapshotting.
4. Add `PiAdapter` for runtime.
5. Build an Atelier-only UI layer that consumes the same orchestration/runtime data but renders a knowledge-work surface.

### Phase 2

Once the provider layer is stable, add a thin presentation-focused alias:

- `thread` -> `task`
- `project` -> `folder workspace`
- runtime events -> `progress feed entries`
- file outputs -> `artifacts`

This should mostly be view-model code, not backend rearchitecture.

## pi integration recommendation

pi looks viable for MVP, but the adapter should be validated against real session behavior before we commit to SDK-only integration.

What is promising:

- package exports `createAgentSession`
- package exports `AuthStorage`, `ModelRegistry`, `SessionManager`
- package supports OAuth `/login` and API key auth
- package is MIT licensed

What still needs proof:

- whether the SDK emits enough structured turn/tool events for T3's canonical runtime stream without an awkward shim
- whether image attachments and long-running session recovery map cleanly
- whether we should prefer SDK embedding or the process/RPC mode for isolation

Recommendation:

- prototype pi as a separate adapter spike first
- choose SDK only if event fidelity is good enough
- otherwise use pi's process/RPC path and normalize events the same way T3 already does for external runtimes

## Cowork cues that matter for Atelier

From the current Claude Cowork docs, the product cues worth copying are:

- folder/project-scoped workspaces
- long-running tasks
- visible progress while the agent works
- direct local file output
- strong setup and safety guidance

The desktop-only VM isolation and scheduled-task system are not MVP requirements for this fork.

## Local environment status

Current machine checks:

- `claude --version` -> `2.1.113`
- `codex --version` -> `codex-cli 0.112.0`
- `node --version` -> `v25.8.0`
- `bun` is not installed

That means we can inspect and modify the codebase now, but we cannot complete an upstream `bun install` / `bun dev` verification pass until Bun is installed.
