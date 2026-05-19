import type { ProjectShellProject } from "@t3tools/project-context";
import type { GitHubWorkActivityItem } from "~/t3work/t3work-githubActivity";
import type { ProjectTicket } from "~/t3work/t3work-types";
import {
  buildContextManifestPath,
  buildContextMetadataPath,
  buildGitHubActivityCacheRoot,
  buildGitHubActivityEntryPoint,
  buildJiraTicketEntryPoint,
} from "~/t3work/t3work-contextCachePaths";
import {
  compactJson,
  dedupeDirectoryBundleFiles,
  dedupeDirectoryBundleReferences,
  type T3WorkDirectoryBundlePayload,
} from "~/t3work/t3work-contextDirectoryBundle";
import { resolveTicketContextKey } from "~/t3work/t3work-ticketContextKey";

function formatReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

function classifyActivity(item: GitHubWorkActivityItem): {
  kind: string;
  label: string;
} {
  const subjectType = (item.subjectType ?? "").toLowerCase();
  if (subjectType === "pullrequest") {
    if (item.subjectState === "merged")
      return { kind: "github-activity-pr-merged", label: "Merged PR" };
    if (item.subjectState === "open") return { kind: "github-activity-pr-open", label: "Open PR" };
    if (item.subjectState === "closed")
      return { kind: "github-activity-pr-closed", label: "Closed PR" };
    if (item.subjectState === "draft")
      return { kind: "github-activity-pr-draft", label: "Draft PR" };
    if (item.reviewRequested) {
      return { kind: "github-activity-review-requested", label: "PR review requested" };
    }
    return { kind: "github-activity-pr", label: "Pull request" };
  }

  const reason = item.reason.toLowerCase();
  if (reason.includes("review")) {
    return { kind: "github-activity-review-requested", label: "Review activity" };
  }
  if (reason.includes("comment") || reason.includes("mention")) {
    return { kind: "github-activity-comment", label: "Comment activity" };
  }
  if (reason.includes("workflow")) {
    return { kind: "github-activity-workflow", label: "Workflow activity" };
  }
  return { kind: "github-activity", label: "GitHub activity" };
}

export function buildGitHubActivityDisplay(input: { item: GitHubWorkActivityItem }): {
  activityKind: string;
  targetLabel: string;
  targetType: string;
  summaryItems: ReadonlyArray<{ label: string; value: string }>;
} {
  const { item } = input;
  const classification = classifyActivity(item);
  const subject = item.subjectTitle ?? item.repository;
  return {
    activityKind: classification.kind,
    targetLabel: `${classification.label}: ${subject}`,
    targetType: `GitHub ${classification.label}`,
    summaryItems: [
      { label: "Activity", value: classification.label },
      { label: "Repository", value: item.repository },
      { label: "Reason", value: formatReason(item.reason) },
      ...(item.authorLogin ? [{ label: "Author", value: item.authorLogin }] : []),
      ...(item.subjectState ? [{ label: "State", value: item.subjectState }] : []),
    ],
  };
}

export function buildGitHubActivityContextBundle(input: {
  project: ProjectShellProject;
  item: GitHubWorkActivityItem;
  linkedWorkItem?: ProjectTicket | null;
  linkedTicketBundle?: T3WorkDirectoryBundlePayload;
}): T3WorkDirectoryBundlePayload {
  const display = buildGitHubActivityDisplay({ item: input.item });
  const root = buildGitHubActivityCacheRoot({
    projectId: input.project.id,
    repository: input.item.repository,
    activityId: input.item.id,
  });
  const files: Array<{ relativePath: string; contents: string }> = [];

  const write = (relativePath: string, value: unknown) => {
    files.push({ relativePath, contents: compactJson(value) });
  };

  const entryPoint = buildGitHubActivityEntryPoint({
    projectId: input.project.id,
    repository: input.item.repository,
    activityId: input.item.id,
  });
  const linkedTicketEntryPoint = input.linkedWorkItem
    ? buildJiraTicketEntryPoint(input.project.id, resolveTicketContextKey(input.linkedWorkItem))
    : null;

  write(buildContextManifestPath(root), {
    kind: "github-activity-context-manifest",
    syncedAt: new Date().toISOString(),
    activityKind: display.activityKind,
    activityLabel: display.targetType,
    activityId: input.item.id,
    entryPointRelativePath: entryPoint,
    linkedWorkItemEntryPointRelativePath: linkedTicketEntryPoint,
  });

  write(`${root}/activity/item.json`, {
    activityKind: display.activityKind,
    item: input.item,
  });
  write(`${root}/repository/context.json`, {
    repository: input.item.repository,
    ...(input.item.repositoryUrl ? { repositoryUrl: input.item.repositoryUrl } : {}),
  });
  write(`${root}/project/context.json`, {
    id: input.project.id,
    title: input.project.title,
    source: input.project.source,
    ...(input.project.workspace?.rootPath
      ? { workspaceRoot: input.project.workspace.rootPath }
      : {}),
  });
  write(`${root}/linked-work-item/context.json`, {
    linkedWorkItem: input.linkedWorkItem ?? null,
    ...(linkedTicketEntryPoint
      ? { linkedTicketEntryPointRelativePath: linkedTicketEntryPoint }
      : {}),
  });
  write(buildContextMetadataPath(root), {
    item: input.item,
    linkedWorkItem: input.linkedWorkItem ?? null,
  });
  write(entryPoint, {
    kind: display.activityKind,
    label: display.targetLabel,
    summaryItems: display.summaryItems,
    paths: {
      manifest: buildContextManifestPath(root),
      metadata: buildContextMetadataPath(root),
      activity: `${root}/activity/item.json`,
      repository: `${root}/repository/context.json`,
      project: `${root}/project/context.json`,
      linkedWorkItem: `${root}/linked-work-item/context.json`,
    },
  });

  const fileReferences = dedupeDirectoryBundleReferences([
    { label: "Activity entrypoint", relativePath: entryPoint },
    ...(linkedTicketEntryPoint
      ? [{ label: "Linked ticket entrypoint", relativePath: linkedTicketEntryPoint }]
      : []),
  ]);

  return {
    kind: "t3work-directory-bundle",
    dedupeKey: `${input.project.id}:github-activity:${input.item.id}`,
    bundleRootRelativePath: root,
    files: dedupeDirectoryBundleFiles([...files, ...(input.linkedTicketBundle?.files ?? [])]),
    fileReferences,
    lightweightItem: {
      kind: display.activityKind,
      label: display.targetLabel,
      summaryItems: display.summaryItems,
      references: fileReferences,
    },
  };
}
