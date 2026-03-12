/**
 * MessageFeedbackRepository - Persistence interface for RLHF message feedback.
 *
 * Stores feedback metadata outside the event log for fast lookup and analytics.
 */
import {
  IsoDateTime,
  MessageId,
  OrchestrationMessageFeedbackRating,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const MessageFeedback = Schema.Struct({
  messageId: MessageId,
  rating: Schema.NullOr(OrchestrationMessageFeedbackRating),
  note: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MessageFeedback = typeof MessageFeedback.Type;

export const MessageFeedbackByMessageIdInput = Schema.Struct({
  messageId: MessageId,
});
export type MessageFeedbackByMessageIdInput = typeof MessageFeedbackByMessageIdInput.Type;

export interface MessageFeedbackRepositoryShape {
  readonly upsert: (feedback: MessageFeedback) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByMessageId: (
    input: MessageFeedbackByMessageIdInput,
  ) => Effect.Effect<MessageFeedback | null, ProjectionRepositoryError>;
  readonly deleteByMessageId: (
    input: MessageFeedbackByMessageIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class MessageFeedbackRepository extends ServiceMap.Service<
  MessageFeedbackRepository,
  MessageFeedbackRepositoryShape
>()("t3/persistence/Services/MessageFeedback/MessageFeedbackRepository") {}
