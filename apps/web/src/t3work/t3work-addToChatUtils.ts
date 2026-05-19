import { randomUUID } from "~/lib/utils";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import {
  ADDED_CONTEXT_FOOTER,
  ADDED_CONTEXT_HEADING,
  inferContextAttachmentKindFromType,
  normalizeContextAttachmentKind,
} from "~/t3work/t3work-contextAttachmentPrimitives";
import {
  appendJiraContextMetadataLines,
  resolveJiraContextAttachmentMetadata,
} from "~/t3work/t3work-jiraContextMetadata";

export type AddToChatRequest = {
  projectId: string;
  projectTitle: string;
  projectWorkspaceRoot?: string | undefined;
  targetLabel: string;
  targetType: string;
  kind?: string;
  jiraIssueType?: string;
  jiraIssueTypeIconUrl?: string;
  dedupeKey?: string;
  payload: unknown | (() => Promise<unknown>);
  summaryItems?: ReadonlyArray<{ label: string; value: string }>;
};

export type T3WorkContextDirectoryBundlePayload = {
  kind: "t3work-directory-bundle";
  dedupeKey: string;
  bundleRootRelativePath: string;
  files: ReadonlyArray<{ relativePath: string; contents: string }>;
  fileReferences: ReadonlyArray<{ label: string; relativePath: string }>;
  lightweightItem: unknown;
};

export const T3WORK_PATH_PREFIX = "/t3work/projects/";
export const T3WORK_THREADS_SEGMENT = "/threads/";

export function parseActiveThreadFromPath(pathname: string): {
  projectId: string;
  threadId: string;
} | null {
  if (!pathname.startsWith(T3WORK_PATH_PREFIX)) {
    return null;
  }

  const suffix = pathname.slice(T3WORK_PATH_PREFIX.length);
  const splitAt = suffix.indexOf("/");
  if (splitAt <= 0) {
    return null;
  }

  const projectId = decodeURIComponent(suffix.slice(0, splitAt));
  const remainder = suffix.slice(splitAt);
  if (!remainder.startsWith(T3WORK_THREADS_SEGMENT)) {
    return null;
  }

  const encodedThreadId = remainder.slice(T3WORK_THREADS_SEGMENT.length);
  if (!encodedThreadId) {
    return null;
  }

  return {
    projectId,
    threadId: decodeURIComponent(encodedThreadId),
  };
}

export function sanitizeForFileName(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base.slice(0, 64) : "context";
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function isDirectoryBundlePayload(
  payload: unknown,
): payload is T3WorkContextDirectoryBundlePayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    candidate.kind === "t3work-directory-bundle" &&
    typeof candidate.dedupeKey === "string" &&
    typeof candidate.bundleRootRelativePath === "string" &&
    Array.isArray(candidate.files) &&
    Array.isArray(candidate.fileReferences)
  );
}

function resolveAttachmentKind(request: AddToChatRequest, payload: unknown): string {
  const explicitRequestKind = normalizeContextAttachmentKind(request.kind);
  if (explicitRequestKind) {
    return explicitRequestKind;
  }
  if (isDirectoryBundlePayload(payload)) {
    const lightweight = payload.lightweightItem;
    if (lightweight && typeof lightweight === "object" && "kind" in lightweight) {
      const k = normalizeContextAttachmentKind(
        (lightweight as Record<string, unknown>).kind as string | undefined,
      );
      if (k) return k;
    }
  }
  if (payload && typeof payload === "object" && "kind" in payload) {
    const k = normalizeContextAttachmentKind(
      (payload as Record<string, unknown>).kind as string | undefined,
    );
    if (k) return k;
  }
  return inferContextAttachmentKindFromType(request.targetType);
}

function buildContextText(input: {
  request: AddToChatRequest;
  relativePath?: string | undefined;
  payload: unknown;
}): string {
  const { request, relativePath, payload } = input;
  const kind = resolveAttachmentKind(request, payload);
  const lines: string[] = [];
  lines.push(`${ADDED_CONTEXT_HEADING} ${request.targetLabel}`);
  lines.push("");
  lines.push(`- Kind: ${kind}`);
  lines.push(`- Type: ${request.targetType}`);
  lines.push(`- Project: ${request.projectTitle}`);
  if (isDirectoryBundlePayload(payload)) {
    lines.push(`- Context cache directory: ${payload.bundleRootRelativePath}`);
    if (payload.fileReferences.length > 0) {
      lines.push("- References:");
      for (const ref of payload.fileReferences) {
        lines.push(`  - ${ref.label}: ${ref.relativePath}`);
      }
    }
  } else if (relativePath) {
    lines.push(`- Snapshot file: ${relativePath}`);
  }
  if (request.summaryItems && request.summaryItems.length > 0) {
    for (const item of request.summaryItems) {
      lines.push(`- ${item.label}: ${item.value}`);
    }
  }
  const jiraMetadata = resolveJiraContextAttachmentMetadata({
    ...(request.kind ? { kind: request.kind } : {}),
    ...(request.jiraIssueType ? { jiraIssueType: request.jiraIssueType } : {}),
    ...(request.jiraIssueTypeIconUrl ? { jiraIssueTypeIconUrl: request.jiraIssueTypeIconUrl } : {}),
    ...(request.summaryItems ? { summaryItems: request.summaryItems } : {}),
  });
  appendJiraContextMetadataLines({
    lines,
    ...(request.summaryItems ? { summaryItems: request.summaryItems } : {}),
    ...(jiraMetadata.jiraIssueType ? { jiraIssueType: jiraMetadata.jiraIssueType } : {}),
    ...(jiraMetadata.jiraIssueTypeIconUrl
      ? { jiraIssueTypeIconUrl: jiraMetadata.jiraIssueTypeIconUrl }
      : {}),
  });

  lines.push("");
  lines.push(ADDED_CONTEXT_FOOTER);
  return lines.join("\n");
}

export function buildContextAttachment(input: {
  request: AddToChatRequest;
  relativePath?: string | undefined;
  payload: unknown;
}): T3WorkContextAttachment {
  const { request, relativePath, payload } = input;
  const kind = resolveAttachmentKind(request, payload);
  const jiraMetadata = resolveJiraContextAttachmentMetadata({
    ...(request.kind ? { kind: request.kind } : {}),
    ...(request.jiraIssueType ? { jiraIssueType: request.jiraIssueType } : {}),
    ...(request.jiraIssueTypeIconUrl ? { jiraIssueTypeIconUrl: request.jiraIssueTypeIconUrl } : {}),
    ...(request.summaryItems ? { summaryItems: request.summaryItems } : {}),
  });
  const dedupeKey =
    request.dedupeKey ?? (isDirectoryBundlePayload(payload) ? payload.dedupeKey : undefined);
  const description = request.summaryItems?.[0]
    ? `${request.summaryItems[0].label}: ${request.summaryItems[0].value}`
    : undefined;
  return {
    id: randomUUID(),
    kind,
    label: request.targetLabel,
    ...(jiraMetadata.jiraIssueType ? { jiraIssueType: jiraMetadata.jiraIssueType } : {}),
    ...(jiraMetadata.jiraIssueTypeIconUrl
      ? { jiraIssueTypeIconUrl: jiraMetadata.jiraIssueTypeIconUrl }
      : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(description ? { description } : {}),
    ...(request.summaryItems ? { summaryItems: request.summaryItems } : {}),
    ...(isDirectoryBundlePayload(payload) ? { fileReferences: payload.fileReferences } : {}),
    contextText: buildContextText({ request, relativePath, payload }),
  };
}
