import { describe, expect, it } from "vitest";

import {
  hostMcpServersToOpenCodeConfigContent,
  hostMcpServersToStdioServers,
} from "./hostMcpServers.ts";

describe("host MCP server adapters", () => {
  it("converts VS Code host MCP sockets to stdio relay server configs", () => {
    const [server] = hostMcpServersToStdioServers([
      {
        name: "t3code-vscode-test",
        socketPath: "/tmp/t3code-vscode-test/mcp.sock",
        toolTimeoutSec: 120,
      },
    ]);

    expect(server).toMatchObject({
      name: "t3code-vscode-test",
      command: process.execPath,
      args: [process.argv[1], "stdio-to-uds", "/tmp/t3code-vscode-test/mcp.sock"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      toolTimeoutSec: 120,
    });
  });

  it("builds OpenCode local MCP config with timeout in milliseconds", () => {
    const raw = hostMcpServersToOpenCodeConfigContent([
      {
        name: "t3code-vscode-test",
        socketPath: "/tmp/t3code-vscode-test/mcp.sock",
        toolTimeoutSec: 120,
      },
    ]);

    expect(JSON.parse(raw)).toEqual({
      mcp: {
        "t3code-vscode-test": {
          type: "local",
          command: [
            process.execPath,
            process.argv[1],
            "stdio-to-uds",
            "/tmp/t3code-vscode-test/mcp.sock",
          ],
          environment: { ELECTRON_RUN_AS_NODE: "1" },
          enabled: true,
          timeout: 120_000,
        },
      },
    });
  });
});
