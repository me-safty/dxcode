import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deploymentPreviewUrlFromStatus,
  githubPullRequestExternalId,
  isPublicDeploymentPreviewUrl,
  parseGitHubDeploymentReadyEvent,
  parseGitHubPullRequestMergedEvent,
  toVercelBranchDeploymentUrl,
} from "./webhook.ts";

describe("GitHub webhook parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves public deployment preview URLs from environment_url", () => {
    expect(
      deploymentPreviewUrlFromStatus({
        deployment_status: {
          state: "success",
          environment_url: "https://example-web-preview.example-app.com",
          target_url: "https://vercel.com/example-org/example-app/abc",
        },
      }),
    ).toBe("https://example-web-preview.example-app.com");
  });

  it("falls back to target_url and filters Vercel dashboard URLs", () => {
    expect(
      deploymentPreviewUrlFromStatus({
        deployment_status: {
          state: "success",
          environment_url: "https://vercel.com/example-org/example-app/abc",
          target_url: "https://example-api-preview.example-app.com",
        },
      }),
    ).toBe("https://example-api-preview.example-app.com");
    expect(isPublicDeploymentPreviewUrl("https://vercel.com/example-org/example-app/abc")).toBe(
      false,
    );
  });

  it("rewrites configured Vercel commit URL domains to branch deployment aliases", () => {
    vi.stubEnv("VERCEL_BRANCH_DEPLOYMENT_DOMAIN_SUFFIXES", "example-app.com");

    expect(
      toVercelBranchDeploymentUrl({
        url: "https://example-web-c2pkvyk7n.example-app.com",
        environment: "Preview – example-web",
        branch: "t3code/pr-card-smoke",
      }),
    ).toBe("https://example-web-git-t3code-pr-card-smoke.example-app.com");
  });

  it("parses successful deployment_status payloads", () => {
    expect(
      parseGitHubDeploymentReadyEvent({
        repository: { owner: { login: "example-org" }, name: "example-app" },
        deployment: {
          id: 123,
          sha: "abc123",
          environment: "Preview - example-web",
        },
        deployment_status: {
          id: 456,
          state: "success",
          environment_url: "https://example-web-preview.example-app.com",
        },
      }),
    ).toEqual({
      owner: "example-org",
      repo: "example-app",
      headSha: "abc123",
      deploymentId: "123",
      statusId: "456",
      environment: "Preview - example-web",
      url: "https://example-web-preview.example-app.com",
    });
  });

  it("parses merged pull_request payloads", () => {
    const event = parseGitHubPullRequestMergedEvent({
      action: "closed",
      repository: { owner: { login: "example-org" }, name: "example-app" },
      pull_request: {
        number: 42,
        merged: true,
        html_url: "https://github.com/example-org/example-app/pull/42",
        title: "Add smoke file",
        merged_at: "2026-05-12T12:00:00Z",
        head: { sha: "abc123", ref: "t3code/smoke" },
      },
    });

    expect(event).toEqual({
      owner: "example-org",
      repo: "example-app",
      number: 42,
      url: "https://github.com/example-org/example-app/pull/42",
      title: "Add smoke file",
      mergedAt: "2026-05-12T12:00:00Z",
      headSha: "abc123",
      headBranch: "t3code/smoke",
    });
    expect(event && githubPullRequestExternalId(event)).toBe("example-org/example-app#42");
  });
});
