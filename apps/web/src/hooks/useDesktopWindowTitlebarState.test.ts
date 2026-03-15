import { assert, describe, it } from "vitest";

import { getDefaultWindowTitlebarState } from "./useDesktopWindowTitlebarState";

describe("getDefaultWindowTitlebarState", () => {
  it("defaults to visible traffic lights for macOS Electron renderers", () => {
    assert.deepStrictEqual(
      getDefaultWindowTitlebarState({ electron: true, platform: "MacIntel" }),
      { trafficLightsVisible: true },
    );
  });

  it("does not reserve traffic-light space outside Electron", () => {
    assert.deepStrictEqual(
      getDefaultWindowTitlebarState({ electron: false, platform: "MacIntel" }),
      { trafficLightsVisible: false },
    );
  });

  it("does not reserve traffic-light space for non-mac platforms", () => {
    assert.deepStrictEqual(getDefaultWindowTitlebarState({ electron: true, platform: "Win32" }), {
      trafficLightsVisible: false,
    });
  });
});
