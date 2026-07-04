import * as Layer from "effect/Layer";

import { GitHubPortLive } from "./Layers/GitHubPort.ts";
import { ProjectScriptTrustLive } from "./Layers/ProjectScriptTrust.ts";
import { RealStepExecutorLive } from "./Layers/RealStepExecutor.ts";
import { ScriptCommandRunnerLive } from "./Layers/ScriptCommandRunner.ts";
import { ScriptStepExecutorLive } from "./Layers/ScriptStepExecutor.ts";
import { SetupRunServiceLive, SetupTerminalPortLive } from "./Layers/SetupRunService.ts";
import { StepOutputHandoffReaderLive } from "./Layers/StepOutputHandoffReader.ts";
import { TicketCheckpointServiceLive } from "./Layers/TicketCheckpointService.ts";
import { MergeGitPortLive, TicketMergeServiceLive } from "./Layers/TicketMergeService.ts";
import { TicketPullRequestServiceLive } from "./Layers/TicketPullRequestService.ts";
import { WorktreePortLive } from "./Layers/WorktreePort.ts";

export const WorkflowStepExecutorLive = RealStepExecutorLive.pipe(
  Layer.provideMerge(WorktreePortLive),
  Layer.provideMerge(ProjectScriptTrustLive),
  Layer.provideMerge(SetupTerminalPortLive),
  Layer.provideMerge(SetupRunServiceLive),
  Layer.provideMerge(ScriptCommandRunnerLive),
  Layer.provideMerge(ScriptStepExecutorLive),
  Layer.provideMerge(StepOutputHandoffReaderLive),
  Layer.provideMerge(TicketCheckpointServiceLive),
  Layer.provideMerge(MergeGitPortLive),
  Layer.provideMerge(TicketMergeServiceLive),
  Layer.provideMerge(GitHubPortLive),
  Layer.provideMerge(TicketPullRequestServiceLive),
);
