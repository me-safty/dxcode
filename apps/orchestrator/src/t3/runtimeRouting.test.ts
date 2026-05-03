import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { SandboxServiceId } from "@t3tools/contracts";

import { extractT3RuntimeEndpoint, resolveTaskRuntimeBridgeBaseUrl } from "./runtimeRouting.ts";

const decodeServiceId = Schema.decodeUnknownSync(SandboxServiceId);

describe("runtime routing", () => {
  it("prefers typed server endpoints for the t3 runtime service", () => {
    const endpoint = extractT3RuntimeEndpoint([
      {
        serviceId: decodeServiceId("dev-server"),
        kind: "dev-server",
        status: "ready",
        endpointUrl: "https://dev.example.com",
      },
      {
        serviceId: decodeServiceId("t3-runtime"),
        kind: "t3-runtime",
        status: "ready",
        endpointUrl: "https://legacy.example.com",
        endpoints: [
          {
            url: "https://browser.example.com",
            protocol: "https",
            accessMode: "browser",
          },
          {
            url: "https://runtime.example.com",
            protocol: "https",
            accessMode: "server",
          },
        ],
      },
    ]);

    expect(endpoint).toBe("https://runtime.example.com");
  });

  it("falls back to the legacy endpoint URL", () => {
    expect(
      extractT3RuntimeEndpoint([
        {
          serviceId: decodeServiceId("t3-runtime"),
          kind: "t3-runtime",
          status: "ready",
          endpointUrl: "https://legacy.example.com",
        },
      ]),
    ).toBe("https://legacy.example.com");
  });

  it("uses the global bridge only for local or legacy sessions", () => {
    expect(
      resolveTaskRuntimeBridgeBaseUrl({
        providerKind: "local",
        runtimeEndpointUrl: undefined,
      }),
    ).toBeUndefined();
  });

  it("rejects modal sessions without a persisted runtime endpoint", () => {
    expect(() =>
      resolveTaskRuntimeBridgeBaseUrl({
        providerKind: "modal",
        runtimeEndpointUrl: undefined,
      }),
    ).toThrow("Missing runtime endpoint");
  });
});
