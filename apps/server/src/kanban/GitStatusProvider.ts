import { Context, Effect, Layer, Schema } from "effect";
import type {
  KanbanConsoleGitFileActionRequest,
  KanbanConsoleGitFileActionResult,
  KanbanConsoleGitFileChangeKind,
  KanbanConsoleGitFileDiff,
  KanbanConsoleGitFileStatus,
  KanbanConsoleGitHunkStagingSupport,
  KanbanConsoleGitOpsPolicy,
  KanbanConsoleGitPolicyViolation,
  KanbanConsoleGitStatusSnapshot,
  KanbanConsoleReleaseGateStatus,
  KanbanConsoleReleaseReadiness,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const DEFAULT_DIFF_MAX_BYTES = 256 * 1024;

export class KanbanGitStatusProviderError extends Schema.TaggedErrorClass<KanbanGitStatusProviderError>()(
  "KanbanGitStatusProviderError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Kanban git status provider failed in ${this.operation}: ${this.detail}`;
  }
}

export interface ReadKanbanGitStatusInput {
  readonly repoId: string;
  readonly cwd: string;
  readonly policy: KanbanConsoleGitOpsPolicy;
}

export interface ReadKanbanGitFileDiffInput {
  readonly repoId: string;
  readonly cwd: string;
  readonly path: string;
  readonly status: KanbanConsoleGitFileStatus["status"];
  readonly maxOutputBytes?: number;
}

export interface ReadKanbanReleaseReadinessInput {
  readonly cwd: string;
  readonly policy: KanbanConsoleGitOpsPolicy;
  readonly releaseNotesPath?: string;
  readonly targetTag?: string;
  readonly providerStatuses?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly status: KanbanConsoleReleaseGateStatus;
  }>;
}

export interface KanbanGitStatusProviderShape {
  readonly readStatus: (
    input: ReadKanbanGitStatusInput,
  ) => Effect.Effect<KanbanConsoleGitStatusSnapshot, KanbanGitStatusProviderError>;
  readonly readFileDiff: (
    input: ReadKanbanGitFileDiffInput,
  ) => Effect.Effect<KanbanConsoleGitFileDiff, KanbanGitStatusProviderError>;
  readonly stageFiles: (
    input: KanbanConsoleGitFileActionRequest,
  ) => Effect.Effect<KanbanConsoleGitFileActionResult, KanbanGitStatusProviderError>;
  readonly unstageFiles: (
    input: KanbanConsoleGitFileActionRequest,
  ) => Effect.Effect<KanbanConsoleGitFileActionResult, KanbanGitStatusProviderError>;
  readonly readReleaseReadiness: (
    input: ReadKanbanReleaseReadinessInput,
  ) => Effect.Effect<KanbanConsoleReleaseReadiness, KanbanGitStatusProviderError>;
}

export class KanbanGitStatusProvider extends Context.Service<
  KanbanGitStatusProvider,
  KanbanGitStatusProviderShape
>()("t3/kanban/KanbanGitStatusProvider") {}

