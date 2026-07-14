import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import * as ExpoPushClient from "./ExpoPushClient.ts";

function layerWithResponses(responses: ReadonlyArray<unknown>) {
  let index = 0;
  const httpClient = HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(request, Response.json(responses[index++], { status: 200 })),
    ),
  );
  return ExpoPushClient.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)));
}

describe("ExpoPushClient", () => {
  it.effect("decodes an accepted Expo push ticket", () =>
    Effect.gen(function* () {
      const client = yield* ExpoPushClient.ExpoPushClient;
      const ticket = yield* client.send({
        to: "ExponentPushToken[test]",
        title: "T3 Code",
        body: "Working: Thread",
        data: { deepLink: "/threads/env/thread" },
        channelId: "t3-connect-activity",
        tag: "t3-connect-agent-status",
        collapseId: "t3-connect-agent-status",
        priority: "default",
      });
      expect(ticket).toEqual({
        ok: true,
        id: "ticket-1",
        status: "ok",
        reason: null,
        errorCode: null,
      });
    }).pipe(Effect.provide(layerWithResponses([{ data: { status: "ok", id: "ticket-1" } }]))),
  );

  it.effect("decodes delivery receipts including permanent token failures", () =>
    Effect.gen(function* () {
      const client = yield* ExpoPushClient.ExpoPushClient;
      const receipts = yield* client.getReceipts(["ticket-1", "ticket-2"]);
      expect(receipts).toEqual({
        "ticket-1": { status: "ok", reason: null, errorCode: null },
        "ticket-2": {
          status: "error",
          reason: "The device is no longer registered.",
          errorCode: "DeviceNotRegistered",
        },
      });
    }).pipe(
      Effect.provide(
        layerWithResponses([
          {
            data: {
              "ticket-1": { status: "ok" },
              "ticket-2": {
                status: "error",
                message: "The device is no longer registered.",
                details: { error: "DeviceNotRegistered" },
              },
            },
          },
        ]),
      ),
    ),
  );
});
