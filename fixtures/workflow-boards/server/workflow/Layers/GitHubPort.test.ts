import { assert, describe, it } from "@effect/vitest";
import { GitCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { GitHubPort } from "../Services/GitHubPort.ts";
import {
  WorkflowFilesystemCapability,
  WorkflowSourceControlCapability,
  WorkflowVcsCapability,
} from "../Services/WorkflowCapabilities.ts";
import { GitHubPortLive } from "./GitHubPort.ts";

const redactedGitHubError = (stderr: string): Error =>
  Object.assign(new Error("GitHub CLI failed in execute: GitHub CLI command failed."), {
    cause: new Error(stderr),
    detail: "GitHub CLI command failed.",
  });

const redactedGitError = (stderr: string): GitCommandError =>
  Object.assign(
    new GitCommandError({
      operation: "PluginVcsCapability.push",
      command: "git",
      cwd: "/repo",
      argumentCount: 4,
      exitCode: 1,
      stderrLength: stderr.length,
      detail: "Git command exited with a non-zero status.",
    }),
    { stderr },
  );

const sourceControlLayer = (overrides: Partial<WorkflowSourceControlCapability["Service"]> = {}) =>
  Layer.succeed(WorkflowSourceControlCapability, {
    detectProvider: () =>
      Effect.succeed({
        provider: { kind: "github", name: "GitHub", baseUrl: "https://github.com" },
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/widgets.git",
      }),
    discoverProviders: Effect.succeed([]),
    listOpenPullRequests: () => Effect.succeed([]),
    getPullRequest: () => Effect.die("unused getPullRequest"),
    getRepositoryCloneUrls: () => Effect.die("unused getRepositoryCloneUrls"),
    createPullRequest: () => Effect.die("unused createPullRequest"),
    mergePullRequest: () => Effect.void,
    getPullRequestDetail: () => Effect.die("unused getPullRequestDetail"),
    listPullRequestChecks: () => Effect.succeed([]),
    listPullRequestReviews: () => Effect.succeed([]),
    listPullRequestReviewComments: () => Effect.succeed([]),
    getDefaultBranch: () => Effect.succeed("main"),
    checkoutPullRequest: () => Effect.die("unused checkoutPullRequest"),
    ...overrides,
  } as never);

const vcsLayer = (overrides: Partial<WorkflowVcsCapability["Service"]> = {}) =>
  Layer.succeed(WorkflowVcsCapability, {
    status: () => Effect.die("unused status"),
    listWorktrees: () => Effect.die("unused listWorktrees"),
    createWorktree: () => Effect.die("unused createWorktree"),
    removeWorktree: () => Effect.die("unused removeWorktree"),
    createBranch: () => Effect.die("unused createBranch"),
    switchRef: () => Effect.die("unused switchRef"),
    removePath: () => Effect.die("unused removePath"),
    clean: () => Effect.die("unused clean"),
    currentBranch: () => Effect.die("unused currentBranch"),
    aheadCount: () => Effect.die("unused aheadCount"),
    listRefs: () => Effect.die("unused listRefs"),
    commit: () => Effect.die("unused commit"),
    merge: () => Effect.die("unused merge"),
    push: () => Effect.succeed({ status: "pushed", branch: "feature/x" }),
    workingTreeDiff: () => Effect.die("unused workingTreeDiff"),
    diffRefs: () => Effect.die("unused diffRefs"),
    createCheckpoint: () => Effect.die("unused createCheckpoint"),
    hasCheckpoint: () => Effect.die("unused hasCheckpoint"),
    restoreCheckpoint: () => Effect.die("unused restoreCheckpoint"),
    deleteCheckpoints: () => Effect.die("unused deleteCheckpoints"),
    ...overrides,
  } as never);

const filesystemLayer = Layer.succeed(WorkflowFilesystemCapability, {
  listRoots: () => Effect.succeed([]),
  readFile: () => Effect.die("unused readFile"),
  readFileString: () => Effect.die("unused readFileString"),
  readFileStringCapped: () => Effect.die("unused readFileStringCapped"),
  writeFile: () => Effect.void,
  writeFileString: () => Effect.void,
  createFileExclusive: () => Effect.void,
  exists: () => Effect.succeed(false),
  stat: () => Effect.die("unused stat"),
  listDir: () => Effect.succeed([]),
  listDirRecursive: () => Effect.succeed([]),
  makeDirectory: () => Effect.void,
  remove: () => Effect.void,
  rename: () => Effect.void,
} as never);

const layer = (
  input: {
    readonly sourceControl?: Partial<WorkflowSourceControlCapability["Service"]>;
    readonly vcs?: Partial<WorkflowVcsCapability["Service"]>;
  } = {},
) =>
  GitHubPortLive.pipe(
    Layer.provideMerge(sourceControlLayer(input.sourceControl)),
    Layer.provideMerge(vcsLayer(input.vcs)),
    Layer.provideMerge(filesystemLayer),
  );

describe("GitHubPortLive", () => {
  it.effect("classifies redacted gh not-mergeable stderr as an ok:false merge result", () =>
    Effect.gen(function* () {
      const port = yield* GitHubPort;

      const result = yield* port.mergePr({
        cwd: "/repo",
        prNumber: 42,
        strategy: "squash",
        deleteBranch: false,
        branch: "feature/x",
        remoteName: "origin",
      });

      assert.equal(result.ok, false);
      if (result.ok === false) {
        assert.match(result.reason, /branch protection/i);
      }
    }).pipe(
      Effect.provide(
        layer({
          sourceControl: {
            mergePullRequest: () =>
              Effect.fail(
                redactedGitHubError(
                  "Pull request is not mergeable: branch protection rules must be satisfied.",
                ),
              ),
          },
        }),
      ),
    ),
  );

  it.effect("classifies redacted git push stderr as branch diverged", () =>
    Effect.gen(function* () {
      const port = yield* GitHubPort;

      const error = yield* port
        .openPr({
          cwd: "/repo",
          branch: "feature/x",
          base: "main",
          title: "Feature",
          body: "Body",
          draft: false,
        })
        .pipe(Effect.flip);

      assert.match(error.message, /^branch diverged:/);
    }).pipe(
      Effect.provide(
        layer({
          vcs: {
            push: () =>
              Effect.fail(
                redactedGitError("! [rejected] feature/x -> feature/x (non-fast-forward)"),
              ),
          },
        }),
      ),
    ),
  );

  it.effect("does not classify remote hook rejections as branch divergence", () =>
    Effect.gen(function* () {
      const port = yield* GitHubPort;

      const error = yield* port
        .openPr({
          cwd: "/repo",
          branch: "feature/x",
          base: "main",
          title: "Feature",
          body: "Body",
          draft: false,
        })
        .pipe(Effect.flip);

      assert.match(error.message, /^failed to push branch:/);
    }).pipe(
      Effect.provide(
        layer({
          vcs: {
            push: () =>
              Effect.fail(
                redactedGitError("! [remote rejected] feature/x -> feature/x (pre-receive hook)"),
              ),
          },
        }),
      ),
    ),
  );
});