function providerError(operation: string, cause: unknown): KanbanGitStatusProviderError {
  return new KanbanGitStatusProviderError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function changeKind(raw: string): KanbanConsoleGitFileChangeKind {
  switch (raw) {
    case "A":
    case "?":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split(/\r?\n/g)) {
    if (!line.trim()) continue;
    const [additionsRaw, deletionsRaw, path] = line.split("\t");
    if (!path) continue;
    const additions = Number.parseInt(additionsRaw ?? "0", 10);
    const deletions = Number.parseInt(deletionsRaw ?? "0", 10);
    result.set(normalizeNumstatPath(path), {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  return result;
}

function parseBranchLine(line: string): {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
} {
  const value = line.replace(/^##\s+/, "").trim();
  const [branchPart, trackingPart = ""] = value.split(/\s+\[/, 2);
  const [branchRaw, upstreamRaw] = (branchPart ?? "").split("...", 2);
  const branch =
    branchRaw && !branchRaw.startsWith("HEAD ") && branchRaw !== "HEAD" ? branchRaw : "DETACHED";
  const tracking = `[${trackingPart}`;
  const aheadMatch = /ahead\s+(\d+)/.exec(tracking);
  const behindMatch = /behind\s+(\d+)/.exec(tracking);
  return {
    branch,
    ...(upstreamRaw ? { upstream: upstreamRaw } : {}),
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? "0", 10) : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? "0", 10) : 0,
  };
}

function normalizePorcelainPath(path: string): string {
  return path.replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
}

function parsePorcelainPath(path: string): { path: string; sourcePath?: string } {
  const normalized = normalizePorcelainPath(path);
  const arrowIndex = normalized.lastIndexOf(" -> ");
  if (arrowIndex === -1) return { path: normalized };
  const sourcePath = normalizePorcelainPath(normalized.slice(0, arrowIndex));
  const targetPath = normalizePorcelainPath(normalized.slice(arrowIndex + " -> ".length));
  return {
    path: targetPath,
    ...(sourcePath ? { sourcePath } : {}),
  };
}

function normalizeNumstatPath(path: string): string {
  const normalized = normalizePorcelainPath(path);
  const arrowIndex = normalized.lastIndexOf(" => ");
  if (arrowIndex === -1) return normalized;

  const bracePrefixMatch = /^(.*)\{([^{}]+)$/.exec(normalized.slice(0, arrowIndex));
  const braceSuffixMatch = /^([^{}]+)\}(.*)$/.exec(normalized.slice(arrowIndex + " => ".length));
  if (bracePrefixMatch && braceSuffixMatch) {
    return `${bracePrefixMatch[1] ?? ""}${braceSuffixMatch[1] ?? ""}${braceSuffixMatch[2] ?? ""}`;
  }

  return normalizePorcelainPath(normalized.slice(arrowIndex + " => ".length));
}

function hunkSupport(
  status: KanbanConsoleGitFileStatus["status"],
  diffAvailable: boolean,
): KanbanConsoleGitHunkStagingSupport {
  if (status === "untracked") return "not-applicable";
  return diffAvailable ? "supported" : "unsupported";
}

function makeFileStatus(input: {
  readonly path: string;
  readonly sourcePath?: string;
  readonly status: KanbanConsoleGitFileStatus["status"];
  readonly change: KanbanConsoleGitFileChangeKind;
  readonly stat?: { additions: number; deletions: number };
}): KanbanConsoleGitFileStatus {
  const diffAvailable = input.status !== "untracked" || input.change === "added";
  return {
    path: input.path,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    status: input.status,
    change: input.change,
    additions: input.stat?.additions ?? 0,
    deletions: input.stat?.deletions ?? 0,
    diffAvailable,
    hunkStaging: hunkSupport(input.status, diffAvailable),
  };
}

function makeFileStatusWithOptionalStat(input: {
  readonly path: string;
  readonly sourcePath?: string;
  readonly status: KanbanConsoleGitFileStatus["status"];
  readonly change: KanbanConsoleGitFileChangeKind;
  readonly stat: { additions: number; deletions: number } | undefined;
}): KanbanConsoleGitFileStatus {
  return makeFileStatus({
    path: input.path,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    status: input.status,
    change: input.change,
    ...(input.stat ? { stat: input.stat } : {}),
  });
}

function parseStatusFiles(input: {
  readonly porcelain: string;
  readonly stagedStats: Map<string, { additions: number; deletions: number }>;
  readonly unstagedStats: Map<string, { additions: number; deletions: number }>;
}): KanbanConsoleGitFileStatus[] {
  const files: KanbanConsoleGitFileStatus[] = [];

  for (const rawLine of input.porcelain.split(/\r?\n/g)) {
    if (!rawLine || rawLine.startsWith("##")) continue;

    const code = rawLine.slice(0, 2);
    const parsedPath = parsePorcelainPath(rawLine.slice(3));
    const path = parsedPath.path;
    if (!path) continue;

    if (code === "??") {
      files.push(makeFileStatus({ path, status: "untracked", change: "added" }));
      continue;
    }

    const indexStatus = code[0] ?? " ";
    const worktreeStatus = code[1] ?? " ";
    if (indexStatus !== " " && indexStatus !== "?") {
      files.push(
        makeFileStatusWithOptionalStat({
          path,
          ...(parsedPath.sourcePath ? { sourcePath: parsedPath.sourcePath } : {}),
          status: "staged",
          change: changeKind(indexStatus),
          stat: input.stagedStats.get(path),
        }),
      );
    }
    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      files.push(
        makeFileStatusWithOptionalStat({
          path,
          ...(parsedPath.sourcePath ? { sourcePath: parsedPath.sourcePath } : {}),
          status: "unstaged",
          change: changeKind(worktreeStatus),
          stat: input.unstagedStats.get(path),
        }),
      );
    }
  }

  return files.toSorted((a, b) => `${a.path}:${a.status}`.localeCompare(`${b.path}:${b.status}`));
}

function wildcardMatches(pattern: string, value: string): boolean {
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function isProtectedBranch(branch: string, policy: KanbanConsoleGitOpsPolicy): boolean {
  return policy.protectedBranches.some((pattern) => wildcardMatches(pattern, branch));
}

function hasAllowedPrefix(branch: string, policy: KanbanConsoleGitOpsPolicy): boolean {
  return policy.allowedWorkBranchPrefixes.some((prefix) => branch.startsWith(prefix));
}

function policyViolations(input: {
  readonly branch: string;
  readonly upstream?: string;
  readonly behind: number;
  readonly files: ReadonlyArray<KanbanConsoleGitFileStatus>;
  readonly policy: KanbanConsoleGitOpsPolicy;
}): KanbanConsoleGitPolicyViolation[] {
  const violations: KanbanConsoleGitPolicyViolation[] = [];
  const dirty = input.files.length > 0;

  if (dirty && isProtectedBranch(input.branch, input.policy)) {
    violations.push({
      id: "protected-branch",
      kind: "protected-branch",
      severity: "blocked",
      message: `Working tree changes are blocked on protected branch ${input.branch}.`,
    });
  }

  if (
    !isProtectedBranch(input.branch, input.policy) &&
    !hasAllowedPrefix(input.branch, input.policy)
  ) {
    violations.push({
      id: "invalid-work-branch-prefix",
      kind: "invalid-work-branch-prefix",
      severity: "warning",
      message: `Branch ${input.branch} does not use an allowed work prefix.`,
    });
  }

  if (!input.upstream) {
    violations.push({
      id: "missing-upstream",
      kind: "missing-upstream",
      severity: "warning",
      message: `Branch ${input.branch} has no upstream tracking branch.`,
    });
  }

  if (input.behind > 0) {
    violations.push({
      id: "behind-upstream",
      kind: "behind-upstream",
      severity: "warning",
      message: `Branch ${input.branch} is ${input.behind} commit(s) behind upstream.`,
    });
  }

  if (dirty && input.branch.startsWith("release/")) {
    violations.push({
      id: "dirty-release-branch",
      kind: "dirty-release-branch",
      severity: "blocked",
      message: `Release branch ${input.branch} has uncommitted changes.`,
    });
  }

  return violations;
}

const readStatus = Effect.fn("KanbanGitStatusProvider.readStatus")(function* (
  git: GitVcsDriver.GitVcsDriverShape,
  input: ReadKanbanGitStatusInput,
) {
  const [statusOutput, stagedNumstat, unstagedNumstat, details] = yield* Effect.all(
    [
      git.execute({
        operation: "KanbanGitStatusProvider.status",
        cwd: input.cwd,
        args: ["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
      }),
      git.execute({
        operation: "KanbanGitStatusProvider.stagedNumstat",
        cwd: input.cwd,
        args: ["diff", "--cached", "--numstat"],
      }),
      git.execute({
        operation: "KanbanGitStatusProvider.unstagedNumstat",
        cwd: input.cwd,
        args: ["diff", "--numstat"],
      }),
      git.statusDetails(input.cwd),
    ],
    { concurrency: "unbounded" },
  );

  const branchLine = statusOutput.stdout.split(/\r?\n/g).find((line) => line.startsWith("##"));
  const branch = branchLine ? parseBranchLine(branchLine) : null;
  const files = parseStatusFiles({
    porcelain: statusOutput.stdout,
    stagedStats: parseNumstat(stagedNumstat.stdout),
    unstagedStats: parseNumstat(unstagedNumstat.stdout),
  });
  const branchName = branch?.branch ?? details.branch ?? "DETACHED";
  const upstream = branch?.upstream ?? details.upstreamRef ?? undefined;
  const behind = branch?.behind ?? details.behindCount;

  return {
    repoId: input.repoId,
    cwd: input.cwd,
    isRepo: details.isRepo,
    branch: branchName,
    ...(upstream ? { upstream } : {}),
    ahead: branch?.ahead ?? details.aheadCount,
    behind,
    aheadOfDefault: details.aheadOfDefaultCount,
    files,
    policyViolations: policyViolations({
      branch: branchName,
      ...(upstream ? { upstream } : {}),
      behind,
      files,
      policy: input.policy,
    }),
  } satisfies KanbanConsoleGitStatusSnapshot;
});

function diffArgs(input: ReadKanbanGitFileDiffInput): ReadonlyArray<string> {
  if (input.status === "staged") return ["diff", "--cached", "--", input.path];
  if (input.status === "untracked") return ["diff", "--no-index", "--", "/dev/null", input.path];
  return ["diff", "--", input.path];
}

function nonEmptyDiff(input: ReadKanbanGitFileDiffInput, output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : `No textual diff is available for ${input.path}.`;
}

const readFileDiff = Effect.fn("KanbanGitStatusProvider.readFileDiff")(function* (
  git: GitVcsDriver.GitVcsDriverShape,
  input: ReadKanbanGitFileDiffInput,
) {
  const result = yield* git.execute({
    operation: "KanbanGitStatusProvider.readFileDiff",
    cwd: input.cwd,
    args: diffArgs(input),
    allowNonZeroExit: input.status === "untracked",
    maxOutputBytes: input.maxOutputBytes ?? DEFAULT_DIFF_MAX_BYTES,
    truncateOutputAtMaxBytes: true,
  });

  return {
    repoId: input.repoId,
    path: input.path,
    status: input.status,
    diff: nonEmptyDiff(input, result.stdout),
    truncated: result.stdoutTruncated,
  } satisfies KanbanConsoleGitFileDiff;
});

function blockedAction(
  action: KanbanConsoleGitFileActionResult["action"],
  input: KanbanConsoleGitFileActionRequest,
): KanbanConsoleGitFileActionResult {
  return {
    repoId: input.repoId,
    paths: input.paths,
    action,
    status: "blocked",
    message: `${action === "stage" ? "Stage" : "Unstage"} requires explicit confirmation.`,
  };
}

const stageFiles = Effect.fn("KanbanGitStatusProvider.stageFiles")(function* (
  git: GitVcsDriver.GitVcsDriverShape,
  input: KanbanConsoleGitFileActionRequest,
) {
  if (!input.confirmed) return blockedAction("stage", input);
  yield* git.execute({
    operation: "KanbanGitStatusProvider.stageFiles",
    cwd: input.cwd,
    args: ["add", "--", ...input.paths],
  });
  return {
    repoId: input.repoId,
    paths: input.paths,
    action: "stage",
    status: "applied",
    message: `Staged ${input.paths.length} file(s).`,
  } satisfies KanbanConsoleGitFileActionResult;
});

const unstageFiles = Effect.fn("KanbanGitStatusProvider.unstageFiles")(function* (
  git: GitVcsDriver.GitVcsDriverShape,
  input: KanbanConsoleGitFileActionRequest,
) {
  if (!input.confirmed) return blockedAction("unstage", input);
  yield* git.execute({
    operation: "KanbanGitStatusProvider.unstageFiles",
    cwd: input.cwd,
    args: ["restore", "--staged", "--", ...input.paths],
  });
  return {
    repoId: input.repoId,
    paths: input.paths,
    action: "unstage",
    status: "applied",
    message: `Unstaged ${input.paths.length} file(s).`,
  } satisfies KanbanConsoleGitFileActionResult;
});

function gate(
  id: string,
  label: string,
  status: KanbanConsoleReleaseGateStatus,
): KanbanConsoleReleaseReadiness["gates"][number] {
  return { id, label, status };
}

function releaseTagFromBranch(branch: string): string | undefined {
  const version = branch.startsWith("release/") ? branch.slice("release/".length).trim() : "";
  if (!version) return undefined;
  return version.startsWith("v") ? version : `v${version}`;
}

const readOptionalGitOutput = (
  git: GitVcsDriver.GitVcsDriverShape,
  input: {
    readonly cwd: string;
    readonly operation: string;
    readonly args: ReadonlyArray<string>;
  },
) =>
  git
    .execute({
      operation: input.operation,
      cwd: input.cwd,
      args: input.args,
      allowNonZeroExit: true,
      maxOutputBytes: 64 * 1024,
    })
    .pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : "")));

const readReleaseReadiness = Effect.fn("KanbanGitStatusProvider.readReleaseReadiness")(function* (
  git: GitVcsDriver.GitVcsDriverShape,
  input: ReadKanbanReleaseReadinessInput,
) {
  const [details, statusOutput, latestTag, targetTagOutput, releaseNotesOutput] = yield* Effect.all(
    [
      git.statusDetails(input.cwd),
      git.execute({
        operation: "KanbanGitStatusProvider.releaseStatus",
        cwd: input.cwd,
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
      }),
      readOptionalGitOutput(git, {
        cwd: input.cwd,
        operation: "KanbanGitStatusProvider.latestTag",
        args: ["describe", "--tags", "--abbrev=0"],
      }),
      input.targetTag
        ? readOptionalGitOutput(git, {
            cwd: input.cwd,
            operation: "KanbanGitStatusProvider.targetTag",
            args: ["tag", "--list", input.targetTag],
          })
        : Effect.succeed(""),
      input.releaseNotesPath
        ? readOptionalGitOutput(git, {
            cwd: input.cwd,
            operation: "KanbanGitStatusProvider.releaseNotes",
            args: ["ls-files", "--error-unmatch", "--", input.releaseNotesPath],
          })
        : Effect.succeed(""),
    ],
    { concurrency: "unbounded" },
  );

  const branch = details.branch ?? "DETACHED";
  const targetTag = input.targetTag ?? releaseTagFromBranch(branch);
  const dirty = statusOutput.stdout.trim().length > 0;
  const providerStatusGates = (input.providerStatuses ?? []).map((providerStatus) =>
    gate(providerStatus.id, providerStatus.label, providerStatus.status),
  );
  const providerGateStatus: KanbanConsoleReleaseGateStatus =
    providerStatusGates.length === 0
      ? "pending"
      : providerStatusGates.some((providerGate) => providerGate.status === "blocked")
        ? "blocked"
        : providerStatusGates.some((providerGate) => providerGate.status === "pending")
          ? "pending"
          : "passing";
  const gates: KanbanConsoleReleaseReadiness["gates"] = [
    gate(
      "gate-release-branch",
      "Release branch",
      branch.startsWith("release/") ? "passing" : "blocked",
    ),
    gate("gate-clean-worktree", "Clean working tree", dirty ? "blocked" : "passing"),
    gate(
      "gate-release-notes",
      "Release notes",
      input.releaseNotesPath ? (releaseNotesOutput.length > 0 ? "passing" : "blocked") : "pending",
    ),
    gate("gate-provider-status", "Provider status", providerGateStatus),
    gate(
      "gate-tag-readiness",
      "Tag readiness",
      targetTag ? (targetTagOutput.length > 0 ? "blocked" : "passing") : "pending",
    ),
    ...providerStatusGates,
  ];

  return {
    branch,
    ...(latestTag ? { latestTag } : {}),
    ...(targetTag ? { targetTag } : {}),
    gates,
  } satisfies KanbanConsoleReleaseReadiness;
});

export const make = Effect.fn("KanbanGitStatusProvider.make")(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  return {
    readStatus: (input) =>
      readStatus(git, input).pipe(Effect.mapError((e) => providerError("readStatus", e))),
    readFileDiff: (input) =>
      readFileDiff(git, input).pipe(Effect.mapError((e) => providerError("readFileDiff", e))),
    stageFiles: (input) =>
      stageFiles(git, input).pipe(Effect.mapError((e) => providerError("stageFiles", e))),
    unstageFiles: (input) =>
      unstageFiles(git, input).pipe(Effect.mapError((e) => providerError("unstageFiles", e))),
    readReleaseReadiness: (input) =>
      readReleaseReadiness(git, input).pipe(
        Effect.mapError((e) => providerError("readReleaseReadiness", e)),
      ),
  } satisfies KanbanGitStatusProviderShape;
});

export const layer = Layer.effect(KanbanGitStatusProvider, make());
