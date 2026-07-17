import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  type ReviewDiscardChangesError,
  type ReviewDiscardChangesInput,
  type ReviewDiscardChangesResult,
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  type ReviewStagePathsError,
  type ReviewStagePathsInput,
  type ReviewStagePathsResult,
  type ReviewUnstagePathsError,
  type ReviewUnstagePathsInput,
  type ReviewUnstagePathsResult,
} from "@t3tools/contracts";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly discardChanges: (
      input: ReviewDiscardChangesInput,
    ) => Effect.Effect<ReviewDiscardChangesResult, ReviewDiscardChangesError>;
    readonly stagePaths: (
      input: ReviewStagePathsInput,
    ) => Effect.Effect<ReviewStagePathsResult, ReviewStagePathsError>;
    readonly unstagePaths: (
      input: ReviewUnstagePathsInput,
    ) => Effect.Effect<ReviewUnstagePathsResult, ReviewUnstagePathsError>;
  }
>()("t3/review/ReviewService") {}

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

  type MutationOperation =
    | "ReviewService.discardChanges"
    | "ReviewService.stagePaths"
    | "ReviewService.unstagePaths";

  const mutationContextError = (operation: MutationOperation, cwd: string, detail: string) =>
    new VcsRepositoryDetectionError({ operation, cwd, detail });

  const canonicalizeWorkspace = Effect.fn("ReviewService.canonicalizeWorkspace")(function* (
    operation: MutationOperation,
    cwd: string,
  ) {
    const normalized = yield* workspacePaths
      .normalizeWorkspaceRoot(cwd)
      .pipe(
        Effect.mapError(() =>
          mutationContextError(operation, cwd, "Review workspace is unavailable or invalid."),
        ),
      );
    return yield* fileSystem
      .realPath(normalized)
      .pipe(
        Effect.mapError(() =>
          mutationContextError(operation, cwd, "Review workspace could not be canonicalized."),
        ),
      );
  });

  const resolveAuthorizedMutationCwd = Effect.fn("ReviewService.resolveAuthorizedMutationCwd")(
    function* (
      operation: MutationOperation,
      input: { readonly cwd: string; readonly threadId: ReviewStagePathsInput["threadId"] },
    ) {
      const thread = yield* projectionSnapshotQuery
        .getThreadShellById(input.threadId)
        .pipe(
          Effect.mapError(() =>
            mutationContextError(
              operation,
              input.cwd,
              "Review thread context could not be loaded.",
            ),
          ),
        );
      if (Option.isNone(thread)) {
        return yield* mutationContextError(
          operation,
          input.cwd,
          "Review thread does not exist or is archived.",
        );
      }
      const project = yield* projectionSnapshotQuery
        .getProjectShellById(thread.value.projectId)
        .pipe(
          Effect.mapError(() =>
            mutationContextError(
              operation,
              input.cwd,
              "Review project context could not be loaded.",
            ),
          ),
        );
      if (Option.isNone(project)) {
        return yield* mutationContextError(
          operation,
          input.cwd,
          "Review project does not exist or is archived.",
        );
      }

      const authorizedCwd = thread.value.worktreePath ?? project.value.workspaceRoot;
      const [requestedCanonicalCwd, authorizedCanonicalCwd] = yield* Effect.all([
        canonicalizeWorkspace(operation, input.cwd),
        canonicalizeWorkspace(operation, authorizedCwd),
      ]);
      if (requestedCanonicalCwd !== authorizedCanonicalCwd) {
        return yield* mutationContextError(
          operation,
          input.cwd,
          "Review workspace is not authorized for this thread.",
        );
      }
      return authorizedCanonicalCwd;
    },
  );

  const validatePaths = Effect.fn("ReviewService.validatePaths")(function* (
    operation: MutationOperation,
    cwd: string,
    paths: ReadonlyArray<string>,
  ) {
    for (const filePath of paths) {
      const normalized = path.normalize(filePath);
      if (
        filePath.includes("\0") ||
        path.isAbsolute(filePath) ||
        normalized === ".." ||
        normalized.startsWith(`..${path.sep}`)
      ) {
        return yield* new VcsRepositoryDetectionError({
          operation,
          cwd,
          detail: `Review file path must stay within the repository: ${filePath}`,
        });
      }
    }
  });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
        workingTree: { staged: [], unstaged: [], truncated: false },
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview({ ...input, cwd: handle.repository.rootPath });
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(input);
  });

  const stagePaths: ReviewService["Service"]["stagePaths"] = Effect.fn("ReviewService.stagePaths")(
    function* (input) {
      const authorizedCwd = yield* resolveAuthorizedMutationCwd("ReviewService.stagePaths", input);
      yield* validatePaths("ReviewService.stagePaths", input.cwd, input.paths);

      const handle = yield* vcsRegistry.detect({ cwd: authorizedCwd, requestedKind: "auto" });
      if (!handle || handle.kind !== "git") {
        return yield* new VcsUnsupportedOperationError({
          operation: "ReviewService.stagePaths",
          kind: handle?.kind ?? "unknown",
          detail: "Staging Review files requires Git.",
        });
      }
      return yield* git.stageReviewPaths({ cwd: handle.repository.rootPath, paths: input.paths });
    },
  );

  const discardChanges: ReviewService["Service"]["discardChanges"] = Effect.fn(
    "ReviewService.discardChanges",
  )(function* (input) {
    const authorizedCwd = yield* resolveAuthorizedMutationCwd(
      "ReviewService.discardChanges",
      input,
    );
    yield* validatePaths(
      "ReviewService.discardChanges",
      input.cwd,
      input.changes.map((change) => change.path),
    );
    const handle = yield* vcsRegistry.detect({ cwd: authorizedCwd, requestedKind: "auto" });
    if (!handle || handle.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.discardChanges",
        kind: handle?.kind ?? "unknown",
        detail: "Discarding Review changes requires Git.",
      });
    }
    return yield* git.discardReviewChanges({
      cwd: handle.repository.rootPath,
      changes: input.changes,
    });
  });

  const unstagePaths: ReviewService["Service"]["unstagePaths"] = Effect.fn(
    "ReviewService.unstagePaths",
  )(function* (input) {
    const authorizedCwd = yield* resolveAuthorizedMutationCwd("ReviewService.unstagePaths", input);
    yield* validatePaths(
      "ReviewService.unstagePaths",
      input.cwd,
      input.changes.flatMap((change) =>
        change.previousPath === null ? [change.path] : [change.path, change.previousPath],
      ),
    );
    const handle = yield* vcsRegistry.detect({ cwd: authorizedCwd, requestedKind: "auto" });
    if (!handle || handle.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.unstagePaths",
        kind: handle?.kind ?? "unknown",
        detail: "Unstaging Review files requires Git.",
      });
    }
    return yield* git.unstageReviewPaths({
      cwd: handle.repository.rootPath,
      changes: input.changes,
    });
  });

  return ReviewService.of({
    getDiffPreview,
    discardChanges,
    stagePaths,
    unstagePaths,
  });
});

export const layer = Layer.effect(ReviewService, make);
