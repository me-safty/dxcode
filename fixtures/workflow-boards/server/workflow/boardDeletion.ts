import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import type { BoardId } from "../../contracts/workflow.ts";
import type { BoardRegistryShape } from "./Services/BoardRegistry.ts";
import type { WorkflowAgentPortShape } from "./Services/WorkflowAgentPort.ts";
import type { WorkflowAgentSessionStoreShape } from "./Services/WorkflowAgentSessionStore.ts";
import type { WorkflowBoardVersionStoreShape } from "./Services/WorkflowBoardVersionStore.ts";
import type { WorkflowEngineShape } from "./Services/WorkflowEngine.ts";
import type { WorkflowEventStoreShape } from "./Services/WorkflowEventStore.ts";
import type { WorkflowReadModelShape } from "./Services/WorkflowReadModel.ts";
import type { WorkflowWebhookShape } from "./Services/WorkflowWebhook.ts";
import type { WorkflowWorktreeJanitorShape } from "./Services/WorkflowWorktreeJanitor.ts";

export interface WorkflowBoardOwnedStateDeletionDeps {
  readonly boardRegistry: Pick<BoardRegistryShape, "unregister">;
  readonly engine: Pick<WorkflowEngineShape, "cancelBoardPipelines">;
  readonly eventStore: Pick<WorkflowEventStoreShape, "deleteForBoard">;
  readonly readModel: Pick<WorkflowReadModelShape, "deleteBoard" | "deleteBoardTicketState">;
  readonly versionStore: Pick<WorkflowBoardVersionStoreShape, "deleteForBoard">;
  readonly sql: Pick<SqlClient.SqlClient, "withTransaction">;
  readonly worktreeJanitor?: Pick<WorkflowWorktreeJanitorShape, "collectBoardPlan" | "run">;
  readonly webhook?: Pick<WorkflowWebhookShape, "deleteForBoard">;
  readonly agentSessions?: Pick<WorkflowAgentSessionStoreShape, "listByBoard" | "deleteByBoard">;
  readonly agentPort?: Pick<WorkflowAgentPortShape, "cleanupSession">;
}

const noCleanup = Effect.succeed(null);

export const deleteWorkflowBoardOwnedState = (
  deps: WorkflowBoardOwnedStateDeletionDeps,
  boardId: BoardId,
) =>
  Effect.gen(function* () {
    const cleanupPlan = yield* deps.worktreeJanitor?.collectBoardPlan(boardId) ?? noCleanup;
    const agentSessionRows: ReadonlyArray<{ readonly threadId: string }> =
      deps.agentSessions === undefined
        ? []
        : yield* deps.agentSessions.listByBoard(boardId).pipe(Effect.orElseSucceed(() => []));
    yield* deps.engine.cancelBoardPipelines(boardId);
    yield* deps.sql.withTransaction(
      Effect.gen(function* () {
        yield* deps.webhook?.deleteForBoard(boardId) ?? Effect.void;
        yield* deps.versionStore.deleteForBoard(boardId);
        yield* deps.agentSessions?.deleteByBoard(boardId) ?? Effect.void;
        yield* deps.eventStore.deleteForBoard(boardId);
        yield* deps.readModel.deleteBoardTicketState(boardId);
        yield* deps.readModel.deleteBoard(boardId);
      }),
    );
    yield* deps.boardRegistry.unregister(boardId);
    if (deps.agentPort !== undefined && agentSessionRows.length > 0) {
      const agentPort = deps.agentPort;
      yield* Effect.forEach(
        agentSessionRows,
        (row) => agentPort.cleanupSession(row.threadId as ThreadId).pipe(Effect.ignore),
        { discard: true },
      );
    }
    yield* deps.worktreeJanitor?.run(cleanupPlan) ?? Effect.void;
  });
