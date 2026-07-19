import type { GitCommandError, ReviewStackTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { normalizeGitDiff } from "@t3tools/shared/git";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const FILE_PATCH_MAX_BYTES = 16 * 1024 * 1024;

export interface RepositoryReviewSource {
  readonly diff: string;
  readonly fileCount: number;
}

export class ReviewSourceCaptureError extends Schema.TaggedErrorClass<ReviewSourceCaptureError>()(
  "ReviewSourceCaptureError",
  { message: Schema.String },
) {}

export interface ReviewPathGroup {
  readonly paths: ReadonlyArray<string>;
  readonly displayPath: string;
  readonly isUntracked: boolean;
}

export function parseNameStatusPathGroups(stdout: string): ReadonlyArray<ReviewPathGroup> {
  const records = stdout.split("\0");
  const groups: ReviewPathGroup[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const status = records[index];
    if (!status) continue;
    const isPair = status.startsWith("R") || status.startsWith("C");
    const oldPath = records[index + 1];
    const newPath = isPair ? records[index + 2] : undefined;
    if (oldPath && (!isPair || newPath)) {
      const paths = isPair && newPath ? [oldPath, newPath] : [oldPath];
      groups.push({
        paths,
        displayPath: newPath ?? oldPath,
        isUntracked: false,
      });
    }
    index += isPair ? 2 : 1;
  }
  return groups;
}

export function parsePorcelainPathGroups(stdout: string): ReadonlyArray<ReviewPathGroup> {
  const records = stdout.split("\0");
  const groups: ReviewPathGroup[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = new Set(record.slice(0, 2));
    const path = record.slice(3);
    if (status.has("R") || status.has("C")) {
      const previousPath = records[index + 1];
      if (path && previousPath) {
        groups.push({ paths: [previousPath, path], displayPath: path, isUntracked: false });
      }
      index += 1;
    } else if (path) {
      groups.push({ paths: [path], displayPath: path, isUntracked: record.startsWith("??") });
    }
  }
  return groups.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

/**
 * Capture a complete, immutable review diff one file at a time.
 *
 * The regular diff preview intentionally has a small global output budget. A review must not let
 * an early large file hide later changes, so this path first captures the complete manifest and
 * then gives every file its own bounded Git process. Pathological single files fail the review
 * rather than producing a successful partial result.
 */
export const captureRepositoryReviewSource = Effect.fn("captureRepositoryReviewSource")(
  function* (input: {
    readonly cwd: string;
    readonly target: Exclude<ReviewStackTarget, { readonly _tag: "turn" }>;
    readonly resolvedBase: string | null;
    readonly ignoreWhitespace: boolean;
    readonly git: GitVcsDriver.GitVcsDriver["Service"];
  }): Effect.fn.Return<RepositoryReviewSource, GitCommandError | ReviewSourceCaptureError> {
    const git = input.git;
    const execute = (operation: string, args: ReadonlyArray<string>, allowNonZeroExit = false) =>
      git.execute({
        operation,
        cwd: input.cwd,
        args,
        allowNonZeroExit,
        maxOutputBytes: MANIFEST_MAX_BYTES,
        appendTruncationMarker: true,
      });

    const manifestArgs =
      input.target._tag === "commit"
        ? ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", input.target.sha]
        : input.target._tag === "branch"
          ? ["diff", "--name-status", "-z", `${input.resolvedBase ?? "HEAD"}...HEAD`, "--"]
          : ["status", "--porcelain=1", "-z", "--untracked-files=all"];
    const manifest = yield* execute("ReviewStack.capture.manifest", manifestArgs);
    if (manifest.stdoutTruncated) {
      return yield* new ReviewSourceCaptureError({
        message: "Review manifest exceeded the safety limit; no partial review was created.",
      });
    }

    const pathGroups =
      input.target._tag === "working-tree"
        ? parsePorcelainPathGroups(manifest.stdout)
        : parseNameStatusPathGroups(manifest.stdout);
    const patches = yield* Effect.forEach(
      pathGroups,
      Effect.fn("ReviewStack.capture.file")(function* (pathGroup) {
        const common = [
          "--patch",
          "--minimal",
          ...(input.ignoreWhitespace ? ["--ignore-all-space"] : []),
        ];
        const args =
          input.target._tag === "commit"
            ? ["show", "--format=", ...common, input.target.sha, "--", ...pathGroup.paths]
            : input.target._tag === "branch"
              ? [
                  "diff",
                  ...common,
                  `${input.resolvedBase ?? "HEAD"}...HEAD`,
                  "--",
                  ...pathGroup.paths,
                ]
              : ["diff", ...common, "HEAD", "--", ...pathGroup.paths];
        let result = yield* git.execute({
          operation: "ReviewStack.capture.filePatch",
          cwd: input.cwd,
          args,
          allowNonZeroExit: input.target._tag === "working-tree",
          maxOutputBytes: FILE_PATCH_MAX_BYTES,
          appendTruncationMarker: true,
        });
        if (
          input.target._tag === "working-tree" &&
          pathGroup.isUntracked &&
          result.stdout.trim().length === 0
        ) {
          result = yield* git.execute({
            operation: "ReviewStack.capture.untrackedFilePatch",
            cwd: input.cwd,
            args: ["diff", "--no-index", ...common, "--", "/dev/null", pathGroup.displayPath],
            allowNonZeroExit: true,
            maxOutputBytes: FILE_PATCH_MAX_BYTES,
            appendTruncationMarker: true,
          });
        }
        if (result.stdoutTruncated) {
          return yield* new ReviewSourceCaptureError({
            message: `The patch for ${pathGroup.displayPath} exceeded the per-file safety limit; no partial review was created.`,
          });
        }
        return normalizeGitDiff(result.stdout);
      }),
      { concurrency: 4 },
    );

    return {
      diff: patches.filter((patch) => patch.length > 0).join("\n"),
      fileCount: pathGroups.length,
    };
  },
);

/** Parse paths from porcelain v1 -z, including the second path emitted for renames/copies. */
export function parsePorcelainPaths(stdout: string): ReadonlyArray<string> {
  return [...new Set(parsePorcelainPathGroups(stdout).flatMap((group) => group.paths))].sort(
    (a, b) => a.localeCompare(b),
  );
}
