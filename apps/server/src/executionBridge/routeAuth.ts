import { HttpServerRequest } from "effect/unstable/http";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ExecutionBridgeAuthError extends Schema.TaggedErrorClass<ExecutionBridgeAuthError>()(
  "ExecutionBridgeAuthError",
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

export const authenticateExecutionBridgeRequest = Effect.gen(function* () {
  const sharedSecret = process.env.T3_EXECUTION_BRIDGE_SHARED_SECRET?.trim();
  if (!sharedSecret) {
    return yield* new ExecutionBridgeAuthError({
      message: "Execution bridge secret is not configured.",
      status: 503,
    });
  }

  const request = yield* HttpServerRequest.HttpServerRequest;
  if (request.headers.authorization !== `Bearer ${sharedSecret}`) {
    return yield* new ExecutionBridgeAuthError({
      message: "Unauthorized execution bridge request.",
      status: 401,
    });
  }
});
