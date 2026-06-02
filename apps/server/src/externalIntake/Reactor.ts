import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ExternalIntegrationRepository } from "../persistence/Services/ExternalIntegrations.ts";
import { ExternalChat } from "./ExternalChat.ts";
import { extractGitHubPullRequests } from "./github.ts";
import { postableReplyBody } from "./postableReply.ts";

type AssistantMessageEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;
type ThreadSessionSetEvent = Extract<OrchestrationEvent, { type: "thread.session-set" }>;
type OrchestrationSessionStatus = ThreadSessionSetEvent["payload"]["session"]["status"];

interface AssistantRelayEntry {
  readonly messageId: string;
  readonly text: string;
}

// Tracks the assistant messages emitted within a single turn so we can relay only
// the first and last of them to Slack, mirroring the old Convex orchestrator behavior.
// `thread.message-sent` events arrive as streaming deltas (partial text, accumulated
// per messageId) followed by a `streaming: false` completion marker (empty text), and a
// single turn can contain multiple distinct assistant messages (segments) sharing a turnId.
interface AssistantTurnRelayState {
  readonly threadId: ThreadId;
  readonly turnId: string | null;
  readonly messageTextById: Map<string, string>;
  readonly orderedMessageIds: string[];
  readonly completedMessageIds: Set<string>;
  firstRelay: AssistantRelayEntry | null;
  finalRelay: AssistantRelayEntry | null;
}

function nowIso() {
  return DateTime.formatIso(DateTime.toUtc(DateTime.nowUnsafe()));
}

