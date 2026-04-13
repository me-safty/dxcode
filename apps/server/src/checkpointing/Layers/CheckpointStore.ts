/**
 * CheckpointStoreLive - Filesystem checkpoint store adapter layer.
 *
 * Implements hidden Git-ref checkpoint capture/restore directly with
 * Effect-native child process execution (`effect/unstable/process`).
 *
 * This layer owns filesystem/Git interactions only; it does not persist
 * checkpoint metadata and does not coordinate provider rollback semantics.
 *
 * @module CheckpointStoreLive
 */
import { randomUUID } from "node:crypto";

import { Effect, Layer, FileSystem, Path } from "effect";

import { CheckpointInvariantError } from "../Errors.ts";
import { extractSubmoduleChanges } from "../Diffs.ts";
import { GitCommandError } from "@t3tools/contracts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointRef } from "@t3tools/contracts";

const makeCheckpointStore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitCore;

  const resolveHeadCommit = (cwd: string): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const hasHeadCommit = (cwd: string): Effect.Effect<boolean, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.hasHeadCommit",
        cwd,
        args: ["rev-parse", "--verify", "HEAD"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => result.code === 0));

  const resolveCheckpointCommit = (
    cwd: string,
    checkpointRef: CheckpointRef,
  ): Effect.Effect<string | null, GitCommandError> =>
    git
      .execute({
        operation: "CheckpointStore.resolveCheckpointCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", `${checkpointRef}^{commit}`],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          if (result.code !== 0) {
            return null;
          }
          const commit = result.stdout.trim();
          return commit.length > 0 ? commit : null;
        }),
      );

  const isGitRepository: CheckpointStoreShape["isGitRepository"] = (cwd) =>
    git
      .execute({
        operation: "CheckpointStore.isGitRepository",
        cwd,
        args: ["rev-parse", "--is-inside-work-tree"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => result.code === 0 && result.stdout.trim() === "true"),
        Effect.catch(() => Effect.succeed(false)),
      );

  /**
   * Detect submodules with dirty working trees and create temporary commits
   * inside each one, then update the parent's temp index so `git write-tree`
   * captures the submodule's actual file state instead of its stale HEAD.
   */
  const captureSubmoduleSnapshots = Effect.fn("captureSubmoduleSnapshots")(function* (
    cwd: string,
    tempDir: string,
    parentEnv: NodeJS.ProcessEnv,
  ) {
    // Detect submodule paths via .gitmodules config.
    const submoduleListResult = yield* git.execute({
      operation: "CheckpointStore.captureSubmoduleSnapshots.list",
      cwd,
      args: ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
      allowNonZeroExit: true,
    });
    if (submoduleListResult.code !== 0 || submoduleListResult.stdout.trim().length === 0) {
      return;
    }

    // Parse "submodule.<name>.path <value>" lines.
    const submodulePaths: string[] = [];
    for (const line of submoduleListResult.stdout.split(/\r?\n/g)) {
      const parts = line.trim().split(/\s+/);
      const subPath = parts.at(-1);
      if (subPath && subPath.length > 0) {
        submodulePaths.push(subPath);
      }
    }
    if (submodulePaths.length === 0) return;

    yield* Effect.all(
      submodulePaths.map((subPath) =>
        captureOneSubmoduleSnapshot(cwd, subPath, tempDir, parentEnv).pipe(
          Effect.catch(() => Effect.void),
        ),
      ),
      { concurrency: "unbounded" },
    );
  });

  /**
   * For a single submodule, create a temp commit from its working tree and
   * update the parent's temp index to reference it.
   */
  const captureOneSubmoduleSnapshot = Effect.fn("captureOneSubmoduleSnapshot")(function* (
    parentCwd: string,
    submodulePath: string,
    tempDir: string,
    parentEnv: NodeJS.ProcessEnv,
  ) {
    const subCwd = path.join(parentCwd, submodulePath);

    // Check that the submodule is an initialized git repo.
    const isRepo = yield* git
      .execute({
        operation: "CheckpointStore.captureOneSubmoduleSnapshot.isRepo",
        cwd: subCwd,
        args: ["rev-parse", "--is-inside-work-tree"],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((r) => r.code === 0 && r.stdout.trim() === "true"));
    if (!isRepo) return;

    // Check if the submodule has any dirty changes (staged or unstaged).
    const statusResult = yield* git.execute({
      operation: "CheckpointStore.captureOneSubmoduleSnapshot.status",
      cwd: subCwd,
      args: ["status", "--porcelain"],
      allowNonZeroExit: true,
    });
    if (statusResult.code !== 0 || statusResult.stdout.trim().length === 0) {
      return; // Clean submodule, nothing to snapshot.
    }

    // Create a temp index for the submodule and capture its working tree.
    const subTempIndex = path.join(tempDir, `sub-index-${randomUUID()}`);
    const subEnv: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: subTempIndex,
      GIT_AUTHOR_NAME: "T3 Code",
      GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
      GIT_COMMITTER_NAME: "T3 Code",
      GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
    };

    // Populate the temp index from the submodule's HEAD.
    const subHasHead = yield* hasHeadCommit(subCwd);
    if (subHasHead) {
      yield* git.execute({
        operation: "CheckpointStore.captureOneSubmoduleSnapshot.readTree",
        cwd: subCwd,
        args: ["read-tree", "HEAD"],
        env: subEnv,
      });
    }

    yield* git.execute({
      operation: "CheckpointStore.captureOneSubmoduleSnapshot.add",
      cwd: subCwd,
      args: ["add", "-A", "--", "."],
      env: subEnv,
    });

    const subTreeResult = yield* git.execute({
      operation: "CheckpointStore.captureOneSubmoduleSnapshot.writeTree",
      cwd: subCwd,
      args: ["write-tree"],
      env: subEnv,
    });
    const subTreeOid = subTreeResult.stdout.trim();
    if (subTreeOid.length === 0) return;

    const subCommitResult = yield* git.execute({
      operation: "CheckpointStore.captureOneSubmoduleSnapshot.commitTree",
      cwd: subCwd,
      args: ["commit-tree", subTreeOid, "-m", "t3 submodule checkpoint snapshot"],
      env: subEnv,
    });
    const subCommitOid = subCommitResult.stdout.trim();
    if (subCommitOid.length === 0) return;

    // Update the parent's temp index to point to this new submodule commit.
    yield* git.execute({
      operation: "CheckpointStore.captureOneSubmoduleSnapshot.updateParentIndex",
      cwd: parentCwd,
      args: ["update-index", "--cacheinfo", `160000,${subCommitOid},${submodulePath}`],
      env: parentEnv,
    });
  });

  const captureCheckpoint: CheckpointStoreShape["captureCheckpoint"] = Effect.fn(
    "captureCheckpoint",
  )(function* (input) {
    const operation = "CheckpointStore.captureCheckpoint";

    yield* Effect.acquireUseRelease(
      fs.makeTempDirectory({ prefix: "t3-fs-checkpoint-" }),
      Effect.fn("captureCheckpoint.withTempDirectory")(function* (tempDir) {
        const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
        const commitEnv: NodeJS.ProcessEnv = {
          ...process.env,
          GIT_INDEX_FILE: tempIndexPath,
          GIT_AUTHOR_NAME: "T3 Code",
          GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
          GIT_COMMITTER_NAME: "T3 Code",
          GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
        };

        const headExists = yield* hasHeadCommit(input.cwd);
        if (headExists) {
          yield* git.execute({
            operation,
            cwd: input.cwd,
            args: ["read-tree", "HEAD"],
            env: commitEnv,
          });
        }

        yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["add", "-A", "--", "."],
          env: commitEnv,
        });

        // Capture dirty submodule working trees into temporary commits so that
        // the parent checkpoint tree reflects their actual file state.
        yield* captureSubmoduleSnapshots(input.cwd, tempDir, commitEnv).pipe(
          Effect.catch(() => Effect.void),
        );

        const writeTreeResult = yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["write-tree"],
          env: commitEnv,
        });
        const treeOid = writeTreeResult.stdout.trim();
        if (treeOid.length === 0) {
          return yield* new GitCommandError({
            operation,
            command: "git write-tree",
            cwd: input.cwd,
            detail: "git write-tree returned an empty tree oid.",
          });
        }

        const message = `t3 checkpoint ref=${input.checkpointRef}`;
        const commitTreeResult = yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["commit-tree", treeOid, "-m", message],
          env: commitEnv,
        });
        const commitOid = commitTreeResult.stdout.trim();
        if (commitOid.length === 0) {
          return yield* new GitCommandError({
            operation,
            command: "git commit-tree",
            cwd: input.cwd,
            detail: "git commit-tree returned an empty commit oid.",
          });
        }

        yield* git.execute({
          operation,
          cwd: input.cwd,
          args: ["update-ref", input.checkpointRef, commitOid],
        });
      }),
      (tempDir) => fs.remove(tempDir, { recursive: true }),
    ).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          Effect.fail(
            new CheckpointInvariantError({
              operation: "CheckpointStore.captureCheckpoint",
              detail: "Failed to capture checkpoint.",
              cause: error,
            }),
          ),
      }),
    );
  });

  const hasCheckpointRef: CheckpointStoreShape["hasCheckpointRef"] = (input) =>
    resolveCheckpointCommit(input.cwd, input.checkpointRef).pipe(
      Effect.map((commit) => commit !== null),
    );

  const restoreCheckpoint: CheckpointStoreShape["restoreCheckpoint"] = Effect.fn(
    "restoreCheckpoint",
  )(function* (input) {
    const operation = "CheckpointStore.restoreCheckpoint";

    let commitOid = yield* resolveCheckpointCommit(input.cwd, input.checkpointRef);

    if (!commitOid && input.fallbackToHead === true) {
      commitOid = yield* resolveHeadCommit(input.cwd);
    }

    if (!commitOid) {
      return false;
    }

    yield* git.execute({
      operation,
      cwd: input.cwd,
      args: ["restore", "--source", commitOid, "--worktree", "--staged", "--", "."],
    });
    yield* git.execute({
      operation,
      cwd: input.cwd,
      args: ["clean", "-fd", "--", "."],
    });

    const headExists = yield* hasHeadCommit(input.cwd);
    if (headExists) {
      yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["reset", "--quiet", "--", "."],
      });
    }

    return true;
  });

  const diffCheckpoints: CheckpointStoreShape["diffCheckpoints"] = Effect.fn("diffCheckpoints")(
    function* (input) {
      const operation = "CheckpointStore.diffCheckpoints";

      let fromCommitOid = yield* resolveCheckpointCommit(input.cwd, input.fromCheckpointRef);
      const toCommitOid = yield* resolveCheckpointCommit(input.cwd, input.toCheckpointRef);

      if (!fromCommitOid && input.fallbackFromToHead === true) {
        const headCommit = yield* resolveHeadCommit(input.cwd);
        if (headCommit) {
          fromCommitOid = headCommit;
        }
      }

      if (!fromCommitOid || !toCommitOid) {
        return yield* new GitCommandError({
          operation,
          command: "git diff",
          cwd: input.cwd,
          detail: "Checkpoint ref is unavailable for diff operation.",
        });
      }

      const result = yield* git.execute({
        operation,
        cwd: input.cwd,
        args: ["diff", "--patch", "--minimal", "--no-color", fromCommitOid, toCommitOid],
      });

      // Expand submodule diffs: for each submodule whose commit changed, run
      // git diff inside the submodule directory and append the file-level patch.
      const submoduleChanges = extractSubmoduleChanges(result.stdout);
      if (submoduleChanges.length > 0) {
        const expansions = yield* Effect.all(
          submoduleChanges.map((sub) => {
            if (!sub.fromCommit || !sub.toCommit) return Effect.succeed("");
            const subCwd = path.join(input.cwd, sub.path);
            return git
              .execute({
                operation: "CheckpointStore.diffSubmodule",
                cwd: subCwd,
                args: [
                  "diff",
                  "--patch",
                  "--minimal",
                  "--no-color",
                  "--ignore-submodules=all",
                  sub.fromCommit,
                  sub.toCommit,
                ],
              })
              .pipe(
                Effect.map((r) => {
                  if (r.stdout.trim().length === 0) return "";
                  // Rewrite paths in the submodule diff to be relative to parent.
                  return r.stdout.replace(
                    /^(diff --git a\/)(.+?)( b\/)(.+)/gm,
                    `$1${sub.path}/$2$3${sub.path}/$4`,
                  );
                }),
                Effect.catch(() => Effect.succeed("")),
              );
          }),
          { concurrency: "unbounded" },
        );

        const expandedPatch = expansions.filter((p) => p.length > 0).join("\n");
        if (expandedPatch.length > 0) {
          return `${result.stdout}\n${expandedPatch}`;
        }
      }

      return result.stdout;
    },
  );

  const deleteCheckpointRefs: CheckpointStoreShape["deleteCheckpointRefs"] = Effect.fn(
    "deleteCheckpointRefs",
  )(function* (input) {
    const operation = "CheckpointStore.deleteCheckpointRefs";

    yield* Effect.forEach(
      input.checkpointRefs,
      (checkpointRef) =>
        git.execute({
          operation,
          cwd: input.cwd,
          args: ["update-ref", "-d", checkpointRef],
          allowNonZeroExit: true,
        }),
      { discard: true },
    );
  });

  return {
    isGitRepository,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    deleteCheckpointRefs,
  } satisfies CheckpointStoreShape;
});

export const CheckpointStoreLive = Layer.effect(CheckpointStore, makeCheckpointStore);
