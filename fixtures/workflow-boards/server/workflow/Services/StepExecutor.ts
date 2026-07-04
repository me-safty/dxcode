import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  BoardId,
  LaneEntryToken,
  LaneKey,
  PipelineRunId,
  StepKey,
  StepOutcome,
  StepRunId,
  TicketId,
  WorkflowStep,
} from "../../../contracts/workflow.ts";

export interface StepExecutionContext {
  readonly ticketId: TicketId;
  readonly boardId: BoardId;
  readonly pipelineRunId: PipelineRunId;
  readonly stepRunId: StepRunId;
  readonly laneEntryToken: LaneEntryToken;
  readonly laneKey: LaneKey;
  readonly laneStepKeys: ReadonlyArray<StepKey>;
  readonly step: WorkflowStep;
}

export interface StepExecutorShape {
  readonly execute: (ctx: StepExecutionContext) => Effect.Effect<StepOutcome>;
}

export class StepExecutor extends Context.Service<StepExecutor, StepExecutorShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/StepExecutor",
) {}
