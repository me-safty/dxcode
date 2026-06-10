import { describe, expect, it } from "vitest";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  PUBLISH_ICON_OVERRIDES,
  resolveWebAssetBrandForConfiguredChannel,
  resolveWebAssetBrandForChannel,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

describe("brand-assets", () => {
  it("maps server publish web assets to production icons", () => {
    expect(PUBLISH_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.salchiWebLogoPng,
        targetRelativePath: "dist/client/salchi-logo.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.salchiIconPng,
        targetRelativePath: "dist/client/salchi-pwa-192.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.salchiIconPng,
        targetRelativePath: "dist/client/salchi-pwa-512.png",
      },
    ]);
  });

  it("maps server build web assets to development icons", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.salchiWebLogoPng,
      targetRelativePath: "dist/client/salchi-logo.png",
    });
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.salchiWebLogoPng,
      targetRelativePath: "apps/web/dist/salchi-logo.png",
    });
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.salchiIconPng,
      targetRelativePath: "apps/web/dist/salchi-pwa-512.png",
    });
  });

  it("maps hosted nightly web assets to nightly icons", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.salchiIconPng,
      targetRelativePath: "apps/web/dist/salchi-pwa-192.png",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("defaults configured web asset channels to production", () => {
    expect(resolveWebAssetBrandForConfiguredChannel(undefined)).toBe("production");
    expect(resolveWebAssetBrandForConfiguredChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForConfiguredChannel("preview")).toBe("production");
    expect(resolveWebAssetBrandForConfiguredChannel(" nightly ")).toBe("nightly");
  });
});
