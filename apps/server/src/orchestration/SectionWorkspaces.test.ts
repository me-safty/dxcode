import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  ensureSectionRepository,
  ensureSectionThreadWorktree,
  removeSectionThreadWorktree,
} from "./SectionWorkspaces.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-section-workspaces-test-",
});
const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

const git = Effect.fn("SectionWorkspaces.test.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* driver.execute({
    operation: "SectionWorkspaces.test.git",
    cwd,
    args,
  });
  return result.stdout.trim();
});

it.layer(TestLayer)("SectionWorkspaces", (it) => {
  it.effect("creates an empty local repository and isolated worktrees without a remote", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "section-root-" });
      const worktreesDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "section-worktrees-",
      });
      const projectId = ProjectId.make("section-project");

      yield* ensureSectionRepository(root);
      assert.equal(yield* git(root, ["remote"]), "");
      assert.equal(
        yield* git(root, ["show", "--format=%s", "--no-patch", "HEAD"]),
        "Initialize section",
      );

      const first = yield* ensureSectionThreadWorktree({
        sectionWorkspaceRoot: root,
        worktreesDir,
        projectId,
        threadId: ThreadId.make("thread-a"),
      });
      const second = yield* ensureSectionThreadWorktree({
        sectionWorkspaceRoot: root,
        worktreesDir,
        projectId,
        threadId: ThreadId.make("thread-b"),
      });

      assert.notEqual(first.worktreePath, second.worktreePath);
      assert.equal(
        yield* fileSystem.realPath(path.dirname(first.worktreePath)),
        yield* fileSystem.realPath(path.join(worktreesDir, "sections", projectId)),
      );
      assert.deepStrictEqual(yield* fileSystem.readDirectory(first.worktreePath), [".git"]);
      assert.deepStrictEqual(yield* fileSystem.readDirectory(second.worktreePath), [".git"]);
    }),
  );

  it.effect("reuses an existing thread worktree and removes its generated branch", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "section-root-" });
      const worktreesDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "section-worktrees-",
      });
      const input = {
        sectionWorkspaceRoot: root,
        worktreesDir,
        projectId: ProjectId.make("section-project"),
        threadId: ThreadId.make("thread-a"),
      };

      const first = yield* ensureSectionThreadWorktree(input);
      const second = yield* ensureSectionThreadWorktree(input);
      assert.deepStrictEqual(second, first);

      yield* removeSectionThreadWorktree({
        sectionWorkspaceRoot: root,
        threadId: input.threadId,
      });
      assert.isFalse(yield* fileSystem.exists(first.worktreePath));
      assert.equal(yield* git(root, ["branch", "--list", first.branch]), "");
    }),
  );

  it.effect("removes only the deleting thread's owned worktree after switching", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "section-root-" });
      const worktreesDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "section-worktrees-",
      });
      const projectId = ProjectId.make("section-project");
      const firstThreadId = ThreadId.make("thread-first");
      const secondThreadId = ThreadId.make("thread-second");
      const first = yield* ensureSectionThreadWorktree({
        sectionWorkspaceRoot: root,
        worktreesDir,
        projectId,
        threadId: firstThreadId,
      });
      const second = yield* ensureSectionThreadWorktree({
        sectionWorkspaceRoot: root,
        worktreesDir,
        projectId,
        threadId: secondThreadId,
      });

      yield* removeSectionThreadWorktree({
        sectionWorkspaceRoot: root,
        threadId: firstThreadId,
      });

      assert.isFalse(yield* fileSystem.exists(first.worktreePath));
      assert.isTrue(yield* fileSystem.exists(second.worktreePath));
      assert.equal(yield* git(root, ["branch", "--list", first.branch]), "");
      assert.include(yield* git(root, ["branch", "--list", second.branch]), second.branch);
    }),
  );
});
