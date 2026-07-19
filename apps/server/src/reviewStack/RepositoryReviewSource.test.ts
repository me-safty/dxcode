import { describe, expect, it } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Effect from "effect/Effect";

import {
  captureRepositoryReviewSource,
  parseNameStatusPathGroups,
  parsePorcelainPathGroups,
  parsePorcelainPaths,
} from "./RepositoryReviewSource.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

describe("parsePorcelainPaths", () => {
  it("returns every changed path once, including both sides of a rename", () => {
    expect(
      parsePorcelainPaths(
        [" M src/a.ts", "?? src/new.ts", "R  src/new-name.ts", "src/old-name.ts", ""].join("\0"),
      ),
    ).toEqual(["src/a.ts", "src/new-name.ts", "src/new.ts", "src/old-name.ts"]);
  });

  it("keeps both sides of immutable rename entries in one path group", () => {
    expect(
      parseNameStatusPathGroups(["M", "src/a.ts", "R100", "old.ts", "new.ts", ""].join("\0")),
    ).toEqual([
      { paths: ["src/a.ts"], displayPath: "src/a.ts", isUntracked: false },
      { paths: ["old.ts", "new.ts"], displayPath: "new.ts", isUntracked: false },
    ]);
  });

  it("marks only porcelain ?? entries as untracked", () => {
    expect(parsePorcelainPathGroups([" M tracked.ts", "?? new.ts", ""].join("\0"))).toEqual([
      { paths: ["new.ts"], displayPath: "new.ts", isUntracked: true },
      { paths: ["tracked.ts"], displayPath: "tracked.ts", isUntracked: false },
    ]);
  });

  effectIt.effect("captures staged files against the empty tree when HEAD is unborn", () =>
    Effect.gen(function* () {
      const calls: ReadonlyArray<string>[] = [];
      const result = yield* captureRepositoryReviewSource({
        cwd: "/repo",
        target: { _tag: "working-tree" },
        resolvedBase: null,
        ignoreWhitespace: false,
        git: {
          execute: (input: Parameters<GitVcsDriver.GitVcsDriver["Service"]["execute"]>[0]) => {
            calls.push(input.args);
            const stdout =
              input.operation === "ReviewStack.capture.manifest"
                ? "A  staged.txt\0"
                : input.operation === "ReviewStack.capture.filePatch"
                  ? [
                      "diff --git a/staged.txt b/staged.txt",
                      "new file mode 100644",
                      "--- /dev/null",
                      "+++ b/staged.txt",
                      "@@ -0,0 +1 @@",
                      "+content",
                    ].join("\n")
                  : "";
            return Effect.succeed({
              exitCode: ChildProcessSpawner.ExitCode(
                input.operation === "ReviewStack.capture.verifyHead" ? 128 : 0,
              ),
              stdout,
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            });
          },
        } as unknown as GitVcsDriver.GitVcsDriver["Service"],
      });

      expect(calls.at(-1)).toEqual([
        "diff",
        "--no-index",
        "--patch",
        "--minimal",
        "--",
        "/dev/null",
        "staged.txt",
      ]);
      expect(result.diff).toContain("+content");
    }),
  );
});
