import type { ProjectShellProject } from "@t3tools/project-context";

import {
  buildContextManifestPath,
  buildContextMetadataPath,
  buildJiraTicketEntryPoint,
  buildProjectContextCacheRoot,
  buildProjectContextEntryPoint,
  sanitizePathSegment,
} from "~/t3work/t3work-contextCachePaths";
import {
  compactJson,
  type T3WorkDirectoryBundlePayload,
} from "~/t3work/t3work-contextDirectoryBundle";
import { buildJiraWorkItemSummary } from "~/t3work/t3work-jiraContextMetadata";
import { resolveTicketContextKey } from "~/t3work/t3work-ticketContextKey";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function buildProjectContextBundle(input: {
  project: ProjectShellProject;
  linkedRepositoryUrls: ReadonlyArray<string>;
  projectTickets: ReadonlyArray<ProjectTicket>;
}): T3WorkDirectoryBundlePayload {
  const root = buildProjectContextCacheRoot(input.project.id);
  const entryPoint = buildProjectContextEntryPoint(input.project.id);
  const files: Array<{ relativePath: string; contents: string }> = [];

  const write = (relativePath: string, value: unknown) => {
    files.push({ relativePath, contents: compactJson(value) });
  };

  write(buildContextMetadataPath(root), {
    project: input.project,
    linkedRepositoryUrls: input.linkedRepositoryUrls,
  });
  write(`${root}/linked-repositories.json`, { linkedRepositoryUrls: input.linkedRepositoryUrls });

  const workItems = input.projectTickets.map((ticket) => {
    const ticketKey = resolveTicketContextKey(ticket);
    const relativePath = `${root}/work-items/${sanitizePathSegment(ticketKey)}.json`;
    write(relativePath, {
      ticket,
      summaryItems: buildJiraWorkItemSummary(ticket).summaryItems,
      ticketEntryPointRelativePath: buildJiraTicketEntryPoint(input.project.id, ticketKey),
    });
    return {
      key: ticketKey,
      relativePath,
      ticketEntryPointRelativePath: buildJiraTicketEntryPoint(input.project.id, ticketKey),
      updatedAt: ticket.updatedAt,
    };
  });

  write(buildContextManifestPath(root), {
    kind: "project-context-manifest",
    syncedAt: new Date().toISOString(),
    projectId: input.project.id,
    entryPointRelativePath: entryPoint,
    workItemCount: workItems.length,
  });
  write(`${root}/work-items/index.json`, { workItems });
  write(entryPoint, {
    kind: "project",
    label: input.project.title,
    summaryItems: [
      { label: "Work items", value: String(input.projectTickets.length) },
      { label: "Linked repositories", value: String(input.linkedRepositoryUrls.length) },
    ],
    paths: {
      manifest: buildContextManifestPath(root),
      metadata: buildContextMetadataPath(root),
      linkedRepositories: `${root}/linked-repositories.json`,
      workItemsIndex: `${root}/work-items/index.json`,
    },
  });

  return {
    kind: "t3work-directory-bundle",
    dedupeKey: `${input.project.id}:project-context`,
    bundleRootRelativePath: root,
    files,
    fileReferences: [{ label: "Project entrypoint", relativePath: entryPoint }],
    lightweightItem: {
      kind: "project",
      label: input.project.title,
      summaryItems: [
        { label: "Work items", value: String(input.projectTickets.length) },
        { label: "Linked repositories", value: String(input.linkedRepositoryUrls.length) },
      ],
      references: [{ label: "Project entrypoint", relativePath: entryPoint }],
    },
  };
}
