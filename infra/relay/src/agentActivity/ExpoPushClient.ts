import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

export interface ExpoPushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
  readonly channelId: string;
  readonly tag: string;
  readonly collapseId: string;
  readonly priority: "default" | "high";
  readonly sound?: "default";
}

export interface ExpoPushTicket {
  readonly ok: boolean;
  readonly id: string | null;
  readonly status: string;
  readonly reason: string | null;
  readonly errorCode: string | null;
}

export interface ExpoPushReceipt {
  readonly status: string;
  readonly reason: string | null;
  readonly errorCode: string | null;
}

export class ExpoPushRequestError extends Schema.TaggedErrorClass<ExpoPushRequestError>()(
  "ExpoPushRequestError",
  {
    stage: Schema.Literals([
      "send",
      "read-response",
      "decode-response",
      "send-receipts",
      "read-receipts",
      "decode-receipts",
    ]),
    status: Schema.NullOr(Schema.Number),
    tokenSuffix: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Expo push request failed during ${this.stage}.`;
  }
}

const isExpoPushRequestError = Schema.is(ExpoPushRequestError);

function decodeReceipts(body: string, status: number): Readonly<Record<string, ExpoPushReceipt>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new ExpoPushRequestError({
      stage: "decode-receipts",
      status,
      tokenSuffix: "",
      cause,
    });
  }
  const data =
    typeof parsed === "object" && parsed !== null && "data" in parsed
      ? (parsed as { readonly data?: unknown }).data
      : null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ExpoPushRequestError({
      stage: "decode-receipts",
      status,
      tokenSuffix: "",
      cause: parsed,
    });
  }
  const receipts: Record<string, ExpoPushReceipt> = {};
  for (const [id, raw] of Object.entries(data)) {
    if (typeof raw !== "object" || raw === null) continue;
    const value = raw as {
      readonly status?: unknown;
      readonly message?: unknown;
      readonly details?: { readonly error?: unknown };
    };
    if (typeof value.status !== "string") continue;
    receipts[id] = {
      status: value.status,
      reason: typeof value.message === "string" ? value.message : null,
      errorCode: typeof value.details?.error === "string" ? value.details.error : null,
    };
  }
  return receipts;
}

function decodeTicket(body: string, status: number, token: string): ExpoPushTicket {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new ExpoPushRequestError({
      stage: "decode-response",
      status,
      tokenSuffix: token.slice(-8),
      cause,
    });
  }
  const envelope =
    typeof parsed === "object" && parsed !== null && "data" in parsed
      ? (parsed as { readonly data?: unknown }).data
      : null;
  const ticket = Array.isArray(envelope) ? envelope[0] : envelope;
  if (typeof ticket !== "object" || ticket === null || !("status" in ticket)) {
    throw new ExpoPushRequestError({
      stage: "decode-response",
      status,
      tokenSuffix: token.slice(-8),
      cause: parsed,
    });
  }
  const value = ticket as {
    readonly status?: unknown;
    readonly id?: unknown;
    readonly message?: unknown;
    readonly details?: { readonly error?: unknown };
  };
  const ticketStatus = typeof value.status === "string" ? value.status : "error";
  return {
    ok: status >= 200 && status < 300 && ticketStatus === "ok",
    id: typeof value.id === "string" ? value.id : null,
    status: ticketStatus,
    reason: typeof value.message === "string" ? value.message : null,
    errorCode: typeof value.details?.error === "string" ? value.details.error : null,
  };
}

export class ExpoPushClient extends Context.Service<
  ExpoPushClient,
  {
    readonly send: (
      message: ExpoPushMessage,
    ) => Effect.Effect<ExpoPushTicket, ExpoPushRequestError>;
    readonly getReceipts: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<Readonly<Record<string, ExpoPushReceipt>>, ExpoPushRequestError>;
  }
>()("t3code-relay/agentActivity/ExpoPushClient") {}

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  const send: ExpoPushClient["Service"]["send"] = Effect.fn("relay.expo_push.send")(
    function* (message) {
      const response = yield* HttpClientRequest.post(EXPO_PUSH_SEND_URL).pipe(
        HttpClientRequest.setHeaders({
          accept: "application/json",
          "content-type": "application/json",
        }),
        HttpClientRequest.bodyJson(message),
        Effect.flatMap(httpClient.execute),
        Effect.mapError(
          (cause) =>
            new ExpoPushRequestError({
              stage: "send",
              status: null,
              tokenSuffix: message.to.slice(-8),
              cause,
            }),
        ),
      );
      const body = yield* response.text.pipe(
        Effect.mapError(
          (cause) =>
            new ExpoPushRequestError({
              stage: "read-response",
              status: response.status,
              tokenSuffix: message.to.slice(-8),
              cause,
            }),
        ),
      );
      return yield* Effect.try({
        try: () => decodeTicket(body, response.status, message.to),
        catch: (cause) =>
          isExpoPushRequestError(cause)
            ? cause
            : new ExpoPushRequestError({
                stage: "decode-response",
                status: response.status,
                tokenSuffix: message.to.slice(-8),
                cause,
              }),
      });
    },
  );

  const getReceipts: ExpoPushClient["Service"]["getReceipts"] = Effect.fn(
    "relay.expo_push.get_receipts",
  )(function* (ids) {
    if (ids.length === 0) return {};
    const response = yield* HttpClientRequest.post(EXPO_PUSH_RECEIPTS_URL).pipe(
      HttpClientRequest.setHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }),
      HttpClientRequest.bodyJson({ ids }),
      Effect.flatMap(httpClient.execute),
      Effect.mapError(
        (cause) =>
          new ExpoPushRequestError({
            stage: "send-receipts",
            status: null,
            tokenSuffix: "",
            cause,
          }),
      ),
    );
    const body = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new ExpoPushRequestError({
            stage: "read-receipts",
            status: response.status,
            tokenSuffix: "",
            cause,
          }),
      ),
    );
    return yield* Effect.try({
      try: () => decodeReceipts(body, response.status),
      catch: (cause) =>
        isExpoPushRequestError(cause)
          ? cause
          : new ExpoPushRequestError({
              stage: "decode-receipts",
              status: response.status,
              tokenSuffix: "",
              cause,
            }),
    });
  });

  return ExpoPushClient.of({ send, getReceipts });
});

export const layer = Layer.effect(ExpoPushClient, make);
