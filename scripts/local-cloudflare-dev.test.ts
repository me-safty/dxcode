import { assert, describe, it } from "@effect/vitest";

import {
  buildServerArgs,
  parseEnvFileContents,
  resolveCloudflaredCommand,
} from "./local-cloudflare-dev.ts";

describe("local-cloudflare-dev", () => {
  it("runs the dev server on the requested local bridge port", () => {
    assert.deepStrictEqual(buildServerArgs({ port: 3773, host: "127.0.0.1" }), [
      "scripts/dev-runner.ts",
      "dev:server",
      "--port",
      "3773",
      "--host",
      "127.0.0.1",
      "--no-browser",
    ]);
  });

  it("uses the configured cloudflared path when provided", () => {
    assert.equal(
      resolveCloudflaredCommand({ T3CODE_CLOUDFLARED_PATH: "C:\\tools\\cloudflared.exe" }, "linux"),
      "C:\\tools\\cloudflared.exe",
    );
  });

  it("defaults to the installed Windows cloudflared path on Windows", () => {
    assert.equal(
      resolveCloudflaredCommand({}, "win32"),
      "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    );
  });

  it("parses local env files like the scheduled server script", () => {
    assert.deepStrictEqual(
      parseEnvFileContents(`
# ignored
T3_EXECUTION_BRIDGE_SHARED_SECRET=secret=value
ORCHESTRATOR_BASE_URL=https://example.test
bad-line
`),
      [
        ["T3_EXECUTION_BRIDGE_SHARED_SECRET", "secret=value"],
        ["ORCHESTRATOR_BASE_URL", "https://example.test"],
      ],
    );
  });
});
