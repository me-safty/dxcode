import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { type NightlyTagRef, parseLsRemoteNightlyTags, parseNightlyTag } from "./NightlyTag.ts";

const EXPECTED_ORIGIN = "github.com/me-safty/dxcode";
const EXPECTED_UPSTREAM = "github.com/pingdotgg/t3code";
const BASE_REF = "dx/main";
const NIGHTLY_NAMESPACE = "refs/dx/upstream-nightlies";
const GIT_TIMEOUT_MS = 60_000;

export class GitUpstreamAdapterError extends Data.TaggedError("GitUpstreamAdapterError")<{
  readonly operation: string;
  readonly message: string;
  readonly canRetry: boolean;
}> {}

const adapterError = (operation: string, message: string, canRetry = false) =>
  new GitUpstreamAdapterError({ operation, message, canRetry });

export interface PreparedMerge {
  readonly status: "ready" | "conflicted";
  readonly conflicts: ReadonlyArray<string>;
}

export interface ComparisonReport {
  readonly baseCommit: string;
  readonly upstreamFiles: ReadonlyArray<string>;
  readonly dxFiles: ReadonlyArray<string>;
  readonly overlappingFiles: ReadonlyArray<string>;
}

export class GitUpstreamAdapter extends Context.Service<
  GitUpstreamAdapter,
  {
    readonly validateRepository: (cwd: string) => Effect.Effect<void, GitUpstreamAdapterError>;
    readonly listNightlies: (
      cwd: string,
      exactTag?: string,
    ) => Effect.Effect<ReadonlyArray<NightlyTagRef>, GitUpstreamAdapterError>;
    readonly fetchNightly: (
      cwd: string,
      ref: NightlyTagRef,
    ) => Effect.Effect<string, GitUpstreamAdapterError>;
    readonly recheckRemoteObject: (
      cwd: string,
      ref: NightlyTagRef,
    ) => Effect.Effect<void, GitUpstreamAdapterError>;
    readonly isAncestor: (
      cwd: string,
      ancestor: string,
      descendant: string,
    ) => Effect.Effect<boolean, GitUpstreamAdapterError>;
    readonly countCommits: (
      cwd: string,
      targetCommit: string,
    ) => Effect.Effect<number, GitUpstreamAdapterError>;
    readonly comparisonReport: (
      cwd: string,
      targetCommit: string,
    ) => Effect.Effect<ComparisonReport, GitUpstreamAdapterError>;
    readonly prepareMerge: (input: {
      readonly cwd: string;
      readonly branch: string;
      readonly worktreePath: string;
      readonly targetCommit: string;
    }) => Effect.Effect<PreparedMerge, GitUpstreamAdapterError>;
    readonly abortMerge: (worktreePath: string) => Effect.Effect<void, GitUpstreamAdapterError>;
    readonly worktreeStatus: (
      worktreePath: string,
    ) => Effect.Effect<ReadonlyArray<string>, GitUpstreamAdapterError>;
  }
>()("t3/upstreamSync/GitUpstreamAdapter") {}

