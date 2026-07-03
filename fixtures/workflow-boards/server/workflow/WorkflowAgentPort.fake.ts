import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadStreamItem,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import type {
  AgentsCapability,
  AgentsAwaitTurnResult,
  AgentsStartTurnResult,
  ProjectionsReadCapability,
  ProjectionTurnRecord,
} from "@t3tools/plugin-sdk";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  WorkflowAgentsCapability,
  WorkflowProjectionsReadCapability,
} from "./Services/WorkflowAgentPort.ts";

type TerminalState = "completed" | "error" | "interrupted";

interface FakeTurn {
  readonly threadId: ThreadId;
  readonly sessionTurnId: TurnId;
  readonly projectionTurnId: TurnId;
  readonly pendingMessageId: MessageId;
  state: "pending" | "running" | TerminalState;
  assistantMessageId: MessageId | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const nowIso = () => "2026-07-03T00:00:00.000Z";

const toTurnRecord = (turn: FakeTurn): ProjectionTurnRecord => ({
  threadId: turn.threadId,
  turnId: turn.projectionTurnId,
  pendingMessageId: turn.pendingMessageId,
  sourceProposedPlanThreadId: null,
  sourceProposedPlanId: null,
  assistantMessageId: turn.assistantMessageId,
  state: turn.state,
  requestedAt: turn.requestedAt,
  startedAt: turn.startedAt,
  completedAt: turn.completedAt,
  checkpointTurnCount: null,
  checkpointRef: null,
  checkpointStatus: null,
  checkpointFiles: [],
});

export interface WorkflowAgentPortFakeControl {
  readonly startCommandCount: () => number;
  readonly startTurnCallCount: () => number;
  readonly interruptCalls: () => ReadonlyArray<ThreadId>;
  readonly stopCalls: () => ReadonlyArray<ThreadId>;
  readonly deleteCalls: () => ReadonlyArray<ThreadId>;
  readonly approvalResponses: () => ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly requestId: string;
    readonly decision: string;
  }>;
  readonly userInputResponses: () => ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly requestId: string;
    readonly answers: Record<string, unknown>;
  }>;
  readonly seedStartedTurn: (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly commandId?: CommandId | undefined;
    readonly state?: "pending" | "running" | TerminalState | undefined;
  }) => AgentsStartTurnResult;
  readonly completeTurn: (input: {
    readonly messageId: MessageId;
    readonly text: string;
    readonly state?: TerminalState | undefined;
  }) => MessageId;
  readonly completeTurnAfterListTurnsReads: (
    input: {
      readonly messageId: MessageId;
      readonly text: string;
      readonly state?: TerminalState | undefined;
    },
    afterReads: number,
  ) => void;
  readonly addAssistantMessage: (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly text: string;
    readonly messageId?: MessageId | undefined;
  }) => MessageId;
  readonly appendActivity: (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly payload: unknown;
    readonly createdAt?: string | undefined;
  }) => OrchestrationThreadActivity;
  readonly turnByMessageId: (messageId: MessageId) => ProjectionTurnRecord | null;
  readonly setAwaitTurnDelay: (delay: Duration.Input | null) => void;
  readonly failActivityReads: (error: Error | null) => void;
}

export interface WorkflowAgentPortFake {
  readonly agents: AgentsCapability;
  readonly projectionsRead: ProjectionsReadCapability;
  readonly layer: Layer.Layer<WorkflowAgentsCapability | WorkflowProjectionsReadCapability>;
  readonly control: WorkflowAgentPortFakeControl;
}

