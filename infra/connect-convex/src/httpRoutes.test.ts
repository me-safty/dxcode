import { describe, expect, it } from "vite-plus/test";

import {
  CONNECT_ENVIRONMENT_LINK_CHALLENGES_ROUTE,
  CONNECT_ENVIRONMENT_LINKS_ROUTE,
  CONNECT_HEALTH_ROUTE,
  connectEnvironmentRoute,
  connectEnvironmentStatusRoute,
  publishAgentActivityRoute,
} from "./httpRoutes.ts";

describe("Convex Connect route constants", () => {
  it("preserves the existing relay-compatible base paths", () => {
    expect(CONNECT_HEALTH_ROUTE).toBe("/health");
    expect(CONNECT_ENVIRONMENT_LINKS_ROUTE).toBe("/v1/client/environment-links");
    expect(CONNECT_ENVIRONMENT_LINK_CHALLENGES_ROUTE).toBe(
      "/v1/client/environment-link-challenges",
    );
  });

  it("formats environment-scoped relay-compatible paths", () => {
    expect(connectEnvironmentStatusRoute("env_123")).toBe("/v1/environments/env_123/status");
    expect(connectEnvironmentRoute("env_123")).toBe("/v1/environments/env_123/connect");
    expect(publishAgentActivityRoute("env_123", "thread_456")).toBe(
      "/v1/environments/env_123/threads/thread_456/agent-activity",
    );
  });
});
