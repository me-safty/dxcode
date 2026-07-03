import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BoardRegistryLive } from "./Layers/BoardRegistry.ts";
import { PredicateEvaluatorLive } from "./Layers/PredicateEvaluator.ts";
import { WorkflowBoardEventsLive } from "./Layers/WorkflowBoardEvents.ts";
import { WorkflowBoardSaveLocksLive } from "./Layers/WorkflowBoardSaveLocks.ts";
import { WorkflowEventCommitterLive } from "./Layers/WorkflowEventCommitter.ts";
import { WorkflowEventStoreLive } from "./Layers/WorkflowEventStore.ts";
import { WorkflowIdsLive } from "./Layers/WorkflowIds.ts";
import { WorkflowProjectionPipelineLive } from "./Layers/WorkflowProjectionPipeline.ts";
import { WorkflowReadModelLive } from "./Layers/WorkflowReadModel.ts";
import { NotificationSinkNoop } from "./NotificationSink.ts";

const WorkflowCoreStorageLive = Layer.mergeAll(
  WorkflowEventStoreLive,
  WorkflowProjectionPipelineLive,
  WorkflowReadModelLive,
);

const WorkflowCoreSupportLive = Layer.mergeAll(
  BoardRegistryLive,
  PredicateEvaluatorLive,
  WorkflowBoardSaveLocksLive,
  WorkflowIdsLive,
  WorkflowBoardEventsLive,
  NotificationSinkNoop,
);

/** Build the workflow event-sourcing core given a SqlClient layer (from database.client). */
export const WorkflowCoreLive = WorkflowEventCommitterLive.pipe(
  Layer.provideMerge(WorkflowCoreStorageLive),
  Layer.provideMerge(WorkflowCoreSupportLive),
);

/** Provide SqlClient from an acquired database capability's raw client. */
export const sqlClientFromDatabase = (client: SqlClient.SqlClient) =>
  Layer.succeed(SqlClient.SqlClient, client);
