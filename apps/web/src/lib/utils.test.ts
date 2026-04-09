import { afterEach, beforeEach, describe, assert, it, vi } from "vitest";
import {
  __resetPrimaryEnvironmentBootstrapForTests,
  resolvePrimaryEnvironmentHttpUrl,
} from "../environments/primary/bootstrap";
import { isWindowsPlatform } from "./utils";

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

const originalWindow = globalThis.window;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://localhost:5735",
        hostname: "localhost",
        port: "5735",
        protocol: "http:",
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetPrimaryEnvironmentBootstrapForTests();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("resolvePrimaryEnvironmentHttpUrl", () => {
  it("uses the configured explicit primary HTTP base URL", () => {
    vi.stubEnv("VITE_HTTP_URL", "http://127.0.0.1:3775");
    vi.stubEnv("VITE_WS_URL", "ws://127.0.0.1:3775");

    assert.equal(
      resolvePrimaryEnvironmentHttpUrl("/api/observability/v1/traces"),
      "http://127.0.0.1:3775/api/observability/v1/traces",
    );
  });
  it("falls back to the current window origin when there is no explicit primary target", () => {
    assert.equal(
      resolvePrimaryEnvironmentHttpUrl("/api/observability/v1/traces"),
      "http://localhost:5735/api/observability/v1/traces",
    );
  });
});
