import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { browserApiCorsHeaders } from "./httpCors.ts";

export class T3workAtlassianError extends Data.TaggedError("T3workAtlassianError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function toAtlassianError(message: string) {
  return (cause: unknown) =>
    new T3workAtlassianError({
      message: cause instanceof Error ? cause.message : message,
      cause,
    });
}

export function readJsonBody<T>() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return (yield* request.json.pipe(
      Effect.mapError(toAtlassianError("Invalid Atlassian request.")),
    )) as T;
  });
}

export function tryAtlassianPromise<T>(thunk: () => Promise<T>, message: string) {
  return Effect.tryPromise({
    try: thunk,
    catch: toAtlassianError(message),
  });
}

export function okJson(body: unknown) {
  return HttpServerResponse.jsonUnsafe(body, { status: 200, headers: browserApiCorsHeaders });
}

export function errorResponse(error: T3workAtlassianError) {
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error.message },
      { status: 502, headers: browserApiCorsHeaders },
    ),
  );
}
