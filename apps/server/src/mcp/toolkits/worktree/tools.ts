import {
  WorktreeHandoffError,
  WorktreeHandoffInput,
  WorktreeHandoffResult,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../../project/ProjectSetupScriptRunner.ts";
import * as VcsStatusBroadcaster from "../../../vcs/VcsStatusBroadcaster.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  Crypto.Crypto,
  OrchestrationEngine.OrchestrationEngineService,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ServerSettings.ServerSettingsService,
  GitWorkflowService.GitWorkflowService,
  ProjectSetupScriptRunner.ProjectSetupScriptRunner,
  VcsStatusBroadcaster.VcsStatusBroadcaster,
];

export const WorktreeHandoffTool = Tool.make("worktree_handoff", {
  description:
    "Move this agent thread into a new git worktree. Creates the worktree branch (optionally from origin), re-points the thread at the worktree, and by default runs the project's setup script there. The session restarts inside the worktree at the start of the next turn with the conversation preserved, so call this only when the remaining work should happen on a dedicated branch. Fails if the thread is already attached to a worktree.",
  parameters: WorktreeHandoffInput,
  success: WorktreeHandoffResult,
  failure: WorktreeHandoffError,
  dependencies,
})
  .annotate(Tool.Title, "Hand off thread to a git worktree")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const WorktreeToolkit = Toolkit.make(WorktreeHandoffTool);
