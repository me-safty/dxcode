import { describe, expect, it } from "vitest";

import { isDevProxyDeniedPath, resolveDevProxyTargetUrl } from "./devProxy.ts";

describe("devProxy", () => {
  it("preserves path and query when resolving the Vite target URL", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("https://machine.ts.net/m?token=test-token");

    expect(resolveDevProxyTargetUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/m?token=test-token",
    );
  });

  it("denies server-owned path prefixes", () => {
    expect(isDevProxyDeniedPath("/api/auth/session")).toBe(true);
    expect(isDevProxyDeniedPath("/.well-known/t3/environment")).toBe(true);
    expect(isDevProxyDeniedPath("/attachments/file-id")).toBe(true);
    expect(isDevProxyDeniedPath("/ws")).toBe(true);
  });

  it("allows SPA and Vite asset paths", () => {
    expect(isDevProxyDeniedPath("/")).toBe(false);
    expect(isDevProxyDeniedPath("/m")).toBe(false);
    expect(isDevProxyDeniedPath("/src/main.tsx")).toBe(false);
    expect(isDevProxyDeniedPath("/@vite/client")).toBe(false);
  });
});
