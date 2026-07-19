// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Tests exercise host-side git orchestration directly.
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import {
  createDefaultSyncNames,
  formatUpstreamSyncReport,
  parseCommitCount,
  runUpstreamSync,
  type GitCommandResult,
  type UpstreamSyncOptions,
} from "./sync-upstream.ts";

const options: UpstreamSyncOptions = {
  repoDir: "/repo",
  upstreamRemote: "upstream",
  upstreamRef: "upstream/main",
  baseRef: "dx/main",
  branch: "sync/upstream-2026-07-18",
  worktreePath: "/worktrees/upstream-sync",
  fetch: true,
  dryRun: false,
};

function response(status = 0, stdout = "", stderr = ""): GitCommandResult {
  return { status, stdout, stderr };
}

function queuedRunner(
  responses: ReadonlyArray<GitCommandResult>,
  commands: Array<ReadonlyArray<string>>,
) {
  let index = 0;
  return (args: ReadonlyArray<string>) => {
    commands.push(args);
    const result = responses[index];
    index += 1;
    if (!result) {
      throw new Error(`Unexpected command: git ${args.join(" ")}`);
    }
    return result;
  };
}

it("derives deterministic default sync names", () => {
  assert.deepStrictEqual(createDefaultSyncNames("/code/t3code", new Date("2026-07-18T12:00:00Z")), {
    branch: "sync/upstream-2026-07-18",
    worktreePath: NodePath.resolve("/code/t3code-upstream-sync-2026-07-18"),
  });
});

it("rejects malformed commit counts", () => {
  assert.throws(() => parseCommitCount("1.5"), /Invalid upstream commit count/);
  assert.throws(() => parseCommitCount("-1"), /Invalid upstream commit count/);
});

it("detects an up-to-date base without creating a worktree", () => {
  const commands: Array<ReadonlyArray<string>> = [];
  const result = runUpstreamSync(options, {
    runGit: queuedRunner([response(), response(), response(0, "0\n"), response(0, "")], commands),
    pathExists: () => false,
  });

  assert.equal(result.status, "up-to-date");
  assert.equal(
    commands.some((command) => command.includes("worktree")),
    false,
  );
});

it("creates an isolated branch and worktree, then merges upstream", () => {
  const commands: Array<ReadonlyArray<string>> = [];
  const result = runUpstreamSync(options, {
    runGit: queuedRunner(
      [
        response(),
        response(),
        response(0, "2\n"),
        response(0, "abc\tOne\ndef\tTwo\n"),
        response(),
        response(1),
        response(),
        response(),
      ],
      commands,
    ),
    pathExists: () => false,
  });

  assert.equal(result.status, "ready");
  assert.deepStrictEqual(result.commits, ["abc\tOne", "def\tTwo"]);
  assert.deepStrictEqual(commands.at(-2), [
    "-C",
    "/repo",
    "worktree",
    "add",
    "-b",
    options.branch,
    options.worktreePath,
    "dx/main",
  ]);
  assert.deepStrictEqual(commands.at(-1), [
    "-C",
    options.worktreePath,
    "merge",
    "--no-ff",
    "--no-edit",
    "upstream/main",
  ]);
  assert.equal(
    commands.some((command) => command.includes("push")),
    false,
  );
});

it("reports merge conflicts without promoting the sync branch", () => {
  const commands: Array<ReadonlyArray<string>> = [];
  const result = runUpstreamSync(options, {
    runGit: queuedRunner(
      [
        response(),
        response(),
        response(0, "1\n"),
        response(0, "abc\tOne\n"),
        response(),
        response(1),
        response(),
        response(1, "", "merge conflict"),
        response(0, "apps/web/a.ts\napps/server/b.ts\n"),
      ],
      commands,
    ),
    pathExists: () => false,
  });

  assert.equal(result.status, "conflicted");
  assert.deepStrictEqual(result.conflicts, ["apps/web/a.ts", "apps/server/b.ts"]);
  const report = formatUpstreamSyncReport(result);
  assert.match(report, /vp check/);
  assert.match(report, /vp run typecheck/);
  assert.match(report, /Promotion: not performed/);
});

it("dry-run detects commits without reserving a branch or path", () => {
  const commands: Array<ReadonlyArray<string>> = [];
  const result = runUpstreamSync(
    { ...options, dryRun: true },
    {
      runGit: queuedRunner(
        [response(), response(), response(0, "1\n"), response(0, "abc\tOne\n")],
        commands,
      ),
      pathExists: () => true,
    },
  );

  assert.equal(result.status, "planned");
  assert.equal(
    commands.some((command) => command.includes("worktree")),
    false,
  );
});

it("refuses to overwrite an existing sync branch", () => {
  assert.throws(
    () =>
      runUpstreamSync(options, {
        runGit: queuedRunner(
          [
            response(),
            response(),
            response(0, "1\n"),
            response(0, "abc\tOne\n"),
            response(),
            response(),
          ],
          [],
        ),
        pathExists: () => false,
      }),
    /Sync branch already exists/,
  );
});
