import { vi } from "@effect/vitest";
import type { HttpClientCapability, HttpClientRequestInput } from "@t3tools/plugin-sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { WorkSourceProviderName } from "../../../contracts/workSource.ts";
import { WorkSourceConnectionStore } from "../Services/WorkSourceConnectionStore.ts";
import { WorkflowHttpClientCapability } from "../Services/WorkflowCapabilities.ts";

export interface CannedHttpResponse {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

const encoder = new TextEncoder();

const normalizeHeaders = (
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
};

const encodeBody = (body: unknown): Uint8Array => {
  if (body instanceof Uint8Array) return body;
  return encoder.encode(typeof body === "string" ? body : JSON.stringify(body ?? {}));
};

export const makeHttpClientLayer = (responses: ReadonlyArray<CannedHttpResponse>) => {
  const remaining = [...responses];
  const request = vi.fn((_input: HttpClientRequestInput) => {
    const next = remaining.shift() ?? { status: 500, body: { message: "unexpected request" } };
    return Effect.succeed({
      status: next.status ?? 200,
      headers: normalizeHeaders(next.headers),
      body: encodeBody(next.body),
    });
  });

  const service: HttpClientCapability = {
    request,
    requestJson: () => Effect.die("requestJson is not used by work-source providers"),
    getJson: () => Effect.die("getJson is not used by work-source providers"),
  };

  return {
    request,
    layer: Layer.succeed(WorkflowHttpClientCapability, service),
  };
};

export const makeConnectionStoreLayer = (
  input: {
    readonly token?: string;
    readonly authMode?: "pat" | "basic" | "bearer";
    readonly baseUrl?: string | null;
    readonly email?: string | null;
    readonly expectedProvider?: WorkSourceProviderName;
  } = {},
) => {
  const token = input.token ?? "test-token";
  const service: WorkSourceConnectionStore["Service"] = {
    getToken: (_connectionRef, expectedProvider) => {
      if (input.expectedProvider !== undefined && expectedProvider !== input.expectedProvider) {
        return Effect.die(`unexpected provider ${expectedProvider}`);
      }
      return Effect.succeed(token);
    },
    getConnectionAuth: (_connectionRef, expectedProvider) => {
      if (input.expectedProvider !== undefined && expectedProvider !== input.expectedProvider) {
        return Effect.die(`unexpected provider ${expectedProvider}`);
      }
      return Effect.succeed({
        token,
        authMode: input.authMode ?? "pat",
        baseUrl: input.baseUrl ?? null,
        email: input.email ?? null,
      });
    },
    create: () => Effect.die("create is not used by work-source provider tests"),
    list: () => Effect.die("list is not used by work-source provider tests"),
    remove: () => Effect.die("remove is not used by work-source provider tests"),
  };
  return Layer.succeed(WorkSourceConnectionStore, service);
};
