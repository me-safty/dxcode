/**
 * The orchestration-backed {@link MessageBroker} for the workflow engine (Epic 25 §Host
 * wiring). Each thread verb fired by a workflow body maps onto one orchestration command:
 *
 *   • thread.create  → dispatch(thread.create)        — make the spawned thread.
 *   • thread.turn    → dispatch(thread.turn.start)     — start an agent turn; record a pending
 *                       ask so the reactor can resolve it when the turn completes.
 *   • thread.message → dispatch(thread.message.upsert) — post a one-way message (no turn).
 *   • user.input     → dispatch(thread.message.upsert, role system) — request user input; record
 *                       a pending ask resolved when the user replies.
 *
 * The broker is created per run, so it carries the run's id, project, and model selection.
 * Dispatches are chained on a single tail promise: `thread.create` is fired floating by the
 * SDK's one-way `sendOneWay`, so chaining guarantees the create lands before the `thread.turn`
 * it precedes (turn-on-a-missing-thread would otherwise race).
 */

import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationCommand,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type T3workMessageExt,
  ThreadId,
} from "@t3tools/contracts";

import type { MessageBroker, MessageEnvelope } from "@t3work/sdk";

import type { T3workWorkflowEngineRegistryShape } from "./t3work-workflowEngineRegistry.ts";

/** The ask a run is parked on, as the broker knows it when it fires (thread + correlation). */
export interface WorkflowEnginePendingAsk {
  readonly threadId: string;
  readonly correlationId: string;
  readonly kind: "thread.turn" | "user.input";
}

export interface WorkflowEngineBrokerDeps {
  readonly runId: string;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly registry: T3workWorkflowEngineRegistryShape;
  /** Run an orchestration command (the launch builds this from the captured runtime). */
  readonly dispatch: (command: OrchestrationCommand) => Promise<void>;
  readonly newId: () => string;
  readonly nowIso: () => string;
  /**
   * Durably persist the pending ask (status=suspended + pending columns) before the side
   * effect dispatches, so a restart finds the parked run in the DB. The in-memory
   * `registry.setPending` is still set for the live reactor's hot lookups; this mirrors it to
   * the source of truth. No-op (undefined) on the fs/in-memory path.
   */
  readonly recordPending?: (pending: WorkflowEnginePendingAsk) => Promise<void>;
}

interface ThreadCreatePayload {
  readonly threadId: string;
  readonly name?: string;
}
interface ThreadTurnPayload {
  readonly threadId: string;
  readonly prompt: string;
}
interface ThreadMessagePayload {
  readonly threadId: string;
  readonly recipient: "agent" | "user";
  readonly text: string;
}
interface UserInputPayload {
  readonly threadId: string;
  readonly question: string;
}

export function createWorkflowEngineBroker(deps: WorkflowEngineBrokerDeps): MessageBroker {
  // Serialize dispatches so a floated `thread.create` lands before the `thread.turn` it precedes.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
  // One-way verbs (thread.create / thread.message) are fired floating by the SDK, so a
  // dispatch rejection would become an unhandled rejection; swallow it (best-effort delivery).
  // Ask verbs (thread.turn / user.input) are awaited, so their failures propagate and fail the
  // run rather than parking it forever on a turn that never started.
  const enqueueOneWay = (fn: () => Promise<void>): Promise<void> => enqueue(fn).catch(() => {});

  const send = async (envelope: MessageEnvelope): Promise<void> => {
    const { correlationId, kind, payload } = envelope;
    if (kind === "thread.create") {
      const p = payload as ThreadCreatePayload;
      await enqueueOneWay(() =>
        deps.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`t3work-wf:create:${deps.newId()}`),
          threadId: ThreadId.make(p.threadId),
          projectId: deps.projectId,
          title: p.name ?? "Workflow thread",
          modelSelection: deps.modelSelection,
          runtimeMode: deps.runtimeMode,
          interactionMode: deps.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: deps.nowIso(),
        }),
      );
      return;
    }
    if (kind === "thread.turn") {
      const p = payload as ThreadTurnPayload;
      deps.registry.setPending(p.threadId, { runId: deps.runId, correlationId, kind: "thread.turn" });
      await deps.recordPending?.({ threadId: p.threadId, correlationId, kind: "thread.turn" });
      await enqueue(() =>
        deps.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`t3work-wf:turn:${deps.newId()}`),
          threadId: ThreadId.make(p.threadId),
          message: {
            messageId: MessageId.make(deps.newId()),
            role: "user",
            text: p.prompt,
            attachments: [],
          },
          modelSelection: deps.modelSelection,
          runtimeMode: deps.runtimeMode,
          interactionMode: deps.interactionMode,
          createdAt: deps.nowIso(),
        }),
      );
      return;
    }
    if (kind === "user.input") {
      const p = payload as UserInputPayload;
      deps.registry.setPending(p.threadId, { runId: deps.runId, correlationId, kind: "user.input" });
      await deps.recordPending?.({ threadId: p.threadId, correlationId, kind: "user.input" });
      // Tag the escalation message as awaiting the user's answer (with the owning run) so the UI
      // can render it as a guided prompt and route the reply back to this run rather than a
      // free-form chat turn.
      await enqueue(() =>
        deps.dispatch(
          messageUpsert(deps, p.threadId, "system", p.question, {
            author: { kind: "system", workflowRunId: deps.runId },
            status: "waiting-for-input",
            visibleToUser: true,
          }),
        ),
      );
      return;
    }
    // thread.message — one-way; agent-directed messages read as a user turn-input, user-directed
    // ones as a system (user-visible) note. No turn.start, no pending.
    const p = payload as ThreadMessagePayload;
    await enqueueOneWay(() =>
      deps.dispatch(messageUpsert(deps, p.threadId, p.recipient === "agent" ? "user" : "system", p.text)),
    );
  };

  return { send };
}

function messageUpsert(
  deps: WorkflowEngineBrokerDeps,
  threadId: string,
  role: "user" | "system",
  text: string,
  t3workExt?: T3workMessageExt,
): OrchestrationCommand {
  return {
    type: "thread.message.upsert",
    commandId: CommandId.make(`t3work-wf:msg:${deps.newId()}`),
    threadId: ThreadId.make(threadId),
    message: {
      messageId: MessageId.make(deps.newId()),
      role,
      text,
      turnId: null,
      streaming: false,
      ...(t3workExt === undefined ? {} : { t3workExt }),
    },
    createdAt: deps.nowIso(),
  };
}
