import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { assert, it } from "@effect/vitest";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  CLAUDE_CAPABILITIES_PROBE_SETTING_SOURCES,
  resolveClaudeCapabilitiesProbeCwd,
  resolveClaudeCapabilitiesProbeHome,
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

it("places the Claude capability probe cwd under an absolute home", () => {
  assert.equal(
    resolveClaudeCapabilitiesProbeCwd("/Users/example"),
    join(resolve("/Users/example"), ".t3", "claude-capability-probe"),
  );
});

it("expands a bare ~ home before joining the probe cwd", () => {
  assert.equal(
    resolveClaudeCapabilitiesProbeCwd("~"),
    join(homedir(), ".t3", "claude-capability-probe"),
  );
});

it("expands ~/… and resolves relative homes to absolute probe cwds", () => {
  assert.equal(
    resolveClaudeCapabilitiesProbeCwd("~/.claude-work"),
    join(homedir(), ".claude-work", ".t3", "claude-capability-probe"),
  );
  assert.equal(
    resolveClaudeCapabilitiesProbeCwd("relative-home"),
    join(resolve("relative-home"), ".t3", "claude-capability-probe"),
  );
});

it("aligns probe env HOME with the resolved probe cwd parent", () => {
  const probeHome = resolveClaudeCapabilitiesProbeHome("~");
  const probeCwd = resolveClaudeCapabilitiesProbeCwd(probeHome);
  const abort = new AbortController();
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    binaryPath: "/usr/bin/claude",
    abortController: abort,
    env: { HOME: probeHome, PATH: "/usr/bin" },
    cwd: probeCwd,
  });

  assert.equal(options.env?.HOME, probeHome);
  assert.equal(options.cwd, probeCwd);
  assert.equal(probeCwd, join(probeHome, ".t3", "claude-capability-probe"));
});
