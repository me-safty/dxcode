#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - Thin synchronous CLI adapter around git.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import {
  newestNightlyTag,
  parseLsRemoteNightlyTags,
  parseNightlyTag,
} from "@t3tools/shared/upstreamNightly";

export const UPSTREAM_SYNC_CHECKS = ["vp check", "vp run typecheck"] as const;

export interface UpstreamSyncOptions {
  readonly repoDir: string;
  readonly baseRef: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly targetTag: string | null;
  readonly policy: "nightly-tags" | "upstream-main";
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
  readonly tag: string;
  readonly targetCommit: string;
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
    throw new UpstreamSyncError(`${operation} failed.`, args);
  }
  return result;
}

function nonEmptyLines(value: string): ReadonlyArray<string> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseCommitCount(value: string): number {
  const count = Number(value.trim());
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new UpstreamSyncError(`Invalid upstream commit count: ${JSON.stringify(value.trim())}.`);
  }
  return count;
}

export function createDefaultSyncNames(repoDir: string, tag: string) {
  const parsed = parseNightlyTag(tag);
  if (!parsed) throw new UpstreamSyncError(`Invalid nightly tag: ${tag}.`);
  const name = `t3-nightly-${parsed.date}-${parsed.build}`;
  return {
    branch: `sync/${name}`,
    worktreePath: NodePath.resolve(repoDir, "..", "t3code-worktrees", `sync-${name}`),
  };
}

function validateRemote(runGit: GitRunner, repoDir: string, remote: string, expected: string) {
  const url = requiredGit(
    runGit,
    ["-C", repoDir, "remote", "get-url", remote],
    `${remote} remote validation`,
  ).stdout.trim();
  if (normalizeGitRemoteUrl(url) !== expected) {
    throw new UpstreamSyncError(`${remote} remote does not match ${expected}.`);
  }
}

function detectNightly(
  options: UpstreamSyncOptions,
  runGit: GitRunner,
): { readonly tag: string; readonly targetCommit: string } {
  const pattern = options.targetTag ? `refs/tags/${options.targetTag}` : "refs/tags/v*-nightly.*";
  if (options.targetTag && !parseNightlyTag(options.targetTag)) {
    throw new UpstreamSyncError(`Invalid nightly tag: ${options.targetTag}.`);
  }
  const refs = parseLsRemoteNightlyTags(
    requiredGit(
      runGit,
      ["-C", options.repoDir, "ls-remote", "--refs", "--tags", "upstream", pattern],
      "Nightly tag detection",
    ).stdout,
  );
  const selected = options.targetTag
    ? (refs.find((ref) => ref.tag === options.targetTag) ?? null)
    : newestNightlyTag(refs);
  if (!selected) throw new UpstreamSyncError("No valid upstream nightly tag found.");
  const namespaceRef = `refs/dx/upstream-nightlies/${selected.tag}`;
  if (options.fetch) {
    const cached = runGit(["-C", options.repoDir, "show-ref", "--hash", "--verify", namespaceRef]);
    if (cached.status === 0 && cached.stdout.trim().toLowerCase() !== selected.remoteObject) {
      throw new UpstreamSyncError(
        "The upstream nightly tag changed after detection. Review the remote before continuing.",
      );
    }
    if (cached.status === 1) {
      requiredGit(
        runGit,
        [
          "-C",
          options.repoDir,
          "fetch",
          "--no-tags",
          "upstream",
          `refs/tags/${selected.tag}:${namespaceRef}`,
        ],
        "Nightly fetch",
      );
    } else if (cached.status !== 0) {
      throw new UpstreamSyncError("Nightly cache lookup failed.");
    }
  }
  const targetCommit = requiredGit(
    runGit,
    ["-C", options.repoDir, "rev-parse", `${namespaceRef}^{commit}`],
    "Nightly commit resolution",
  ).stdout.trim();
  const rechecked = parseLsRemoteNightlyTags(
    requiredGit(
      runGit,
      [
        "-C",
        options.repoDir,
        "ls-remote",
        "--refs",
        "--tags",
        "upstream",
        `refs/tags/${selected.tag}`,
      ],
      "Nightly tag recheck",
    ).stdout,
  );
  if (rechecked.length !== 1 || rechecked[0]?.remoteObject !== selected.remoteObject) {
    throw new UpstreamSyncError(
      "The upstream nightly tag changed after detection. Review the remote before continuing.",
    );
  }
  return { tag: selected.tag, targetCommit };
}

