import { describe, expect, it } from "vite-plus/test";

import {
  DesktopPackagedFlavorIds,
  isDesktopPackagedFlavorId,
  resolveDesktopFlavor,
  resolveDesktopRuntimeFlavor,
} from "./desktopFlavor.ts";

describe("desktopFlavor", () => {
  it("keeps every runtime identity isolated", () => {
    const flavors = [
      resolveDesktopFlavor("production"),
      resolveDesktopFlavor("development"),
      resolveDesktopFlavor("dx"),
    ];

    for (const property of [
      "appId",
      "appUserModelId",
      "userDataDirName",
      "stateDirName",
      "rendererScheme",
      "executableName",
    ] as const) {
      expect(new Set(flavors.map((flavor) => flavor[property])).size).toBe(flavors.length);
    }
  });

  it("keeps production defaults and disables DX updates", () => {
    expect(DesktopPackagedFlavorIds).toEqual(["production", "dx"]);
    expect(resolveDesktopFlavor("production")).toMatchObject({
      appId: "com.t3tools.t3code",
      userDataDirName: "t3code",
      stateDirName: "userdata",
      autoUpdatesEnabled: true,
    });
    expect(resolveDesktopFlavor("dx")).toMatchObject({
      appId: "com.t3tools.dxcode",
      productName: "DX Code",
      userDataDirName: "dxcode",
      stateDirName: "dx",
      autoUpdatesEnabled: false,
    });
  });

  it("forces live development to the development identity", () => {
    expect(resolveDesktopRuntimeFlavor({ isDevelopment: true, packagedFlavorId: "dx" }).id).toBe(
      "development",
    );
    expect(resolveDesktopRuntimeFlavor({ isDevelopment: false, packagedFlavorId: "dx" }).id).toBe(
      "dx",
    );
  });

  it("rejects unknown packaged flavor ids", () => {
    expect(isDesktopPackagedFlavorId("production")).toBe(true);
    expect(isDesktopPackagedFlavorId("dx")).toBe(true);
    expect(isDesktopPackagedFlavorId("nightly")).toBe(false);
  });
});
