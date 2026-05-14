import { describe, expect, it } from "vitest";

import { classifyBridgeStatus, defaultHealthCheckConfig } from "./orchestrator-health-check.ts";

describe("orchestrator-health-check", () => {
  it("classifies unauthenticated bridge status codes", () => {
    expect(classifyBridgeStatus(401)).toEqual({
      ok: true,
      details: "bridge route exists and rejected unauthenticated request with 401",
    });
    expect(classifyBridgeStatus(503).details).toContain(
      "missing T3_EXECUTION_BRIDGE_SHARED_SECRET",
    );
    expect(classifyBridgeStatus(404).details).toContain("stale");
  });

  it("resolves defaults with env overrides", () => {
    expect(
      defaultHealthCheckConfig({
        T3CODE_HEALTH_LOCAL_BASE_URL: "http://localhost:4773",
        T3CODE_HEALTH_PUBLIC_BASE_URL: "https://example.com",
        T3CODE_HEALTH_CONVEX_SITE_URL: "https://convex.example",
        T3CODE_HEALTH_TIMEOUT_MS: "1234",
      }).timeoutMs,
    ).toBe(1234);
  });
});
