import type { ProjectShellProject, ResourceSnapshot } from "@t3tools/project-context";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { AddToChatPayloadProgressUpdate } from "~/t3work/t3work-addToChatUtils";
import type { ProjectTicket } from "~/t3work/t3work-types";
import type { BackendApi } from "~/t3work/backend/t3work-types";
import { buildTicketContextBundle } from "~/t3work/t3work-ticketContextBundle";

export type TicketDetailContextTarget =
  | "metadata"
  | "description"
  | "attachments"
  | "comments"
  | "relationships"
  | "parent";

function jiraDetailKind(target: TicketDetailContextTarget): string {
  return `jira-ticket-${target}`;
}

export async function buildTicketDetailContextBundle(input: {
  backend: BackendApi;
  project: ProjectShellProject;
  ticket: ProjectTicket;
  projectTickets: ReadonlyArray<ProjectTicket>;
  githubActivityItems: ReadonlyArray<GitHubWorkActivityItem>;
  target: TicketDetailContextTarget;
  targetLabel: string;
  summaryItems?: ReadonlyArray<{ label: string; value: string }>;
  primarySnapshot?: ResourceSnapshot | null;
  onProgress?: ((update: AddToChatPayloadProgressUpdate) => void) | undefined;
}) {
  return buildTicketContextBundle({
    backend: input.backend,
    project: input.project,
    ticket: input.ticket,
    projectTickets: input.projectTickets,
    githubActivityItems: input.githubActivityItems,
    focus: {
      kind: jiraDetailKind(input.target),
      label: input.targetLabel,
      ...(input.summaryItems ? { summaryItems: input.summaryItems } : {}),
    },
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });
}
