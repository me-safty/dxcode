import { describe, expect, it } from "vitest";

import { isLoopbackHostname, resolveDevRedirectUrl } from "./http.ts";
import { isDevProxyDeniedPath } from "./http/devProxy.ts";

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

  it("does not treat Tailscale hostnames as loopback", () => {
    expect(isLoopbackHostname("machine.tail98085b.ts.net")).toBe(false);
  });

  it("does not proxy denied paths", () => {
    expect(isDevProxyDeniedPath("/api/orchestration/snapshot")).toBe(true);
  });
});
