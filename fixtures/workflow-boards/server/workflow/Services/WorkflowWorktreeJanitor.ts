import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { BoardId, TicketId } from "../../../contracts/workflow.ts";

export interface WorktreeCleanupPlan {
  readonly repoRoot: string;
  readonly ticketIds: ReadonlyArray<TicketId>;
}

export interface WorkflowWorktreeJanitorShape {
  readonly collectBoardPlan: (boardId: BoardId) => Effect.Effect<WorktreeCleanupPlan | null>;
  readonly collectTicketPlan: (ticketId: TicketId) => Effect.Effect<WorktreeCleanupPlan | null>;
  readonly run: (plan: WorktreeCleanupPlan | null) => Effect.Effect<void>;
}

export class WorkflowWorktreeJanitor extends Context.Service<
  WorkflowWorktreeJanitor,
  WorkflowWorktreeJanitorShape
>()("@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowWorktreeJanitor") {}
