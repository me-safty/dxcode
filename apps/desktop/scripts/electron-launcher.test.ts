import { describe, expect, it } from "vitest";

import { resolveElectronLaunchStrategy } from "./electron-launcher.mjs";

describe("resolveElectronLaunchStrategy", () => {
  it("uses the original Electron bundle on macOS local starts by default", () => {
    expect(
      resolveElectronLaunchStrategy({
        platform: "darwin",
        isDevelopment: false,
        useMacWrapper: false,
      }),
    ).toBe("original");
  });

  it("allows opting into the wrapped macOS bundle", () => {
    expect(
      resolveElectronLaunchStrategy({
        platform: "darwin",
        isDevelopment: false,
        useMacWrapper: true,
      }),
    ).toBe("wrapped");
  });

  it("keeps development launches on the original Electron bundle", () => {
    expect(
      resolveElectronLaunchStrategy({
        platform: "darwin",
        isDevelopment: true,
        useMacWrapper: true,
      }),
    ).toBe("original");
  });

  it("keeps non-macOS launches on the original Electron bundle", () => {
    expect(
      resolveElectronLaunchStrategy({
        platform: "linux",
        isDevelopment: false,
        useMacWrapper: true,
      }),
    ).toBe("original");
  });
});
