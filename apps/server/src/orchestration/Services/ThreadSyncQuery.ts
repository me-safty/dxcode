import type {
  OrchestrationGetThreadHistoryPageInput,
  OrchestrationGetThreadHistoryPageResult,
  OrchestrationThreadActivity,
  ThreadHead,
  ThreadHistoryCursor,
  ThreadId,
  ThreadWindowMessage,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export const THREAD_SYNC_TAIL_MESSAGE_LIMIT = 32;
export const THREAD_SYNC_TAIL_ACTIVITY_LIMIT = 128;

export interface ThreadSyncTail {
  readonly watermark: number;
  readonly historyEpoch: number;
  readonly head: ThreadHead;
  readonly messages: ReadonlyArray<ThreadWindowMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly before: ThreadHistoryCursor;
  readonly hasOlderMessages: boolean;
  readonly hasOlderActivities: boolean;
}

export interface ThreadHistoryPageQueryResult {
  readonly currentHistoryEpoch: number;
  readonly page: OrchestrationGetThreadHistoryPageResult | null;
}

export interface ThreadSyncQueryShape {
  readonly getTail: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ThreadSyncTail>, ProjectionRepositoryError>;
  readonly getHistoryPage: (
    input: OrchestrationGetThreadHistoryPageInput,
  ) => Effect.Effect<ThreadHistoryPageQueryResult, ProjectionRepositoryError>;
}

export class ThreadSyncQuery extends Context.Service<ThreadSyncQuery, ThreadSyncQueryShape>()(
  "t3/orchestration/Services/ThreadSyncQuery",
) {}