function detectUpstreamMain(options: UpstreamSyncOptions, runGit: GitRunner) {
  const namespaceRef = "refs/dx/upstream-main";
  if (options.fetch) {
    requiredGit(
      runGit,
      ["-C", options.repoDir, "fetch", "--no-tags", "upstream", `refs/heads/main:${namespaceRef}`],
      "upstream/main fetch",
    );
  }
  const targetCommit = requiredGit(
    runGit,
    ["-C", options.repoDir, "rev-parse", `${namespaceRef}^{commit}`],
    "upstream/main resolution",
  ).stdout.trim();
  return { tag: "upstream/main", targetCommit };
}

export function runUpstreamSync(
  rawOptions: UpstreamSyncOptions,
  dependencies: UpstreamSyncDependencies,
): UpstreamSyncResult {
  const options = { ...rawOptions, repoDir: NodePath.resolve(rawOptions.repoDir) };
  const { runGit, pathExists } = dependencies;
  requiredGit(runGit, ["-C", options.repoDir, "rev-parse", "--show-toplevel"], "Repository check");
  validateRemote(runGit, options.repoDir, "origin", "github.com/me-safty/dxcode");
  validateRemote(runGit, options.repoDir, "upstream", "github.com/pingdotgg/t3code");

  const detected =
    options.policy === "nightly-tags"
      ? detectNightly(options, runGit)
      : detectUpstreamMain(options, runGit);
  const defaults =
    options.policy === "nightly-tags"
      ? createDefaultSyncNames(options.repoDir, detected.tag)
      : {
          branch: `sync/upstream-${new Date().toISOString().slice(0, 10)}`,
          worktreePath: NodePath.resolve(
            options.repoDir,
            "..",
            "t3code-worktrees",
            "sync-upstream-main",
          ),
        };
  const branch = options.branch ?? defaults.branch;
  const worktreePath = NodePath.resolve(options.worktreePath ?? defaults.worktreePath);
  if (worktreePath === options.repoDir) {
    throw new UpstreamSyncError("Sync worktree must differ from the source repository.");
  }

  const ancestry = runGit([
    "-C",
    options.repoDir,
    "merge-base",
    "--is-ancestor",
    detected.targetCommit,
    options.baseRef,
  ]);
  if (ancestry.status !== 0 && ancestry.status !== 1) {
    throw new UpstreamSyncError("Git ancestry check failed.");
  }
  const commitCount = parseCommitCount(
    requiredGit(
      runGit,
      [
        "-C",
        options.repoDir,
        "rev-list",
        "--count",
        `${options.baseRef}..${detected.targetCommit}`,
      ],
      "Upstream detection",
    ).stdout,
  );
  const commits = nonEmptyLines(
    requiredGit(
      runGit,
      [
        "-C",
        options.repoDir,
        "log",
        "--format=%h%x09%s",
        `${options.baseRef}..${detected.targetCommit}`,
      ],
      "Upstream history read",
    ).stdout,
  );
  const resultBase = {
    tag: detected.tag,
    targetCommit: detected.targetCommit,
    commitCount,
    commits,
    branch,
    worktreePath,
    conflicts: [] as ReadonlyArray<string>,
    checks: UPSTREAM_SYNC_CHECKS,
  };
  if (ancestry.status === 0) return { ...resultBase, status: "up-to-date" };
  if (options.dryRun) return { ...resultBase, status: "planned" };

  requiredGit(
    runGit,
    ["-C", options.repoDir, "check-ref-format", "--branch", branch],
    "Branch validation",
  );
  const branchLookup = runGit([
    "-C",
    options.repoDir,
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  if (branchLookup.status === 0)
    throw new UpstreamSyncError(`Sync branch already exists: ${branch}.`);
  if (branchLookup.status !== 1) throw new UpstreamSyncError("Sync branch lookup failed.");
  if (pathExists(worktreePath)) {
    throw new UpstreamSyncError(`Sync worktree path already exists: ${worktreePath}.`);
  }
  requiredGit(
    runGit,
    ["-C", options.repoDir, "worktree", "add", "-b", branch, worktreePath, options.baseRef],
    "Sync worktree creation",
  );
  const merge = runGit([
    "-C",
    worktreePath,
    "merge",
    "--no-ff",
    "--no-commit",
    detected.targetCommit,
  ]);
  if (merge.status === 0) return { ...resultBase, status: "ready" };
  const conflicts = nonEmptyLines(
    requiredGit(
      runGit,
      ["-C", worktreePath, "diff", "--name-only", "--diff-filter=U"],
      "Conflict detection",
    ).stdout,
  );
  if (conflicts.length === 0) {
    throw new UpstreamSyncError("Upstream merge failed without unresolved files.");
  }
  return { ...resultBase, status: "conflicted", conflicts };
}

export function formatUpstreamSyncReport(result: UpstreamSyncResult): string {
  const lines = [
    `Status: ${result.status}`,
    `Target: ${result.tag}`,
    `Pinned commit: ${result.targetCommit}`,
    `New upstream commits: ${result.commitCount}`,
    `Sync branch: ${result.branch}`,
    `Worktree: ${result.worktreePath}`,
  ];
  if (result.commits.length > 0)
    lines.push("Commits:", ...result.commits.map((commit) => `  ${commit}`));
  if (result.conflicts.length > 0)
    lines.push("Conflicts:", ...result.conflicts.map((path) => `  ${path}`));
  if (result.status === "ready" || result.status === "conflicted") {
    lines.push("Required checks:", ...result.checks.map((check) => `  ${check}`));
  }
  lines.push("Commit, push, promotion, deletion: not performed.");
  return lines.join("\n");
}

function parseCliArgs(args: ReadonlyArray<string>): UpstreamSyncOptions {
  const values = new Map<string, string>();
  let fetch = true;
  let dryRun = false;
  let policy: UpstreamSyncOptions["policy"] = "nightly-tags";
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
    if (arg === "--upstream-main") {
      policy = "upstream-main";
      continue;
    }
    if (!arg.startsWith("--")) throw new UpstreamSyncError(`Unexpected argument: ${arg}.`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new UpstreamSyncError(`Missing value for ${arg}.`);
    values.set(arg, value);
    index += 1;
  }
  const allowed = new Set(["--repo-dir", "--base-ref", "--branch", "--worktree", "--tag"]);
  const unknown = [...values.keys()].find((key) => !allowed.has(key));
  if (unknown) throw new UpstreamSyncError(`Unknown option: ${unknown}.`);
  return {
    repoDir: NodePath.resolve(values.get("--repo-dir") ?? process.cwd()),
    baseRef: values.get("--base-ref") ?? "dx/main",
    branch: values.get("--branch") ?? null,
    worktreePath: values.get("--worktree") ?? null,
    targetTag: values.get("--tag") ?? null,
    policy,
    fetch,
    dryRun,
  };
}

function nodeGitRunner(args: ReadonlyArray<string>): GitCommandResult {
  const result = NodeChildProcess.spawnSync("git", [...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  if (result.error)
    throw new UpstreamSyncError(`Failed to start git: ${result.error.message}.`, args);
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

if (import.meta.main) {
  try {
    const result = runUpstreamSync(parseCliArgs(process.argv.slice(2)), {
      runGit: nodeGitRunner,
      pathExists: NodeFS.existsSync,
    });
    console.log(formatUpstreamSyncReport(result));
    if (result.status === "conflicted") process.exitCode = 2;
  } catch (error) {
    console.error(
      `Upstream sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
