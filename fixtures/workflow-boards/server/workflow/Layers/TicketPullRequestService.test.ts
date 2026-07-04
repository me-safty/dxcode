import { assert, describe, it } from "@effect/vitest";
import { GitCommandError } from "@t3tools/contracts";
import type { PullRequestStep, StepRunId, TicketId } from "../../../contracts/workflow.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkflowEventCommitter } from "../Services/WorkflowEventCommitter.ts";
import type { WorkflowEventInput } from "../Services/WorkflowEventStore.ts";
import { GitHubPort } from "../Services/GitHubPort.ts";
import { MergeGitPort, type MergeGitResult } from "../Services/TicketMergeService.ts";
import { TicketPullRequestService } from "../Services/TicketPullRequestService.ts";
import {
  WorkflowFilesystemCapability,
  WorkflowSourceControlCapability,
  WorkflowVcsCapability,
} from "../Services/WorkflowCapabilities.ts";
import { WorkflowIds, type WorkflowIdsShape } from "../Services/WorkflowIds.ts";
import {
  WorkflowReadModel,
  type TicketPrStateRow,
  type WorkflowReadModelShape,
} from "../Services/WorkflowReadModel.ts";
import { GitHubPortLive } from "./GitHubPort.ts";
import { TicketPullRequestServiceLive } from "./TicketPullRequestService.ts";

const TICKET_ID = "ticket-pr" as TicketId;

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
      cwd: "/repo-worktrees/ticket-pr",
      argumentCount: 4,
      exitCode: 1,
      stderrLength: stderr.length,
      detail: "Git command exited with a non-zero status.",
    }),
    { stderr },
  );

const prInput = (step: Partial<PullRequestStep> = {}) => ({
  ticketId: TICKET_ID,
  stepRunId: "step-run-1" as StepRunId,
  repoRoot: "/repo",
  worktreePath: "/repo-worktrees/ticket-pr",
  worktreeRef: "workflow/ticket-pr",
  step: {
    key: "open-pr" as never,
    type: "pullRequest" as const,
    action: "open" as const,
    ...step,
  },
});

const prStateRow = (overrides: Partial<TicketPrStateRow> = {}): TicketPrStateRow => ({
  prNumber: 42,
  prUrl: "https://github.com/acme/widgets/pull/42",
  branch: "workflow/ticket-pr",
  remoteName: "origin",
  repo: "acme/widgets",
  prState: "open",
  lastHeadSha: null,
  lastCiState: null,
  lastReviewDecision: null,
  lastCommentCursor: null,
  ...overrides,
});

const readModelLayer = (script: { readonly prState?: TicketPrStateRow | null } = {}) =>
  Layer.succeed(WorkflowReadModel, {
    getTicketDetail: () =>
      Effect.succeed({
        ticket: {
          ticketId: "ticket-pr",
          boardId: "board-1",
          title: "Fix login",
          description: "Make login work again",
          currentLaneKey: "open-pr",
          currentLaneEntryToken: "token-1",
          queuedAt: null,
          status: "running",
        },
        steps: [],
        messages: [],
      }),
    getTicketPrState: () => Effect.succeed(script.prState ?? null),
  } as unknown as WorkflowReadModelShape);

const idsLayer = Layer.succeed(WorkflowIds, {
  eventId: () => Effect.succeed("event-1"),
} as unknown as WorkflowIdsShape);

const committerLayer = (committed: WorkflowEventInput[] = []) =>
  Layer.succeed(WorkflowEventCommitter, {
    commit: (event: WorkflowEventInput) =>
      Effect.sync(() => {
        committed.push(event);
      }),
    commitMany: () => Effect.void,
    appendManyUnlocked: () => Effect.succeed([]),
    publishTicketView: () => Effect.void,
  } as never);

const mergeGitLayer = (calls: Array<ReadonlyArray<string>> = []) =>
  Layer.succeed(MergeGitPort, {
    run: (input: { readonly args: ReadonlyArray<string> }) =>
      Effect.sync(() => {
        calls.push(input.args);
        return { exitCode: 0, stdout: "", stderr: "" } satisfies MergeGitResult;
      }),
  });

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
    push: () => Effect.succeed({ status: "pushed", branch: "workflow/ticket-pr" }),
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

