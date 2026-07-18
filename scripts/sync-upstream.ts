#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const UPSTREAM_SYNC_CHECKS = ["vp check", "vp run typecheck"] as const;

export interface UpstreamSyncOptions {
  readonly repoDir: string;
  readonly upstreamRemote: string;
  readonly upstreamRef: string;
  readonly baseRef: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly fetch: boolean;
  readonly dryRun: boolean;
}

export interface GitCommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (args: ReadonlyArray<string>) => GitCommandResult;

export interface UpstreamSyncDependencies {
  readonly runGit: GitRunner;
  readonly pathExists: (path: string) => boolean;
}

export interface UpstreamSyncResult {
  readonly status: "up-to-date" | "planned" | "ready" | "conflicted";
  readonly commitCount: number;
  readonly commits: ReadonlyArray<string>;
  readonly branch: string;
  readonly worktreePath: string;
  readonly conflicts: ReadonlyArray<string>;
  readonly checks: typeof UPSTREAM_SYNC_CHECKS;
}

export class UpstreamSyncError extends Error {
  readonly command: ReadonlyArray<string> | undefined;

  constructor(message: string, command?: ReadonlyArray<string>) {
    super(message);
    this.name = "UpstreamSyncError";
    this.command = command;
  }
}

function requiredGit(runGit: GitRunner, args: ReadonlyArray<string>, operation: string) {
  const result = runGit(args);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new UpstreamSyncError(
      `${operation} failed${detail.length > 0 ? `: ${detail}` : "."}`,
      args,
    );
  }
  return result;
}

function nonEmptyLines(value: string): ReadonlyArray<string> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseCommitCount(value: string): number {
  const count = Number(value.trim());
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new UpstreamSyncError(`Invalid upstream commit count: ${JSON.stringify(value.trim())}.`);
  }
  return count;
}

export function createDefaultSyncNames(
  repoDir: string,
  date = new Date(),
): { readonly branch: string; readonly worktreePath: string } {
  const day = date.toISOString().slice(0, 10);
  const repoName = NodePath.basename(NodePath.resolve(repoDir));
  return {
    branch: `sync/upstream-${day}`,
    worktreePath: NodePath.resolve(repoDir, "..", `${repoName}-upstream-sync-${day}`),
  };
}

export function runUpstreamSync(
  options: UpstreamSyncOptions,
  dependencies: UpstreamSyncDependencies,
): UpstreamSyncResult {
  const { runGit, pathExists } = dependencies;
  const repoDir = NodePath.resolve(options.repoDir);
  const worktreePath = NodePath.resolve(options.worktreePath);

  if (worktreePath === repoDir) {
    throw new UpstreamSyncError("Sync worktree must differ from the source repository.");
  }
  if (options.branch.startsWith("-") || options.branch.trim().length === 0) {
    throw new UpstreamSyncError(`Invalid sync branch: ${JSON.stringify(options.branch)}.`);
  }

  requiredGit(runGit, ["-C", repoDir, "rev-parse", "--show-toplevel"], "Repository check");

  if (options.fetch) {
    requiredGit(
      runGit,
      ["-C", repoDir, "fetch", options.upstreamRemote, "--prune"],
      "Upstream fetch",
    );
  }

  const commitCount = parseCommitCount(
    requiredGit(
      runGit,
      ["-C", repoDir, "rev-list", "--count", `${options.baseRef}..${options.upstreamRef}`],
      "Upstream detection",
    ).stdout,
  );
  const commits = nonEmptyLines(
    requiredGit(
      runGit,
      ["-C", repoDir, "log", "--format=%h%x09%s", `${options.baseRef}..${options.upstreamRef}`],
      "Upstream history read",
    ).stdout,
  );

  const resultBase = {
    commitCount,
    commits,
    branch: options.branch,
    worktreePath,
    conflicts: [] as ReadonlyArray<string>,
    checks: UPSTREAM_SYNC_CHECKS,
  };

  if (commitCount === 0) {
    return { ...resultBase, status: "up-to-date" };
  }
  if (options.dryRun) {
    return { ...resultBase, status: "planned" };
  }

  requiredGit(
    runGit,
    ["-C", repoDir, "check-ref-format", "--branch", options.branch],
    "Sync branch validation",
  );
  const branchLookup = runGit([
    "-C",
    repoDir,
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${options.branch}`,
  ]);
  if (branchLookup.status === 0) {
    throw new UpstreamSyncError(`Sync branch already exists: ${options.branch}.`);
  }
  if (branchLookup.status !== 1) {
    throw new UpstreamSyncError("Sync branch lookup failed.", [
      "-C",
      repoDir,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${options.branch}`,
    ]);
  }
  if (pathExists(worktreePath)) {
    throw new UpstreamSyncError(`Sync worktree path already exists: ${worktreePath}.`);
  }

  requiredGit(
    runGit,
    ["-C", repoDir, "worktree", "add", "-b", options.branch, worktreePath, options.baseRef],
    "Sync worktree creation",
  );

  const merge = runGit(["-C", worktreePath, "merge", "--no-ff", "--no-edit", options.upstreamRef]);
  if (merge.status === 0) {
    return { ...resultBase, status: "ready" };
  }

  const conflicts = nonEmptyLines(
    requiredGit(
      runGit,
      ["-C", worktreePath, "diff", "--name-only", "--diff-filter=U"],
      "Conflict detection",
    ).stdout,
  );
  if (conflicts.length === 0) {
    const detail = merge.stderr.trim() || merge.stdout.trim();
    throw new UpstreamSyncError(
      `Upstream merge failed without unresolved files${detail.length > 0 ? `: ${detail}` : "."}`,
    );
  }

  return { ...resultBase, status: "conflicted", conflicts };
}

