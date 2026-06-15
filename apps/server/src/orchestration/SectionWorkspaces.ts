import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { isSectionThreadBranch, SECTION_THREAD_BRANCH_PREFIX } from "@t3tools/shared/git";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";

const SECTION_BASE_REF = "refs/morecode/section-base";
const SAFE_MANAGED_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;

function managedPathSegment(value: string): string {
  return SAFE_MANAGED_PATH_SEGMENT.test(value) && value !== "." && value !== ".."
    ? value
    : Encoding.encodeBase64Url(value);
}

const runGit = Effect.fn("SectionWorkspaces.runGit")(function* (
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const git = yield* GitVcsDriver;
  yield* git.execute({
    operation,
    cwd,
    args,
  });
});

const gitRefExists = Effect.fn("SectionWorkspaces.gitRefExists")(function* (
  cwd: string,
  ref: string,
) {
  const git = yield* GitVcsDriver;
  const result = yield* git.execute({
    operation: "SectionWorkspaces.gitRefExists",
    cwd,
    args: ["show-ref", "--verify", "--quiet", ref],
    allowNonZeroExit: true,
  });
  return result.exitCode === 0;
});

const resolveWorktreeBranch = Effect.fn("SectionWorkspaces.resolveWorktreeBranch")(function* (
  worktreePath: string,
) {
  const git = yield* GitVcsDriver;
  const result = yield* git.execute({
    operation: "SectionWorkspaces.resolveWorktreeBranch",
    cwd: worktreePath,
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    allowNonZeroExit: true,
  });
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
});

const findRegisteredWorktree = Effect.fn("SectionWorkspaces.findRegisteredWorktree")(function* (
  sectionWorkspaceRoot: string,
  branch: string,
) {
  const git = yield* GitVcsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const result = yield* git.execute({
    operation: "SectionWorkspaces.findRegisteredWorktree",
    cwd: sectionWorkspaceRoot,
    args: ["worktree", "list", "--porcelain"],
  });
  let worktreePath: string | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice(9);
    } else if (line === `branch refs/heads/${branch}` && worktreePath) {
      return (yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => false)))
        ? worktreePath
        : null;
    } else if (line === "") {
      worktreePath = null;
    }
  }
  return null;
});

export const sectionThreadBranch = (threadId: ThreadId): string =>
  `${SECTION_THREAD_BRANCH_PREFIX}${managedPathSegment(threadId)}`;

export const sectionWorkspacePath = Effect.fn("sectionWorkspacePath")(function* (input: {
  readonly sectionsDir: string;
  readonly projectId: ProjectId;
}) {
  const path = yield* Path.Path;
  return path.join(input.sectionsDir, managedPathSegment(input.projectId));
});

export const sectionThreadWorktreePath = Effect.fn("sectionThreadWorktreePath")(function* (input: {
  readonly worktreesDir: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}) {
  const path = yield* Path.Path;
  return path.join(
    input.worktreesDir,
    "sections",
    managedPathSegment(input.projectId),
    managedPathSegment(input.threadId),
  );
});

export const ensureSectionRepository = Effect.fn("ensureSectionRepository")(function* (
  sectionWorkspaceRoot: string,
) {
  const git = yield* GitVcsDriver;
  yield* git.initRepo({ cwd: sectionWorkspaceRoot });

  if (yield* gitRefExists(sectionWorkspaceRoot, SECTION_BASE_REF)) {
    return;
  }

  const hasHead = yield* gitRefExists(sectionWorkspaceRoot, "HEAD");
  if (!hasHead) {
    yield* runGit("SectionWorkspaces.createInitialCommit", sectionWorkspaceRoot, [
      "-c",
      "user.name=moreCode",
      "-c",
      "user.email=morecode@local",
      "commit",
      "--allow-empty",
      "--no-gpg-sign",
      "--no-verify",
      "-m",
      "Initialize section",
    ]);
  }

  yield* runGit("SectionWorkspaces.createBaseRef", sectionWorkspaceRoot, [
    "update-ref",
    SECTION_BASE_REF,
    "HEAD",
  ]);
});

export const ensureSectionThreadWorktree = Effect.fn("ensureSectionThreadWorktree")(
  function* (input: {
    readonly sectionWorkspaceRoot: string;
    readonly worktreesDir: string;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
  }) {
    const git = yield* GitVcsDriver;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* ensureSectionRepository(input.sectionWorkspaceRoot);

    const worktreePath = yield* sectionThreadWorktreePath(input);
    const branch = sectionThreadBranch(input.threadId);
    const registeredWorktreePath = yield* findRegisteredWorktree(
      input.sectionWorkspaceRoot,
      branch,
    );
    if (registeredWorktreePath) {
      return {
        branch,
        worktreePath: registeredWorktreePath,
      };
    }

    if (yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => false))) {
      yield* fileSystem.remove(worktreePath, { force: true, recursive: true });
    }
    yield* runGit("SectionWorkspaces.pruneStaleWorktrees", input.sectionWorkspaceRoot, [
      "worktree",
      "prune",
    ]);
    yield* fileSystem.makeDirectory(path.dirname(worktreePath), { recursive: true });

    const branchExists = yield* gitRefExists(input.sectionWorkspaceRoot, `refs/heads/${branch}`);
    const worktree = yield* git.createWorktree({
      cwd: input.sectionWorkspaceRoot,
      refName: branchExists ? branch : SECTION_BASE_REF,
      ...(branchExists ? {} : { newRefName: branch }),
      path: worktreePath,
    });
    return {
      branch,
      worktreePath:
        (yield* findRegisteredWorktree(input.sectionWorkspaceRoot, branch)) ??
        worktree.worktree.path,
    };
  },
);

export const removeSectionThreadWorktree = Effect.fn("removeSectionThreadWorktree")(
  function* (input: { readonly sectionWorkspaceRoot: string; readonly worktreePath: string }) {
    const git = yield* GitVcsDriver;
    const branch = yield* resolveWorktreeBranch(input.worktreePath).pipe(
      Effect.orElseSucceed(() => null),
    );
    yield* git.removeWorktree({
      cwd: input.sectionWorkspaceRoot,
      path: input.worktreePath,
      force: true,
    });
    if (branch && isSectionThreadBranch(branch)) {
      yield* runGit("SectionWorkspaces.removeThreadBranch", input.sectionWorkspaceRoot, [
        "branch",
        "-D",
        branch,
      ]);
    }
  },
);
