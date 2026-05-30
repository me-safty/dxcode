import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../environmentApi", () => ({
  ensureEnvironmentApi: vi.fn(),
}));

vi.mock("../wsRpcClient", () => ({
  getWsRpcClient: vi.fn(),
  getWsRpcClientForEnvironment: vi.fn(),
}));

import type { InfiniteData } from "@tanstack/react-query";
import { EnvironmentId, type EnvironmentApi, type VcsListRefsResult } from "@t3tools/contracts";
import * as environmentApi from "../environmentApi";

import {
  gitBranchSearchInfiniteQueryOptions,
  gitGenerateCommitMessageMutationOptions,
  gitMutationKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  gitQueryKeys,
  gitRunStackedActionMutationOptions,
  gitWorkingTreeDiffQueryOptions,
  invalidateGitQueries,
  vcsStageFilesMutationOptions,
  vcsUnstageFilesMutationOptions,
} from "./gitReactQuery";

const BRANCH_QUERY_RESULT: VcsListRefsResult = {
  refs: [],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 0,
};

const BRANCH_SEARCH_RESULT: InfiniteData<VcsListRefsResult, number> = {
  pages: [BRANCH_QUERY_RESULT],
  pageParams: [0],
};
const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");

afterEach(() => {
  vi.clearAllMocks();
});

describe("gitMutationKeys", () => {
  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.runStackedAction(ENVIRONMENT_A, "/repo/b"),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.pull(ENVIRONMENT_A, "/repo/b"),
    );
  });

  it("scopes generated commit message keys by cwd", () => {
    expect(gitMutationKeys.generateCommitMessage(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.generateCommitMessage(ENVIRONMENT_A, "/repo/b"),
    );
  });

  it("scopes pull request thread preparation keys by cwd", () => {
    expect(gitMutationKeys.preparePullRequestThread(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.preparePullRequestThread(ENVIRONMENT_A, "/repo/b"),
    );
  });

  it("scopes stage and unstage keys by cwd", () => {
    expect(gitMutationKeys.stageFiles(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.stageFiles(ENVIRONMENT_A, "/repo/b"),
    );
    expect(gitMutationKeys.unstageFiles(ENVIRONMENT_A, "/repo/a")).not.toEqual(
      gitMutationKeys.unstageFiles(ENVIRONMENT_A, "/repo/b"),
    );
  });
});

describe("git working tree diff query options", () => {
  it("includes target, ignoreWhitespace, and filePaths in the query key", () => {
    expect(gitQueryKeys.workingTreeDiff(ENVIRONMENT_A, "/repo", "unstaged", false)).not.toEqual(
      gitQueryKeys.workingTreeDiff(ENVIRONMENT_A, "/repo", "staged", false),
    );
    expect(gitQueryKeys.workingTreeDiff(ENVIRONMENT_A, "/repo", "unstaged", false)).not.toEqual(
      gitQueryKeys.workingTreeDiff(ENVIRONMENT_A, "/repo", "unstaged", true),
    );
    expect(gitQueryKeys.workingTreeDiff(ENVIRONMENT_A, "/repo", "all", false)).not.toEqual(
      gitQueryKeys.workingTreeDiff(ENVIRONMENT_A, "/repo", "all", false, ["src/app.ts"]),
    );
  });

  it("forwards working tree diff requests to the environment API", async () => {
    const getWorkingTreeDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    vi.mocked(environmentApi.ensureEnvironmentApi).mockReturnValue({
      vcs: {
        getWorkingTreeDiff,
      },
    } as unknown as EnvironmentApi);

    const queryClient = new QueryClient();
    await queryClient.fetchQuery(
      gitWorkingTreeDiffQueryOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo",
        target: "all",
        ignoreWhitespace: true,
        filePaths: ["src/app.ts"],
      }),
    );

    expect(getWorkingTreeDiff).toHaveBeenCalledWith({
      cwd: "/repo",
      target: "all",
      ignoreWhitespace: true,
      filePaths: ["src/app.ts"],
    });
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.runStackedAction(ENVIRONMENT_A, "/repo/a"));
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(gitMutationKeys.pull(ENVIRONMENT_A, "/repo/a"));
  });

  it("attaches cwd-scoped mutation key for generated commit messages", () => {
    const options = gitGenerateCommitMessageMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
    });
    expect(options.mutationKey).toEqual(
      gitMutationKeys.generateCommitMessage(ENVIRONMENT_A, "/repo/a"),
    );
  });

  it("attaches cwd-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual(
      gitMutationKeys.preparePullRequestThread(ENVIRONMENT_A, "/repo/a"),
    );
  });

  it("attaches cwd-scoped mutation keys for stage operations", () => {
    expect(
      vcsStageFilesMutationOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo/a",
        queryClient,
      }).mutationKey,
    ).toEqual(gitMutationKeys.stageFiles(ENVIRONMENT_A, "/repo/a"));
    expect(
      vcsUnstageFilesMutationOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo/a",
        queryClient,
      }).mutationKey,
    ).toEqual(gitMutationKeys.unstageFiles(ENVIRONMENT_A, "/repo/a"));
  });

  it("forwards stage operations to the environment API", async () => {
    const stageFiles = vi.fn().mockResolvedValue(null);
    const unstageFiles = vi.fn().mockResolvedValue(null);
    vi.mocked(environmentApi.ensureEnvironmentApi).mockReturnValue({
      vcs: {
        stageFiles,
        unstageFiles,
      },
    } as unknown as EnvironmentApi);

    await vcsStageFilesMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    }).mutationFn?.({ filePaths: ["src/app.ts"] }, undefined as never);
    await vcsUnstageFilesMutationOptions({
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
      queryClient,
    }).mutationFn?.({ filePaths: ["src/app.ts"] }, undefined as never);

    expect(stageFiles).toHaveBeenCalledWith({ cwd: "/repo/a", filePaths: ["src/app.ts"] });
    expect(unstageFiles).toHaveBeenCalledWith({ cwd: "/repo/a", filePaths: ["src/app.ts"] });
  });
});

describe("invalidateGitQueries", () => {
  it("can invalidate a single cwd without blasting other git query scopes", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      gitBranchSearchInfiniteQueryOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo/a",
        query: "feature",
      }).queryKey,
      BRANCH_SEARCH_RESULT,
    );
    queryClient.setQueryData(
      gitBranchSearchInfiniteQueryOptions({
        environmentId: ENVIRONMENT_B,
        cwd: "/repo/b",
        query: "feature",
      }).queryKey,
      BRANCH_SEARCH_RESULT,
    );

    await invalidateGitQueries(queryClient, { environmentId: ENVIRONMENT_A, cwd: "/repo/a" });

    expect(
      queryClient.getQueryState(
        gitBranchSearchInfiniteQueryOptions({
          environmentId: ENVIRONMENT_A,
          cwd: "/repo/a",
          query: "feature",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        gitBranchSearchInfiniteQueryOptions({
          environmentId: ENVIRONMENT_B,
          cwd: "/repo/b",
          query: "feature",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(false);
  });
});
