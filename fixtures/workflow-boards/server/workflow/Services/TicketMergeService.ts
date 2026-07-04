import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MergeStep, StepOutcome, TicketId } from "../../../contracts/workflow.ts";
import type { WorkflowEventStoreError } from "./Errors.ts";

export interface MergeGitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface MergeGitPortShape {
  readonly run: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly allowNonZeroExit?: boolean;
  }) => Effect.Effect<MergeGitResult, WorkflowEventStoreError>;
}

export class MergeGitPort extends Context.Service<MergeGitPort, MergeGitPortShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/TicketMergeService/MergeGitPort",
) {}

export interface TicketMergeInput {
  readonly ticketId: TicketId;
  readonly repoRoot: string;
  readonly worktreePath: string;
  readonly worktreeRef: string;
  readonly step: MergeStep;
}

export interface TicketMergeServiceShape {
  readonly merge: (input: TicketMergeInput) => Effect.Effect<StepOutcome, WorkflowEventStoreError>;
}

export class TicketMergeService extends Context.Service<
  TicketMergeService,
  TicketMergeServiceShape
>()("@t3tools/fixture-workflow-boards/server/workflow/Services/TicketMergeService") {}