function normalizedAssistantText(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function relayTurnKey(input: {
  readonly threadId: ThreadId | string;
  readonly turnId: string | null;
  readonly messageId: string;
}) {
  return `${String(input.threadId)}:${input.turnId ?? `message:${input.messageId}`}`;
}

// A turn ends once its session leaves the running/transitional states. We relay the final
// assistant message at that point, regardless of whether the turn completed, was stopped,
// interrupted, or errored, so the last thing the assistant said still reaches Slack.
function isTerminalSessionStatus(status: OrchestrationSessionStatus) {
  return (
    status === "ready" || status === "stopped" || status === "interrupted" || status === "error"
  );
}

function relayEntryForMessage(
  state: AssistantTurnRelayState,
  messageId: string,
): AssistantRelayEntry | null {
  const text = normalizedAssistantText(state.messageTextById.get(messageId) ?? "");
  return text === null ? null : { messageId, text };
}

function lastAssistantMessageEntry(state: AssistantTurnRelayState) {
  const messageId = state.orderedMessageIds.at(-1);
  return messageId === undefined ? null : relayEntryForMessage(state, messageId);
}

// Decides whether the turn's final assistant message should be relayed. Returns false when
// the turn produced only the message already relayed as "first" (same text), so a
// single-message turn is never sent twice. Mirrors the execution bridge's tested predicate.
export function shouldRelayFinalAssistantMessage(input: {
  readonly firstRelay?: AssistantRelayEntry;
  readonly finalRelay?: AssistantRelayEntry;
  readonly finalResponse?: AssistantRelayEntry;
}) {
  if (input.finalResponse === undefined) {
    return false;
  }
  if (input.finalRelay !== undefined) {
    return false;
  }
  if (input.firstRelay === undefined) {
    return true;
  }
  if (input.firstRelay.text === input.finalResponse.text) {
    return false;
  }
  return true;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const repository = yield* ExternalIntegrationRepository;
  const externalChat = yield* ExternalChat;
  const assistantRelayStateByTurn = new Map<string, AssistantTurnRelayState>();

  const recordPullRequests = (input: { readonly threadId: ThreadId; readonly text: string }) =>
    Effect.gen(function* () {
      const now = nowIso();
      for (const pullRequest of extractGitHubPullRequests(input.text)) {
        yield* repository.upsertArtifactLink({
          kind: "github_pr",
          externalId: pullRequest.externalId,
          t3ThreadId: input.threadId,
          url: pullRequest.url,
          metadata: pullRequest,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

  const postAssistantRelayToSlack = (input: {
    readonly threadId: ThreadId;
    readonly turnId: string | null;
    readonly messageId: string;
    readonly text: string;
    readonly phase: "first" | "final";
  }) =>
    Effect.gen(function* () {
      const links = yield* repository.listThreadLinksByThread(input.threadId);
      const now = nowIso();
      for (const link of links) {
        if (link.source !== "slack" || link.muted) continue;
        const deliveryKey = `assistant-message:${input.phase}:${relayTurnKey(input)}:${link.externalThreadId}`;
        const existing = yield* repository.getDeliveryReceipt({
          source: "slack",
          deliveryKey,
        });
        if (Option.isSome(existing) && existing.value.status === "completed") {
          continue;
        }
        const posted = yield* externalChat
          .postToThread({
            source: "slack",
            externalThreadId: link.externalThreadId,
            message: postableReplyBody({
              kind: "slack_thread",
              body: input.text,
            }),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("external intake failed to relay assistant message to Slack", {
                threadId: String(input.threadId),
                messageId: input.messageId,
                externalThreadId: link.externalThreadId,
                phase: input.phase,
                error: error instanceof Error ? error.message : String(error),
              }).pipe(Effect.as(null)),
            ),
          );
        if (posted === null) {
          continue;
        }
        yield* repository.upsertDeliveryReceipt({
          source: "slack",
          deliveryKey,
          status: "completed",
          externalMessageId: posted.externalMessageId,
          metadata: {
            t3ThreadId: String(input.threadId),
            t3MessageId: input.messageId,
            t3TurnId: input.turnId,
            phase: input.phase,
          },
          createdAt: Option.getOrElse(
            Option.map(existing, (receipt) => receipt.createdAt),
            () => now,
          ),
          updatedAt: nowIso(),
        });
      }
    });

  const recordPullRequestsForMessage = (state: AssistantTurnRelayState, messageId: string) =>
    Effect.gen(function* () {
      const text = normalizedAssistantText(state.messageTextById.get(messageId) ?? "");
      if (text === null) {
        return;
      }
      yield* recordPullRequests({ threadId: state.threadId, text });
    });

  // Relays the first assistant message of the turn, once. We wait until that first message is
  // "settled" — its completion marker arrived, a later message started, or the turn ended —
  // so we relay its full text rather than a partial streaming delta.
  const relayFirstAssistantMessage = (
    state: AssistantTurnRelayState,
    options: { readonly force: boolean },
  ) =>
    Effect.gen(function* () {
      if (state.firstRelay !== null) {
        return;
      }
      const firstMessageId = state.orderedMessageIds[0];
      if (firstMessageId === undefined) {
        return;
      }
      const settled =
        options.force ||
        state.completedMessageIds.has(firstMessageId) ||
        state.orderedMessageIds.length >= 2;
      if (!settled) {
        return;
      }
      const entry = relayEntryForMessage(state, firstMessageId);
      if (entry === null) {
        return;
      }
      yield* postAssistantRelayToSlack({
        threadId: state.threadId,
        turnId: state.turnId,
        messageId: entry.messageId,
        text: entry.text,
        phase: "first",
      });
      state.firstRelay = entry;
    });

  const relayFinalAssistantMessage = (state: AssistantTurnRelayState) =>
    Effect.gen(function* () {
      // Ensure the first message was relayed (e.g. a single-message turn that never reached
      // the mid-turn trigger) before deciding on the final one.
      yield* relayFirstAssistantMessage(state, { force: true });
      const finalResponse = lastAssistantMessageEntry(state);
      const shouldRelay = shouldRelayFinalAssistantMessage({
        ...(state.firstRelay !== null ? { firstRelay: state.firstRelay } : {}),
        ...(state.finalRelay !== null ? { finalRelay: state.finalRelay } : {}),
        ...(finalResponse !== null ? { finalResponse } : {}),
      });
      if (!shouldRelay || finalResponse === null) {
        return;
      }
      yield* recordPullRequests({ threadId: state.threadId, text: finalResponse.text });
      yield* postAssistantRelayToSlack({
        threadId: state.threadId,
        turnId: state.turnId,
        messageId: finalResponse.messageId,
        text: finalResponse.text,
        phase: "final",
      });
      state.finalRelay = finalResponse;
    });

  const ingestAssistantMessageEvent = (event: AssistantMessageEvent) =>
    Effect.gen(function* () {
      if (event.payload.role !== "assistant") {
        return;
      }

      const messageId = String(event.payload.messageId);
      const turnId = event.payload.turnId === null ? null : String(event.payload.turnId);
      const key = relayTurnKey({ threadId: event.payload.threadId, turnId, messageId });
      const state =
        assistantRelayStateByTurn.get(key) ??
        ({
          threadId: event.payload.threadId as ThreadId,
          turnId,
          messageTextById: new Map<string, string>(),
          orderedMessageIds: [],
          completedMessageIds: new Set<string>(),
          firstRelay: null,
          finalRelay: null,
        } satisfies AssistantTurnRelayState);
      assistantRelayStateByTurn.set(key, state);

      // Streaming deltas carry partial text that must be accumulated per messageId; the
      // completion marker (streaming: false) carries empty text and only signals "done".
      const text = event.payload.text;
      if (text.length > 0) {
        if (!state.messageTextById.has(messageId)) {
          state.orderedMessageIds.push(messageId);
        }
        state.messageTextById.set(
          messageId,
          `${state.messageTextById.get(messageId) ?? ""}${text}`,
        );
      }
      if (event.payload.streaming === false) {
        state.completedMessageIds.add(messageId);
        // Extract PR links from every completed message (including suppressed intermediates)
        // so artifact tracking is not limited to the first/last relayed messages.
        yield* recordPullRequestsForMessage(state, messageId);
      }

      yield* relayFirstAssistantMessage(state, { force: false });

      // Messages without a turn never receive a turn-ending session-set keyed to them, so we
      // finalize them as their own single-message turn as soon as they complete.
      if (turnId === null && event.payload.streaming === false) {
        yield* relayFinalAssistantMessage(state);
        assistantRelayStateByTurn.delete(key);
      }
    });

  const finalizeAssistantTurnsForThread = (event: ThreadSessionSetEvent) =>
    Effect.gen(function* () {
      if (!isTerminalSessionStatus(event.payload.session.status)) {
        return;
      }
      const threadId = String(event.payload.threadId);
      for (const [key, state] of assistantRelayStateByTurn) {
        if (String(state.threadId) !== threadId) {
          continue;
        }
        yield* relayFinalAssistantMessage(state);
        assistantRelayStateByTurn.delete(key);
      }
    });

  yield* Effect.forkScoped(
    Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
      if (event.type === "thread.session-set") {
        return finalizeAssistantTurnsForThread(event).pipe(
          Effect.catch((error) =>
            Effect.logWarning("external intake reactor failed to finalize Slack assistant relay", {
              eventId: String(event.eventId),
              threadId: String(event.payload.threadId),
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
      }

      if (event.type !== "thread.message-sent" || event.payload.role !== "assistant") {
        return Effect.void;
      }
      return ingestAssistantMessageEvent(event).pipe(
        Effect.catch((error) =>
          Effect.logWarning("external intake reactor failed to process assistant message", {
            eventId: String(event.eventId),
            threadId: String(event.payload.threadId),
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }),
  );
});

export const ExternalIntakeReactorLive = Layer.effectDiscard(make);
