import { httpRouter } from "convex/server";
import * as Schema from "effect/Schema";
import { TaskRuntimeAssistantMessageEvent, TaskRuntimeLifecycleEvent } from "@t3tools/contracts";

import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { httpAction } from "./_generated/server.js";

const http = httpRouter();
const decodeTaskRuntimeAssistantMessageEvent = Schema.decodeUnknownSync(
  TaskRuntimeAssistantMessageEvent,
);
const decodeTaskRuntimeLifecycleEvent = Schema.decodeUnknownSync(TaskRuntimeLifecycleEvent);

function requireBridgeAuthorization(request: Request) {
  const secret = process.env.T3_EXECUTION_BRIDGE_SHARED_SECRET?.trim();
  if (!secret) {
    return {
      ok: false as const,
      status: 503,
      message: "Missing orchestrator bridge secret",
    };
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return {
      ok: false as const,
      status: 401,
      message: "Unauthorized execution bridge callback",
    };
  }

  return { ok: true as const };
}

function timingSafeEqualString(actual: string, expected: string) {
  if (actual.length !== expected.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

async function verifyGitHubWebhookSignature(body: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return {
      ok: false as const,
      status: 503,
      message: "Missing GitHub webhook secret",
    };
  }
  if (signature === null || !signature.startsWith("sha256=")) {
    return {
      ok: false as const,
      status: 401,
      message: "Missing GitHub webhook signature",
    };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = `sha256=${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

  if (!timingSafeEqualString(signature, expected)) {
    return {
      ok: false as const,
      status: 401,
      message: "Invalid GitHub webhook signature",
    };
  }

  return { ok: true as const };
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response("ok", { status: 200 })),
});

http.route({
  path: "/slack/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return forwardChatSdkWebhook(ctx, request, "slack");
  }),
});

http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const auth = await verifyGitHubWebhookSignature(
      body,
      request.headers.get("x-hub-signature-256"),
    );
    if (!auth.ok) {
      return Response.json({ error: auth.message }, { status: auth.status });
    }

    const result = await ctx.runAction(internal.github.handleWebhook, {
      event: request.headers.get("x-github-event") ?? "",
      deliveryId: request.headers.get("x-github-delivery") ?? "",
      body,
    });

    return Response.json({
      accepted: true,
      ...result,
    });
  }),
});

http.route({
  path: "/t3/task-runtime-assistant-messages",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBridgeAuthorization(request);
    if (!auth.ok) {
      return Response.json({ error: auth.message }, { status: auth.status });
    }

    const payload = decodeTaskRuntimeAssistantMessageEvent(await request.json());
    const result = await ctx.runAction(internal.taskIntake.postTaskRuntimeAssistantMessage, {
      eventId: payload.eventId,
      taskId: payload.taskId as Id<"tasks">,
      workSessionId: payload.workSessionId as Id<"workSessions">,
      occurredAt: payload.occurredAt,
      t3ThreadId: String(payload.t3ThreadId),
      t3MessageId: String(payload.t3MessageId),
      ...(payload.t3TurnId !== undefined ? { t3TurnId: String(payload.t3TurnId) } : {}),
      assistantMessage: payload.assistantMessage,
    });

    return Response.json({
      accepted: true,
      ...result,
    });
  }),
});

http.route({
  path: "/t3/task-runtime-events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBridgeAuthorization(request);
    if (!auth.ok) {
      return Response.json({ error: auth.message }, { status: auth.status });
    }

    const payload = decodeTaskRuntimeLifecycleEvent(await request.json());
    const result = await ctx.runMutation(internal.t3Runtime.applyTaskRuntimeLifecycleEvent, {
      eventId: payload.eventId,
      taskId: payload.taskId as Id<"tasks">,
      workSessionId: payload.workSessionId as Id<"workSessions">,
      type: payload.type,
      occurredAt: payload.occurredAt,
      ...(payload.t3ThreadId !== undefined ? { t3ThreadId: String(payload.t3ThreadId) } : {}),
      ...(payload.t3TurnId !== undefined ? { t3TurnId: String(payload.t3TurnId) } : {}),
      ...(payload.failureSummary !== undefined ? { failureSummary: payload.failureSummary } : {}),
      ...(payload.assistantResponse !== undefined
        ? { assistantResponse: payload.assistantResponse }
        : {}),
    });

    let intakeReply:
      | {
          readonly posted: boolean;
          readonly reason?: string;
          readonly externalMessageId?: string;
        }
      | undefined;
    let pullRequest:
      | {
          readonly status: "waiting_for_changes" | "created" | "existing" | "failed" | "skipped";
          readonly url?: string;
          readonly title?: string;
          readonly repo?: string;
          readonly headBranch?: string;
          readonly previewUrl?: string;
          readonly deploymentPreviewsJson?: string;
          readonly summary?: string;
        }
      | undefined;
    if (payload.type === "completed" || payload.type === "failed") {
      try {
        pullRequest = await ctx.runAction(api.t3Runtime.ensureTaskPullRequest, {
          taskId: payload.taskId as Id<"tasks">,
          workSessionId: payload.workSessionId as Id<"workSessions">,
          reason: `runtime-${payload.type}`,
        });
      } catch (error) {
        pullRequest = {
          status: "failed",
          summary: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        if (
          payload.type === "completed" &&
          pullRequest?.status !== "failed" &&
          pullRequest?.status !== "waiting_for_changes" &&
          pullRequest?.status !== "skipped" &&
          pullRequest.url !== undefined
        ) {
          const parsedPullRequest = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(
            pullRequest.url,
          );
          intakeReply =
            parsedPullRequest !== null
              ? await ctx.runAction(internal.taskIntake.postTaskPullRequestStatusReply, {
                  taskId: payload.taskId as Id<"tasks">,
                  workSessionId: payload.workSessionId as Id<"workSessions">,
                  pullRequestExternalId: `${parsedPullRequest[1]}/${parsedPullRequest[2]}#${parsedPullRequest[3]}`,
                  pullRequestUrl: pullRequest.url,
                  pullRequestStatus: pullRequest.status,
                  ...(pullRequest.title !== undefined ? { title: pullRequest.title } : {}),
                  ...(pullRequest.repo !== undefined ? { repo: pullRequest.repo } : {}),
                  ...(pullRequest.headBranch !== undefined
                    ? { headBranch: pullRequest.headBranch }
                    : {}),
                  ...(pullRequest.previewUrl !== undefined
                    ? { previewUrl: pullRequest.previewUrl }
                    : {}),
                  ...(pullRequest.deploymentPreviewsJson !== undefined
                    ? { deploymentPreviewsJson: pullRequest.deploymentPreviewsJson }
                    : {}),
                })
              : { posted: false, reason: "unparseable_pull_request_url" };
        } else if (payload.type === "failed") {
          intakeReply = await ctx.runAction(internal.taskIntake.postTaskRuntimeLifecycleReply, {
            taskId: payload.taskId as Id<"tasks">,
            workSessionId: payload.workSessionId as Id<"workSessions">,
            status: payload.type,
            occurredAt: payload.occurredAt,
            ...(payload.t3ThreadId !== undefined ? { t3ThreadId: String(payload.t3ThreadId) } : {}),
            ...(payload.t3TurnId !== undefined ? { t3TurnId: String(payload.t3TurnId) } : {}),
            ...(payload.failureSummary !== undefined
              ? { failureSummary: payload.failureSummary }
              : {}),
            ...(payload.assistantResponse !== undefined
              ? { assistantResponse: payload.assistantResponse }
              : {}),
          });
        }
      } catch (error) {
        intakeReply = {
          posted: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return Response.json({
      accepted: true,
      ...result,
      ...(pullRequest !== undefined ? { pullRequest } : {}),
      ...(intakeReply !== undefined ? { intakeReply } : {}),
    });
  }),
});

export default http;

async function forwardChatSdkWebhook(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
  source: "slack",
) {
  const result = await ctx.runAction(internal.taskIntake.handleChatSdkWebhook, {
    source,
    url: request.url,
    headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
    body: await request.text(),
  });

  const init =
    result.contentType === undefined
      ? { status: result.status }
      : { status: result.status, headers: { "content-type": result.contentType } };

  return new Response(result.body, {
    ...init,
  });
}
