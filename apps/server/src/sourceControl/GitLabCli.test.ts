import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../processRunner.ts";
import * as GitLabCli from "./GitLabCli.ts";

const mockedRunProcess = vi.mocked(runProcess);
const layer = it.layer(GitLabCli.layer);

afterEach(() => {
  mockedRunProcess.mockReset();
});

layer("GitLabCli.layer", (it) => {
  it.effect("parses merge request view output", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          iid: 42,
          title: "Add MR thread creation",
          web_url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/42",
          target_branch: "main",
          source_branch: "feature/mr-threads",
          state: "opened",
          source_project_id: 101,
          target_project_id: 100,
          source_project: {
            path_with_namespace: "octocat/t3code",
          },
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "42",
        });
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add MR thread creation",
        url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/42",
        baseRefName: "main",
        headRefName: "feature/mr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/t3code",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "glab",
        ["mr", "view", "42", "--output", "json"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("skips invalid entries when parsing MR lists", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            iid: 0,
            title: "invalid",
            web_url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/0",
            target_branch: "main",
            source_branch: "feature/invalid",
          },
          {
            iid: 43,
            title: "  Valid MR  ",
            web_url: " https://gitlab.com/pingdotgg/t3code/-/merge_requests/43 ",
            target_branch: " main ",
            source_branch: " feature/mr-list ",
            state: "merged",
          },
        ]),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.listMergeRequests({
          cwd: "/repo",
          headSelector: "feature/mr-list",
          state: "all",
        });
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid MR",
          url: "https://gitlab.com/pingdotgg/t3code/-/merge_requests/43",
          baseRefName: "main",
          headRefName: "feature/mr-list",
          state: "merged",
        },
      ]);
      expect(mockedRunProcess).toHaveBeenCalledWith(
        "glab",
        [
          "mr",
          "list",
          "--source-branch",
          "feature/mr-list",
          "--all",
          "--per-page",
          "20",
          "--output",
          "json",
        ],
        expect.objectContaining({ cwd: "/repo" }),
      );
    }),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockResolvedValueOnce({
        stdout: JSON.stringify({
          path_with_namespace: "octocat/t3code",
          web_url: "https://gitlab.com/octocat/t3code",
          http_url_to_repo: "https://gitlab.com/octocat/t3code.git",
          ssh_url_to_repo: "git@gitlab.com:octocat/t3code.git",
        }),
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
      });

      const result = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getRepositoryCloneUrls({
          cwd: "/repo",
          repository: "octocat/t3code",
        });
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/t3code",
        url: "https://gitlab.com/octocat/t3code.git",
        sshUrl: "git@gitlab.com:octocat/t3code.git",
      });
    }),
  );

  it.effect("surfaces a friendly error when the merge request is not found", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockRejectedValueOnce(new Error("GET 404 merge request not found"));

      const error = yield* Effect.gen(function* () {
        const glab = yield* GitLabCli.GitLabCli;
        return yield* glab.getMergeRequest({
          cwd: "/repo",
          reference: "4888",
        });
      }).pipe(Effect.flip);

      assert.equal(error.message.includes("Merge request not found"), true);
    }),
  );
});
