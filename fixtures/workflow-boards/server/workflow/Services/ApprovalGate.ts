import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { StepRunId } from "../../../contracts/workflow.ts";

export interface ApprovalGateShape {
  readonly park: (stepRunId: StepRunId) => Effect.Effect<void>;
  readonly await: (stepRunId: StepRunId) => Effect.Effect<boolean>;
  readonly resolve: (stepRunId: StepRunId, approved: boolean) => Effect.Effect<boolean>;
}

export class ApprovalGate extends Context.Service<ApprovalGate, ApprovalGateShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/ApprovalGate",
) {}
