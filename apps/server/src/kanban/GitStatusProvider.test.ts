import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path, PlatformError, Scope } from "effect";
import { assert, describe, it } from "@effect/vitest";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitStatusProvider from "./GitStatusProvider.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-kanban-git-status-",
});

const GitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);
const ProviderLayer = GitStatusProvider.layer.pipe(Layer.provide(GitLayer));
const TestLayer = Layer.mergeAll(GitLayer, ProviderLayer);

const policy = {
  protectedBranches: ["main", "release/*"],
  allowedWorkBranchPrefixes: ["feature/", "fix/", "chore/", "docs/"],
  destructiveActionsRequireSecondConfirmation: true,
};

function makeTempDir(
  prefix: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeFile(
  cwd: string,
  relativePath: string,
  content: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, content);
  });
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    yield* git.execute({
      operation: "KanbanGitStatusProvider.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });
}

function initRepo() {
  return Effect.gen(function* () {
    const repoDir = yield* makeTempDir("kanban-git-status-");
    yield* runGit(repoDir, ["init", "-b", "main"]);
    yield* runGit(repoDir, ["config", "user.email", "test@example.com"]);
    yield* runGit(repoDir, ["config", "user.name", "Test User"]);
    yield* writeFile(repoDir, "README.md", "initial\n");
    yield* runGit(repoDir, ["add", "README.md"]);
    yield* runGit(repoDir, ["commit", "-m", "initial"]);
    return repoDir;
  });
}

describe("KanbanGitStatusProvider", () => {
  it.layer(TestLayer)("reads branch, staged, unstaged, and untracked status", (it) => {
    it.effect("maps real git state into the Kanban status contract", () =>
      Effect.gen(function* () {
        const provider = yield* GitStatusProvider.KanbanGitStatusProvider;
        const repoDir = yield* initRepo();
        yield* runGit(repoDir, ["checkout", "-b", "feature/gitops"]);
        yield* writeFile(repoDir, "README.md", "initial\nunstaged\n");
        yield* writeFile(repoDir, "src/staged.ts", "export const staged = true;\n");
        yield* runGit(repoDir, ["add", "src/staged.ts"]);
        yield* writeFile(repoDir, "notes/untracked.md", "untracked\n");

        const status = yield* provider.readStatus({
          repoId: "repo-1",
          cwd: repoDir,
          policy,
        });

        assert.equal(status.branch, "feature/gitops");
        assert.equal(status.isRepo, true);
        assert.equal(
          status.files.some((file) => file.path === "README.md" && file.status === "unstaged"),
          true,
        );
        assert.equal(
          status.files.some((file) => file.path === "src/staged.ts" && file.status === "staged"),
          true,
        );
        assert.equal(
          status.files.some(
            (file) => file.path === "notes/untracked.md" && file.status === "untracked",
          ),
          true,
        );
        assert.equal(
          status.policyViolations?.some((violation) => violation.kind === "missing-upstream"),
          true,
        );
      }),
    );

    it.effect("flags dirty protected branches", () =>
      Effect.gen(function* () {
        const provider = yield* GitStatusProvider.KanbanGitStatusProvider;
        const repoDir = yield* initRepo();
        yield* writeFile(repoDir, "README.md", "dirty on main\n");

        const status = yield* provider.readStatus({
          repoId: "repo-1",
          cwd: repoDir,
          policy,
        });

        assert.equal(status.branch, "main");
        assert.equal(
          status.policyViolations?.some(
            (violation) =>
              violation.kind === "protected-branch" && violation.severity === "blocked",
          ),
          true,
        );
      }),
    );

    it.effect("reads diffs and gates stage/unstage actions on confirmation", () =>
      Effect.gen(function* () {
        const provider = yield* GitStatusProvider.KanbanGitStatusProvider;
        const repoDir = yield* initRepo();
        yield* runGit(repoDir, ["checkout", "-b", "feature/stage-actions"]);
        yield* writeFile(repoDir, "README.md", "initial\nchanged\n");

        const diff = yield* provider.readFileDiff({
          repoId: "repo-1",
          cwd: repoDir,
          path: "README.md",
          status: "unstaged",
        });
        assert.equal(diff.truncated, false);
        assert.equal(diff.diff.includes("+changed"), true);

        const blocked = yield* provider.stageFiles({
          repoId: "repo-1",
          cwd: repoDir,
          paths: ["README.md"],
          confirmed: false,
        });
        assert.equal(blocked.status, "blocked");

        const staged = yield* provider.stageFiles({
          repoId: "repo-1",
          cwd: repoDir,
          paths: ["README.md"],
          confirmed: true,
        });
        assert.equal(staged.status, "applied");

        let status = yield* provider.readStatus({ repoId: "repo-1", cwd: repoDir, policy });
        assert.equal(
          status.files.some((file) => file.path === "README.md" && file.status === "staged"),
          true,
        );

        const unstaged = yield* provider.unstageFiles({
          repoId: "repo-1",
          cwd: repoDir,
          paths: ["README.md"],
          confirmed: true,
        });
        assert.equal(unstaged.status, "applied");

        status = yield* provider.readStatus({ repoId: "repo-1", cwd: repoDir, policy });
        assert.equal(
          status.files.some((file) => file.path === "README.md" && file.status === "unstaged"),
          true,
        );
      }),
    );

    it.effect("normalizes renamed paths for diffs and file actions", () =>
      Effect.gen(function* () {
        const provider = yield* GitStatusProvider.KanbanGitStatusProvider;
        const repoDir = yield* initRepo();
        yield* runGit(repoDir, ["checkout", "-b", "feature/rename-status"]);
        yield* runGit(repoDir, ["mv", "README.md", "README-renamed.md"]);

        const status = yield* provider.readStatus({ repoId: "repo-1", cwd: repoDir, policy });
        const renamed = status.files.find((file) => file.change === "renamed");

        assert.equal(renamed?.path, "README-renamed.md");
        assert.equal(renamed?.sourcePath, "README.md");

        const diff = yield* provider.readFileDiff({
          repoId: "repo-1",
          cwd: repoDir,
          path: renamed?.path ?? "README-renamed.md",
          status: "staged",
        });
        assert.equal(diff.diff.includes("README-renamed.md"), true);

        const unstaged = yield* provider.unstageFiles({
          repoId: "repo-1",
          cwd: repoDir,
          paths: [renamed?.path ?? "README-renamed.md"],
          confirmed: true,
        });
        assert.equal(unstaged.status, "applied");
      }),
    );

    it.effect("reports release and tag readiness gates", () =>
      Effect.gen(function* () {
        const provider = yield* GitStatusProvider.KanbanGitStatusProvider;
        const repoDir = yield* initRepo();
        yield* runGit(repoDir, ["tag", "v0.1.0"]);
        yield* runGit(repoDir, ["checkout", "-b", "release/0.2.0"]);
        yield* writeFile(repoDir, "docs/product/release-notes.md", "Release notes\n");
        yield* runGit(repoDir, ["add", "docs/product/release-notes.md"]);
        yield* runGit(repoDir, ["commit", "-m", "release notes"]);

        const readiness = yield* provider.readReleaseReadiness({
          cwd: repoDir,
          policy,
          releaseNotesPath: "docs/product/release-notes.md",
          targetTag: "v0.2.0",
          providerStatuses: [{ id: "gate-ci", label: "CI", status: "passing" }],
        });

        assert.equal(readiness.branch, "release/0.2.0");
        assert.equal(readiness.latestTag, "v0.1.0");
        assert.equal(readiness.targetTag, "v0.2.0");
        assert.equal(
          readiness.gates.every((gate) => gate.status === "passing"),
          true,
        );

        yield* runGit(repoDir, ["tag", "v0.2.0"]);
        const blocked = yield* provider.readReleaseReadiness({
          cwd: repoDir,
          policy,
          releaseNotesPath: "docs/product/release-notes.md",
          targetTag: "v0.2.0",
        });
        assert.equal(
          blocked.gates.some(
            (gate) => gate.id === "gate-tag-readiness" && gate.status === "blocked",
          ),
          true,
        );
      }),
    );
  });
});
