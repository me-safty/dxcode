/**
 * Types and the message-upsert command builder shared by the workflow-engine broker (Epic 25
 * §Host wiring). The broker itself lives in `t3work-workflowEngineBroker.ts`; this module
 * carries the per-run dependency shape, the pending-ask record the registry/durability layer
 * mirrors, and the payload shapes the SDK's thread verbs put on the wire.
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

import type { AskAffordance } from "@t3work/sdk";

import type { T3workWorkflowEngineRegistryShape } from "./t3work-workflowEngineRegistry.ts";

/** The ask a run is parked on, as the broker knows it when it fires (thread + correlation). */
export interface WorkflowEnginePendingAsk {
  readonly threadId: string;
  readonly correlationId: string;
  readonly kind: "thread.turn" | "user.input";
}

/** The timer a run parks on when it fires `waitUntil` (Epic 27): the `waitUntil` correlation
 * the scheduler resolves on fire, plus the wake deadline (epoch millis) it arms a timer for. */
export interface WorkflowEngineSleep {
  readonly correlationId: string;
  readonly deadline: number;
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
  /**
   * Durably record a clock park (status=sleeping + `wake_at` + the `waitUntil` correlation)
   * before the run suspends, so the scheduler finds it on boot (Epic 27). Mirrors
   * {@link recordPending} for the timer wake source. No-op (undefined) on the fs/in-memory path.
   */
  readonly recordSleeping?: (sleep: WorkflowEngineSleep) => Promise<void>;
}

export interface ThreadCreatePayload {
  readonly threadId: string;
  readonly name?: string;
}
export interface ThreadTurnPayload {
  readonly threadId: string;
  readonly prompt: string;
}
export interface ThreadMessagePayload {
  readonly threadId: string;
  readonly recipient: "agent" | "user";
  readonly text: string;
}
export interface UserInputPayload {
  readonly threadId: string;
  readonly question: string;
  /** Serializable descriptor of the reply affordance, derived from the ask's schema by the
   * SDK (`schemaToAffordance`). Absent on payloads from older journals → treated as text. */
  readonly affordance?: AskAffordance;
  /** External-resource refs to render as cards on the decision message. */
  readonly attachments?: ReadonlyArray<unknown>;
}
/** The `wait.until` envelope payload: the wall-clock deadline (epoch millis) the run sleeps to. */
export interface WaitUntilPayload {
  readonly deadline: number;
}

export function messageUpsert(
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
