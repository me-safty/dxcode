import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path, PlatformError, Scope } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { assert, describe, expect, it, vi, afterEach } from "@effect/vitest";

import { ServerConfig } from "../config.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsProcessLayer from "../vcs/VcsProcess.ts";
import * as ProductArtifactsProvider from "./ProductArtifactsProvider.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-kanban-product-artifacts-",
});

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const execute = vi.fn<GitHubCli.GitHubCliShape["execute"]>();

const GitLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(VcsProcessLayer.layer),
  Layer.provideMerge(NodeServices.layer),
);

const ProviderLayer = ProductArtifactsProvider.layer.pipe(
  Layer.provide(GitLayer),
  Layer.provide(
    Layer.mock(GitHubCli.GitHubCli)({
      execute,
      listOpenPullRequests: vi.fn(),
      getPullRequest: vi.fn(),
      getRepositoryCloneUrls: vi.fn(),
      createRepository: vi.fn(),
      createPullRequest: vi.fn(),
      getDefaultBranch: vi.fn(),
      checkoutPullRequest: vi.fn(),
    }),
  ),
);

const TestLayer = Layer.mergeAll(GitLayer, ProviderLayer);

afterEach(() => {
  execute.mockReset();
});

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
      operation: "ProductArtifactsProvider.test.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });
}

function initRepo() {
  return Effect.gen(function* () {
    const repoDir = yield* makeTempDir("kanban-product-artifacts-");
    yield* runGit(repoDir, ["init", "-b", "main"]);
    yield* runGit(repoDir, ["config", "user.email", "test@example.com"]);
    yield* runGit(repoDir, ["config", "user.name", "Test User"]);
    yield* writeFile(repoDir, "docs/product/overview.md", "# Overview\n\nSynthetic notes.\n");
    yield* writeFile(repoDir, "docs/product/nested/brief.md", "# Brief\n\nNested notes.\n");
    yield* writeFile(repoDir, "README.md", "initial\n");
    yield* runGit(repoDir, ["add", "."]);
    yield* runGit(repoDir, ["commit", "-m", "initial"]);
    yield* runGit(repoDir, ["checkout", "-b", "feature/product-artifacts"]);
    return repoDir;
  });
}

describe("ProductArtifactsProvider", () => {
  it.layer(TestLayer)("browses and previews Markdown artifacts under docs/product", (it) => {
    it.effect("lists product Markdown files with clean status", () =>
      Effect.gen(function* () {
        const provider = yield* ProductArtifactsProvider.ProductArtifactsProvider;
        const repoDir = yield* initRepo();

        const artifacts = yield* provider.listArtifacts({
          repoId: "repo-1",
          cwd: repoDir,
        });

        expect(artifacts.map((artifact) => artifact.path)).toEqual([
          "docs/product/nested/brief.md",
          "docs/product/overview.md",
        ]);
        expect(artifacts.every((artifact) => artifact.status === "clean")).toBe(true);

        const content = yield* provider.readArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
        });
        assert.equal(content.title, "Overview");
        assert.equal(content.preview.includes("Synthetic notes."), true);
      }),
    );

    it.effect("confines reads and writes to docs/product Markdown files", () =>
      Effect.gen(function* () {
        const provider = yield* ProductArtifactsProvider.ProductArtifactsProvider;
        const repoDir = yield* initRepo();

        const outside = yield* Effect.exit(
          provider.readArtifact({
            repoId: "repo-1",
            cwd: repoDir,
            path: "docs/product/../tasks/plan.md",
          }),
        );
        const nonMarkdown = yield* Effect.exit(
          provider.writeArtifact({
            repoId: "repo-1",
            cwd: repoDir,
            path: "docs/product/notes.txt",
            content: "not markdown",
            confirmed: true,
          }),
        );

        assert.equal(outside._tag, "Failure");
        assert.equal(nonMarkdown._tag, "Failure");
      }),
    );

    it.effect("blocks dirty file conflicts before writing", () =>
      Effect.gen(function* () {
        const provider = yield* ProductArtifactsProvider.ProductArtifactsProvider;
        const repoDir = yield* initRepo();
        yield* writeFile(repoDir, "docs/product/overview.md", "# Overview\n\nDirty edit.\n");

        const result = yield* provider.writeArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
          content: "# Overview\n\nNew edit.\n",
          confirmed: true,
        });

        assert.equal(result.status, "blocked");
        assert.equal(result.message.includes("dirty"), true);
      }),
    );

    it.effect("writes clean artifacts and posts concise linked issue comments", () =>
      Effect.gen(function* () {
        execute.mockReturnValueOnce(Effect.succeed(processOutput("commented\n")));
        const provider = yield* ProductArtifactsProvider.ProductArtifactsProvider;
        const repoDir = yield* initRepo();

        const result = yield* provider.writeArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
          content: "# Overview\n\nUpdated through provider.\n",
          confirmed: true,
          linkedRepository: "MohAnghabo/kanban-console",
          linkedIssueNumber: 43,
        });

        assert.equal(result.status, "applied");
        assert.equal(result.commentTarget, "issue#43");
        expect(execute).toHaveBeenCalledWith({
          cwd: repoDir,
          args: [
            "issue",
            "comment",
            "43",
            "--repo",
            "MohAnghabo/kanban-console",
            "--body",
            expect.stringContaining("Raw diff and command output intentionally omitted."),
          ],
          timeoutMs: 30_000,
        });

        const content = yield* provider.readArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
        });
        assert.equal(content.content.includes("Updated through provider."), true);
      }),
    );

    it.effect("keeps the artifact write result explicit when comment posting fails", () =>
      Effect.gen(function* () {
        execute.mockReturnValueOnce(
          Effect.fail(
            new GitHubCli.GitHubCliError({
              operation: "execute",
              detail: "GitHub CLI is not authenticated.",
            }),
          ),
        );
        const provider = yield* ProductArtifactsProvider.ProductArtifactsProvider;
        const repoDir = yield* initRepo();

        const result = yield* provider.writeArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
          content: "# Overview\n\nUpdated without comment.\n",
          confirmed: true,
          linkedRepository: "MohAnghabo/kanban-console",
          linkedIssueNumber: 43,
        });

        assert.equal(result.status, "applied");
        assert.equal(result.commentTarget, undefined);
        assert.equal(result.message.includes("comment posting failed"), true);

        const content = yield* provider.readArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
        });
        assert.equal(content.content.includes("Updated without comment."), true);
      }),
    );

    it.effect("blocks confirmed writes on protected branches", () =>
      Effect.gen(function* () {
        const provider = yield* ProductArtifactsProvider.ProductArtifactsProvider;
        const repoDir = yield* initRepo();
        yield* runGit(repoDir, ["checkout", "main"]);

        const result = yield* provider.writeArtifact({
          repoId: "repo-1",
          cwd: repoDir,
          path: "docs/product/overview.md",
          content: "# Overview\n\nProtected branch edit.\n",
          confirmed: true,
        });

        assert.equal(result.status, "blocked");
        assert.equal(result.message.includes("protected branch main"), true);
      }),
    );
  });
});
