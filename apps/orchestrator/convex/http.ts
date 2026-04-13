import { httpRouter } from "convex/server";
import { Schema } from "effect";

import {
  buildLinearInstallUrl,
  buildLinearOAuthCallbackUrl,
  exchangeLinearOAuthCode,
  renderLinearOAuthPage,
} from "../src/linear/oauth.ts";
import { normalizeLinearWebhookInput } from "../src/linear/ingress.ts";
import { hasValidLinearSignature } from "../src/linear/webhookVerification.ts";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ExecutionRunLifecycleEvent } from "@t3tools/contracts";

const http = httpRouter();
const decodeExecutionRunLifecycleEvent = Schema.decodeUnknownSync(ExecutionRunLifecycleEvent);
const FIVE_MINUTES_MS = 5 * 60 * 1000;

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

function requireLinearWebhookSecret() {
  const secret = process.env.LINEAR_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return {
      ok: false as const,
      status: 503,
      message: "Missing Linear webhook secret",
    };
  }

  return {
    ok: true as const,
    secret,
  };
}

function hasFreshLinearTimestamp(payload: unknown) {
  if (payload === null || typeof payload !== "object") {
    return true;
  }

  const webhookTimestamp = (payload as { readonly webhookTimestamp?: unknown }).webhookTimestamp;
  return (
    typeof webhookTimestamp !== "number" ||
    Math.abs(Date.now() - webhookTimestamp) <= FIVE_MINUTES_MS
  );
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response("ok", { status: 200 })),
});

http.route({
  path: "/linear/oauth/install",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    try {
      return Response.redirect(buildLinearInstallUrl(new URL(request.url).origin), 302);
    } catch (error) {
      return renderLinearOAuthPage({
        status: "error",
        title: "Linear Install Could Not Start",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }),
});

http.route({
  path: "/linear/oauth/callback",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) {
      return renderLinearOAuthPage({
        status: "error",
        title: "Linear Install Was Cancelled",
        detail: error,
      });
    }

    const code = url.searchParams.get("code");
    if (!code) {
      return renderLinearOAuthPage({
        status: "error",
        title: "Linear Install Did Not Return A Code",
        detail: "Linear redirected back without an authorization code.",
      });
    }

    try {
      const result = await exchangeLinearOAuthCode({
        code,
        redirectUri: buildLinearOAuthCallbackUrl(url.origin),
      });

      return renderLinearOAuthPage({
        status: "success",
        title: "Linear App Install Completed",
        detail: `OAuth callback completed successfully.${result.scope ? ` Granted scopes: ${result.scope}.` : ""} You can close this tab and continue with webhook testing.`,
      });
    } catch (callbackError) {
      return renderLinearOAuthPage({
        status: "error",
        title: "Linear Install Callback Failed",
        detail: callbackError instanceof Error ? callbackError.message : String(callbackError),
      });
    }
  }),
});

http.route({
  path: "/linear/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = requireLinearWebhookSecret();
    if (!secret.ok) {
      return Response.json({ error: secret.message }, { status: secret.status });
    }

    const rawBody = await request.text();
    if (
      !(await hasValidLinearSignature({
        body: rawBody,
        request,
        secret: secret.secret,
      }))
    ) {
      return Response.json({ error: "Invalid Linear signature" }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!hasFreshLinearTimestamp(payload)) {
      return Response.json({ error: "Linear webhook expired" }, { status: 401 });
    }

    const botUserName = process.env.LINEAR_BOT_USERNAME?.trim();
    const ingress =
      botUserName !== undefined
        ? normalizeLinearWebhookInput(payload, { botUserName })
        : normalizeLinearWebhookInput(payload);
    if (ingress === null) {
      return Response.json({
        accepted: true,
        ignored: true,
      });
    }

    const result = await ctx.runAction(
      internal.linearOrchestration.handleLinearWebhookIngress,
      ingress,
    );

    return Response.json({
      accepted: true,
      ignored: false,
      ...result,
    });
  }),
});

http.route({
  path: "/t3/execution-events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBridgeAuthorization(request);
    if (!auth.ok) {
      return Response.json({ error: auth.message }, { status: auth.status });
    }

    const payload = decodeExecutionRunLifecycleEvent(await request.json());
    const result = await ctx.runMutation(internal.executionRuns.applyLifecycleEvent, {
      eventId: payload.eventId,
      controlThreadId: payload.controlThreadId,
      executionRunId: payload.executionRunId,
      type: payload.type,
      occurredAt: payload.occurredAt,
      ...(payload.t3ThreadId !== undefined ? { t3ThreadId: String(payload.t3ThreadId) } : {}),
      ...(payload.t3TurnId !== undefined ? { t3TurnId: String(payload.t3TurnId) } : {}),
      ...(payload.failureSummary !== undefined ? { failureSummary: payload.failureSummary } : {}),
    });

    let linearReply:
      | {
          readonly error?: string;
          readonly posted: boolean;
          readonly reason: string;
          readonly replyCommentId?: string;
        }
      | undefined;
    if (payload.type === "completed" || payload.type === "failed") {
      try {
        linearReply = await ctx.runAction(internal.linearOrchestration.postExecutionReplyIfNeeded, {
          executionRunId: payload.executionRunId,
        });
      } catch (replyError) {
        const errorMessage = replyError instanceof Error ? replyError.message : String(replyError);
        await ctx.runMutation(internal.executionRuns.recordLinearReplyError, {
          executionRunId: payload.executionRunId,
          errorMessage,
          updatedAt: Date.now(),
        });
        linearReply = {
          posted: false,
          reason: "reply_post_failed",
          error: errorMessage,
        };
      }
    }

    return Response.json({
      accepted: true,
      ...result,
      ...(linearReply !== undefined ? { linearReply } : {}),
    });
  }),
});

export default http;
