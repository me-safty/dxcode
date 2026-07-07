import { describe, expect, it } from "@effect/vitest";

import { projectThreadRoutePresentation } from "./projectThreadRoutePresentation";

describe("projectThreadRoutePresentation", () => {
  it("renders thread content once the shell is selected", () => {
    expect(
      projectThreadRoutePresentation({
        hasSelectedThread: true,
        isLoadingConnections: false,
        connectionState: "connected",
        routeThreadStatus: "empty",
        routeThreadError: null,
      }),
    ).toBe("content");
  });

  it("loads a newly created thread while connected before shell data arrives", () => {
    expect(
      projectThreadRoutePresentation({
        hasSelectedThread: false,
        isLoadingConnections: false,
        connectionState: "connected",
        routeThreadStatus: "empty",
        routeThreadError: null,
      }),
    ).toBe("loading");
  });

  it("loads while the environment reconnects", () => {
    expect(
      projectThreadRoutePresentation({
        hasSelectedThread: false,
        isLoadingConnections: false,
        connectionState: "reconnecting",
        routeThreadStatus: "empty",
        routeThreadError: null,
      }),
    ).toBe("loading");
  });

  it("surfaces deleted threads instead of loading forever", () => {
    expect(
      projectThreadRoutePresentation({
        hasSelectedThread: false,
        isLoadingConnections: false,
        connectionState: "connected",
        routeThreadStatus: "deleted",
        routeThreadError: null,
      }),
    ).toBe("unavailable");
  });

  it("explains unavailable threads while disconnected", () => {
    expect(
      projectThreadRoutePresentation({
        hasSelectedThread: false,
        isLoadingConnections: false,
        connectionState: "offline",
        routeThreadStatus: "empty",
        routeThreadError: null,
      }),
    ).toBe("unavailable");
  });
});
