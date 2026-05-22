import { describe, expect, it } from "vitest";

import {
  buildT3ThreadUrl,
  flattenMarkdownTablesForSlack,
  postableDeploymentReady,
  postableOpsHealthAlert,
  postablePullRequestMerged,
  postablePullRequestStatus,
  postableReplyBody,
  postableTaskStartedStatus,
  protectSlackPackageScopes,
} from "./postableReply.ts";

describe("postableReplyBody", () => {
  it("posts Slack replies as Markdown so the Slack adapter converts formatting", () => {
    expect(
      postableReplyBody({
        kind: "slack_thread",
        body: "**Dependencies**\n\n- `react`\n- `vite`",
      }),
    ).toEqual({
      markdown: "**Dependencies**\n\n- `react`\n- `vite`",
    });
  });

  it("keeps Linear replies as raw strings", () => {
    expect(
      postableReplyBody({
        kind: "linear_issue",
        body: "**Dependencies**\n\n- `react`\n- `vite`",
      }),
    ).toBe("**Dependencies**\n\n- `react`\n- `vite`");
  });

  it("flattens Markdown tables before Slack can drop cell formatting", () => {
    expect(
      flattenMarkdownTablesForSlack(
        [
          "| Package | Purpose |",
          "| --- | --- |",
          "| **apps/web** | `next`, **React** |",
          "| **packages/db** | Database helpers |",
        ].join("\n"),
      ),
    ).toBe(
      [
        "- **apps/web:** **Purpose:** `next`, **React**",
        "- **packages/db:** **Purpose:** Database helpers",
      ].join("\n"),
    );
  });

  it("protects scoped package names from Slack mention expansion", () => {
    expect(
      protectSlackPackageScopes("Uses @sentry/nextjs, @vercel/*, and `@repo/ui` packages."),
    ).toBe("Uses `@sentry/nextjs`, `@vercel/*`, and `@repo/ui` packages.");
  });

  it("builds T3 thread URLs from the public app base URL and scoped thread ref", () => {
    expect(
      buildT3ThreadUrl({
        baseUrl: "https://t3.example.com/",
        environmentId: "environment-local",
        t3ThreadId: "thread-123",
      }),
    ).toBe("https://t3.example.com/environment-local/thread-123");
  });

  it("builds a Slack task started card with an Open T3 button", () => {
    const message = postableTaskStartedStatus({
      kind: "slack_thread",
      t3ThreadUrl: "https://t3.example.com/environment-local/thread-123",
    });

    expect(message).toMatchObject({
      fallbackText: expect.stringContaining("Open T3"),
      card: {
        title: "Talk to Vevin in this thread",
      },
    });
    expect(JSON.stringify(message)).toContain(
      "https://t3.example.com/environment-local/thread-123",
    );
  });

  it("builds a Slack PR status card with PR and preview buttons", () => {
    const message = postablePullRequestStatus({
      kind: "slack_thread",
      body: "Pull request: https://github.com/acme/app/pull/42",
      pullRequestUrl: "https://github.com/acme/app/pull/42",
      pullRequestStatus: "created",
      title: "Add checkout filter",
      repo: "acme/app",
      branch: "task/add-checkout-filter",
      t3ThreadUrl: "https://t3.example.com/environment-local/thread-123",
      deploymentPreviews: [
        {
          environment: "Preview - example-web",
          url: "https://example-web.example.com",
        },
        {
          environment: "Preview - example-api",
          url: "https://example-api.example.com",
        },
      ],
    });

    expect(message).toMatchObject({
      fallbackText: "Pull request: https://github.com/acme/app/pull/42",
      card: {
        title: "New PR #42 - Add checkout filter",
      },
    });
    expect(JSON.stringify(message)).toContain("View PR");
    expect(JSON.stringify(message)).not.toContain("Open T3");
    expect(JSON.stringify(message)).toContain("https://example-web.example.com");
    expect(JSON.stringify(message)).toContain("https://example-api.example.com");
  });

  it("renders every deployment preview as a button", () => {
    const postable = postablePullRequestStatus({
      kind: "slack_thread",
      body: "Pull request: https://github.com/example-org/example-app/pull/123",
      pullRequestUrl: "https://github.com/example-org/example-app/pull/123",
      deploymentPreviews: Array.from({ length: 7 }, (_, index) => ({
        environment: `Preview - app-${index + 1}`,
        url: `https://preview-${index + 1}.example.com`,
      })),
    });

    expect(JSON.stringify(postable)).toContain("preview-7.example.com");
    expect(JSON.stringify(postable).match(/preview-[1-7]\.example\.com/g)).toHaveLength(7);
  });

  it("keeps all Nextcard deployment preview buttons paired to their own URLs", () => {
    const message = postablePullRequestStatus({
      kind: "slack_thread",
      body: "Pull request: https://github.com/example-org/example-app/pull/1382",
      pullRequestUrl: "https://github.com/example-org/example-app/pull/1382",
      title: "Add Slack PR preview smoke file",
      repo: "example-org/example-app",
      branch: "t3code/slack-preview-smoke-file",
      deploymentPreviews: [
        {
          environment: "Preview – example-web",
          url: "https://example-web-preview.example-app.com",
        },
        {
          environment: "Preview – example-api",
          url: "https://example-api-preview.example-app.com",
        },
        {
          environment: "Preview – example-pdp",
          url: "https://example-pdp-preview.example-app.com",
        },
      ],
    });

    const json = JSON.stringify(message);

    expect(json).toContain("example-web");
    expect(json).toContain("https://example-web-preview.example-app.com");
    expect(json).toContain("example-api");
    expect(json).toContain("https://example-api-preview.example-app.com");
    expect(json).toContain("example-pdp");
    expect(json).toContain("https://example-pdp-preview.example-app.com");
  });

  it("keeps Linear PR status as raw text", () => {
    expect(
      postablePullRequestStatus({
        kind: "linear_issue",
        body: "Pull request: https://github.com/acme/app/pull/42",
        pullRequestUrl: "https://github.com/acme/app/pull/42",
      }),
    ).toBe("Pull request: https://github.com/acme/app/pull/42");
  });

  it("builds a Slack PR merged card with a View PR button", () => {
    const message = postablePullRequestMerged({
      kind: "slack_thread",
      pullRequestUrl: "https://github.com/acme/app/pull/42",
      title: "Add checkout filter",
    });

    expect(message).toMatchObject({
      fallbackText: "PR was merged: https://github.com/acme/app/pull/42",
      card: {
        title: "PR was merged #42 - Add checkout filter",
      },
    });
    expect(JSON.stringify(message)).toContain("View PR");
    expect(JSON.stringify(message)).not.toContain("New PR");
  });

  it("builds a Slack deployment-ready card with a deployment button", () => {
    const message = postableDeploymentReady({
      kind: "slack_thread",
      environment: "Preview - example-web",
      url: "https://example-web-preview.example-app.com",
    });

    expect(message).toMatchObject({
      fallbackText:
        "Deployment ready (Preview - example-web): https://example-web-preview.example-app.com",
      card: {
        title: "Preview - example-web is ready",
      },
    });
    expect(JSON.stringify(message)).toContain("Open deployment");
    expect(JSON.stringify(message)).toContain("https://example-web-preview.example-app.com");
  });

  it("keeps Linear deployment-ready replies as raw text", () => {
    expect(
      postableDeploymentReady({
        kind: "linear_issue",
        environment: "Preview - example-web",
        url: "https://example-web-preview.example-app.com",
      }),
    ).toBe("Deployment ready (Preview - example-web): https://example-web-preview.example-app.com");
  });

  it("builds a Slack ops health alert card", () => {
    const message = postableOpsHealthAlert({
      title: "Vevin health check failing (1)",
      summary: "One orchestrator health check failed.",
      status: "failing",
      checkedAt: "2026-05-15T21:00:00.000Z",
      failingChecks: [
        {
          name: "public T3",
          details: "https://t3.example.com -> HTTP 530",
        },
      ],
      allChecks: [
        {
          name: "public T3",
          ok: false,
          details: "https://t3.example.com -> HTTP 530",
        },
      ],
    });

    const json = JSON.stringify(message);
    expect(json).toContain("Vevin health check failing");
    expect(json).toContain("public T3");
    expect(json).toContain("HTTP 530");
  });
});
