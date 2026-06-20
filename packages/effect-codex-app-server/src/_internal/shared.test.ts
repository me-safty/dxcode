import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as CodexError from "../errors.ts";
import * as Shared from "./shared.ts";

it.effect("preserves schema decode diagnostics without deriving the message from the cause", () =>
  Effect.gen(function* () {
    const error = yield* Shared.decodeOptionalPayload("thread/start", Schema.String, 42).pipe(
      Effect.flip,
    );

    assert.instanceOf(error, CodexError.CodexAppServerRequestError);
    assert.equal(error.code, -32602);
    assert.equal(error.method, "thread/start");
    assert.equal(error.operation, "decode-payload");
    assert.equal(
      error.message,
      "Invalid payload for method 'thread/start' during 'decode-payload'",
    );
    assert.isTrue(Schema.isSchemaError(error.cause));

    const protocolError = error.toProtocolError();
    assert.equal(protocolError.code, -32602);
    assert.equal(protocolError.message, error.message);
    assert.property(protocolError, "data");
    assert.notProperty(protocolError, "method");
    assert.notProperty(protocolError, "operation");
    assert.notProperty(protocolError, "cause");
  }),
);

it.effect("preserves schema encode diagnostics", () =>
  Effect.gen(function* () {
    const error = yield* Shared.encodeOptionalPayload(
      "thread/start",
      Schema.Number,
      "not-a-number" as never,
    ).pipe(Effect.flip);

    assert.equal(error.method, "thread/start");
    assert.equal(error.operation, "encode-payload");
    assert.equal(
      error.message,
      "Invalid payload for method 'thread/start' during 'encode-payload'",
    );
    assert.isTrue(Schema.isSchemaError(error.cause));
  }),
);

it.effect("does not invent a cause when a method has no payload schema", () =>
  Effect.gen(function* () {
    const error = yield* Shared.decodeOptionalPayload<never, never>(
      "initialized",
      undefined,
      "unexpected",
    ).pipe(Effect.flip);

    assert.equal(error.method, "initialized");
    assert.equal(error.operation, "decode-payload");
    assert.isUndefined(error.cause);
  }),
);

it.effect("retains the request-handler error as the internal error cause", () =>
  Effect.gen(function* () {
    const rootCause = new Error("socket closed");
    const source = new CodexError.CodexAppServerTransportError({
      detail: "Codex App Server transport failed",
      cause: rootCause,
    });
    const error = yield* Shared.runHandler(
      (_payload: void) => Effect.fail(source),
      undefined,
      "thread/start",
    ).pipe(Effect.flip);

    assert.equal(error.code, -32603);
    assert.equal(error.method, "thread/start");
    assert.equal(error.operation, "handle-request");
    assert.equal(
      error.message,
      "Codex App Server request handler failed for method 'thread/start'",
    );
    assert.strictEqual(error.cause, source);
    assert.strictEqual(source.cause, rootCause);
    assert.notInclude(error.message, source.message);
  }),
);

it.effect("passes request errors through without adding a wrapper", () =>
  Effect.gen(function* () {
    const source = CodexError.CodexAppServerRequestError.invalidParams("Invalid thread id");
    const error = yield* Shared.runHandler(
      (_payload: void) => Effect.fail(source),
      undefined,
      "thread/start",
    ).pipe(Effect.flip);

    assert.strictEqual(error, source);
  }),
);

it.effect("retains the full notification payload decode cause chain", () =>
  Effect.gen(function* () {
    const error = yield* Shared.decodeNotificationPayload(
      "item/agentMessage/delta",
      Schema.String,
      42,
    ).pipe(Effect.flip);

    assert.equal(error.method, "item/agentMessage/delta");
    assert.equal(error.operation, "decode-notification-payload");
    assert.equal(error.detail, "Invalid notification payload");
    assert.instanceOf(error.cause, CodexError.CodexAppServerRequestError);
    assert.isTrue(Schema.isSchemaError(error.cause.cause));
  }),
);
