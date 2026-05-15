import { describe, expect, it } from "vitest";

import {
  deploymentPreviewUrlFromStatus,
  githubPullRequestExternalId,
  isPublicDeploymentPreviewUrl,
  parseGitHubDeploymentReadyEvent,
  parseGitHubPullRequestMergedEvent,
  toVercelBranchDeploymentUrl,
} from "./webhook.ts";

describe("GitHub webhook parsing", () => {
  it("resolves public deployment preview URLs from environment_url", () => {
    expect(
      deploymentPreviewUrlFromStatus({
        deployment_status: {
          state: "success",
          environment_url: "https://nextcard-web-preview.nextcard.com",
          target_url: "https://vercel.com/affil-ai/nextcard/abc",
        },
      }),
    ).toBe("https://nextcard-web-preview.nextcard.com");
  });

  it("falls back to target_url and filters Vercel dashboard URLs", () => {
    expect(
      deploymentPreviewUrlFromStatus({
        deployment_status: {
          state: "success",
          environment_url: "https://vercel.com/affil-ai/nextcard/abc",
          target_url: "https://nextcard-mcp-preview.nextcard.com",
        },
      }),
    ).toBe("https://nextcard-mcp-preview.nextcard.com");
    expect(isPublicDeploymentPreviewUrl("https://vercel.com/affil-ai/nextcard/abc")).toBe(false);
  });

  it("rewrites nextcard Vercel commit URLs to branch deployment aliases", () => {
    expect(
      toVercelBranchDeploymentUrl({
        url: "https://nextcard-c2pkvyk7n.nextcard.com",
        environment: "Preview – nextcard-web",
        branch: "t3code/pr-card-smoke",
      }),
    ).toBe("https://nextcard-web-git-t3code-pr-card-smoke.nextcard.com");
  });

  it("parses successful deployment_status payloads", () => {
    expect(
      parseGitHubDeploymentReadyEvent({
        repository: { owner: { login: "affil-ai" }, name: "nextcard" },
        deployment: {
          id: 123,
          sha: "abc123",
          environment: "Preview - nextcard-web",
        },
        deployment_status: {
          id: 456,
          state: "success",
          environment_url: "https://nextcard-web-preview.nextcard.com",
        },
      }),
    ).toEqual({
      owner: "affil-ai",
      repo: "nextcard",
      headSha: "abc123",
      deploymentId: "123",
      statusId: "456",
      environment: "Preview - nextcard-web",
      url: "https://nextcard-web-preview.nextcard.com",
    });
  });

  it("parses merged pull_request payloads", () => {
    const event = parseGitHubPullRequestMergedEvent({
      action: "closed",
      repository: { owner: { login: "affil-ai" }, name: "nextcard" },
      pull_request: {
        number: 42,
        merged: true,
        html_url: "https://github.com/affil-ai/nextcard/pull/42",
        title: "Add smoke file",
        merged_at: "2026-05-12T12:00:00Z",
        head: { sha: "abc123", ref: "t3code/smoke" },
      },
    });

    expect(event).toEqual({
      owner: "affil-ai",
      repo: "nextcard",
      number: 42,
      url: "https://github.com/affil-ai/nextcard/pull/42",
      title: "Add smoke file",
      mergedAt: "2026-05-12T12:00:00Z",
      headSha: "abc123",
      headBranch: "t3code/smoke",
    });
    expect(event && githubPullRequestExternalId(event)).toBe("affil-ai/nextcard#42");
  });
});
