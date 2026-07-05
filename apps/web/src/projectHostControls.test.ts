import { describe, expect, it } from "vite-plus/test";

import { deriveProjectHostControlAvailability } from "./projectHostControls";

describe("deriveProjectHostControlAvailability", () => {
  it("enables terminal and project action controls for a connected active project host", () => {
    expect(
      deriveProjectHostControlAvailability({
        hasActiveProject: true,
        environmentConnectionPhase: "connected",
        terminalDrawerOpen: false,
      }),
    ).toEqual({
      terminalControlsAvailable: true,
      terminalDrawerToggleAvailable: true,
      projectActionsRunAvailable: true,
    });
  });

  it("requires both an active project and a connected project host", () => {
    expect(
      deriveProjectHostControlAvailability({
        hasActiveProject: false,
        environmentConnectionPhase: "connected",
        terminalDrawerOpen: false,
      }),
    ).toMatchObject({
      terminalControlsAvailable: false,
      projectActionsRunAvailable: false,
    });

    for (const environmentConnectionPhase of [
      "available",
      "offline",
      "connecting",
      "reconnecting",
      "error",
      null,
    ] as const) {
      expect(
        deriveProjectHostControlAvailability({
          hasActiveProject: true,
          environmentConnectionPhase,
          terminalDrawerOpen: false,
        }),
      ).toMatchObject({
        terminalControlsAvailable: false,
        projectActionsRunAvailable: false,
      });
    }
  });

  it("keeps the terminal drawer toggle available while an existing drawer is open", () => {
    expect(
      deriveProjectHostControlAvailability({
        hasActiveProject: false,
        environmentConnectionPhase: null,
        terminalDrawerOpen: true,
      }).terminalDrawerToggleAvailable,
    ).toBe(true);
  });
});
