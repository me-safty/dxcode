import { describe, expect, it } from "vitest";

import {
  collectTaskPullRequestPreviewLinks,
  sortTaskPullRequestPreviewLinks,
  taskRuntimeWorktreeCreateInput,
  toVercelBranchPreviewUrl,
} from "./runStart.ts";

describe("task pull request preview links", () => {
  it("uses public GitHub deployment status URLs and filters Vercel dashboard URLs", () => {
    const previews = collectTaskPullRequestPreviewLinks({
      deployments: [
        {
          id: 1,
          environment: "Preview - nextcard-web",
          creator: { login: "vercel[bot]" },
        },
        {
          id: 2,
          environment: "Preview - nextcard-mcp",
          creator: { login: "vercel[bot]" },
        },
      ],
      statusesByDeploymentId: new Map([
        [
          "1",
          [
            {
              state: "success",
              environment_url: "https://nextcard-abc123.nextcard.com",
              target_url: "https://vercel.com/affil/nextcard-web/build",
            },
          ],
        ],
        [
          "2",
          [
            {
              state: "success",
              environment_url: "https://vercel.com/affil/nextcard-mcp/build",
              target_url: "https://nextcard-mcp-abc123.nextcard.com",
            },
          ],
        ],
      ]),
    });

    expect(previews).toEqual([
      {
        provider: "vercel",
        environment: "Preview - nextcard-web",
        url: "https://nextcard-abc123.nextcard.com",
      },
      {
        provider: "vercel",
        environment: "Preview - nextcard-mcp",
        url: "https://nextcard-mcp-abc123.nextcard.com",
      },
    ]);
  });

  it("rewrites nextcard Vercel commit URLs to branch preview aliases", () => {
    expect(
      toVercelBranchPreviewUrl({
        url: "https://nextcard-c2pkvyk7n.nextcard.com",
        environment: "Preview – nextcard-web",
        branch: "t3code/pr-card-smoke",
      }),
    ).toBe("https://nextcard-web-git-t3code-pr-card-smoke.nextcard.com");
  });

  it("collects branch preview aliases for nextcard deployments", () => {
    const previews = collectTaskPullRequestPreviewLinks({
      headBranch: "t3code/pr-card-smoke",
      deployments: [
        {
          id: 1,
          environment: "Preview – nextcard-web",
          creator: { login: "vercel[bot]" },
        },
      ],
      statusesByDeploymentId: new Map([
        [
          "1",
          [
            {
              state: "success",
              environment_url: "https://nextcard-c2pkvyk7n.nextcard.com",
            },
          ],
        ],
      ]),
    });

    expect(previews[0]?.url).toBe("https://nextcard-web-git-t3code-pr-card-smoke.nextcard.com");
  });

  it("prefers the nextcard web preview when multiple deployments are available", () => {
    expect(
      sortTaskPullRequestPreviewLinks([
        {
          provider: "vercel",
          environment: "Preview - nextcard-pdp",
          url: "https://nextcard-pdp.example.com",
        },
        {
          provider: "vercel",
          environment: "Preview - nextcard-web",
          url: "https://nextcard-web.example.com",
        },
      ])[0]?.url,
    ).toBe("https://nextcard-web.example.com");
  });
});

describe("task runtime worktree creation", () => {
  it("requests an origin base refresh before materializing task worktrees", () => {
    expect(
      taskRuntimeWorktreeCreateInput(
        {
          project: {
            repoName: "nextcard",
            workspaceRoot: "C:\\Users\\Vivek\\Affil\\nextcard",
            defaultBranch: "dev",
          },
        },
        "t3code/fresh-base",
      ),
    ).toEqual({
      cwd: "C:\\Users\\Vivek\\Affil\\nextcard",
      refName: "dev",
      newRefName: "t3code/fresh-base",
      path: null,
      refreshBaseFromOrigin: true,
    });
  });
});
