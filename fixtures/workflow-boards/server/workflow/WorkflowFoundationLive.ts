import * as Layer from "effect/Layer";

import { BoardRegistryLive } from "./Layers/BoardRegistry.ts";
import { WorkflowEventStoreLive } from "./Layers/WorkflowEventStore.ts";
import { WorkflowProjectionPipelineLive } from "./Layers/WorkflowProjectionPipeline.ts";
import { WorkflowReadModelLive } from "./Layers/WorkflowReadModel.ts";

export const WorkflowFoundationLive = Layer.mergeAll(
  WorkflowEventStoreLive,
  WorkflowProjectionPipelineLive,
  WorkflowReadModelLive,
).pipe(Layer.provideMerge(BoardRegistryLive));
