import type {
  PluginHttpDescriptor,
  PluginHttpRequest,
  PluginHttpResponse,
} from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";

import type { BoardId, TicketId } from "../../contracts/workflow.ts";
import { WorkflowEventStoreErrorCode } from "./Services/Errors.ts";
import { WorkflowEngine } from "./Services/WorkflowEngine.ts";
import { WorkflowReadModel } from "./Services/WorkflowReadModel.ts";
import { WorkflowWebhook } from "./Services/WorkflowWebhook.ts";
import { sanitizeExternalEventPayload } from "./externalEvent.ts";

export const WORKFLOW_WEBHOOK_LOCAL_PATH = "/webhook/:boardId";
export const WORKFLOW_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

const MAX_NAME_LENGTH = 100;
const MAX_DELIVERY_ID_LENGTH = 128;
const MAX_CORRELATION_LENGTH = 200;

const textDecoder = new TextDecoder();

export const workflowWebhookPath = (basePath: string, boardId: BoardId | string): string => {
  const normalizedBasePath = basePath.replace(/\/+$/u, "");
  return `${normalizedBasePath}/webhook/${encodeURIComponent(String(boardId))}`;
};

const notFound: PluginHttpResponse = { status: 404, body: "Not Found" };

const serviceUnavailable = (detail: string): PluginHttpResponse => ({
  status: 503,
  body: detail,
});

const unprocessable = (detail: string): PluginHttpResponse => ({
  status: 422,
  body: { error: detail },
});

interface ParsedHookBody {
  readonly name: string;
  readonly ticketId: TicketId;
  readonly payload: unknown;
  readonly deliveryId: string | undefined;
}

const parseHookBody = (body: Uint8Array): ParsedHookBody | string => {
  if (body.byteLength === 0 || body.byteLength > WORKFLOW_WEBHOOK_MAX_BODY_BYTES) {
    return "body must be 1 byte to 64 KiB of JSON";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(body));
  } catch {
    return "body must be JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "body must be a JSON object";
  }

  const raw = parsed as Record<string, unknown>;
  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  if (name === "" || name.length > MAX_NAME_LENGTH) {
    return "name is required (1-100 chars)";
  }

  const ticketId = typeof raw["ticketId"] === "string" ? raw["ticketId"].trim() : "";
  const branch = typeof raw["branch"] === "string" ? raw["branch"].trim() : "";
  if ((ticketId === "") === (branch === "")) {
    return "exactly one of ticketId or branch is required";
  }
  if (ticketId.length > MAX_CORRELATION_LENGTH || branch.length > MAX_CORRELATION_LENGTH) {
    return "correlation value too long";
  }

  let correlatedTicketId = ticketId;
  if (branch !== "") {
    const match = /^workflow\/(.+)$/u.exec(branch);
    if (match === null || match[1] === undefined) {
      return 'branch must look like "workflow/<ticketId>"';
    }
    correlatedTicketId = match[1];
  }

  const rawDeliveryId = raw["deliveryId"];
  if (rawDeliveryId !== undefined) {
    if (typeof rawDeliveryId !== "string" || rawDeliveryId.length > MAX_DELIVERY_ID_LENGTH) {
      return "deliveryId must be a string (max 128 chars)";
    }
  }

  return {
    name,
    ticketId: correlatedTicketId as TicketId,
    payload: sanitizeExternalEventPayload(raw["payload"] ?? null),
    deliveryId: typeof rawDeliveryId === "string" ? rawDeliveryId : undefined,
  };
};

export type WorkflowWebhookRouteContext = WorkflowWebhook | WorkflowEngine | WorkflowReadModel;

export const handleWorkflowWebhookRequest = (
  request: PluginHttpRequest,
): Effect.Effect<PluginHttpResponse, never, WorkflowWebhookRouteContext> =>
  Effect.gen(function* () {
    const boardId = request.params["boardId"] ?? "";
    if (boardId === "" || boardId.length > MAX_CORRELATION_LENGTH) {
      return notFound;
    }

    const headerToken = request.headers["x-t3-webhook-token"];
    const token = typeof headerToken === "string" ? headerToken : "";
    if (token === "") {
      return notFound;
    }

    // Verify the token FIRST, before parsing the body or reading the board, so
    // an unauthenticated request does the least (and uniform) work regardless of
    // whether the board exists — mirrors the fork's ordering. verifyToken keys on
    // the webhook row, so "board absent", "no webhook configured", and "wrong
    // token" are indistinguishable (all 404), with no board-existence timing or
    // 503-stage side channel. All 503 bodies are identical for the same reason.
    const webhook = yield* WorkflowWebhook;
    const verified = yield* webhook.verifyToken(boardId as BoardId, token).pipe(Effect.result);
    if (verified._tag === "Failure") {
      return serviceUnavailable("temporarily unavailable");
    }
    if (!verified.success) {
      return notFound;
    }

    const parsed = parseHookBody(request.body);
    if (typeof parsed === "string") {
      return notFound;
    }

    const readModel = yield* WorkflowReadModel;
    const boardResult = yield* readModel.getBoard(boardId as BoardId).pipe(Effect.result);
    if (boardResult._tag === "Failure") {
      return serviceUnavailable("temporarily unavailable");
    }
    if (boardResult.success === null) {
      return notFound;
    }

    if (parsed.deliveryId !== undefined) {
      const recorded = yield* webhook
        .recordDelivery(boardId as BoardId, parsed.deliveryId)
        .pipe(Effect.result);
      if (recorded._tag === "Failure") {
        return serviceUnavailable("temporarily unavailable");
      }
      if (recorded.success) {
        return { status: 202, body: { outcome: "duplicate" } };
      }
    }

    const engine = yield* WorkflowEngine;
    const result = yield* engine
      .ingestExternalEvent({
        boardId: boardId as BoardId,
        name: parsed.name,
        ticketId: parsed.ticketId,
        payload: parsed.payload,
      })
      .pipe(Effect.result);

    if (result._tag === "Failure") {
      if (result.failure.code === WorkflowEventStoreErrorCode.ticketNotOnBoard) {
        return unprocessable("ticket not found on this board");
      }

      if (parsed.deliveryId !== undefined) {
        yield* webhook
          .releaseDelivery(boardId as BoardId, parsed.deliveryId)
          .pipe(Effect.orElseSucceed(() => undefined));
      }
      return serviceUnavailable("temporarily unavailable");
    }

    return {
      status: 202,
      body: {
        outcome: result.success.outcome,
        ...(result.success.toLane === undefined ? {} : { toLane: result.success.toLane }),
      },
    };
  });

export const makeWorkflowWebhookHttpDescriptor = (
  runWithRuntime: <A>(
    effect: Effect.Effect<A, Error, WorkflowWebhookRouteContext>,
  ) => Effect.Effect<A, Error>,
): PluginHttpDescriptor => ({
  method: "POST",
  path: WORKFLOW_WEBHOOK_LOCAL_PATH,
  auth: "public",
  maxBodyBytes: WORKFLOW_WEBHOOK_MAX_BODY_BYTES,
  handler: (request) => runWithRuntime(handleWorkflowWebhookRequest(request)),
});
