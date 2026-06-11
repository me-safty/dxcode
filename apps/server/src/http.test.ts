import { describe, expect, it } from "vitest";

import { cacheControlForStaticPath, isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("does not treat LAN addresses as local", () => {
    expect(isLoopbackHostname("192.168.86.35")).toBe(false);
    expect(isLoopbackHostname("10.0.0.24")).toBe(false);
    expect(isLoopbackHostname("example.local")).toBe(false);
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("static cache control", () => {
  it("marks hashed asset build outputs as immutable", () => {
    expect(cacheControlForStaticPath("assets/index-abc123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("requires revalidation for unhashed static outputs", () => {
    expect(cacheControlForStaticPath("index.html")).toBe("no-cache");
    expect(cacheControlForStaticPath("t3-service-worker.js")).toBe("no-cache");
    expect(cacheControlForStaticPath("t3-push-service-worker.js")).toBe("no-cache");
    expect(cacheControlForStaticPath("manifest.webmanifest")).toBe("no-cache");
  });

  it("does not treat assetsy as the assets directory", () => {
    expect(cacheControlForStaticPath("assetsy/file.js")).toBe("no-cache");
  });
});
