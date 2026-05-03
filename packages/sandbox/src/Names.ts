import type { SandboxProviderKind } from "@t3tools/contracts";

const DEFAULT_MAX_PROVIDER_NAME_LENGTH = 63;
const DEFAULT_MAX_BRANCH_LENGTH = 96;

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sanitizeProviderNameSegment(value: string, fallback = "sandbox"): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : fallback;
}

export function truncateWithHash(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const suffix = hashString(value);
  const prefixLength = Math.max(1, maxLength - suffix.length - 1);
  return `${value.slice(0, prefixLength).replace(/-+$/g, "")}-${suffix}`;
}

export function buildSandboxName(input: {
  readonly taskId: string;
  readonly title: string;
  readonly providerKind?: SandboxProviderKind;
  readonly maxLength?: number;
}): string {
  const providerPrefix = input.providerKind === "local" ? "local" : "sandbox";
  const title = sanitizeProviderNameSegment(input.title, "task");
  const task = sanitizeProviderNameSegment(input.taskId, "task");
  return truncateWithHash(
    `${providerPrefix}-${title}-${task}`,
    input.maxLength ?? DEFAULT_MAX_PROVIDER_NAME_LENGTH,
  );
}

export function buildTaskBranchName(input: {
  readonly taskId: string;
  readonly title: string;
  readonly prefix?: string;
  readonly maxLength?: number;
}): string {
  const prefix = input.prefix ?? "task";
  const title = input.title
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 48)
    .replace(/[./_-]+$/g, "");
  const task = sanitizeProviderNameSegment(input.taskId, "task").slice(-16);
  return truncateWithHash(
    `${prefix}/${title || "update"}-${task}`,
    input.maxLength ?? DEFAULT_MAX_BRANCH_LENGTH,
  );
}

export function buildTaskMaterializationIdempotencyKey(input: {
  readonly taskId: string;
  readonly workSessionId: string;
  readonly providerKind: SandboxProviderKind;
}): string {
  return `sandbox:${input.providerKind}:${input.taskId}:${input.workSessionId}`;
}

export function buildSandboxTags(input: {
  readonly providerKind: SandboxProviderKind;
  readonly taskId: string;
  readonly workSessionId: string;
  readonly projectKey?: string;
  readonly environment?: string;
}): Record<string, string> {
  return {
    "t3.sandbox.provider": input.providerKind,
    "t3.task.id": input.taskId,
    "t3.workSession.id": input.workSessionId,
    ...(input.projectKey ? { "t3.project.key": input.projectKey } : {}),
    ...(input.environment ? { "t3.environment": input.environment } : {}),
  };
}
