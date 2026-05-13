export interface GitHubDeploymentReadyEvent {
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
  readonly deploymentId: string;
  readonly statusId?: string | undefined;
  readonly environment?: string | undefined;
  readonly url: string;
}

export interface GitHubPullRequestMergedEvent {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title?: string | undefined;
  readonly headSha?: string | undefined;
  readonly headBranch?: string | undefined;
  readonly mergedAt?: string | undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nestedString(source: unknown, path: ReadonlyArray<string>): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    const currentRecord = record(current);
    if (currentRecord === null) return undefined;
    current = currentRecord[key];
  }
  return stringField(current);
}

function nestedNumber(source: unknown, path: ReadonlyArray<string>): number | undefined {
  let current: unknown = source;
  for (const key of path) {
    const currentRecord = record(current);
    if (currentRecord === null) return undefined;
    current = currentRecord[key];
  }
  return numberField(current);
}

export function githubPullRequestExternalId(input: {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}) {
  return `${input.owner}/${input.repo}#${input.number}`;
}

export function isPublicDeploymentPreviewUrl(value: string | undefined): value is string {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "vercel.com" || hostname.endsWith(".vercel.com")) return false;
    return true;
  } catch {
    return false;
  }
}

export function deploymentPreviewUrlFromStatus(payload: unknown): string | undefined {
  const environmentUrl = nestedString(payload, ["deployment_status", "environment_url"]);
  if (isPublicDeploymentPreviewUrl(environmentUrl)) return environmentUrl;

  const targetUrl = nestedString(payload, ["deployment_status", "target_url"]);
  return isPublicDeploymentPreviewUrl(targetUrl) ? targetUrl : undefined;
}

function vercelBranchSlug(branch: string) {
  return branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function vercelProjectSlugFromEnvironment(environment: string | undefined) {
  return environment
    ?.trim()
    .replace(/^Preview\s*(?:[-:]|\u2013|\u2014)\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toVercelBranchDeploymentUrl(input: {
  readonly url: string;
  readonly environment?: string | undefined;
  readonly branch?: string | undefined;
}) {
  if (input.branch === undefined) return input.url;
  const projectSlug = vercelProjectSlugFromEnvironment(input.environment);
  const branchSlug = vercelBranchSlug(input.branch);
  if (!projectSlug || !branchSlug) return input.url;

  try {
    const url = new URL(input.url);
    const hostname = url.hostname.toLowerCase();
    const suffix = hostname.includes(".") ? hostname.slice(hostname.indexOf(".") + 1) : "";
    if (!suffix || !hostname.endsWith(".nextcard.com")) return input.url;
    return `https://${projectSlug}-git-${branchSlug}.${suffix}`;
  } catch {
    return input.url;
  }
}

export function parseGitHubDeploymentReadyEvent(
  payload: unknown,
): GitHubDeploymentReadyEvent | null {
  if (nestedString(payload, ["deployment_status", "state"]) !== "success") {
    return null;
  }

  const owner =
    nestedString(payload, ["repository", "owner", "login"]) ??
    nestedString(payload, ["repository", "owner", "name"]);
  const repo = nestedString(payload, ["repository", "name"]);
  const headSha = nestedString(payload, ["deployment", "sha"]);
  const deploymentId = nestedNumber(payload, ["deployment", "id"]);
  const url = deploymentPreviewUrlFromStatus(payload);
  if (!owner || !repo || !headSha || deploymentId === undefined || !url) {
    return null;
  }

  const statusId = nestedNumber(payload, ["deployment_status", "id"]);
  return {
    owner,
    repo,
    headSha,
    deploymentId: String(deploymentId),
    ...(statusId !== undefined ? { statusId: String(statusId) } : {}),
    ...(nestedString(payload, ["deployment", "environment"]) !== undefined
      ? { environment: nestedString(payload, ["deployment", "environment"]) }
      : {}),
    url,
  };
}

export function parseGitHubPullRequestMergedEvent(
  payload: unknown,
): GitHubPullRequestMergedEvent | null {
  if (nestedString(payload, ["action"]) !== "closed") {
    return null;
  }
  if (record(record(payload)?.pull_request)?.merged !== true) {
    return null;
  }

  const owner =
    nestedString(payload, ["repository", "owner", "login"]) ??
    nestedString(payload, ["repository", "owner", "name"]);
  const repo = nestedString(payload, ["repository", "name"]);
  const number = nestedNumber(payload, ["pull_request", "number"]);
  const url = nestedString(payload, ["pull_request", "html_url"]);
  if (!owner || !repo || number === undefined || !url) {
    return null;
  }

  return {
    owner,
    repo,
    number,
    url,
    ...(nestedString(payload, ["pull_request", "title"]) !== undefined
      ? { title: nestedString(payload, ["pull_request", "title"]) }
      : {}),
    ...(nestedString(payload, ["pull_request", "head", "sha"]) !== undefined
      ? { headSha: nestedString(payload, ["pull_request", "head", "sha"]) }
      : {}),
    ...(nestedString(payload, ["pull_request", "head", "ref"]) !== undefined
      ? { headBranch: nestedString(payload, ["pull_request", "head", "ref"]) }
      : {}),
    ...(nestedString(payload, ["pull_request", "merged_at"]) !== undefined
      ? { mergedAt: nestedString(payload, ["pull_request", "merged_at"]) }
      : {}),
  };
}
