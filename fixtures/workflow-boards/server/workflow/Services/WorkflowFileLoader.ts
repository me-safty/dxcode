import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { BoardId, WorkflowDefinition, WorkflowRpcError } from "../../../contracts/workflow.ts";
import type { LintError } from "../workflowFile.ts";

export interface WorkflowFilePortShape {
  readonly readFileString: (filePath: string) => Effect.Effect<string, WorkflowRpcError>;
  readonly instructionFileExists: (input: {
    readonly repoRoot: string;
    readonly repoRelativePath: string;
  }) => Effect.Effect<boolean, WorkflowRpcError>;
}

export class WorkflowFilePort extends Context.Service<WorkflowFilePort, WorkflowFilePortShape>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowFileLoader/WorkflowFilePort",
) {}

export interface WorkflowProviderInstancePortShape {
  readonly providerInstanceExists: (instanceId: string) => Effect.Effect<boolean, WorkflowRpcError>;
  readonly providerInstanceSupportsResume: (
    instanceId: string,
  ) => Effect.Effect<boolean, WorkflowRpcError>;
}

export class WorkflowProviderInstancePort extends Context.Service<
  WorkflowProviderInstancePort,
  WorkflowProviderInstancePortShape
>()(
  "@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowFileLoader/WorkflowProviderInstancePort",
) {}

export interface WorkflowFileLoaderShape {
  readonly lintDefinition: (input: {
    readonly definition: WorkflowDefinition;
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
  }) => Effect.Effect<ReadonlyArray<LintError>, WorkflowRpcError>;
  readonly loadAndRegister: (input: {
    readonly boardId: BoardId;
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly lintMode?: "strict" | "skip";
  }) => Effect.Effect<BoardId, WorkflowRpcError>;
}

export class WorkflowFileLoader extends Context.Service<
  WorkflowFileLoader,
  WorkflowFileLoaderShape
>()("@t3tools/fixture-workflow-boards/server/workflow/Services/WorkflowFileLoader") {}
