import type { ProjectShellProject } from "@t3tools/project-context";

import type { BackendApi } from "~/t3work/backend/t3work-types";
import { buildTicketSidebarAddToChatRequest } from "~/t3work/components/t3work-projectSidebarAddToChatRequests";
import type { AddToChatRequest } from "~/t3work/t3work-addToChatUtils";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function buildEmbeddedTicketThreadAutoAttachKey(input: {
  threadId: string;
  project: ProjectShellProject;
  ticket: ProjectTicket;
}): string {
  return `${input.threadId}:${input.project.id}:${input.ticket.id}`;
}

export function takeEmbeddedTicketThreadAutoAttach(input: {
  seenKeys: Set<string>;
  threadId: string;
  backend: BackendApi;
  project: ProjectShellProject;
  ticket: ProjectTicket;
  projectTickets: ReadonlyArray<ProjectTicket>;
  githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
}): {
  request: AddToChatRequest;
  target: {
    type: "thread";
    threadId: string;
  };
} | null {
  const key = buildEmbeddedTicketThreadAutoAttachKey({
    threadId: input.threadId,
    project: input.project,
    ticket: input.ticket,
  });
  if (input.seenKeys.has(key)) {
    return null;
  }

  input.seenKeys.add(key);

  return {
    request: buildTicketSidebarAddToChatRequest({
      backend: input.backend,
      project: input.project,
      projectId: input.project.id,
      projectTickets: input.projectTickets,
      ticket: input.ticket,
      githubActivityItems: input.githubActivityItems,
    }),
    target: {
      type: "thread",
      threadId: input.threadId,
    },
  };
}
