import type { WorkflowEvent } from "../../../contracts/workflow.ts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { WorkflowEventStoreError } from "./Errors.ts";

export interface WorkflowProjectionPipelineShape {
  readonly projectEvent: (event: WorkflowEvent) => Effect.Effect<void, WorkflowEventStoreError>;
}

export class WorkflowProjectionPipeline extends Context.Service<
  WorkflowProjectionPipeline,
  WorkflowProjectionPipelineShape
>()("@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowProjectionPipeline") {}
