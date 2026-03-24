import { describe, expect, it } from "vitest";

import type { ServerConfigShape } from "./config";
import { isProtectedWebAuthEnabled } from "./webAuth";

const makeConfig = (overrides: Partial<ServerConfigShape> = {}): ServerConfigShape => ({
  mode: "web",
  port: 3773,
  cwd: "/tmp/t3-test-workspace",
  host: undefined,
  baseDir: "/tmp/t3-test-home",
  stateDir: "/tmp/t3-test-home/userdata",
  dbPath: "/tmp/t3-test-home/userdata/state.sqlite",
  logsDir: "/tmp/t3-test-home/logs",
  serverLogPath: "/tmp/t3-test-home/logs/server.log",
  providerLogsDir: "/tmp/t3-test-home/logs/provider",
  providerEventLogPath: "/tmp/t3-test-home/logs/provider/events.log",
  terminalLogsDir: "/tmp/t3-test-home/logs/terminals",
  attachmentsDir: "/tmp/t3-test-home/attachments",
  keybindingsConfigPath: "/tmp/t3-test-home/keybindings.json",
  worktreesDir: "/tmp/t3-test-home/worktrees",
  anonymousIdPath: "/tmp/t3-test-home/userdata/anonymous-id",
  staticDir: undefined,
  devUrl: undefined,
  noBrowser: true,
  authToken: "auth-secret",
  autoBootstrapProjectFromCwd: true,
  logWebSocketEvents: false,
  ...overrides,
});

describe("isProtectedWebAuthEnabled", () => {
  it("returns true for built web mode with an auth token", () => {
    expect(isProtectedWebAuthEnabled(makeConfig())).toBe(true);
  });

  it("returns false when a dev server url is present", () => {
    expect(
      isProtectedWebAuthEnabled(
        makeConfig({
          devUrl: new URL("http://localhost:5173"),
        }),
      ),
    ).toBe(false);
  });

  it("returns false without an auth token", () => {
    expect(
      isProtectedWebAuthEnabled(
        makeConfig({
          authToken: undefined,
        }),
      ),
    ).toBe(false);
  });

  it("returns false outside web mode", () => {
    expect(
      isProtectedWebAuthEnabled(
        makeConfig({
          mode: "desktop",
        }),
      ),
    ).toBe(false);
  });
});
