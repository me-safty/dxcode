import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const EXPECTED_ORIGIN = "github.com/me-safty/dxcode";
const REMOTE_BRANCH = "refs/heads/dx/main";
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40,64}$/;
const GIT_TIMEOUT_MS = 60_000;

export type DxRemoteClassification =
  | { readonly status: "same" }
  | { readonly status: "remote-ahead"; readonly commitsBehind: number }
  | { readonly status: "installed-ahead" }
  | { readonly status: "diverged" }
  | { readonly status: "unknown-installed" };

export class GitDxReleaseAdapterError extends Data.TaggedError("GitDxReleaseAdapterError")<{
  readonly operation: string;
  readonly message: string;
  readonly canRetry: boolean;
}> {}

const adapterError = (operation: string, message: string, canRetry = false) =>
  new GitDxReleaseAdapterError({ operation, message, canRetry });

const parseCommit = (
  operation: string,
  value: string,
): Effect.Effect<string, GitDxReleaseAdapterError> => {
  const commit = value.trim().toLowerCase();
  return FULL_COMMIT_PATTERN.test(commit)
    ? Effect.succeed(commit)
    : Effect.fail(adapterError(operation, "Git returned an invalid commit identifier."));
};

export class GitDxReleaseAdapter extends Context.Service<
  GitDxReleaseAdapter,
  {
    readonly validateRepository: (cwd: string) => Effect.Effect<void, GitDxReleaseAdapterError>;
    readonly remoteHead: (cwd: string) => Effect.Effect<string, GitDxReleaseAdapterError>;
    readonly fetchRemoteHead: (
      cwd: string,
      expectedCommit: string,
    ) => Effect.Effect<string, GitDxReleaseAdapterError>;
    readonly classifyInstalled: (input: {
      readonly cwd: string;
      readonly installedCommit: string;
      readonly remoteCommit: string;
    }) => Effect.Effect<DxRemoteClassification, GitDxReleaseAdapterError>;
    readonly localMainCommit: (cwd: string) => Effect.Effect<string, GitDxReleaseAdapterError>;
    readonly findMainWorktree: (cwd: string) => Effect.Effect<string, GitDxReleaseAdapterError>;
    readonly requireCleanMain: (cwd: string) => Effect.Effect<string, GitDxReleaseAdapterError>;
    readonly fastForwardMain: (
      cwd: string,
      commit: string,
    ) => Effect.Effect<void, GitDxReleaseAdapterError>;
    readonly pushSyncBranch: (
      cwd: string,
      branch: string,
    ) => Effect.Effect<void, GitDxReleaseAdapterError>;
    readonly pushMain: (cwd: string) => Effect.Effect<void, GitDxReleaseAdapterError>;
    readonly commitPreparedSync: (input: {
      readonly cwd: string;
      readonly tag: string;
      readonly targetCommit: string;
      readonly nightlyCount: number;
    }) => Effect.Effect<string, GitDxReleaseAdapterError>;
  }
