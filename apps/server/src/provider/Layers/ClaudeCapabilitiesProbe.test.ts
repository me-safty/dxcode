import { join } from "node:path";

import { assert, it } from "@effect/vitest";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES,
  resolveClaudeCapabilitiesProbeCwd,
} from "./ClaudeProvider.ts";

it("isolates Claude capability probes from user MCP servers", () => {
  const abort = new AbortController();
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    binaryPath: "/usr/bin/claude",
    abortController: abort,
    env: { HOME: "/home/user", PATH: "/usr/bin" },
    cwd: "/tmp/t3-claude-capability-probe",
  });

  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.cwd, "/tmp/t3-claude-capability-probe");
  assert.equal(options.persistSession, false);
  assert.equal(options.pathToClaudeCodeExecutable, "/usr/bin/claude");
  assert.equal(options.abortController, abort);
  assert.deepEqual(options.settingSources, [...CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES]);
  assert.deepEqual(options.allowedTools, []);
  assert.equal(options.env?.HOME, "/home/user");
  assert.equal(options.env?.PATH, "/usr/bin");
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it("places the Claude capability probe cwd under ~/.t3", () => {
  assert.equal(
    resolveClaudeCapabilitiesProbeCwd("/Users/example"),
    join("/Users/example", ".t3", "claude-capability-probe"),
  );
});
