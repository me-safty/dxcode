import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "T3 Code",
            stageLabel: "Nightly",
            displayName: "T3 Olumbe",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("T3 Code");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Olumbe");
  });

  it("derives the app name from VITE_APP_NAME", async () => {
    vi.stubEnv("VITE_APP_NAME", "Olumbe");

    const branding = await import("./branding");

    expect(branding.APP_NAME).toBe("Olumbe");
    expect(branding.APP_BASE_NAME).toBe("T3 Olumbe");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Olumbe");
  });

  it("defaults the app name to Code when VITE_APP_NAME is blank", async () => {
    vi.stubEnv("VITE_APP_NAME", "");

    const branding = await import("./branding");

    expect(branding.APP_NAME).toBe("Code");
    expect(branding.APP_BASE_NAME).toBe("T3 Code");
    expect(branding.APP_DISPLAY_NAME).toBe("T3 Code");
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nightly");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });
});
