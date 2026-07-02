import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const originalAppVariant = process.env.APP_VARIANT;

afterEach(() => {
  if (originalAppVariant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = originalAppVariant;
  }

  vi.resetModules();
});

async function loadConfigForVariant(appVariant: string) {
  process.env.APP_VARIANT = appVariant;
  vi.resetModules();

  const module = await import("./app.config");
  return module.default;
}

describe("mobile app config", () => {
  it("configures development iOS builds with a bundle-scoped Keychain access group", async () => {
    const config = await loadConfigForVariant("development");

    expect(config.ios?.bundleIdentifier).toBe("com.t3tools.t3code.dev");
    expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
      "$(AppIdentifierPrefix)com.t3tools.t3code.dev",
    ]);
  });
});
