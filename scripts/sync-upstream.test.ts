// @effect-diagnostics nodeBuiltinImport:off - Tests inspect platform path construction.
import * as NodePath from "node:path";

import { assert, it } from "vite-plus/test";

import {
  createDefaultSyncNames,
  formatUpstreamSyncReport,
  parseCommitCount,
  runUpstreamSync,
  type GitCommandResult,
  type UpstreamSyncOptions,
} from "./sync-upstream.ts";

const TAG = "v0.0.29-nightly.20260719.828";
const REMOTE_OBJECT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TARGET_COMMIT = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const options: UpstreamSyncOptions = {
  repoDir: "/repo",
  baseRef: "dx/main",
  branch: "sync/t3-nightly-20260719-828",
  worktreePath: "/worktrees/upstream-sync",
  targetTag: null,
  policy: "nightly-tags",
  fetch: true,
  dryRun: false,
};

const response = (status = 0, stdout = "", stderr = ""): GitCommandResult => ({
  status,
  stdout,
  stderr,
});
function fakeRunner(commands: Array<ReadonlyArray<string>>, mergeStatus = 0) {
  return (args: ReadonlyArray<string>): GitCommandResult => {
    commands.push(args);
    const joined = args.join(" ");
    if (joined.includes("remote get-url origin")) {
      return response(0, "git@github.com:me-safty/dxcode.git\n");
    }
    if (joined.includes("remote get-url upstream")) {
      return response(0, "https://github.com/pingdotgg/t3code.git\n");
    }
    if (joined.includes("ls-remote --refs --tags")) {
      return response(0, `${REMOTE_OBJECT}\trefs/tags/${TAG}\n`);
    }
    if (joined.includes("show-ref --hash --verify refs/dx/upstream-nightlies")) {
      return response(1);
    }
    if (joined.includes("rev-parse refs/dx/upstream-nightlies")) {
      return response(0, `${TARGET_COMMIT}\n`);
    }
    if (joined.includes("merge-base --is-ancestor")) return response(1);
    if (joined.includes("rev-list --count")) return response(0, "2\n");
    if (joined.includes("log --format")) return response(0, "abc\tOne\ndef\tTwo\n");
    if (joined.includes("show-ref --verify --quiet refs/heads")) return response(1);
    if (joined.includes(" merge --no-ff --no-commit ")) return response(mergeStatus);
    if (joined.includes("diff --name-only --diff-filter=U")) {
      return response(0, "apps/web/a.ts\n");
    }
    return response();
  };
}

it("derives deterministic nightly sync names", () => {
  assert.deepStrictEqual(createDefaultSyncNames("/code/t3code", TAG), {
    branch: "sync/t3-nightly-20260719-828",
    worktreePath: NodePath.resolve("/code/t3code-worktrees/sync-t3-nightly-20260719-828"),
  });
});

it("rejects malformed commit counts", () => {
  assert.throws(() => parseCommitCount("1.5"), /Invalid upstream commit count/);
  assert.throws(() => parseCommitCount("-1"), /Invalid upstream commit count/);
});

it("detects newest nightly through --refs and isolated namespace", () => {
  const commands: Array<ReadonlyArray<string>> = [];
  const result = runUpstreamSync(
    { ...options, dryRun: true },
    { runGit: fakeRunner(commands), pathExists: () => false },
  );
  assert.equal(result.status, "planned");
  assert.equal(result.tag, TAG);
  assert.equal(result.targetCommit, TARGET_COMMIT);
  assert.equal(
    commands.some(
      (command) => command.includes("--refs") && command.includes("refs/tags/v*-nightly.*"),
    ),
    true,
  );
  assert.equal(
    commands.some((command) =>
      command.includes(`refs/tags/${TAG}:refs/dx/upstream-nightlies/${TAG}`),
    ),
    true,
  );
});

it("creates one deferred merge against the pinned commit", () => {
  const commands: Array<ReadonlyArray<string>> = [];
  const worktreePath = options.worktreePath;
  assert.ok(worktreePath);
  const result = runUpstreamSync(options, {
    runGit: fakeRunner(commands),
    pathExists: () => false,
  });
  assert.equal(result.status, "ready");
  assert.deepStrictEqual(commands.at(-1), [
    "-C",
    worktreePath,
    "merge",
    "--no-ff",
    "--no-commit",
    TARGET_COMMIT,
  ]);
  assert.equal(
    commands.some((command) => command.includes("push")),
    false,
  );
  assert.match(
    formatUpstreamSyncReport(result),
    /Commit, push, promotion, deletion: not performed/,
  );
});

it("reports conflicts without committing", () => {
  const result = runUpstreamSync(options, {
    runGit: fakeRunner([], 1),
    pathExists: () => false,
  });
  assert.equal(result.status, "conflicted");
  assert.deepStrictEqual(result.conflicts, ["apps/web/a.ts"]);
});
