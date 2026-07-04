import type { ThreadId } from "@t3tools/contracts";
import type { TerminalsCapability } from "@t3tools/plugin-sdk";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { StepRunId } from "../../../contracts/workflow.ts";
import type { WorkflowEventStoreError } from "./Errors.ts";

export interface ScriptCancelHandle {
  readonly scriptThreadId: ThreadId;
  readonly terminalId: string;
}

export interface ScriptCancelRegistryShape {
  readonly register: (stepRunId: StepRunId, handle: ScriptCancelHandle) => Effect.Effect<void>;
  readonly unregister: (stepRunId: StepRunId) => Effect.Effect<void>;
  readonly cancel: (stepRunId: StepRunId) => Effect.Effect<void, WorkflowEventStoreError>;
}

export class WorkflowTerminalsCapability extends Context.Service<
  WorkflowTerminalsCapability,
  TerminalsCapability
>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/ScriptCancelRegistry/WorkflowTerminalsCapability",
) {}

export class ScriptCancelRegistry extends Context.Service<
  ScriptCancelRegistry,
  ScriptCancelRegistryShape
>()("@t3tools/fixture-workflow-boards/server/workflow/Services/ScriptCancelRegistry") {}