const githubLayer = (input: {
  readonly sourceControl?: Partial<WorkflowSourceControlCapability["Service"]>;
  readonly vcs?: Partial<WorkflowVcsCapability["Service"]>;
}) =>
  GitHubPortLive.pipe(
    Layer.provideMerge(sourceControlLayer(input.sourceControl)),
    Layer.provideMerge(vcsLayer(input.vcs)),
    Layer.provideMerge(filesystemLayer),
  );

const serviceLayer = (input: {
  readonly prState?: TicketPrStateRow | null;
  readonly sourceControl?: Partial<WorkflowSourceControlCapability["Service"]>;
  readonly vcs?: Partial<WorkflowVcsCapability["Service"]>;
  readonly committed?: WorkflowEventInput[];
  readonly gitCalls?: Array<ReadonlyArray<string>>;
}) =>
  TicketPullRequestServiceLive.pipe(
    Layer.provideMerge(githubLayer(input)),
    Layer.provideMerge(
      readModelLayer(input.prState === undefined ? {} : { prState: input.prState }),
    ),
    Layer.provideMerge(mergeGitLayer(input.gitCalls)),
    Layer.provideMerge(committerLayer(input.committed)),
    Layer.provideMerge(idsLayer),
  );

describe("TicketPullRequestServiceLive", () => {
  it.effect("blocks a land step when gh reports the PR is not mergeable through stderr", () =>
    Effect.gen(function* () {
      const service = yield* TicketPullRequestService;

      const outcome = yield* service.land(prInput({ action: "land" as const }));

      assert.deepEqual(outcome, {
        _tag: "blocked",
        reason: "Pull request is not mergeable: branch protection rules must be satisfied.",
      });
    }).pipe(
      Effect.provide(
        serviceLayer({
          prState: prStateRow(),
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

  it.effect("blocks an open step on a diverged push and does not commit TicketPrOpened", () => {
    const committed: WorkflowEventInput[] = [];
    return Effect.gen(function* () {
      const service = yield* TicketPullRequestService;

      const outcome = yield* service.open(prInput());

      assert.equal(outcome._tag, "blocked");
      if (outcome._tag === "blocked") {
        assert.match(outcome.reason, /^branch diverged:/);
      }
      assert.equal(committed.length, 0);
    }).pipe(
      Effect.provide(
        serviceLayer({
          committed,
          vcs: {
            push: () =>
              Effect.fail(
                redactedGitError(
                  "! [rejected] workflow/ticket-pr -> workflow/ticket-pr (non-fast-forward)",
                ),
              ),
          },
        }),
      ),
    );
  });

  it.effect("still supports a direct GitHubPort fake returning ok:false", () =>
    Effect.gen(function* () {
      const service = yield* TicketPullRequestService;
      const outcome = yield* service.land(prInput({ action: "land" as const }));

      assert.deepEqual(outcome, {
        _tag: "blocked",
        reason: "branch protection: review required",
      });
    }).pipe(
      Effect.provide(
        TicketPullRequestServiceLive.pipe(
          Layer.provideMerge(
            Layer.succeed(GitHubPort, {
              preflight: () => Effect.succeed({ ok: true }),
              resolveRemote: () => Effect.die("unused resolveRemote"),
              defaultBranch: () => Effect.succeed("main"),
              openPr: () => Effect.die("unused openPr"),
              prDetail: () => Effect.die("unused prDetail"),
              findPrForBranch: () => Effect.die("unused findPrForBranch"),
              mergePr: () =>
                Effect.succeed({ ok: false, reason: "branch protection: review required" }),
              failingCheckLogs: () => Effect.die("unused failingCheckLogs"),
              listReviewFeedback: () => Effect.die("unused listReviewFeedback"),
            }),
          ),
          Layer.provideMerge(readModelLayer({ prState: prStateRow() })),
          Layer.provideMerge(mergeGitLayer()),
          Layer.provideMerge(committerLayer()),
          Layer.provideMerge(idsLayer),
        ),
      ),
    ),
  );
});
