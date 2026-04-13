# Plan: Convex Orchestrator

> Convex-native orchestration control plane with Linear Agent Sessions, Slack integration, bi-directional sync, and T3 Code as the worker runtime.

## Summary

Build a clean-break fork where Convex becomes the control plane and T3 Code becomes the worker runtime. The orchestrator accepts work from both Slack and Linear, uses a Convex Agent (LLM) for task routing and coordination, and streams real-time activities to Linear's native agent session UI.

This plan intentionally does **not** include legacy cutover or in-place migration work. The target deployment is a new machine with fresh setup, separate from the current production environment. T3's existing web UI remains untouched and continues to serve as a worker/debug console rather than the primary operator surface.

## Architectural decisions

Durable decisions that apply across all phases:

- **Package layout**:
  - `apps/orchestrator/` is the new control-plane app
  - `apps/orchestrator/convex/` contains Convex entrypoints and generated API
  - `apps/orchestrator/src/` contains bridge clients, platform adapters, and model config
- **Primary control plane**: Convex is the canonical store for orchestration threads, execution-run metadata, parent/child relationships, and platform thread mappings.
- **Worker runtime**: `apps/server` owns worktrees, provider sessions, terminals, git state, diffs, checkpoints, and raw execution artifacts.
- **UI scope**: `apps/web` is unchanged. No Convex-aware rendering, no new orchestration UX in T3.
- **No Chat SDK**: Chat SDK models chatbot threads. Our orchestrator models durable tasks with lifecycle states and bi-directional platform sync. The abstraction mismatch costs more than it saves. Chat SDK scaffold from Phase 1 is removed in Phase 7.
- **Linear integration via `@linear/sdk`**: Use Linear's first-party Agent Session API (`agentSessionCreateOnIssue`, `createAgentActivity`, `agentSessionUpdate`) for native streaming status in Linear's UI. Fall back to comments only when agent sessions are unavailable.
- **Slack integration via `@slack/web-api`**: Minimal direct client, no Bolt framework. Stateless adapter pattern matching the Linear adapter.
- **Platform adapter pattern**: Stateless `PlatformAdapter` interface in `apps/orchestrator/src/adapters/`. Adapters are translators between platform events and orchestration domain events. All durable state stays in Convex tables.
- **Bi-directional sync via Convex**: Each `controlThread` stores optional `linearRef` + `slackRef`. Outbound orchestrator responses fan out to all attached platform refs. Human messages do not mirror between platforms.
- **Convex Agent as workflow brain**: A Convex Agent (LLM via AI SDK + OpenRouter) owns task-vs-question routing, Linear issue creation decisions, T3 run orchestration, and completion behavior. The agent's thread in Convex is the durable decision log.
- **Acknowledge receipt deterministically**: Platform acknowledgement (Slack emoji reaction, Linear agent session creation with initial activity) happens immediately on webhook ingress, before invoking the Convex Agent. This is deterministic code, not an agent tool.
- **Bridge protocol**: Convex controls T3 through a small authenticated HTTP worker API. T3 emits signed, idempotent callbacks back to Convex.
- **Run topology**: One Convex control thread can spawn many T3 execution runs. Each child run is independently addressable and rolls up to a parent thread.
- **Artifact ownership**: T3 stores raw logs, terminal output, file manifests, and diffs. Convex stores summaries, foreign keys, lifecycle state, and artifact pointers.
- **Deployment mode**: Clean break on a new machine. No backward-compatibility or live migration work is required in this plan.
- **Reference implementation**: [ceedaragents/cyrus](https://github.com/ceedaragents/cyrus) — production Linear + Slack coding agent using direct SDK wrappers with a similar adapter pattern. Key patterns: `ChatPlatformAdapter`, `LinearActivitySink`, `ChatSessionHandler`.

---

## Phase 1: Control Plane Skeleton

**User stories**:

- As an operator, I can boot a new `apps/orchestrator` service beside T3.
- As the system, I have one canonical place for orchestration state.

### What to build

Create the new `apps/orchestrator` app, wire Convex into the monorepo, and stand up the minimum Chat SDK Linear entrypoint with a no-op orchestration path. Define the core control-plane models so every later slice builds on stable identifiers and lifecycle records instead of ad hoc event handling.

This phase proves that the repo can host the orchestrator app and that Linear ingress can create durable control-thread records without involving T3 yet.

### Acceptance criteria

- `apps/orchestrator` is a first-class workspace in the monorepo and participates in build/typecheck tasks.
- Convex app entrypoints exist under `apps/orchestrator/convex/` and can boot locally.
- A Linear webhook can create or update a canonical control-thread record in Convex.
- The vendored Chat SDK state adapter is present and supports the minimum lock, subscription, and KV behavior needed by the bot runtime.
- No T3 worker interaction is required for the happy path in this phase.

### Implementation notes

- Added `apps/orchestrator` as a standalone workspace with Convex config, schema, HTTP ingress, and source/tests for the control-plane skeleton.
- Generated Convex `_generated/`* files via `npx convex dev` so the new app is using the real Convex codegen instead of a hand-written shim.
- Implemented a local `StateAdapter` for Chat SDK instead of `convex-chat-sdk`, which keeps the phase-1 runtime self-contained while still matching Chat SDK's actual interface.
- Wired Linear ingress to normalize payloads into durable Convex `controlThreads`, `controlThreadEvents`, and `controlThreadMessages` records.
- Kept T3 worker execution and the richer Linear lifecycle bridge out of scope for this phase, exactly as planned.

### Implementation footprint

Files added in phase 1:

- `.plans/convex-orchestrator-linear-refactor.md`
- `apps/orchestrator/package.json`
- `apps/orchestrator/tsconfig.json`
- `apps/orchestrator/src/index.ts`
- `apps/orchestrator/src/chat/bot.ts`
- `apps/orchestrator/src/chat/state.ts`
- `apps/orchestrator/src/chat/state.test.ts`
- `apps/orchestrator/src/linear/ingress.ts`
- `apps/orchestrator/src/linear/ingress.test.ts`
- `apps/orchestrator/convex/convex.config.ts`
- `apps/orchestrator/convex/schema.ts`
- `apps/orchestrator/convex/http.ts`
- `apps/orchestrator/convex/chatState.ts`
- `apps/orchestrator/convex/controlThreads.ts`
- `apps/orchestrator/convex/_generated/`*
- `bun.lock`

What those files established:

- `apps/orchestrator/convex/schema.ts` defines the first durable control-plane tables:
  - `controlThreads`
  - `controlThreadEvents`
  - `controlThreadMessages`
  - `chatStateLocks`
  - `chatStateSubscriptions`
  - `chatStateKv`
- `apps/orchestrator/convex/http.ts` exposes the first Convex HTTP ingress:
  - `GET /health`
  - `POST /linear/webhook`
- `apps/orchestrator/src/linear/ingress.ts` normalizes loose Linear webhook payloads into a stable `LinearIngressEnvelope`.
- `apps/orchestrator/convex/controlThreads.ts` upserts canonical thread state from normalized ingress instead of allowing ad hoc writes from the HTTP layer.
- `apps/orchestrator/src/chat/state.ts` and `apps/orchestrator/convex/chatState.ts` vendor the minimum Chat SDK state-adapter semantics locally.

---

## Phase 2: Single Worker Handshake

**User stories**:

- As an orchestrator, I can start one execution run in T3 from a Convex control thread.
- As the system, I can correlate one control thread to one worker run deterministically.

### What to build

Introduce the first version of the worker bridge between Convex and T3. Convex should be able to request a worker run, T3 should allocate its internal thread/worktree/session state, and T3 should callback into Convex with stable identifiers and a small lifecycle envelope.

This is the first thin end-to-end slice through control plane, worker API, callback protocol, and durable run metadata.

### Acceptance criteria

- Convex can create one execution run through an authenticated HTTP request to T3.
- T3 returns or publishes a stable `t3ThreadId` and `executionRunId` that Convex can persist.
- T3 can callback into Convex with `started`, `completed`, and `failed` lifecycle events for a single run.
- Callback application is idempotent for repeated deliveries of the same event id.
- No Linear reply behavior is required yet beyond internal control-thread/run correlation.

### Status

Implemented on `feature/orchestrator-agent`.

This slice now has a real end-to-end single-worker handshake:

- Convex can persist a requested execution run for an existing `controlThreads` record.
- `apps/orchestrator` can call a dedicated authenticated T3 HTTP bridge.
- T3 can create the minimal project/thread state it needs, dispatch `thread.turn.start`, and return a stable `t3ThreadId`.
- T3 watches real `thread.session-set` lifecycle events and calls back into Convex with `started`, `completed`, and `failed`.
- Convex applies callback events idempotently by `eventId`.

Phase 2 still intentionally stops short of any Linear reply or status-post behavior.

### Files to edit

Existing files changed in phase 2:

- `apps/orchestrator/convex/schema.ts`
- `apps/orchestrator/convex/http.ts`
- `apps/orchestrator/convex/_generated/api.d.ts`
- `apps/orchestrator/package.json`
- `apps/server/src/server.ts`
- `packages/contracts/src/index.ts`

### Files to create

New files created in phase 2:

- `apps/orchestrator/convex/executionRuns.ts`
- `apps/orchestrator/src/t3/client.ts`
- `apps/server/src/executionBridge/http.ts`
- `apps/server/src/executionBridge/routeAuth.ts`
- `apps/server/src/executionBridge/runStart.ts`
- `packages/contracts/src/executionBridge.ts`

Files intentionally left untouched in phase 2:

- `apps/orchestrator/convex/controlThreads.ts`
- `apps/server/src/orchestration/http.ts`
- `packages/contracts/src/orchestration.ts`

Those modules did not need edits because phase 2 extracted a dedicated bridge contract file and kept the new worker bridge separate from owner-session orchestration HTTP.

### Acceptance criteria

- Convex can create one execution run through an authenticated HTTP request to T3.
- T3 returns or publishes a stable `t3ThreadId` and `executionRunId` that Convex can persist.
- T3 can callback into Convex with `started`, `completed`, and `failed` lifecycle events for a single run.
- Callback application is idempotent for repeated deliveries of the same event id.
- No Linear reply behavior is required yet beyond internal control-thread/run correlation.

### Concrete implementation details

Convex-side additions:

- `apps/orchestrator/convex/schema.ts` now defines:
  - `executionRuns`
  - `executionRunEvents`
- `executionRuns` stores the durable correlation record:
  - `executionRunId`
  - `controlThreadId`
  - request payload basics like `initialPrompt` and `workspaceRoot`
  - lifecycle fields like `status`, `requestedAt`, `acceptedAt`, `startedAt`, `completedAt`
  - worker correlation fields like `t3ThreadId`, `t3TurnId`, `lastEventId`, `failureSummary`
- `executionRunEvents` stores callback application history keyed by `eventId`, which is the idempotency key for repeated server callbacks.
- `apps/orchestrator/convex/executionRuns.ts` now implements:
  - `createRequestedRun`
  - `attachT3Acceptance`
  - `applyLifecycleEvent`
  - `startSingleWorkerRun`
  - `getExecutionRun`
- `apps/orchestrator/src/t3/client.ts` is the first machine-to-machine client for T3:
  - reads `T3_EXECUTION_BRIDGE_BASE_URL`
  - reads `T3_EXECUTION_BRIDGE_SHARED_SECRET`
  - POSTs `ExecutionRunCreateRequest`
  - validates `ExecutionRunCreateResponse`
- `apps/orchestrator/convex/http.ts` now exposes `POST /t3/execution-events` for T3 callbacks and protects it with the shared bearer secret.

T3-side additions:

- `apps/server/src/executionBridge/routeAuth.ts` validates the shared bearer secret and keeps bridge auth separate from owner sessions.
- `apps/server/src/executionBridge/runStart.ts` translates one bridge request into existing orchestration commands:
  - create a project if the requested `workspaceRoot` is not already known
  - create a new T3 thread
  - dispatch `thread.turn.start`
  - track `executionRunId -> t3ThreadId` in a small in-memory registry for this thin phase
- `apps/server/src/executionBridge/http.ts` adds:
  - `POST /api/execution/runs`
  - a scoped background subscriber on `OrchestrationEngineService.streamDomainEvents`
  - lifecycle forwarding based on real `thread.session-set` events
- `apps/server/src/server.ts` now wires both the new route and the lifecycle forwarder into the running server.
- The lifecycle forwarder intentionally only emits the first `started`, `completed`, and `failed` event it successfully posts per tracked run, so duplicate session transitions do not spam Convex.

Bridge contract:

- `packages/contracts/src/executionBridge.ts` now owns:
  - `ExecutionRunCreateRequest`
  - `ExecutionRunCreateResponse`
  - `ExecutionRunLifecycleEvent`
- The bridge contract was intentionally extracted instead of bloating `packages/contracts/src/orchestration.ts`, because this is a control-plane-to-worker boundary rather than a browser-facing orchestration contract.

Authentication approach for this phase:

- The shared secret is `T3_EXECUTION_BRIDGE_SHARED_SECRET`.
- `apps/orchestrator` also needs `T3_EXECUTION_BRIDGE_BASE_URL` to reach T3.
- `apps/server` also needs `ORCHESTRATOR_BASE_URL` to post callbacks back to Convex.
- Owner-session auth, cookies, and pairing tokens are still intentionally out of scope for this bridge.

### Implementation decisions made

- The phase 2 server-side run registry is intentionally in-memory, not persisted.
  - Reason: phase 2 only needs a thin handshake and lifecycle callback proof.
  - Consequence: server restarts can lose the temporary `executionRunId -> t3ThreadId` callback mapping.
- T3 always creates a fresh thread for this phase instead of trying to reuse an existing worker thread.
  - Reason: it keeps correlation deterministic and avoids continuation semantics before phase 5.
- Lifecycle forwarding uses `thread.session-set` rather than inventing a second callback source.
  - Reason: it is already driven by the existing provider runtime ingestion path, so the bridge remains anchored to real orchestration state.
- Convex applies callback events idempotently by inserting an `executionRunEvents` row before patching the run state.
  - Reason: repeated callback delivery is expected and should no-op cleanly.

### Deferred to Phase 3+

- Any Linear reply or threaded status-post behavior
- Retry queues or durable outbox behavior for failed T3 -> Convex callback delivery
- Persisted server-side run correlation across server restarts
- Run continuation, interrupt, or thread reuse semantics
- Richer worker metadata like diff summaries or artifact pointers

### Pseudocode sketch

Convex run request:

```ts
// apps/orchestrator/convex/executionRuns.ts
export const startSingleWorkerRun = action({
  args: { controlThreadId: v.id("controlThreads"), prompt: v.string() },
  handler: async (ctx, args) => {
    const executionRunId = crypto.randomUUID();
    await ctx.runMutation(internal.executionRuns.createRequestedRun, {
      controlThreadId: args.controlThreadId,
      executionRunId,
    });

    const response = await t3Client.createExecutionRun({
      controlThreadId: args.controlThreadId,
      executionRunId,
      initialPrompt: args.prompt,
    });

    await ctx.runMutation(internal.executionRuns.attachT3Thread, response);
    return response;
  },
});
```

T3 bridge route:

```ts
// apps/server/src/executionBridge/http.ts
POST /api/execution/runs
  -> authenticate shared secret
  -> validate ExecutionRunCreateRequest
  -> create project/thread if needed
  -> dispatch thread.turn.start through OrchestrationEngineService
  -> return { executionRunId, t3ThreadId, acceptedAt }
```

T3 callback application:

```ts
// apps/orchestrator/convex/http.ts
POST /t3/execution-events
  -> authenticate shared secret
  -> validate ExecutionRunLifecycleEvent
  -> if eventId already applied: return applied=false
  -> persist executionRunEvents record
  -> patch executionRuns lifecycle state
```

### Definition of done for phase 2

Phase 2 is done when this exact thin path works without any Linear reply logic:

1. A Convex action creates one requested execution run for an existing control thread.
2. `apps/orchestrator` sends one authenticated HTTP request to T3.
3. T3 dispatches one `thread.turn.start` using existing orchestration internals.
4. T3 calls Convex back with `started` and then terminal state (`completed` or `failed`).
5. Convex stores the full run correlation and ignores duplicate callback deliveries safely.

---

## Phase 3: Linear Thread Reply Loop

**User stories**:

- As a Linear user, I can comment on an issue and receive a threaded reply tied to the correct issue or comment thread.
- As the system, I can tolerate duplicate webhook delivery without double-replying.

### What to build

Complete the first user-visible vertical slice: Linear webhook arrives through Chat SDK, Convex resolves or creates the control thread, Convex launches a single T3 worker run, T3 emits completion data, and Convex posts a threaded reply back into Linear.

The reply can be intentionally simple in v1, but it must be deterministic, correctly threaded, and sourced from Convex-owned run state rather than direct T3-to-Linear calls.

### Acceptance criteria

- Top-level Linear issue comments and nested comment-thread replies both map to stable Convex control threads using adapter-compatible root-comment thread ids.
- One completed worker run produces exactly one threaded Linear reply.
- Duplicate Linear webhook delivery does not create duplicate control threads or duplicate replies.
- The Linear reply is generated from Convex-owned run state rather than from direct T3 webhook logic.
- The happy path is demoable without any manual data repair between systems.

### Status

Implemented on the current branch.

This phase is now install/test-ready for the MVP path:

- `GET /linear/oauth/install` starts the `actor=app` install flow
- `GET /linear/oauth/callback` exchanges the returned authorization code and renders an operator completion page
- `POST /linear/webhook` now verifies `Linear-Signature`, parses raw `Comment create` payloads, upserts control threads, and starts one worker run when the bot is mentioned
- `POST /t3/execution-events` now attempts exactly-once Linear reply posting for final lifecycle states while keeping callback application idempotent

### Implementation notes

- We intentionally landed the MVP webhook/reply path as a minimal Convex-native Linear slice instead of mounting the full Chat SDK runtime into the webhook request path.
- The current ingress logic mirrors the adapter's root-comment thread model: both top-level comments and nested replies resolve to `linear:{issueId}:c:{rootCommentId}`.
- The install path uses OAuth `actor=app`, but runtime posting still uses client credentials because the bot only needs app-scoped server-to-server auth after installation.
- Reply posting is lifecycle-based and intentionally simple for now; it confirms completion or failure without trying to surface rich artifact summaries before the later metadata phases land.

### Implementation footprint

Files added in phase 3:

- `apps/orchestrator/convex/linearMvp.ts`
- `apps/orchestrator/src/linear/client.ts`
- `apps/orchestrator/src/linear/oauth.ts`
- `apps/orchestrator/src/linear/replies.ts`
- `apps/orchestrator/src/linear/replies.test.ts`

Files changed in phase 3:

- `apps/orchestrator/convex/controlThreads.ts`
- `apps/orchestrator/convex/executionRuns.ts`
- `apps/orchestrator/convex/http.ts`
- `apps/orchestrator/convex/schema.ts`
- `apps/orchestrator/src/chat/bot.ts`
- `apps/orchestrator/src/index.ts`
- `apps/orchestrator/src/linear/ingress.ts`
- `apps/orchestrator/src/linear/ingress.test.ts`
- `docs/orchestrator-deployment.md`
- `docs/linear-agent-mvp-setup.md`

---

## Phase 4: Linear Surface Validation

**User stories**:

- As an operator, I know exactly which Linear entities and fields reach the orchestrator through the Chat SDK adapter.
- As the system, I do not accidentally design around unsupported Linear surfaces such as first-class file ingestion when the adapter only supports comment/message primitives.

### What to build

Add a focused validation slice for the real Linear integration surface area. This phase is about proving, with tests and controlled fixtures, what the adapter actually delivers for:

- issue-level comments
- comment-thread replies
- mentions
- reactions
- issue metadata
- attachment-adjacent content such as markdown links or attachment references in comment bodies

The goal is to turn current assumptions into documented, repeatable evidence before later phases depend on those assumptions.

This phase should explicitly answer whether issue attachments are available as structured adapter data or only indirectly via normal comment/markdown content. If attachments are not first-class in the adapter, that limitation should become a durable architectural constraint for the rest of the plan.

### Acceptance criteria

- We have a deterministic test matrix for the Linear adapter inputs the MVP depends on.
- The team has a documented answer for whether issue attachments are exposed as structured data, only as links in comment bodies, or not at all.
- Unsupported adapter surfaces are recorded as explicit constraints in the orchestrator docs and plan, not as tribal knowledge.
- Mention, comment-thread, and issue-thread behavior is validated against real or captured payloads, not only inferred from docs.
- Later phases are not allowed to assume first-class attachment ingestion unless this phase proves it.

### Status

Partially implemented on the current branch.

What landed:

- the ingress tests now lock down top-level comment routing, nested reply routing, mention detection, and the current attachment boundary
- the docs now explicitly call out that attachments are only available indirectly via markdown links in comment bodies for this MVP
- the plan now treats root-comment threading and attachment limits as durable constraints instead of assumptions

What still remains:

- validate the same thread behavior against a real installed Linear app or captured production payloads after the first live install

---

## Phase 5: Execution State and Recovery

**User stories**:

- As an operator, I can recover run state after retries, duplicate callbacks, or worker restarts.
- As the system, I can reach a correct final state without double-applying completion behavior.

### What to build

Strengthen the worker-control protocol so Convex can reconcile eventual worker state even when callbacks are delayed, duplicated, or partially missing. Add explicit execution-run lifecycle states and a recovery path based on callback replay and status inspection.

This phase makes the architecture operationally credible before we add richer orchestration behaviors.

### Acceptance criteria

- Execution runs have explicit durable states for requested, accepted, started, completed, failed, interrupted, and reconciling.
- Duplicate callbacks do not re-open closed runs or double-trigger Linear replies.
- Convex can reconcile final worker state via polling T3's existing read model if callbacks are lost.
- Worker restarts do not orphan the control thread permanently.
- Recovery behavior is covered by deterministic tests, not only by manual verification.

### Status

Implemented on the current branch.

### Implementation notes

- The pure lifecycle state machine is extracted into `apps/orchestrator/src/executionLifecycle.ts` — all transition rules (`isTerminalStatus`, `canApplyLifecycleEvent`, `deriveNextStatus`) live there and are tested deterministically without a Convex runtime.
- Recovery is Convex-driven, not T3-driven. The T3-side run registry remains in-memory by design to minimize changes to core T3 code and avoid merge conflicts with upstream.
- Convex polls T3's existing orchestration read model via a new `POST /api/execution/runs/status` endpoint. No new T3 SQLite migrations or persistence tables were added.
- The `interrupted` lifecycle type is now supported across the full bridge: contract schema, T3 session mapping, Convex mutation, and event storage.

### Implementation footprint

Files changed:

- `apps/orchestrator/convex/schema.ts` — added `interrupted` and `reconciling` to `executionRunState`, added `interrupted` to `executionLifecycleType`, added `by_updated_at` index on `executionRuns`
- `apps/orchestrator/convex/executionRuns.ts` — hardened `applyLifecycleEvent` with `canApplyLifecycleEvent` guard, added `findStaleRuns` query, `markReconciling` mutation, `resolveReconciliation` mutation, and `reconcileStaleRuns` action
- `apps/orchestrator/src/t3/client.ts` — added `queryRunStatus` method to the T3 bridge client
- `apps/orchestrator/src/executionLifecycle.ts` — pure state machine with `isTerminalStatus`, `deriveNextStatus`, `canApplyLifecycleEvent` (pre-existing, confirmed complete)
- `apps/orchestrator/src/executionLifecycle.test.ts` — 35 tests covering terminal state guards, transition rules, idempotent re-delivery (pre-existing, confirmed passing)
- `packages/contracts/src/executionBridge.ts` — added `interrupted` to `ExecutionRunLifecycleType`, added `ExecutionRunStatusQuery` and `ExecutionRunStatusResponse` schemas
- `apps/server/src/executionBridge/http.ts` — added `interrupted` session status mapping, added status query route
- `apps/server/src/executionBridge/runStart.ts` — added `interruptedEventId` to `TrackedExecutionRun`
- `apps/server/src/server.ts` — wired status query route (2 lines)

### Implementation decisions made

- The T3-side run registry stays in-memory. Recovery is Convex-owned: `reconcileStaleRuns` finds non-terminal runs older than 10 minutes, polls T3 for current session status, and resolves them to `completed` or `failed` based on what T3 reports.
- T3's `POST /api/execution/runs/status` reads from `OrchestrationEngineService.getReadModel()` (the existing in-memory projection), so no new persistence layer is needed on the T3 side.
- Idempotent re-delivery of the same terminal state is allowed (e.g. `completed` on an already-completed run). Only cross-terminal transitions are rejected (e.g. `failed` on a completed run).
- If T3 has no record of the thread (e.g. server restarted and lost the projection), reconciliation marks the run as failed with a descriptive summary.

---

## Phase 6: Run Continuation and Stop Control

**User stories**:

- As a Linear user, I can send follow-up comments that continue an existing worker run context.
- As a Linear user, I can stop or interrupt in-flight work.

### What to build

Add continuation and interruption semantics to the control plane. Follow-up messages should route to the right control thread and either continue an active worker context or create a new run on the same control thread according to explicit policy. Stop requests should flow through Convex to T3 and produce a final, durable result state.

This phase turns the system from one-shot request/reply automation into an actual conversational execution loop.

### Acceptance criteria

- Follow-up messages attach to the correct control thread.
- Convex can create a continuation run or inject a follow-up turn against the appropriate worker context.
- Stop requests result in T3 interruption and a durable interrupted state in Convex.
- The system avoids ambiguous "two active runs for one control thread" behavior.
- The continuation/interrupt bridge routes are wired end-to-end.

### Status

Implemented on the current branch.

### Implementation notes

- Continuation follows a state-dependent policy:
  - **Active run** (started/accepted/requested): inject a new `thread.turn.start` on the same T3 thread, same execution run. No new run created.
  - **Terminal run** (completed/failed/interrupted): create a new execution run in Convex, dispatch a new turn on the same T3 thread from the last run. The T3 thread preserves its worktree, git state, and conversation history.
  - **No runs**: error — use `startSingleWorkerRun` instead.
- Interrupt dispatches `thread.turn.interrupt` on the T3 thread. The lifecycle forwarder will emit an `interrupted` callback when the session transitions.
- The continue route updates the in-memory run registry so lifecycle callbacks for the continued turn route back to the correct execution run.

### Implementation footprint

Files changed:

- `packages/contracts/src/executionBridge.ts` — added `ExecutionRunContinueRequest`, `ExecutionRunContinueResponse`, `ExecutionRunInterruptRequest`, `ExecutionRunInterruptResponse`
- `apps/orchestrator/src/t3/client.ts` — added `continueExecutionRun` and `interruptExecutionRun` methods
- `apps/orchestrator/convex/executionRuns.ts` — added `continueWorkerRun` action, `interruptWorkerRun` action, `listRunsForControlThread` query
- `apps/server/src/executionBridge/runStart.ts` — added `continueExecutionRun` and `interruptExecutionRun` effect functions
- `apps/server/src/executionBridge/http.ts` — added `POST /api/execution/runs/continue` and `POST /api/execution/runs/interrupt` routes
- `apps/server/src/server.ts` — wired continue and interrupt routes (4 lines total)

### Implementation decisions made

- Continue reuses the T3 thread from the latest run on the control thread. This preserves codebase context (worktree, git state, conversation history) across follow-ups.
- For active runs, the same execution run ID is reused — no new Convex record. For terminal runs, a new execution run is created so each run has clean lifecycle tracking.
- The continue route re-registers the run in the T3 in-memory registry if the mapping was lost (e.g. server restart between original run and continuation).
- Interrupt is fire-and-forget from Convex's perspective — it dispatches the command and relies on the existing lifecycle forwarder to emit the `interrupted` callback.

---

## Phase 7: Drop Chat SDK and Define Adapter Types

**User stories**:

- As a developer, I have a clean codebase with no dead Chat SDK scaffold.
- As the system, I have a well-defined platform adapter interface that later phases build on.

### What to build

Remove the Chat SDK scaffold and define the `PlatformAdapter` interface that all platform integrations will implement.

### What to remove

- `apps/orchestrator/src/chat/` (bot.ts, state.ts, state.test.ts)
- `apps/orchestrator/convex/chatState.ts`
- `chatStateLocks`, `chatStateSubscriptions`, `chatStateKv` tables from `apps/orchestrator/convex/schema.ts`
- `chat` and `@chat-adapter/linear` dependencies from `apps/orchestrator/package.json`

### What to create

- `apps/orchestrator/src/adapters/types.ts` with core interfaces:
  - `PlatformAdapter` — `normalizeInbound`, `postMessage`, `postActivity`, `updateIssueStatus`, `verifyWebhook`, `fetchThreadContext`
  - `InboundEvent` — normalized platform event with `threadKey`, `eventKey`, `type`, `author`, `content`, `attachments`, `platformRef`
  - `OutboundMessage` — markdown + attachments
  - `PlatformThreadRef` — discriminated union (`linear` | `slack`)
  - `AgentActivity` — `thought`, `action`, `response`, `error` (matching Linear's agent activity schema)
  - `IssueStatus` — enum mapping to workflow states

### Acceptance criteria

- [x] `bun typecheck` passes with chat scaffold removed
- [x] `PlatformAdapter` interface is defined with inbound, outbound, and lifecycle methods
- [x] No references to `chat-sdk`, `@chat-adapter`, or `createOrchestratorBot` remain
- [x] Existing Linear comment flow still works (no behavior change)

### Status

Implemented on the current branch.

### Implementation footprint

Files deleted:

- `apps/orchestrator/src/chat/bot.ts`
- `apps/orchestrator/src/chat/state.ts`
- `apps/orchestrator/src/chat/state.test.ts`
- `apps/orchestrator/convex/chatState.ts`

Files created:

- `apps/orchestrator/src/adapters/types.ts` — `PlatformAdapter`, `InboundEvent`, `OutboundMessage`, `PlatformThreadRef`, `AgentActivity`, `IssueStatus`, `Attachment`, `ThreadContext`, `PlatformMessageRef`

Files changed:

- `apps/orchestrator/convex/schema.ts` — removed `chatStateLocks`, `chatStateSubscriptions`, `chatStateKv` tables
- `apps/orchestrator/package.json` — removed `chat` and `@chat-adapter/linear` dependencies
- `apps/orchestrator/src/index.ts` — removed chat exports

---

## Phase 8: Linear Platform Adapter with Agent Session API

**User stories**:

- As a Linear user, I see native agent session UI when the orchestrator picks up my issue.
- As the system, I can manage issue lifecycle (status, assignment) through the adapter.

### What to build

1. `apps/orchestrator/src/adapters/linear.ts` — `LinearPlatformAdapter` wrapping `@linear/sdk`:
  - `normalizeInbound()` — handle both `AgentSessionEvent` (created/prompted) and `Comment` webhooks
  - `postMessage()` — threaded comments via `linearClient.createComment()`
  - `postActivity()` — streaming activities via `linearClient.createAgentActivity()` (thought, action, response, error)
  - `createAgentSession()` — create agent session on issue or comment via `agentSessionCreateOnIssue` / `agentSessionCreateOnComment`
  - `updateAgentSession()` — update plans and external URLs via `agentSessionUpdate`
  - `updateIssueStatus()` — change workflow state and assignee via `issue.update()`
  - `verifyWebhook()` — HMAC-SHA256 signature check
2. Upgrade `apps/orchestrator/convex/http.ts` `/linear/webhook` to handle `AgentSessionEvent` webhook type alongside existing `Comment` webhooks
3. Agent session is created immediately on webhook ingress (deterministic, before any LLM call), with an initial "Preparing..." thought activity
4. Add `@linear/sdk` as direct dependency
5. Refactor `apps/orchestrator/src/linear/` to delegate to `LinearPlatformAdapter` or replace

### Acceptance criteria

- `AgentSessionEvent` (created/prompted) webhooks are handled alongside `Comment` webhooks
- Agent sessions are created immediately when the orchestrator picks up work
- Streaming activities (thought, action, response, error) post to Linear's native agent UI
- Issue status changes to "In Review" and assignee changes work
- Comment webhook path still works as fallback for non-agent interactions

---

## Phase 9: Streaming Activities from T3 to Linear

**User stories**:

- As a Linear user, I can see real-time progress of what the agent is doing.
- As the system, I can forward T3 domain events as native Linear agent activities.

### What to build

1. Extend the bridge callback contract with activity-level events:
  - New `ExecutionRunActivityEvent` in `packages/contracts/src/executionBridge.ts`
  - Activity types: `thought`, `action`, `response`, `error`
2. Add a second background stream watcher in `apps/server/src/executionBridge/http.ts` that forwards selected T3 domain events as activities:
  - `thread.activity-appended` with `tone: "tool"` → `action` activity (e.g. "Reading src/auth.ts")
  - `thread.message.assistant.delta` batched → `thought` activity (debounced, not per-token)
  - `thread.message.assistant.complete` → `response` activity (final T3 response)
  - `thread.session-set` with `status: "error"` → `error` activity
3. Add `POST /t3/execution-activities` route to `apps/orchestrator/convex/http.ts`
4. Convex action forwards activities to `linearAdapter.postActivity()` when the control thread has an `agentSessionId`

### Acceptance criteria

- T3 tool use events appear as `action` activities in Linear's agent session UI
- T3 assistant reasoning appears as `thought` activities (debounced)
- T3 final response appears as a `response` activity
- T3 errors appear as `error` activities
- Activities only post when the control thread has an active agent session
- Activity forwarding doesn't block or degrade the lifecycle callback path

---

## Phase 10: Slack Platform Adapter

**User stories**:

- As a Slack user, I can mention the bot and get a response in my thread.
- As an operator, I can install the Slack app via OAuth.

### What to build

1. `apps/orchestrator/src/adapters/slack.ts` — `SlackPlatformAdapter`:
  - `normalizeInbound()` — handle `app_mention` events, extract `thread_ts`, parse attachments/files
  - `postMessage()` — threaded replies via `chat.postMessage` with `thread_ts`
  - `updateMessage()` — edit messages via `chat.update`
  - `fetchThreadContext()` — full thread history via `conversations.replies`
  - `verifyWebhook()` — Slack request signing verification
  - `acknowledgeReceipt()` — add emoji reaction (deterministic, before agent invocation)
2. Add `@slack/web-api` as dependency
3. Add routes to `apps/orchestrator/convex/http.ts`:
  - `POST /slack/events` — webhook handler with URL verification challenge, signature check, inbound normalization, control thread upsert, execution run dispatch
  - `GET /slack/oauth/install` — redirect to Slack OAuth
  - `GET /slack/oauth/callback` — exchange code, store bot token
4. Add `upsertFromSlackIngress` mutation in `apps/orchestrator/convex/controlThreads.ts`
5. Extend `apps/orchestrator/convex/schema.ts` with Slack-specific fields

### Acceptance criteria

- Slack `app_mention` events create control threads in Convex
- Bot immediately reacts with emoji (deterministic acknowledge)
- Orchestrator replies in the correct Slack thread
- Slack attachments (files, images) are included in the prompt sent to T3
- Thread context (conversation history) is fetched and included in prompts
- Slack OAuth install flow works end-to-end
- Slack operates independently (no Linear sync yet — that's Phase 13)

---

## Phase 11: Convex Agent Core

**User stories**:

- As the system, I have an LLM-powered orchestrator agent that decides what to do with incoming requests.
- As a Linear user, my requests go through the agent instead of deterministic webhook-to-bridge routing.

### What to build

1. Set up AI SDK with OpenRouter provider:
  - Model config in `apps/orchestrator/src/` for easy model switching
  - LLM calls in Convex actions via `convex-agent`
2. Define the Convex Agent with tools:
  - `startT3Run({ prompt, workspaceRoot })` — kick off a T3 execution run
  - `continueT3Run({ executionRunId, prompt })` — send follow-up to active T3 run
  - `interruptT3Run({ executionRunId })` — stop T3 work
  - `createLinearIssue({ title, description })` — create issue in configured team (env var `LINEAR_DEFAULT_TEAM_ID`), status "In Progress"
  - `createLinearAgentSession({ issueId })` — start agent session for streaming
  - `postLinearActivity({ agentSessionId, activity })` — post thought/action/response
  - `updateLinearIssueStatus({ issueId, status, assigneeId })` — move to "In Review", assign reviewer
  - `postSlackMessage({ channelId, threadTs, text })` — reply in Slack thread
3. Wire the agent into the existing Linear-initiated flow:
  - Replace `linearMvp.startRunFromLinearWebhook` with agent invocation
  - Agent receives the normalized inbound event and decides what to do
  - Agent's Convex thread is the durable decision log
4. The agent handles three routing modes:
  - Simple question (no codebase needed) → agent answers directly
  - Question needing codebase context → agent starts T3 run, gets answer, responds
  - Coding task → agent starts T3 run, creates Linear issue (if not already Linear-initiated), monitors progress

### Acceptance criteria

- AI SDK + OpenRouter configured and callable from Convex actions
- Convex Agent defined with all tools listed above
- Linear-initiated flow works through the agent (not deterministic routing)
- Agent can decide between answering directly vs starting a T3 run
- Agent decisions are logged durably in the Convex agent thread
- Slack not connected to the agent yet (that's Phase 12)

---

## Phase 12: Slack to Convex Agent

**User stories**:

- As a Slack user, my messages go through the Convex Agent for intelligent routing.
- As a Slack user, I get direct answers for questions and T3-powered answers for coding questions.

### What to build

1. Wire Slack webhook handler to invoke the Convex Agent instead of starting T3 runs directly
2. The agent handles Slack events with the same three routing modes:
  - Simple question → agent answers directly in Slack
  - Question needing codebase → agent starts T3 run, gets answer, replies in Slack, no Linear issue
  - Coding task → agent starts T3 run, responds in Slack (Linear issue creation is Phase 13)
3. Follow-up Slack messages in the same thread route to the same agent thread for continuation/interrupt decisions

### Acceptance criteria

- Slack mentions invoke the Convex Agent
- Agent can answer simple questions directly in Slack without T3
- Agent can start T3 runs for codebase questions and reply in Slack
- Agent can identify coding tasks (Linear issue creation deferred to Phase 13)
- Follow-up messages in the same Slack thread continue the same agent context
- Both Slack and Linear entry points work through the same agent

---

## Phase 13: Bi-directional Sync

**User stories**:

- As a Slack user, coding tasks I start automatically get a Linear issue for tracking.
- As a user on either platform, I see orchestrator responses on both platforms.
- As a reviewer, completed tasks are assigned to me with the issue moved to "In Review".

### What to build

1. Extend `controlThreads` schema:
  - `linearRef: v.optional(v.object({ issueId, agentSessionId? }))` — Linear issue/session correlation
  - `slackRef: v.optional(v.object({ channelId, threadTs, teamId? }))` — Slack thread correlation
  - `syncedPlatforms: v.array(v.union(v.literal("linear"), v.literal("slack")))` — which platforms are attached
2. Slack → Linear sync:
  - When the Convex Agent decides a Slack message is a coding task, it creates a Linear issue (configured team via `LINEAR_DEFAULT_TEAM_ID`, status "In Progress")
  - Stores `linearRef` on the control thread
  - Creates an agent session on the Linear issue for streaming activities
3. Outbound fan-out:
  - Orchestrator responses fan out to all attached platform refs on the control thread
  - Human messages do NOT mirror between platforms
4. Completion behavior:
  - On `completed`: `linearAdapter.updateIssueStatus("in_review", reviewerUserId)` + `slackAdapter.postMessage("@reviewer PR is ready for review: ...")`
  - On `failed`: post failure summary to all attached platform refs
5. Follow-up routing:
  - Follow-up messages from either platform that trigger orchestrator action → forwarded to T3
  - Resulting orchestrator responses fan out to all attached refs

### Acceptance criteria

- Slack-initiated coding tasks auto-create a Linear issue in configured team
- Linear issue starts in "In Progress" status
- T3 activities stream to the Linear agent session for Slack-initiated tasks
- Orchestrator responses fan out to both Slack thread and Linear issue
- Completion moves Linear issue to "In Review" and assigns reviewer
- Completion posts review-request message in Slack thread
- Duplicate webhook delivery doesn't create duplicate synced records
- Linear-only flows don't auto-create Slack threads

---

## Future work

These items are intentionally out of scope for this plan:

- **Parent/child orchestration**: one control thread fans out to multiple T3 runs, with aggregate status roll-up and orchestrator-managed decomposition
- **Configurable reviewer per issue**: instead of a single hardcoded reviewer, support per-team, per-project, or per-issue reviewer assignment (e.g. via Linear issue metadata, Slack thread participants, or orchestrator config)
- Machine setup guides and deployment runbooks for the new environment
- Operational dashboards and day-2 observability tooling
- Any migration or cutover plan from the current production machine
- Any future decision to make the T3 UI Convex-aware

