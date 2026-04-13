import { describe, expect, it } from "vitest";

import { summarizeStaticClientLog } from "./http";

describe("summarizeStaticClientLog", () => {
  it("classifies the app root as a shell request", () => {
    expect(
      summarizeStaticClientLog({
        requestId: "static-1",
        requestPath: "/",
        status: 200,
        source: "spa-fallback",
        startedAt: 100,
        finishedAt: 145,
      }),
    ).toEqual({
      requestId: "static-1",
      requestPath: "/",
      requestType: "shell",
      status: 200,
      source: "spa-fallback",
      durationMs: 45,
    });
  });

  it("classifies bundled assets as asset requests", () => {
    expect(
      summarizeStaticClientLog({
        requestId: "static-2",
        requestPath: "/assets/index-ABC123.js",
        status: 200,
        source: "static-file",
        startedAt: 500,
        finishedAt: 507,
      }),
    ).toEqual({
      requestId: "static-2",
      requestPath: "/assets/index-ABC123.js",
      requestType: "asset",
      status: 200,
      source: "static-file",
      durationMs: 7,
    });
  });

  it("clamps negative durations to zero", () => {
    expect(
      summarizeStaticClientLog({
        requestId: "static-3",
        requestPath: "/settings/general",
        status: 200,
        source: "spa-fallback",
        startedAt: 250,
        finishedAt: 200,
      }),
    ).toEqual({
      requestId: "static-3",
      requestPath: "/settings/general",
      requestType: "shell",
      status: 200,
      source: "spa-fallback",
      durationMs: 0,
    });
  });
});