>()("t3/dxLocalUpdate/GitDxReleaseAdapter") {}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;

  const run = Effect.fn("GitDxReleaseAdapter.run")(function* (input: {
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

  const isAncestor = Effect.fn("GitDxReleaseAdapter.isAncestor")(function* (
    cwd: string,
    ancestor: string,
    descendant: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "classify-ancestry",
      args: ["merge-base", "--is-ancestor", ancestor, descendant],
      allowNonZeroExit: true,
    });
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    return yield* adapterError("classify-ancestry", "Could not classify DX branch ancestry.");
  });

  const objectExists = Effect.fn("GitDxReleaseAdapter.objectExists")(function* (
    cwd: string,
    commit: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "verify-installed-object",
      args: ["cat-file", "-e", `${commit}^{commit}`],
      allowNonZeroExit: true,
    });
    return result.exitCode === 0;
  });

  const refExists = Effect.fn("GitDxReleaseAdapter.refExists")(function* (
    cwd: string,
    ref: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "verify-isolated-origin-ref",
      args: ["show-ref", "--verify", "--quiet", ref],
      allowNonZeroExit: true,
    });
    return result.exitCode === 0;
  });

  const validateRepository = Effect.fn("GitDxReleaseAdapter.validateRepository")(function* (
    cwd: string,
  ) {
    yield* run({ cwd, operation: "repository-check", args: ["rev-parse", "--show-toplevel"] });
    const origin = yield* run({
      cwd,
      operation: "validate-origin",
      args: ["remote", "get-url", "origin"],
    });
    if (normalizeGitRemoteUrl(origin.stdout.trim()) !== EXPECTED_ORIGIN) {
      return yield* adapterError(
        "validate-origin",
        "The configured source repository origin is not me-safty/dxcode.",
      );
    }
  });

  const remoteHead = Effect.fn("GitDxReleaseAdapter.remoteHead")(function* (cwd: string) {
    const result = yield* run({
      cwd,
      operation: "read-origin-dx-main",
      args: ["ls-remote", "--heads", "origin", REMOTE_BRANCH],
      canRetry: true,
    });
    const fields = result.stdout.trim().split(/\s+/u);
    if (fields.length !== 2 || fields[1] !== REMOTE_BRANCH) {
      return yield* adapterError(
        "read-origin-dx-main",
        "origin/dx/main was not found or returned an ambiguous result.",
        true,
      );
    }
    return yield* parseCommit("read-origin-dx-main", fields[0] ?? "");
  });

  const fetchRemoteHead = Effect.fn("GitDxReleaseAdapter.fetchRemoteHead")(function* (
    cwd: string,
    expectedCommit: string,
  ) {
    const expected = yield* parseCommit("fetch-origin-dx-main", expectedCommit);
    const isolatedRef = `refs/dx/origin-main/${expected}`;
    if (!(yield* refExists(cwd, isolatedRef))) {
      yield* run({
        cwd,
        operation: "fetch-origin-dx-main",
        args: ["fetch", "--no-tags", "origin", `${REMOTE_BRANCH}:${isolatedRef}`],
        canRetry: true,
      });
    }
    const resolved = yield* run({
      cwd,
      operation: "verify-origin-dx-main",
      args: ["rev-parse", `${isolatedRef}^{commit}`],
    });
    const actual = yield* parseCommit("verify-origin-dx-main", resolved.stdout);
    if (actual !== expected) {
      return yield* adapterError(
        "verify-origin-dx-main",
        "origin/dx/main moved while the update was being prepared.",
        true,
      );
    }
    return isolatedRef;
  });

  const classifyInstalled = Effect.fn("GitDxReleaseAdapter.classifyInstalled")(function* (input: {
    readonly cwd: string;
    readonly installedCommit: string;
    readonly remoteCommit: string;
  }) {
    if (!(yield* objectExists(input.cwd, input.installedCommit))) {
      return { status: "unknown-installed" } as const;
    }
    if (input.installedCommit === input.remoteCommit) return { status: "same" } as const;
    if (yield* isAncestor(input.cwd, input.installedCommit, input.remoteCommit)) {
      const count = yield* run({
        cwd: input.cwd,
        operation: "count-origin-dx-main",
        args: ["rev-list", "--count", `${input.installedCommit}..${input.remoteCommit}`],
      });
      const commitsBehind = Number(count.stdout.trim());
      if (!Number.isSafeInteger(commitsBehind) || commitsBehind < 1) {
        return yield* adapterError("count-origin-dx-main", "Git returned an invalid commit count.");
      }
      return { status: "remote-ahead", commitsBehind } as const;
    }
    if (yield* isAncestor(input.cwd, input.remoteCommit, input.installedCommit)) {
      return { status: "installed-ahead" } as const;
    }
    return { status: "diverged" } as const;
  });

  const localMainCommit = Effect.fn("GitDxReleaseAdapter.localMainCommit")(function* (cwd: string) {
    const result = yield* run({
      cwd,
      operation: "resolve-local-dx-main",
      args: ["rev-parse", "dx/main"],
    });
    return yield* parseCommit("resolve-local-dx-main", result.stdout);
  });

  const findMainWorktree = Effect.fn("GitDxReleaseAdapter.findMainWorktree")(function* (
    cwd: string,
  ) {
    const result = yield* run({
      cwd,
      operation: "find-dx-main-worktree",
      args: ["worktree", "list", "--porcelain"],
    });
    const entries = result.stdout.split(/\n\n+/u);
    for (const entry of entries) {
      const lines = entry.split("\n");
      if (!lines.includes("branch refs/heads/dx/main")) continue;
      const worktreeLine = lines.find((line) => line.startsWith("worktree "));
      if (worktreeLine) return worktreeLine.slice("worktree ".length);
    }
    return yield* adapterError(
      "find-dx-main-worktree",
      "No worktree currently owns the local dx/main branch.",
    );
  });

  const requireCleanMain = Effect.fn("GitDxReleaseAdapter.requireCleanMain")(function* (
    cwd: string,
  ) {
    const branch = yield* run({
      cwd,
      operation: "validate-dx-main-branch",
      args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    });
    if (branch.stdout.trim() !== "dx/main") {
      return yield* adapterError(
        "validate-dx-main-branch",
        "The update worktree is not on dx/main.",
      );
    }
    const status = yield* run({
      cwd,
      operation: "validate-clean-dx-main",
      args: ["status", "--porcelain=v1", "--untracked-files=normal"],
    });
    if (status.stdout.trim().length > 0) {
      return yield* adapterError(
        "validate-clean-dx-main",
        "The dx/main worktree contains local changes. Preserve them and recover manually.",
      );
    }
    return yield* localMainCommit(cwd);
  });

  const fastForwardMain = Effect.fn("GitDxReleaseAdapter.fastForwardMain")(function* (
    cwd: string,
    commit: string,
  ) {
    yield* requireCleanMain(cwd);
    yield* run({
      cwd,
      operation: "fast-forward-dx-main",
      args: ["merge", "--ff-only", commit],
    });
  });

  const pushSyncBranch = Effect.fn("GitDxReleaseAdapter.pushSyncBranch")(function* (
    cwd: string,
    branch: string,
  ) {
    yield* run({
      cwd,
      operation: "push-sync-branch",
      args: ["push", "-u", "origin", branch],
      canRetry: true,
    });
  });

  const pushMain = Effect.fn("GitDxReleaseAdapter.pushMain")(function* (cwd: string) {
    yield* run({
      cwd,
      operation: "push-dx-main",
      args: ["push", "origin", "refs/heads/dx/main:refs/heads/dx/main"],
      canRetry: true,
    });
  });

  const commitPreparedSync = Effect.fn("GitDxReleaseAdapter.commitPreparedSync")(function* (input: {
    readonly cwd: string;
    readonly tag: string;
    readonly targetCommit: string;
    readonly nightlyCount: number;
  }) {
    const conflicts = yield* run({
      cwd: input.cwd,
      operation: "validate-sync-conflicts",
      args: ["diff", "--name-only", "--diff-filter=U"],
    });
    if (conflicts.stdout.trim().length > 0) {
      return yield* adapterError(
        "validate-sync-conflicts",
        "The synchronization still has unresolved conflicts.",
      );
    }
    const mergeHead = yield* run({
      cwd: input.cwd,
      operation: "validate-sync-merge",
      args: ["rev-parse", "--quiet", "--verify", "MERGE_HEAD"],
      allowNonZeroExit: true,
    });
    if (mergeHead.exitCode !== 0) {
      return yield* adapterError(
        "validate-sync-merge",
        "The pinned synchronization merge is no longer in progress.",
      );
    }
    const message = [
      `chore: sync T3 ${input.tag}`,
      "",
      `T3-Upstream-Tag: ${input.tag}`,
      `T3-Upstream-Commit: ${input.targetCommit}`,
      `T3-Nightlies-Detected: ${input.nightlyCount}`,
    ].join("\n");
    yield* run({
      cwd: input.cwd,
      operation: "commit-sync",
      args: ["commit", "-m", message],
    });
    const head = yield* run({
      cwd: input.cwd,
      operation: "resolve-sync-commit",
      args: ["rev-parse", "HEAD"],
    });
    return yield* parseCommit("resolve-sync-commit", head.stdout);
  });

  return GitDxReleaseAdapter.of({
    validateRepository,
    remoteHead,
    fetchRemoteHead,
    classifyInstalled,
    localMainCommit,
    findMainWorktree,
    requireCleanMain,
    fastForwardMain,
    pushSyncBranch,
    pushMain,
    commitPreparedSync,
  });
});

export const layer = Layer.effect(GitDxReleaseAdapter, make);
