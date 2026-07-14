import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { APP_VARIANT_CONFIG, resolveAppVariant } from "./app-variants";

function pngDimensions(path: string): { readonly width: number; readonly height: number } {
  const file = NodeFS.readFileSync(NodeURL.fileURLToPath(new URL(path, import.meta.url)));
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  };
}

describe("mobile app variants", () => {
  it("defaults unknown or missing variants to production", () => {
    expect(resolveAppVariant(undefined)).toBe("production");
    expect(resolveAppVariant("unknown")).toBe("production");
    expect(resolveAppVariant("development")).toBe("development");
    expect(resolveAppVariant("preview")).toBe("preview");
    expect(resolveAppVariant("production")).toBe("production");
  });

  it("keeps blueprint branding exclusive to development builds", () => {
    expect(APP_VARIANT_CONFIG.development.assets).toMatchObject({
      appIcon: "./assets/splash-icon-dev.png",
      androidAdaptiveForeground: "./assets/android-icon-dev-foreground.png",
    });
    expect(APP_VARIANT_CONFIG.preview.assets).toBe(APP_VARIANT_CONFIG.production.assets);
    expect(APP_VARIANT_CONFIG.production.assets).toMatchObject({
      appIcon: "./assets/splash-icon-prod.png",
      androidAdaptiveForeground: "./assets/android-icon-mark.png",
      androidAdaptiveBackgroundColor: "#000000",
    });
  });

  it("references assets that exist for every build variant", () => {
    for (const variant of Object.values(APP_VARIANT_CONFIG)) {
      for (const [name, path] of Object.entries(variant.assets)) {
        if (!name.endsWith("Color")) {
          expect(
            NodeFS.existsSync(NodeURL.fileURLToPath(new URL(path, import.meta.url))),
            path,
          ).toBe(true);
        }
      }
    }
  });

  it.each([
    ["./assets/splash-icon-dev.png", 1024, 1024],
    ["./assets/splash-icon-prod.png", 1024, 1024],
    ["./assets/android-icon-dev-foreground.png", 432, 432],
    ["./assets/android-icon-mark.png", 432, 432],
    ["./assets/android-notification-icon.png", 96, 96],
    ["./store-assets/google-play-icon.png", 512, 512],
    ["./store-assets/google-play-feature-graphic.png", 1024, 500],
  ] as const)("keeps %s at its required %ix%i dimensions", (path, width, height) => {
    expect(pngDimensions(path)).toEqual({ width, height });
  });
});
