import { Schema } from "effect";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

export class ExecutionBridgeAuthError extends Schema.TaggedErrorClass<ExecutionBridgeAuthError>()(
  "ExecutionBridgeAuthError",
  {
    message: Schema.String,
    status: Schema.Number,
  },
) {}

function readExecutionBridgeSecret() {
  return process.env.T3_EXECUTION_BRIDGE_SHARED_SECRET?.trim();
}

export const authenticateExecutionBridgeRequest = Effect.gen(function* () {
  const secret = readExecutionBridgeSecret();
  if (!secret) {
    return yield* new ExecutionBridgeAuthError({
      message: "Execution bridge secret is not configured.",
      status: 503,
    });
  }

  const request = yield* HttpServerRequest.HttpServerRequest;
  const authorization = request.headers["authorization"];
  if (authorization !== `Bearer ${secret}`) {
    return yield* new ExecutionBridgeAuthError({
      message: "Unauthorized execution bridge request.",
      status: 401,
    });
  }
});
