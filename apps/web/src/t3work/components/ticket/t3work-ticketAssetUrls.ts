import type { JiraAttachment } from "./t3work-ticketRichContentTypes";
import { buildTicketAttachmentCacheRelativePath } from "~/t3work/t3work-ticketAttachmentUtils";

function resolveUrlAgainstBase(url: string, baseUrl?: string): string {
  const trimmed = url.trim();
  if (!trimmed || !baseUrl) return trimmed;

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function buildAtlassianAssetContentUrl(input: {
  accountId: string;
  url: string;
  workspaceRoot?: string;
  relativePath?: string;
}): string {
  const params = new URLSearchParams({
    accountId: input.accountId,
    url: input.url,
  });

  if (input.workspaceRoot) {
    params.set("workspaceRoot", input.workspaceRoot);
  }
  if (input.relativePath) {
    params.set("relativePath", input.relativePath);
  }

  return `/api/t3work/atlassian/asset/content?${params.toString()}`;
}

export function createJiraTicketAssetUrlResolver(input: {
  projectId: string;
  ticketKey: string;
  accountId?: string;
  workspaceRoot?: string;
  baseUrl?: string;
  attachments: JiraAttachment[];
}): ((url: string) => string) | undefined {
  if (!input.accountId) {
    return undefined;
  }

  const rewrites = new Map<string, string>();
  for (const attachment of input.attachments) {
    const sourceUrl = attachment.content?.trim() ?? "";
    const thumbnailUrl = attachment.thumbnail?.trim() ?? "";
    const fallbackUrl = sourceUrl || thumbnailUrl;
    if (!fallbackUrl) {
      continue;
    }

    const resolvedFallbackUrl = resolveUrlAgainstBase(fallbackUrl, input.baseUrl);
    if (!resolvedFallbackUrl) {
      continue;
    }

    const relativePath = buildTicketAttachmentCacheRelativePath({
      projectId: input.projectId,
      ticketKey: input.ticketKey,
      attachment,
    });
    const localAssetUrl = buildAtlassianAssetContentUrl({
      accountId: input.accountId,
      url: resolvedFallbackUrl,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
      relativePath,
    });

    if (sourceUrl) {
      rewrites.set(sourceUrl, localAssetUrl);
    }
    rewrites.set(resolvedFallbackUrl, localAssetUrl);

    if (thumbnailUrl) {
      rewrites.set(thumbnailUrl, localAssetUrl);
      const resolvedThumbnailUrl = resolveUrlAgainstBase(thumbnailUrl, input.baseUrl);
      if (resolvedThumbnailUrl) {
        rewrites.set(resolvedThumbnailUrl, localAssetUrl);
      }
    }
  }

  if (rewrites.size === 0) {
    return undefined;
  }

  return (url: string) => rewrites.get(url.trim()) ?? url;
}