export const makeWorkflowAgentPortFake = (): WorkflowAgentPortFake => {
  let sequence = 0;
  let startCommands = 0;
  let startCalls = 0;
  const commandReceipts = new Map<string, AgentsStartTurnResult>();
  const threads = new Set<string>();
  const turns: FakeTurn[] = [];
  const messages: OrchestrationMessage[] = [];
  const activityRows: Array<{
    readonly threadId: ThreadId;
    readonly activity: OrchestrationThreadActivity;
  }> = [];
  const interrupts: ThreadId[] = [];
  const stops: ThreadId[] = [];
  const deletes: ThreadId[] = [];
  const approvalResponses: Array<{
    readonly threadId: ThreadId;
    readonly requestId: string;
    readonly decision: string;
  }> = [];
  const userInputResponses: Array<{
    readonly threadId: ThreadId;
    readonly requestId: string;
    readonly answers: Record<string, unknown>;
  }> = [];
  let awaitTurnDelay: Duration.Input | null = null;
  let activityReadError: Error | null = null;
  let listTurnsReadCount = 0;
  let completeAfterListTurnsReads: {
    readonly afterReads: number;
    readonly input: {
      readonly messageId: MessageId;
      readonly text: string;
      readonly state?: TerminalState | undefined;
    };
  } | null = null;

  const next = (prefix: string) => `${prefix}-${++sequence}`;
  const threadEvent = (threadId: ThreadId | "fake"): OrchestrationThreadStreamItem =>
    ({
      kind: "event",
      event: {
        id: EventId.make(next("thread-event")),
        aggregateKind: "thread",
        aggregateId: String(threadId),
        eventType: "fake.thread.changed",
        payload: {},
        createdAt: nowIso(),
      },
    }) as unknown as OrchestrationThreadStreamItem;
  const createTurn = (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly commandId?: CommandId | undefined;
    readonly state?: "pending" | "running" | TerminalState | undefined;
  }): AgentsStartTurnResult => {
    const commandKey = String(input.commandId ?? CommandId.make(next("cmd")));
    const existing = commandReceipts.get(commandKey);
    if (existing) {
      return existing;
    }
    threads.add(String(input.threadId));
    startCommands += 1;
    const sessionTurnId = TurnId.make(next("session-turn"));
    const projectionTurnId = TurnId.make(next("turn"));
    const now = nowIso();
    turns.push({
      threadId: input.threadId,
      sessionTurnId,
      projectionTurnId,
      pendingMessageId: input.messageId,
      state: input.state ?? "running",
      assistantMessageId: null,
      requestedAt: now,
      startedAt: now,
      completedAt:
        input.state === "completed" || input.state === "error" || input.state === "interrupted"
          ? now
          : null,
    });
    const result = { turnId: sessionTurnId, messageId: input.messageId };
    commandReceipts.set(commandKey, result);
    return result;
  };

  const control: WorkflowAgentPortFakeControl = {
    startCommandCount: () => startCommands,
    startTurnCallCount: () => startCalls,
    interruptCalls: () => [...interrupts],
    stopCalls: () => [...stops],
    deleteCalls: () => [...deletes],
    approvalResponses: () => [...approvalResponses],
    userInputResponses: () => [...userInputResponses],
    seedStartedTurn: createTurn,
    completeTurn: ({ messageId, text, state = "completed" }) => {
      const turn = turns.find((turn) => turn.pendingMessageId === messageId);
      if (!turn) {
        throw new Error(`No fake turn for message ${String(messageId)}`);
      }
      turn.state = state;
      turn.completedAt = nowIso();
      const assistantMessageId = MessageId.make(next("assistant-message"));
      turn.assistantMessageId = assistantMessageId;
      messages.push({
        id: assistantMessageId,
        role: "assistant",
        text,
        turnId: turn.projectionTurnId,
        streaming: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      return assistantMessageId;
    },
    completeTurnAfterListTurnsReads: (input, afterReads) => {
      completeAfterListTurnsReads = { input, afterReads };
    },
    addAssistantMessage: ({ threadId, turnId, text, messageId }) => {
      const id = messageId ?? MessageId.make(next("assistant-message"));
      messages.push({
        id,
        role: "assistant",
        text,
        turnId,
        streaming: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      threads.add(String(threadId));
      return id;
    },
    appendActivity: ({ threadId, kind, payload, createdAt }) => {
      threads.add(String(threadId));
      const tone: OrchestrationThreadActivity["tone"] = kind.includes("approval")
        ? "approval"
        : kind.includes("failed")
          ? "error"
          : "info";
      const activity = {
        id: EventId.make(next("activity")),
        tone,
        kind,
        summary: kind,
        payload,
        turnId: null,
        createdAt: createdAt ?? nowIso(),
      } satisfies OrchestrationThreadActivity;
      activityRows.push({ threadId, activity });
      return activity;
    },
    turnByMessageId: (messageId) => {
      const turn = turns.find((turn) => turn.pendingMessageId === messageId);
      return turn ? toTurnRecord(turn) : null;
    },
    setAwaitTurnDelay: (delay) => {
      awaitTurnDelay = delay;
    },
    failActivityReads: (error) => {
      activityReadError = error;
    },
  };

  const agents: AgentsCapability = {
    listInstances: () => Effect.succeed({ available: [], unavailable: [] }),
    createThread: () =>
      Effect.sync(() => {
        const threadId = ThreadId.make(next("thread"));
        threads.add(String(threadId));
        return { threadId };
      }),
    startTurn: (input) =>
      Effect.sync(() => {
        startCalls += 1;
        return createTurn({
          threadId: input.threadId,
          messageId: input.messageId ?? MessageId.make(next("message")),
          commandId: input.commandId,
        });
      }),
    observeThread: (threadId) =>
      Stream.make(threadEvent(threadId)).pipe(
        Stream.concat(
          Stream.fromEffect(Effect.sleep("10 millis").pipe(Effect.as(threadEvent(threadId)))).pipe(
            Stream.forever,
          ),
        ),
      ),
    awaitTurn: (input) => {
      const wait: Effect.Effect<AgentsAwaitTurnResult, Error> = Effect.gen(function* () {
        const turn = turns.find(
          (turn) => turn.threadId === input.threadId && turn.sessionTurnId === input.turnId,
        );
        if (!turn) {
          return yield* Effect.die(new Error(`No fake turn ${String(input.turnId)}`));
        }
        if (turn.state === "running" || turn.state === "pending") {
          return yield* Effect.never as Effect.Effect<AgentsAwaitTurnResult, Error>;
        }
        if (awaitTurnDelay !== null) {
          yield* Effect.sleep(awaitTurnDelay);
        }
        const assistantText =
          turn.assistantMessageId === null
            ? null
            : (messages.find((message) => message.id === turn.assistantMessageId)?.text ?? null);
        return {
          state: turn.state,
          assistantText,
        };
      });
      return wait;
    },
    listPendingRequests: (threadId) =>
      Effect.succeed(
        activityRows
          .filter(
            (row) =>
              row.threadId === threadId &&
              (row.activity.kind === "approval.requested" ||
                row.activity.kind === "user-input.requested"),
          )
          .map((row) => ({
            kind: row.activity.kind as "approval.requested" | "user-input.requested",
            requestId:
              typeof row.activity.payload === "object" &&
              row.activity.payload !== null &&
              "requestId" in row.activity.payload
                ? String((row.activity.payload as { requestId: unknown }).requestId)
                : "",
            activity: row.activity,
          })),
      ),
    respondToApproval: (input) =>
      Effect.sync(() => {
        approvalResponses.push({
          threadId: input.threadId,
          requestId: input.requestId,
          decision: input.decision,
        });
      }),
    respondToUserInput: (input) =>
      Effect.sync(() => {
        userInputResponses.push({
          threadId: input.threadId,
          requestId: input.requestId,
          answers: input.answers as Record<string, unknown>,
        });
      }),
    interruptTurn: ({ threadId }) =>
      Effect.sync(() => {
        interrupts.push(threadId);
      }),
    stopSession: ({ threadId }) =>
      Effect.sync(() => {
        stops.push(threadId);
      }),
    deleteThread: ({ threadId }) =>
      Effect.sync(() => {
        deletes.push(threadId);
        threads.delete(String(threadId));
      }),
  };

  const projectionsRead: ProjectionsReadCapability = {
    getThreadShellById: () => Effect.succeed(null),
    getThreadDetailById: () => Effect.succeed(null),
    listTurnsByThreadId: ({ threadId, limit }) =>
      Effect.sync(() => {
        listTurnsReadCount += 1;
        if (
          completeAfterListTurnsReads !== null &&
          listTurnsReadCount >= completeAfterListTurnsReads.afterReads
        ) {
          const scheduled = completeAfterListTurnsReads;
          completeAfterListTurnsReads = null;
          control.completeTurn(scheduled.input);
        }
        return turns
          .filter((turn) => turn.threadId === threadId)
          .map(toTurnRecord)
          .slice(0, limit ?? 2_000);
      }),
    listMessagesByThreadId: ({ threadId, limit }) =>
      Effect.succeed(
        messages
          .filter((message) => {
            const turn = turns.find((turn) => turn.projectionTurnId === message.turnId);
            return turn?.threadId === threadId;
          })
          .slice(0, limit ?? 2_000),
      ),
    getMessageById: (messageId) =>
      Effect.succeed(messages.find((message) => message.id === messageId) ?? null),
    listActivitiesByThreadId: ({ threadId, limit }) =>
      activityReadError
        ? Effect.fail(activityReadError)
        : Effect.succeed(
            activityRows
              .filter((row) => row.threadId === threadId)
              .map((row) => row.activity)
              .slice(0, limit ?? 2_000),
          ),
  };

  return {
    agents,
    projectionsRead,
    control,
    layer: Layer.mergeAll(
      Layer.succeed(WorkflowAgentsCapability, agents),
      Layer.succeed(WorkflowProjectionsReadCapability, projectionsRead),
    ),
  };
};
