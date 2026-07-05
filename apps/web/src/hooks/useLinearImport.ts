import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProviderInstanceId,
  type EnvironmentId,
  type LinearIssueDetail,
  type LinearIssueLink,
  type ModelSelection,
  type ProjectId,
} from "@t3tools/contracts";
import { useCallback } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { formatLinearIssues } from "../lib/linearFormat";
import { newMessageId, newThreadId } from "../lib/utils";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useProjects } from "../state/entities";
import { linearEnvironment } from "../state/linear";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useClientSettings } from "./useSettings";
import { useNewThreadHandler } from "./useHandleNewThread";

export interface LinearImportTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/** `combine` → one draft thread with all issues. `perIssue` → one started thread per issue. */
export type LinearBulkImportMode = "combine" | "perIssue";

export interface LinearImportResult {
  readonly ok: boolean;
  readonly error?: string;
}

function issueTitle(issue: LinearIssueDetail): string {
  const title = `${issue.identifier}: ${issue.title}`.trim();
  return title.length > 120 ? title.slice(0, 117) + "…" : title;
}

function issueLink(issue: LinearIssueDetail): LinearIssueLink {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    ...(issue.teamId ? { teamId: issue.teamId } : {}),
    ...(issue.stateType ? { stateType: issue.stateType } : {}),
    ...(issue.stateName ? { stateName: issue.stateName } : {}),
  };
}

/**
 * Imports the selected Linear issues into T3 Code threads for `target`.
 * `combine` pre-fills a single draft; `perIssue` creates and starts one linked
 * thread per issue (leaning into parallel agents).
 */
export function useLinearImport() {
  const projects = useProjects();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const newThread = useNewThreadHandler();
  const fetchIssues = useAtomCommand(linearEnvironment.fetchIssues, "linear fetch issues");
  const startTurn = useAtomCommand(threadEnvironment.startTurn, "linear import start turn");

  return useCallback(
    async (input: {
      readonly target: LinearImportTarget;
      readonly ids: ReadonlyArray<string>;
      readonly mode: LinearBulkImportMode;
    }): Promise<LinearImportResult> => {
      if (input.ids.length === 0) {
        return { ok: false, error: "Select at least one issue to import." };
      }

      const projectRef = scopeProjectRef(input.target.environmentId, input.target.projectId);
      const project = projects.find(
        (candidate) =>
          candidate.id === input.target.projectId &&
          candidate.environmentId === input.target.environmentId,
      );

      const result = await fetchIssues({
        environmentId: input.target.environmentId,
        input: { ids: [...input.ids] },
      });
      if (result._tag !== "Success") {
        return { ok: false, error: "Failed to load the selected Linear issues." };
      }
      const issues = result.value.issues;
      if (issues.length === 0) {
        return { ok: false, error: "The selected issues could not be loaded." };
      }

      if (input.mode === "perIssue") {
        const modelSelection: ModelSelection = project?.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
        // Attempt every issue; report a summary rather than bailing mid-loop and
        // leaving the caller unsure which threads were actually created.
        const failed: string[] = [];
        for (const issue of issues) {
          const createdAt = new Date().toISOString();
          const title = issueTitle(issue);
          const startResult = await startTurn({
            environmentId: input.target.environmentId,
            input: {
              threadId: newThreadId(),
              message: {
                messageId: newMessageId(),
                role: "user",
                text: formatLinearIssues([issue], "combine"),
                attachments: [],
              },
              modelSelection,
              titleSeed: title,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              bootstrap: {
                createThread: {
                  projectId: input.target.projectId,
                  title,
                  modelSelection,
                  runtimeMode: DEFAULT_RUNTIME_MODE,
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  branch: null,
                  worktreePath: null,
                  linearIssue: issueLink(issue),
                  createdAt,
                },
              },
              createdAt,
            },
          });
          if (startResult._tag !== "Success") {
            failed.push(issue.identifier);
          }
        }
        const createdCount = issues.length - failed.length;
        if (createdCount === 0) {
          return { ok: false, error: "Failed to create any threads from Linear." };
        }
        if (failed.length > 0) {
          return {
            ok: false,
            error: `Created ${createdCount} of ${issues.length} threads; failed: ${failed.join(", ")}.`,
          };
        }
        const missing = input.ids.length - issues.length;
        if (missing > 0) {
          return {
            ok: false,
            error: `Imported ${issues.length}; ${missing} selected issue(s) could not be loaded.`,
          };
        }
        return { ok: true };
      }

      // combine: pre-fill a single draft the user reviews before sending.
      const markdown = formatLinearIssues(issues, "combine");
      await newThread(projectRef);
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, groupingSettings)
        : scopedProjectKey(projectRef);
      const draft = useComposerDraftStore
        .getState()
        .getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (draft) {
        useComposerDraftStore.getState().setPrompt(draft.draftId, markdown);
      }
      return { ok: true };
    },
    [fetchIssues, groupingSettings, newThread, projects, startTurn],
  );
}
