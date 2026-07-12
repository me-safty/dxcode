import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  ModelSelection,
  NonNegativeInt,
  OrchestrationProposedPlanId,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
  type OrchestrationGetThreadHistoryPageResult,
  type OrchestrationLatestTurn,
  type OrchestrationProposedPlan,
  type OrchestrationSession,
  type ThreadHistoryCursor,
  type ThreadWindowMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import {
  THREAD_SYNC_TAIL_ACTIVITY_LIMIT,
  THREAD_SYNC_TAIL_MESSAGE_LIMIT,
  ThreadSyncQuery,
  type ThreadSyncQueryShape,
} from "../Services/ThreadSyncQuery.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";

const ThreadLookup = Schema.Struct({ threadId: ThreadId });
const PageLookup = Schema.Struct({
  threadId: ThreadId,
  beforeCreatedAt: Schema.NullOr(IsoDateTime),
  beforeId: Schema.NullOr(Schema.String),
  limit: NonNegativeInt,
});
const ProjectionThreadDbRow = ProjectionThread.mapFields(
  Struct.assign({ modelSelection: Schema.fromJsonString(ModelSelection) }),
);
const ProjectionMessageDbRow = ProjectionThreadMessage.mapFields(
  Struct.assign({
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
    isStreaming: Schema.Number,
  }),
);
const ProjectionActivityDbRow = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionLatestTurnRow = Schema.Struct({
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const CountsRow = Schema.Struct({
  messages: NonNegativeInt,
  activities: NonNegativeInt,
});
const SequenceRow = Schema.Struct({ value: NonNegativeInt });
const ProjectionSessionRow = ProjectionThreadSession;
const ProjectionPlanRow = ProjectionThreadProposedPlan;

function mapError(operation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(`${operation}:decode`)(cause)
      : toPersistenceSqlError(`${operation}:query`)(cause);
}

function mapMessage(row: typeof ProjectionMessageDbRow.Type): ThreadWindowMessage {
  return {
    id: row.messageId,
    role: row.role,
    text: row.text,
    ...(row.attachments !== null ? { attachments: row.attachments } : {}),
    turnId: row.turnId,
    streaming: row.isStreaming === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapActivity(row: typeof ProjectionActivityDbRow.Type): OrchestrationThreadActivity {
  return {
    id: row.activityId,
    tone: row.tone,
    kind: row.kind,
    summary: row.summary,
    payload: row.payload,
    turnId: row.turnId,
    ...(row.sequence !== null ? { sequence: row.sequence } : {}),
    createdAt: row.createdAt,
  };
}

function mapLatestTurn(row: typeof ProjectionLatestTurnRow.Type): OrchestrationLatestTurn {
  return {
    turnId: row.turnId,
    state:
      row.state === "error"
        ? "error"
        : row.state === "interrupted"
          ? "interrupted"
          : row.state === "completed"
            ? "completed"
            : "running",
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    assistantMessageId: row.assistantMessageId,
    ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
      ? {
          sourceProposedPlan: {
            threadId: row.sourceProposedPlanThreadId,
            planId: row.sourceProposedPlanId,
          },
        }
      : {}),
  };
}

function mapSession(row: typeof ProjectionSessionRow.Type): OrchestrationSession {
  return {
    threadId: row.threadId,
    status: row.status,
    providerName: row.providerName,
    ...(row.providerInstanceId !== null ? { providerInstanceId: row.providerInstanceId } : {}),
    runtimeMode: row.runtimeMode,
    activeTurnId: row.activeTurnId,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

function mapPlan(row: typeof ProjectionPlanRow.Type): OrchestrationProposedPlan {
  return {
    id: row.planId,
    turnId: row.turnId,
    planMarkdown: row.planMarkdown,
    implementedAt: row.implementedAt,
    implementationThreadId: row.implementationThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cursors(
  messages: ReadonlyArray<ThreadWindowMessage>,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  fallback: ThreadHistoryCursor = { message: null, activity: null },
): ThreadHistoryCursor {
  const message = messages[0];
  const activity = activities[0];
  return {
    message:
      message === undefined
        ? fallback.message
        : { createdAt: message.createdAt, messageId: message.id },
    activity:
      activity === undefined
        ? fallback.activity
        : { createdAt: activity.createdAt, activityId: activity.id },
  };
}

const makeThreadSyncQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getThread = SqlSchema.findOneOption({
    Request: ThreadLookup,
    Result: ProjectionThreadDbRow,
    execute: ({ threadId }) => sql`
      SELECT thread_id AS "threadId", project_id AS "projectId", title,
        model_selection_json AS "modelSelection", runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode", branch, worktree_path AS "worktreePath",
        latest_turn_id AS "latestTurnId", created_at AS "createdAt", updated_at AS "updatedAt",
        archived_at AS "archivedAt", latest_user_message_at AS "latestUserMessageAt",
        pending_approval_count AS "pendingApprovalCount",
        pending_user_input_count AS "pendingUserInputCount",
        has_actionable_proposed_plan AS "hasActionableProposedPlan", deleted_at AS "deletedAt"
      FROM projection_threads
      WHERE thread_id = ${threadId} AND deleted_at IS NULL
      LIMIT 1
    `,
  });
  const getLatestTurn = SqlSchema.findOneOption({
    Request: ThreadLookup,
    Result: ProjectionLatestTurnRow,
    execute: ({ threadId }) => sql`
      SELECT turns.turn_id AS "turnId", turns.state, turns.requested_at AS "requestedAt",
        turns.started_at AS "startedAt", turns.completed_at AS "completedAt",
        turns.assistant_message_id AS "assistantMessageId",
        turns.source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
        turns.source_proposed_plan_id AS "sourceProposedPlanId"
      FROM projection_threads threads
      JOIN projection_turns turns ON turns.thread_id = threads.thread_id
        AND turns.turn_id = threads.latest_turn_id
      WHERE threads.thread_id = ${threadId}
      LIMIT 1
    `,
  });
  const getSession = SqlSchema.findOneOption({
    Request: ThreadLookup,
    Result: ProjectionSessionRow,
    execute: ({ threadId }) => sql`
      SELECT thread_id AS "threadId", status, provider_name AS "providerName",
        provider_instance_id AS "providerInstanceId", runtime_mode AS "runtimeMode",
        active_turn_id AS "activeTurnId", last_error AS "lastError", updated_at AS "updatedAt"
      FROM projection_thread_sessions WHERE thread_id = ${threadId} LIMIT 1
    `,
  });
  const getActivePlan = SqlSchema.findOneOption({
    Request: ThreadLookup,
    Result: ProjectionPlanRow,
    execute: ({ threadId }) => sql`
      SELECT plan_id AS "planId", thread_id AS "threadId", turn_id AS "turnId",
        plan_markdown AS "planMarkdown", implemented_at AS "implementedAt",
        implementation_thread_id AS "implementationThreadId", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_thread_proposed_plans
      WHERE thread_id = ${threadId} AND implemented_at IS NULL
      ORDER BY updated_at DESC, plan_id DESC LIMIT 1
    `,
  });
  const getCounts = SqlSchema.findOne({
    Request: ThreadLookup,
    Result: CountsRow,
    execute: ({ threadId }) => sql`
      SELECT
        (SELECT COUNT(*) FROM projection_thread_messages WHERE thread_id = ${threadId}) AS messages,
        (SELECT COUNT(*) FROM projection_thread_activities WHERE thread_id = ${threadId}) AS activities
    `,
  });
  const getWatermark = SqlSchema.findOne({
    Request: Schema.Void,
    Result: SequenceRow,
    execute: () => sql`
      SELECT MIN(
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threads}), 0),
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}), 0),
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadActivities}), 0),
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadSessions}), 0),
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans}), 0),
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.threadTurns}), 0),
        COALESCE((SELECT last_applied_sequence FROM projection_state
          WHERE projector = ${ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals}), 0)
      ) AS value
    `,
  });
  const getHistoryEpoch = SqlSchema.findOne({
    Request: ThreadLookup,
    Result: SequenceRow,
    execute: ({ threadId }) => sql`
      SELECT COALESCE(MAX(sequence), 0) AS value
      FROM orchestration_events
      WHERE aggregate_kind = 'thread' AND stream_id = ${threadId} AND event_type = 'thread.reverted'
    `,
  });
  const listTailMessages = SqlSchema.findAll({
    Request: ThreadLookup,
    Result: ProjectionMessageDbRow,
    execute: ({ threadId }) => sql`
      SELECT message_id AS "messageId", thread_id AS "threadId", turn_id AS "turnId", role, text,
        attachments_json AS attachments, is_streaming AS "isStreaming",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_thread_messages WHERE thread_id = ${threadId}
      ORDER BY created_at DESC, message_id DESC LIMIT ${THREAD_SYNC_TAIL_MESSAGE_LIMIT}
    `,
  });
  const listTailActivities = SqlSchema.findAll({
    Request: ThreadLookup,
    Result: ProjectionActivityDbRow,
    execute: ({ threadId }) => sql`
      SELECT activity_id AS "activityId", thread_id AS "threadId", turn_id AS "turnId", tone,
        kind, summary, payload_json AS payload, sequence, created_at AS "createdAt"
      FROM projection_thread_activities WHERE thread_id = ${threadId}
      ORDER BY created_at DESC, activity_id DESC LIMIT ${THREAD_SYNC_TAIL_ACTIVITY_LIMIT}
    `,
  });
  const listPendingRequests = SqlSchema.findAll({
    Request: ThreadLookup,
    Result: ProjectionActivityDbRow,
    execute: ({ threadId }) => sql`
      WITH latest_user_input AS (
        SELECT activity_id, kind FROM (
          SELECT activity_id, kind,
            ROW_NUMBER() OVER (
              PARTITION BY json_extract(payload_json, '$.requestId')
              ORDER BY created_at DESC, activity_id DESC
            ) AS row_number
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
            AND json_extract(payload_json, '$.requestId') IS NOT NULL
            AND kind IN ('user-input.requested', 'user-input.resolved', 'provider.user-input.respond.failed')
        ) WHERE row_number = 1
      )
      SELECT activity.activity_id AS "activityId", activity.thread_id AS "threadId",
        activity.turn_id AS "turnId", activity.tone, activity.kind, activity.summary,
        activity.payload_json AS payload, activity.sequence, activity.created_at AS "createdAt"
      FROM projection_thread_activities activity
      WHERE activity.thread_id = ${threadId}
        AND (
          (activity.kind = 'approval.requested' AND EXISTS (
            SELECT 1 FROM projection_pending_approvals pending
            WHERE pending.thread_id = activity.thread_id AND pending.status = 'pending'
              AND pending.request_id = json_extract(activity.payload_json, '$.requestId')
          ))
          OR activity.activity_id IN (
            SELECT activity_id FROM latest_user_input WHERE kind = 'user-input.requested'
          )
        )
      ORDER BY activity.created_at ASC, activity.activity_id ASC
    `,
  });
  const listMessagePage = SqlSchema.findAll({
    Request: PageLookup,
    Result: ProjectionMessageDbRow,
    execute: ({ threadId, beforeCreatedAt, beforeId, limit }) => sql`
      SELECT message_id AS "messageId", thread_id AS "threadId", turn_id AS "turnId", role, text,
        attachments_json AS attachments, is_streaming AS "isStreaming",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND ${beforeCreatedAt} IS NOT NULL AND (
        created_at < ${beforeCreatedAt}
        OR (created_at = ${beforeCreatedAt} AND message_id < ${beforeId})
      )
      ORDER BY created_at DESC, message_id DESC LIMIT ${limit}
    `,
  });
  const listActivityPage = SqlSchema.findAll({
    Request: PageLookup,
    Result: ProjectionActivityDbRow,
    execute: ({ threadId, beforeCreatedAt, beforeId, limit }) => sql`
      SELECT activity_id AS "activityId", thread_id AS "threadId", turn_id AS "turnId", tone,
        kind, summary, payload_json AS payload, sequence, created_at AS "createdAt"
      FROM projection_thread_activities
      WHERE thread_id = ${threadId} AND ${beforeCreatedAt} IS NOT NULL AND (
        created_at < ${beforeCreatedAt}
        OR (created_at = ${beforeCreatedAt} AND activity_id < ${beforeId})
      )
      ORDER BY created_at DESC, activity_id DESC LIMIT ${limit}
    `,
  });

  const getTail: ThreadSyncQueryShape["getTail"] = (threadId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            thread,
            latestTurn,
            session,
            activePlan,
            counts,
            watermark,
            epoch,
            messageRows,
            activityRows,
            pendingRows,
          ] = yield* Effect.all([
            getThread({ threadId }),
            getLatestTurn({ threadId }),
            getSession({ threadId }),
            getActivePlan({ threadId }),
            getCounts({ threadId }),
            getWatermark(undefined),
            getHistoryEpoch({ threadId }),
            listTailMessages({ threadId }),
            listTailActivities({ threadId }),
            listPendingRequests({ threadId }),
          ]);
          if (Option.isNone(thread)) return Option.none();
          const messages = messageRows.toReversed().map(mapMessage);
          const tailActivities = activityRows.toReversed().map(mapActivity);
          return Option.some({
            watermark: watermark.value,
            historyEpoch: epoch.value,
            head: {
              id: thread.value.threadId,
              projectId: thread.value.projectId,
              title: thread.value.title,
              modelSelection: thread.value.modelSelection,
              runtimeMode: thread.value.runtimeMode,
              interactionMode: thread.value.interactionMode,
              branch: thread.value.branch,
              worktreePath: thread.value.worktreePath,
              latestTurn: Option.isSome(latestTurn) ? mapLatestTurn(latestTurn.value) : null,
              createdAt: thread.value.createdAt,
              updatedAt: thread.value.updatedAt,
              archivedAt: thread.value.archivedAt,
              deletedAt: thread.value.deletedAt,
              session: Option.isSome(session) ? mapSession(session.value) : null,
              activeProposedPlan: Option.isSome(activePlan) ? mapPlan(activePlan.value) : null,
              pendingRequests: pendingRows.map(mapActivity),
              counts,
            },
            messages,
            activities: tailActivities,
            before: cursors(messages, tailActivities),
            hasOlderMessages: counts.messages > messages.length,
            hasOlderActivities: counts.activities > tailActivities.length,
          });
        }),
      )
      .pipe(Effect.mapError(mapError("ThreadSyncQuery.getTail")));

  const getHistoryPage: ThreadSyncQueryShape["getHistoryPage"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const epoch = yield* getHistoryEpoch({ threadId: input.threadId });
          if (epoch.value !== input.historyEpoch) {
            return { currentHistoryEpoch: epoch.value, page: null };
          }
          const messageLimit = Math.min(Math.max(input.messageLimit, 1), 64);
          const activityLimit = Math.min(Math.max(input.activityLimit, 1), 256);
          const [messageRows, activityRows] = yield* Effect.all([
            listMessagePage({
              threadId: input.threadId,
              beforeCreatedAt: input.before.message?.createdAt ?? null,
              beforeId: input.before.message?.messageId ?? null,
              limit: messageLimit + 1,
            }),
            listActivityPage({
              threadId: input.threadId,
              beforeCreatedAt: input.before.activity?.createdAt ?? null,
              beforeId: input.before.activity?.activityId ?? null,
              limit: activityLimit + 1,
            }),
          ]);
          const hasOlderMessages = messageRows.length > messageLimit;
          const hasOlderActivities = activityRows.length > activityLimit;
          const messages = messageRows.slice(0, messageLimit).toReversed().map(mapMessage);
          const activities = activityRows.slice(0, activityLimit).toReversed().map(mapActivity);
          const page: OrchestrationGetThreadHistoryPageResult = {
            historyEpoch: epoch.value,
            messages,
            activities,
            before: cursors(messages, activities, input.before),
            hasOlderMessages,
            hasOlderActivities,
          };
          return { currentHistoryEpoch: epoch.value, page };
        }),
      )
      .pipe(Effect.mapError(mapError("ThreadSyncQuery.getHistoryPage")));

  return ThreadSyncQuery.of({ getTail, getHistoryPage });
});

export const ThreadSyncQueryLive = Layer.effect(ThreadSyncQuery, makeThreadSyncQuery);