export function formatUpstreamSyncReport(result: UpstreamSyncResult): string {
  const lines = [
    `Status: ${result.status}`,
    `New upstream commits: ${result.commitCount}`,
    `Sync branch: ${result.branch}`,
    `Worktree: ${result.worktreePath}`,
  ];

  if (result.commits.length > 0) {
    lines.push("Commits:", ...result.commits.map((commit) => `  ${commit}`));
  }
  if (result.conflicts.length > 0) {
    lines.push("Conflicts:", ...result.conflicts.map((path) => `  ${path}`));
  }
  if (result.status === "ready" || result.status === "conflicted") {
    lines.push("Required checks:", ...result.checks.map((check) => `  ${check}`));
  }

  lines.push("Promotion: not performed. Review and merge the sync branch manually.");
  return lines.join("\n");
}

function parseCliArgs(args: ReadonlyArray<string>): UpstreamSyncOptions {
  const values = new Map<string, string>();
  let fetch = true;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--no-fetch") {
      fetch = false;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new UpstreamSyncError(`Unexpected argument: ${arg}.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UpstreamSyncError(`Missing value for ${arg}.`);
    }
    values.set(arg, value);
    index += 1;
  }

  const repoDir = NodePath.resolve(values.get("--repo-dir") ?? process.cwd());
  const defaults = createDefaultSyncNames(repoDir);
  const allowed = new Set([
    "--repo-dir",
    "--upstream-remote",
    "--upstream-ref",
    "--base-ref",
    "--branch",
    "--worktree",
  ]);
  const unknown = [...values.keys()].find((key) => !allowed.has(key));
  if (unknown) {
    throw new UpstreamSyncError(`Unknown option: ${unknown}.`);
  }

  return {
    repoDir,
    upstreamRemote: values.get("--upstream-remote") ?? "upstream",
    upstreamRef: values.get("--upstream-ref") ?? "upstream/main",
    baseRef: values.get("--base-ref") ?? "dx/main",
    branch: values.get("--branch") ?? defaults.branch,
    worktreePath: NodePath.resolve(values.get("--worktree") ?? defaults.worktreePath),
    fetch,
    dryRun,
  };
}

function nodeGitRunner(args: ReadonlyArray<string>): GitCommandResult {
  const result = NodeChildProcess.spawnSync("git", [...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw new UpstreamSyncError(`Failed to start git: ${result.error.message}.`, args);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

if (import.meta.main) {
  try {
    const result = runUpstreamSync(parseCliArgs(process.argv.slice(2)), {
      runGit: nodeGitRunner,
      pathExists: NodeFS.existsSync,
    });
    console.log(formatUpstreamSyncReport(result));
    if (result.status === "conflicted") {
      process.exitCode = 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Upstream sync failed: ${message}`);
    process.exitCode = 1;
  }
}
