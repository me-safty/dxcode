import { assert, it } from "@effect/vitest";

import { buildCodexAppServerArgs } from "./codexAppServerArgs.ts";

it("uses a portable reasoning effort when starting Codex app-server", () => {
  assert.deepStrictEqual(buildCodexAppServerArgs(), [
    "app-server",
    "--config",
    'model_reasoning_effort="medium"',
  ]);
});

it("preserves extra app-server arguments after the compatibility default", () => {
  assert.deepStrictEqual(
    buildCodexAppServerArgs(["-c", "mcp_servers.t3-code.url=http://127.0.0.1:3774/mcp"]),
    [
      "app-server",
      "--config",
      'model_reasoning_effort="medium"',
      "-c",
      "mcp_servers.t3-code.url=http://127.0.0.1:3774/mcp",
    ],
  );
});

it("keeps an intentional reasoning override after the compatibility default", () => {
  assert.deepStrictEqual(buildCodexAppServerArgs(["-c", 'model_reasoning_effort="high"']), [
    "app-server",
    "--config",
    'model_reasoning_effort="medium"',
    "-c",
    'model_reasoning_effort="high"',
  ]);
});
