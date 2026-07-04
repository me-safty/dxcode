import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { WorkflowEventStoreError } from "./Errors.ts";

export interface WorkflowRecoveryShape {
  readonly recover: () => Effect.Effect<void, WorkflowEventStoreError>;
}

export class WorkflowRecovery extends Context.Service<WorkflowRecovery, WorkflowRecoveryShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowRecovery",
) {}
