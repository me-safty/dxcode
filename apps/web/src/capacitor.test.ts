import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { isCapacitorNativeApp } from "./capacitor";

describe("Capacitor runtime detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects a native Capacitor WebView", () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });

    expect(isCapacitorNativeApp()).toBe(true);
  });

  it("does not classify the browser implementation as native", () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => false });

    expect(isCapacitorNativeApp()).toBe(false);
  });
});
