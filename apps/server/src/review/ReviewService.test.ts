import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  ProjectId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ReviewService from "./ReviewService.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

const TEST_THREAD_ID = ThreadId.make("thread-review-service-test");
const TEST_PROJECT_ID = ProjectId.make("project-review-service-test");

function makeLayer(input: {
  readonly detectCalls?: Array<{ readonly cwd: string }>;
  readonly repositoryRoot?: string;
  readonly authorizedCwd?: string;
  readonly gitCalls?: Array<{ readonly operation: string; readonly cwd: string }>;
}) {
  return ReviewService.layer.pipe(
    Layer.provide(
      Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
        get: () => Effect.die("unexpected VCS registry get"),
        resolve: () => Effect.die("unexpected VCS registry resolve"),
        detect: (request) =>
          Effect.sync(() => {
            input.detectCalls?.push({ cwd: request.cwd });
            return input.repositoryRoot
              ? ({
                  kind: "git",
                  repository: {
                    kind: "git",
                    rootPath: input.repositoryRoot,
                    metadataPath: null,
                    freshness: {
                      source: "live-local",
                      observedAt: DateTime.nowUnsafe(),
                      expiresAt: Option.none(),
                    },
                  },
                  driver: {} as VcsDriver.VcsDriver["Service"],
                } satisfies VcsDriverRegistry.VcsDriverHandle)
              : null;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        getReviewDiffPreview: (request) =>
          Effect.sync(() => {
            input.gitCalls?.push({ operation: "preview", cwd: request.cwd });
            return {
              cwd: request.cwd,
              generatedAt: DateTime.nowUnsafe(),
              sources: [],
              commits: [],
              workingTree: { staged: [], unstaged: [], truncated: false },
            };
          }),
        discardReviewChanges: (request) =>
          Effect.sync(() => {
            input.gitCalls?.push({ operation: "discard", cwd: request.cwd });
            return { discardedPaths: request.changes.map((change) => change.path) };
          }),
        stageReviewPaths: (request) =>
          Effect.sync(() => {
            input.gitCalls?.push({ operation: "stage", cwd: request.cwd });
            return { stagedPaths: [...request.paths] };
          }),
        unstageReviewPaths: (request) =>
          Effect.sync(() => {
            input.gitCalls?.push({ operation: "unstage", cwd: request.cwd });
            return { unstagedPaths: request.changes.map((change) => change.path) };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
        getThreadShellById: () =>
          Effect.succeed(
            input.authorizedCwd
              ? Option.some({
                  id: TEST_THREAD_ID,
                  projectId: TEST_PROJECT_ID,
                  worktreePath: input.authorizedCwd,
                } as OrchestrationThreadShell)
              : Option.none(),
          ),
        getProjectShellById: () =>
          Effect.succeed(
            input.authorizedCwd
              ? Option.some({
                  id: TEST_PROJECT_ID,
                  workspaceRoot: input.authorizedCwd,
                } as OrchestrationProjectShell)
              : Option.none(),
          ),
      }),
    ),
    Layer.provide(WorkspacePaths.layer),
    Layer.provideMerge(NodeServices.layer),
  );
}

describe("ReviewService", () => {
  it.effect("runs Git review operations from the detected repository root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const repositoryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-root-" });
      const nestedCwd = `${repositoryRoot}/packages/app`;
      yield* fs.makeDirectory(nestedCwd, { recursive: true });
      const gitCalls: Array<{ readonly operation: string; readonly cwd: string }> = [];

      yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        yield* review.getDiffPreview({ cwd: nestedCwd });
        yield* review.discardChanges({
          cwd: nestedCwd,
          threadId: TEST_THREAD_ID,
          changes: [{ path: "src/app.ts", kind: "modified" }],
        });
        yield* review.stagePaths({
          cwd: nestedCwd,
          threadId: TEST_THREAD_ID,
          paths: ["src/app.ts"],
        });
        yield* review.unstagePaths({
          cwd: nestedCwd,
          threadId: TEST_THREAD_ID,
          changes: [{ path: "src/app.ts", previousPath: null }],
        });
      }).pipe(Effect.provide(makeLayer({ repositoryRoot, authorizedCwd: nestedCwd, gitCalls })));

      assert.deepStrictEqual(gitCalls, [
        { operation: "preview", cwd: repositoryRoot },
        { operation: "discard", cwd: repositoryRoot },
        { operation: "stage", cwd: repositoryRoot },
        { operation: "unstage", cwd: repositoryRoot },
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("uses the requested project cwd instead of the server cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-project-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getDiffPreview({ cwd: projectRoot });
      }).pipe(Effect.provide(makeLayer({ detectCalls })));

      assert.strictEqual(result.cwd, projectRoot);
      assert.deepStrictEqual(result.sources, []);
      assert.deepStrictEqual(detectCalls, [{ cwd: projectRoot }]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects staging paths that escape the repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .stagePaths({
            cwd: workspaceRoot,
            threadId: TEST_THREAD_ID,
            paths: ["../outside.ts"],
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ authorizedCwd: workspaceRoot, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.strictEqual(error.operation, "ReviewService.stagePaths");
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects paths containing null bytes before spawning Git", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .stagePaths({ cwd: workspaceRoot, threadId: TEST_THREAD_ID, paths: ["bad\0path.ts"] })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ authorizedCwd: workspaceRoot, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects discarding paths that escape the repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .discardChanges({
            cwd: workspaceRoot,
            threadId: TEST_THREAD_ID,
            changes: [{ path: "../outside.ts", kind: "modified" }],
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ authorizedCwd: workspaceRoot, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.strictEqual(error.operation, "ReviewService.discardChanges");
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects unstaging paths that escape the repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-workspace-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .unstagePaths({
            cwd: workspaceRoot,
            threadId: TEST_THREAD_ID,
            changes: [{ path: "../outside.ts", previousPath: null }],
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ authorizedCwd: workspaceRoot, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      assert.strictEqual(error.operation, "ReviewService.unstagePaths");
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects mutation cwd outside the thread workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const authorizedCwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-authorized-" });
      const requestedCwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-review-unauthorized-" });
      const detectCalls: Array<{ readonly cwd: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .stagePaths({
            cwd: requestedCwd,
            threadId: TEST_THREAD_ID,
            paths: ["src/app.ts"],
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer({ authorizedCwd, detectCalls })));

      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
      if (error._tag === "VcsRepositoryDetectionError") {
        assert.include(error.detail, "not authorized");
      }
      assert.deepStrictEqual(detectCalls, []);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
