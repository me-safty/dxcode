import { httpRouter } from "convex/server";
import { Schema } from "effect";

import { normalizeLinearWebhookInput } from "../src/linear/ingress.ts";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ExecutionRunLifecycleEvent } from "@t3tools/contracts";

const http = httpRouter();
const decodeExecutionRunLifecycleEvent = Schema.decodeUnknownSync(ExecutionRunLifecycleEvent);

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

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => new Response("ok", { status: 200 })),
});

http.route({
  path: "/linear/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();
    const ingress = normalizeLinearWebhookInput(payload);
    const result = await ctx.runMutation(internal.controlThreads.upsertFromLinearIngress, ingress);

    return Response.json({
      accepted: true,
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

    return Response.json({
      accepted: true,
      ...result,
    });
  }),
});

export default http;
