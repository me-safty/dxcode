import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import { TrimmedNonEmptyString } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  MessageFeedback,
  MessageFeedbackByMessageIdInput,
  MessageFeedbackRepository,
  type MessageFeedbackRepositoryShape,
} from "../Services/MessageFeedback.ts";

const MessageFeedbackDbRowSchema = MessageFeedback.mapFields(
  Struct.assign({
    note: Schema.NullOr(TrimmedNonEmptyString),
  }),
);

const makeMessageFeedbackRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertFeedbackRow = SqlSchema.void({
    Request: MessageFeedback,
    execute: (row) =>
      sql`
        INSERT INTO rlhf_message_feedback (
          message_id,
          rating,
          note,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.rating},
          ${row.note ?? null},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (message_id)
        DO UPDATE SET
          rating = excluded.rating,
          note = excluded.note,
          updated_at = excluded.updated_at
      `,
  });

  const getFeedbackRow = SqlSchema.findOneOption({
    Request: MessageFeedbackByMessageIdInput,
    Result: MessageFeedbackDbRowSchema,
    execute: ({ messageId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          rating,
          note,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM rlhf_message_feedback
        WHERE message_id = ${messageId}
      `,
  });

  const deleteFeedbackRow = SqlSchema.void({
    Request: MessageFeedbackByMessageIdInput,
    execute: ({ messageId }) =>
      sql`
        DELETE FROM rlhf_message_feedback
        WHERE message_id = ${messageId}
      `,
  });

  const upsert: MessageFeedbackRepositoryShape["upsert"] = (row) =>
    upsertFeedbackRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("MessageFeedbackRepository.upsert:query")),
    );

  const getByMessageId: MessageFeedbackRepositoryShape["getByMessageId"] = (input) =>
    getFeedbackRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("MessageFeedbackRepository.getByMessageId:query")),
      Effect.map((rowOption) =>
        Option.match(rowOption, {
          onNone: () => null,
          onSome: (row) => ({
            messageId: row.messageId,
            rating: row.rating,
            ...(row.note !== null ? { note: row.note } : {}),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }),
        }),
      ),
    );

  const deleteByMessageId: MessageFeedbackRepositoryShape["deleteByMessageId"] = (input) =>
    deleteFeedbackRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("MessageFeedbackRepository.deleteByMessageId:query")),
    );

  return { upsert, getByMessageId, deleteByMessageId };
});

export const MessageFeedbackRepositoryLive = Layer.effect(
  MessageFeedbackRepository,
  makeMessageFeedbackRepository,
);
