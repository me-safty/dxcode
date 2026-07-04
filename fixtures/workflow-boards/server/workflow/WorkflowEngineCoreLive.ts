import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ApprovalGateLive } from "./Layers/ApprovalGate.ts";
import { DurableApprovalResumeLive } from "./Layers/DurableApprovalResume.ts";
import { ScriptCancelRegistryLive } from "./Layers/ScriptCancelRegistry.ts";
import { StepUsageReaderLive } from "./Layers/StepUsageReader.ts";
import { WorkflowAgentPortLive } from "./Layers/WorkflowAgentPort.ts";
import { WorkflowEngineLayer } from "./Layers/WorkflowEngine.ts";
import { WorkflowRecoveryLive } from "./Layers/WorkflowRecovery.ts";
import { WorkflowRoutingContextBuilderLive } from "./Layers/WorkflowRoutingContextBuilder.ts";
import { WorkflowSourceCommitterLive } from "./Layers/WorkflowSourceCommitter.ts";
import { WorkflowBoardVersionStore } from "./Services/WorkflowBoardVersionStore.ts";
import { WorktreeLeaseService } from "./Services/WorktreeLeaseService.ts";
import { WorkflowCoreLive } from "./WorkflowCoreLive.ts";

export const WorkflowBoardVersionStoreNoop = Layer.succeed(WorkflowBoardVersionStore, {
  record: () => Effect.void,
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(null),
  deleteForBoard: () => Effect.void,
} satisfies WorkflowBoardVersionStore["Service"]);

export const WorktreeLeaseServiceNoop = Layer.succeed(WorktreeLeaseService, {
  acquire: () => Effect.succeed({ fenceToken: 0 }),
  release: () => Effect.void,
  isValid: () => Effect.succeed(true),
} satisfies WorktreeLeaseService["Service"]);

const WorkflowEngineSupportLive = Layer.mergeAll(
  ApprovalGateLive,
  ScriptCancelRegistryLive,
  WorkflowRoutingContextBuilderLive,
  StepUsageReaderLive,
  WorkflowBoardVersionStoreNoop,
  WorktreeLeaseServiceNoop,
);

const WorkflowEngineAndRecoveryLive = Layer.mergeAll(
  WorkflowRecoveryLive,
  WorkflowSourceCommitterLive,
).pipe(Layer.provideMerge(WorkflowEngineLayer));

export const WorkflowEngineCoreLive = WorkflowEngineAndRecoveryLive.pipe(
  Layer.provideMerge(DurableApprovalResumeLive),
  Layer.provideMerge(WorkflowEngineSupportLive),
  Layer.provideMerge(WorkflowCoreLive),
  Layer.provideMerge(WorkflowAgentPortLive),
);