const nonEmptyLines = (value: string): ReadonlyArray<string> =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseCount = (value: string): number => {
  const count = Number(value.trim());
  if (!Number.isSafeInteger(count) || count < 0) {
    throw adapterError("count-commits", "Git returned an invalid commit count.");
  }
  return count;
};

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;

  const run = Effect.fn("GitUpstreamAdapter.run")(function* (input: {
    readonly cwd: string;
    readonly operation: string;
    readonly args: ReadonlyArray<string>;
    readonly allowNonZeroExit?: boolean;
    readonly canRetry?: boolean;
  }) {
    return yield* git
      .execute({
        cwd: input.cwd,
        operation: input.operation,
        args: input.args,
        timeoutMs: GIT_TIMEOUT_MS,
        ...(input.allowNonZeroExit === undefined
          ? {}
          : { allowNonZeroExit: input.allowNonZeroExit }),
      })
      .pipe(
        Effect.mapError(() =>
          adapterError(
            input.operation,
            `Git operation failed: ${input.operation}.`,
            input.canRetry ?? false,
          ),
        ),
      );
  });

  const remoteUrl = Effect.fn("GitUpstreamAdapter.remoteUrl")(function* (
    cwd: string,
    remote: "origin" | "upstream",
  ) {
    const result = yield* run({
      cwd,
      operation: `validate-${remote}`,
      args: ["remote", "get-url", remote],
    });
    return result.stdout.trim();
  });

  const validateRepository = Effect.fn("GitUpstreamAdapter.validateRepository")(function* (
    cwd: string,
  ) {
    yield* run({ cwd, operation: "repository-check", args: ["rev-parse", "--show-toplevel"] });
    const [origin, upstream] = yield* Effect.all([
      remoteUrl(cwd, "origin"),
      remoteUrl(cwd, "upstream"),
    ]);
    if (normalizeGitRemoteUrl(origin) !== EXPECTED_ORIGIN) {
      return yield* adapterError(
        "validate-origin",
        "The configured source repository origin is not me-safty/dxcode.",
      );
    }
    if (normalizeGitRemoteUrl(upstream) !== EXPECTED_UPSTREAM) {
      return yield* adapterError(
        "validate-upstream",
        "The configured upstream remote is not pingdotgg/t3code.",
      );
    }
  });

  const listNightlies = Effect.fn("GitUpstreamAdapter.listNightlies")(function* (
    cwd: string,
    exactTag?: string,
  ) {
    if (exactTag !== undefined && parseNightlyTag(exactTag) === null) {
      return yield* adapterError("list-nightlies", "Invalid nightly tag.");
    }
    const pattern = exactTag ? `refs/tags/${exactTag}` : "refs/tags/v*-nightly.*";
    const result = yield* run({
      cwd,
      operation: "list-nightlies",
      args: ["ls-remote", "--refs", "--tags", "upstream", pattern],
      canRetry: true,
    });
    return parseLsRemoteNightlyTags(result.stdout);
  });

  const fetchNightly = Effect.fn("GitUpstreamAdapter.fetchNightly")(function* (
    cwd: string,
    ref: NightlyTagRef,
  ) {
    const namespaceRef = `${NIGHTLY_NAMESPACE}/${ref.tag}`;
    const existing = yield* run({
      cwd,
      operation: "read-nightly-cache",
      args: ["show-ref", "--hash", "--verify", namespaceRef],
      allowNonZeroExit: true,
    });
    if (existing.exitCode === 0 && existing.stdout.trim().toLowerCase() !== ref.remoteObject) {
      return yield* adapterError(
        "fetch-nightly",
        "The upstream nightly tag changed after detection. Review the remote before continuing.",
      );
    }
    if (existing.exitCode !== 0) {
      yield* run({
        cwd,
        operation: "fetch-nightly",
        args: ["fetch", "--no-tags", "upstream", `refs/tags/${ref.tag}:${namespaceRef}`],
        canRetry: true,
      });
    }
    const resolved = yield* run({
      cwd,
      operation: "resolve-nightly",
      args: ["rev-parse", `${namespaceRef}^{commit}`],
    });
    const commit = resolved.stdout.trim().toLowerCase();
    if (!/^[0-9a-f]{40,64}$/.test(commit)) {
      return yield* adapterError(
        "resolve-nightly",
        "The upstream nightly did not resolve to an immutable commit.",
      );
    }
    return commit;
  });

  const recheckRemoteObject = Effect.fn("GitUpstreamAdapter.recheckRemoteObject")(function* (
    cwd: string,
    ref: NightlyTagRef,
  ) {
    const current = yield* listNightlies(cwd, ref.tag);
    if (current.length !== 1 || current[0]?.remoteObject !== ref.remoteObject) {
      return yield* adapterError(
        "recheck-nightly",
        "The upstream nightly tag changed after detection. Review the remote before continuing.",
      );
    }
  });

  const isAncestor = Effect.fn("GitUpstreamAdapter.isAncestor")(function* (
    cwd: string,
    ancestor: string,
    descendant: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "check-ancestry",
      args: ["merge-base", "--is-ancestor", ancestor, descendant],
      allowNonZeroExit: true,
    });
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    return yield* adapterError("check-ancestry", "Git ancestry check failed.");
  });

  const countCommits = Effect.fn("GitUpstreamAdapter.countCommits")(function* (
    cwd: string,
    targetCommit: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "count-commits",
      args: ["rev-list", "--count", `${BASE_REF}..${targetCommit}`],
    });
    return parseCount(result.stdout);
  });

  const changedFiles = Effect.fn("GitUpstreamAdapter.changedFiles")(function* (
    cwd: string,
    range: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "compare-changed-files",
      args: ["diff", "--name-only", range],
    });
    return nonEmptyLines(result.stdout);
  });

  const comparisonReport = Effect.fn("GitUpstreamAdapter.comparisonReport")(function* (
    cwd: string,
    targetCommit: string,
  ) {
    const mergeBase = yield* run({
      cwd,
      operation: "comparison-merge-base",
      args: ["merge-base", BASE_REF, targetCommit],
    });
    const baseCommit = mergeBase.stdout.trim();
    const [upstreamFiles, dxFiles] = yield* Effect.all([
      changedFiles(cwd, `${baseCommit}..${targetCommit}`),
      changedFiles(cwd, `${baseCommit}..${BASE_REF}`),
    ]);
    const dxSet = new Set(dxFiles);
    return {
      baseCommit,
      upstreamFiles,
      dxFiles,
      overlappingFiles: upstreamFiles.filter((file) => dxSet.has(file)),
    } satisfies ComparisonReport;
  });

  const prepareMerge = Effect.fn("GitUpstreamAdapter.prepareMerge")(function* (input: {
    readonly cwd: string;
    readonly branch: string;
    readonly worktreePath: string;
    readonly targetCommit: string;
  }) {
    const branch = yield* run({
      cwd: input.cwd,
      operation: "check-sync-branch",
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${input.branch}`],
      allowNonZeroExit: true,
    });
    if (branch.exitCode === 0) {
      return yield* adapterError("prepare-merge", `Sync branch already exists: ${input.branch}.`);
    }
    if (branch.exitCode !== 1) {
      return yield* adapterError("prepare-merge", "Sync branch lookup failed.");
    }
    yield* run({
      cwd: input.cwd,
      operation: "create-sync-worktree",
      args: ["worktree", "add", "-b", input.branch, input.worktreePath, BASE_REF],
    });
    const merge = yield* run({
      cwd: input.worktreePath,
      operation: "prepare-pinned-merge",
      args: ["merge", "--no-ff", "--no-commit", input.targetCommit],
      allowNonZeroExit: true,
    });
    if (merge.exitCode === 0) return { status: "ready", conflicts: [] } as const;
    const conflicts = yield* run({
      cwd: input.worktreePath,
      operation: "read-merge-conflicts",
      args: ["diff", "--name-only", "--diff-filter=U"],
    });
    const paths = nonEmptyLines(conflicts.stdout);
    if (paths.length === 0) {
      return yield* adapterError(
        "prepare-pinned-merge",
        "Pinned upstream merge failed without unresolved files.",
      );
    }
    return { status: "conflicted", conflicts: paths } as const;
  });

  const abortMerge = Effect.fn("GitUpstreamAdapter.abortMerge")(function* (worktreePath: string) {
    const result = yield* run({
      cwd: worktreePath,
      operation: "abort-sync-merge",
      args: ["merge", "--abort"],
      allowNonZeroExit: true,
    });
    if (result.exitCode !== 0) {
      return yield* adapterError(
        "abort-sync-merge",
        "Could not abort the synchronization merge. The worktree was preserved.",
      );
    }
  });

  const worktreeStatus = Effect.fn("GitUpstreamAdapter.worktreeStatus")(function* (
    worktreePath: string,
  ) {
    const result = yield* run({
      cwd: worktreePath,
      operation: "read-sync-worktree-status",
      args: ["status", "--porcelain"],
    });
    return nonEmptyLines(result.stdout);
  });

  return GitUpstreamAdapter.of({
    validateRepository,
    listNightlies,
    fetchNightly,
    recheckRemoteObject,
    isAncestor,
    countCommits,
    comparisonReport,
    prepareMerge,
    abortMerge,
    worktreeStatus,
  });
});

export const layer = Layer.effect(GitUpstreamAdapter, make);

export const UPSTREAM_BASE_REF = BASE_REF;
