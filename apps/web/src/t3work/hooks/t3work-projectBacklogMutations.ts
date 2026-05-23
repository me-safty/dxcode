import type { Dispatch, SetStateAction } from "react";

import type { AtlassianAssignableUser, BackendApi } from "~/t3work/backend/t3work-types";
import type { ProjectBacklogSubtaskCreateInput, ProjectTicket } from "~/t3work/t3work-types";

import { type BacklogSelectionInput } from "./t3work-projectBacklogCache";
import {
  createProjectBacklogSubtaskRemote,
  updateProjectBacklogAssigneeRemote,
  updateProjectBacklogEstimateRemote,
} from "./t3work-projectBacklogRemote";
import {
  incrementProjectBacklogStateSubtaskCount,
  type ProjectBacklogState,
  updateProjectBacklogStateAssignee,
  updateProjectBacklogStateEstimate,
} from "./t3work-projectBacklogState";

export type ConnectedBacklogSource = {
  readonly provider: string;
  readonly accountId: string;
  readonly externalProjectId: string;
};

type ProjectBacklogMutationContext = {
  readonly backend: BackendApi;
  readonly connectedSource: ConnectedBacklogSource;
  readonly currentSelection: BacklogSelectionInput;
  readonly setBacklogState: Dispatch<SetStateAction<ProjectBacklogState>>;
  readonly refreshBacklog: (options?: { clearProjectCache?: boolean }) => Promise<void>;
};

export async function updateProjectBacklogAssignee(
  input: ProjectBacklogMutationContext & {
    readonly ticket: ProjectTicket;
    readonly assignee: AtlassianAssignableUser | null;
  },
): Promise<void> {
  await updateProjectBacklogAssigneeRemote({
    backend: input.backend.atlassian,
    accountId: input.connectedSource.accountId,
    ticket: input.ticket,
    assignee: input.assignee,
  });

  input.setBacklogState((current) =>
    updateProjectBacklogStateAssignee(current, input.ticket.id, input.assignee),
  );
}

export async function updateProjectBacklogEstimate(
  input: ProjectBacklogMutationContext & {
    readonly ticket: ProjectTicket;
    readonly estimateValue: number | null;
  },
): Promise<void> {
  const result = await updateProjectBacklogEstimateRemote({
    backend: input.backend.atlassian,
    accountId: input.connectedSource.accountId,
    ticket: input.ticket,
    estimateValue: input.estimateValue,
  });

  input.setBacklogState((current) =>
    updateProjectBacklogStateEstimate(current, input.ticket.id, input.estimateValue, {
      mode: result.mode,
      ...(result.mode === "points" ? { estimateFieldLabel: result.label } : {}),
    }),
  );
}

export async function createProjectBacklogSubtask(
  input: ProjectBacklogMutationContext & {
    readonly ticket: ProjectTicket;
    readonly subtask: ProjectBacklogSubtaskCreateInput;
  },
): Promise<void> {
  await createProjectBacklogSubtaskRemote({
    backend: input.backend.atlassian,
    accountId: input.connectedSource.accountId,
    externalProjectId: input.connectedSource.externalProjectId,
    ticket: input.ticket,
    subtask: input.subtask,
  });

  input.setBacklogState((current) =>
    incrementProjectBacklogStateSubtaskCount(current, input.ticket.id),
  );

  await input.refreshBacklog();
}
