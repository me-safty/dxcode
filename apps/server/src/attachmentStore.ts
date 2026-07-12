// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ChatAttachment } from "@t3tools/contracts";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { inferImageExtension, SAFE_IMAGE_FILE_EXTENSIONS } from "./imageMime.ts";

const ATTACHMENT_FILENAME_EXTENSIONS = [...SAFE_IMAGE_FILE_EXTENSIONS, ".bin"];
const TEXT_ATTACHMENT_DIRECTORY = "text";
const TEXT_ATTACHMENT_FILE_NAME_MAX_CHARS = 120;
const WINDOWS_RESERVED_FILE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_THREAD_SEGMENT_PATTERN = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ATTACHMENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ATTACHMENT_ID_PATTERN = new RegExp(
  `^(${ATTACHMENT_ID_THREAD_SEGMENT_PATTERN})-(${ATTACHMENT_ID_UUID_PATTERN})$`,
  "i",
);

export function toSafeThreadAttachmentSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  if (segment.length === 0) {
    return null;
  }
  return segment;
}

export function createAttachmentId(threadId: string): string | null {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return null;
  }
  return `${threadSegment}-${NodeCrypto.randomUUID()}`;
}

export function parseThreadSegmentFromAttachmentId(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  return match[1]?.toLowerCase() ?? null;
}

export function attachmentRelativePath(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case "image": {
      const extension = inferImageExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
  }
}

export function resolveAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: attachmentRelativePath(input.attachment),
  });
}

export function resolveAttachmentPathById(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  for (const extension of ATTACHMENT_FILENAME_EXTENSIONS) {
    const maybePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: `${normalizedId}${extension}`,
    });
    if (maybePath && NodeFS.existsSync(maybePath)) {
      return maybePath;
    }
  }
  return null;
}

export function parseAttachmentIdFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeAttachmentRelativePath(relativePath);
  if (!normalized || normalized.includes("/")) {
    return null;
  }
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return null;
  }
  const id = normalized.slice(0, extensionIndex);
  return id.length > 0 && !id.includes(".") ? id : null;
}

export function createTextAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly fileName: string;
}): string {
  const sanitizedName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.+$/, "");
  let safeName =
    sanitizedName.length > 0 && sanitizedName !== "." && sanitizedName !== ".."
      ? sanitizedName
      : "context.txt";
  if (WINDOWS_RESERVED_FILE_NAME_PATTERN.test(safeName)) {
    safeName = `_${safeName}`;
  }
  if (safeName.length > TEXT_ATTACHMENT_FILE_NAME_MAX_CHARS) {
    const extensionIndex = safeName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? safeName.slice(extensionIndex).slice(0, 20) : "";
    safeName = `${safeName.slice(0, TEXT_ATTACHMENT_FILE_NAME_MAX_CHARS - extension.length)}${extension}`;
  }
  return NodePath.join(
    input.attachmentsDir,
    TEXT_ATTACHMENT_DIRECTORY,
    NodeCrypto.randomUUID(),
    safeName,
  );
}

export function textAttachmentRelativePath(input: {
  readonly attachmentsDir: string;
  readonly path: string;
}): string | null {
  const relativePath = NodePath.relative(
    NodePath.resolve(input.attachmentsDir),
    NodePath.resolve(input.path),
  ).replaceAll("\\", "/");
  return /^text\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i.test(
    relativePath,
  )
    ? relativePath
    : null;
}

export function textAttachmentDirectory(input: {
  readonly attachmentsDir: string;
  readonly path: string;
}): string | null {
  const relativePath = textAttachmentRelativePath(input);
  return relativePath ? NodePath.join(input.attachmentsDir, NodePath.dirname(relativePath)) : null;
}

const MARKDOWN_LINK_DESTINATION_PATTERN = /\]\(([^)\s]+)\)/g;

export function collectTextAttachmentRelativePaths(input: {
  readonly attachmentsDir: string;
  readonly text: string;
}): Set<string> {
  const paths = new Set<string>();
  for (const match of input.text.matchAll(MARKDOWN_LINK_DESTINATION_PATTERN)) {
    const encodedPath = match[1];
    if (!encodedPath) continue;
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      continue;
    }
    const relativePath = textAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      path,
    });
    if (relativePath) paths.add(relativePath);
  }
  return paths;
}
