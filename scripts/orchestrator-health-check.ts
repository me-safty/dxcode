#!/usr/bin/env node
// @effect-diagnostics globalConsole:off
// @effect-diagnostics globalTimers:off
// @effect-diagnostics nodeBuiltinImport:off

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export interface HealthCheckConfig {
  readonly localBaseUrl: string;
  readonly publicBaseUrl: string;
  readonly convexSiteUrl?: string | undefined;
  readonly orchestratorDir: string;
  readonly serverTaskName: string;
  readonly tunnelTaskName: string;
  readonly timeoutMs: number;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly details: string;
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function defaultHealthCheckConfig(env: NodeJS.ProcessEnv = process.env): HealthCheckConfig {
  return {
    localBaseUrl: env.T3CODE_HEALTH_LOCAL_BASE_URL ?? "http://127.0.0.1:3773",
    publicBaseUrl: env.T3CODE_HEALTH_PUBLIC_BASE_URL ?? "https://t3.olumbe.com",
    convexSiteUrl: envValue("T3CODE_HEALTH_CONVEX_SITE_URL") ?? envValue("ORCHESTRATOR_BASE_URL"),
    orchestratorDir: env.T3CODE_HEALTH_ORCHESTRATOR_DIR ?? "apps/orchestrator",
    serverTaskName: env.T3CODE_HEALTH_SERVER_TASK ?? "t3code-server",
    tunnelTaskName: env.T3CODE_HEALTH_TUNNEL_TASK ?? "t3code-tunnel",
    timeoutMs: Number(env.T3CODE_HEALTH_TIMEOUT_MS ?? "10000"),
  };
}

export function classifyBridgeStatus(status: number) {
  if (status === 401) {
    return {
      ok: true,
      details: "bridge route exists and rejected unauthenticated request with 401",
    };
  }
  if (status === 503) {
    return {
      ok: false,
      details: "bridge route exists but local server is missing T3_EXECUTION_BRIDGE_SHARED_SECRET",
    };
  }
  if (status === 404) {
    return {
      ok: false,
      details: "bridge route returned 404; running server build or tunnel target is stale",
    };
  }
  return {
    ok: false,
    details: `bridge route returned unexpected HTTP ${status}`,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timeout))
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${label} timed out after ${timeoutMs}ms`);
      }
      throw error;
    });
}

async function checkFetch(name: string, url: string, timeoutMs: number): Promise<CheckResult> {
  try {
    const response = await fetchWithTimeout(url, {}, timeoutMs, name);
    return {
      name,
      ok: response.ok,
      details: `${url} -> HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkBridge(config: HealthCheckConfig): Promise<CheckResult> {
  const url = `${config.publicBaseUrl.replace(/\/$/, "")}/api/execution/runs/status`;
  try {
    const response = await fetchWithTimeout(
      url,
      { method: "POST" },
      config.timeoutMs,
      "bridge route",
    );
    const classification = classifyBridgeStatus(response.status);
    return {
      name: "bridge auth",
      ok: classification.ok,
      details: `${url} -> HTTP ${response.status}; ${classification.details}`,
    };
  } catch (error) {
    return {
      name: "bridge auth",
      ok: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function runCommand(
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly timeoutMs: number },
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function checkScheduledTask(taskName: string, timeoutMs: number): Promise<CheckResult> {
  if (process.platform !== "win32") {
    return {
      name: `scheduled task ${taskName}`,
      ok: true,
      details: "skipped on non-Windows platform",
    };
  }

  const result = await runCommand(
    "schtasks.exe",
    ["/query", "/tn", taskName, "/fo", "LIST", "/v"],
    { timeoutMs },
  );
  return {
    name: `scheduled task ${taskName}`,
    ok: result.code === 0,
    details:
      result.code === 0
        ? firstMatchingLine(result.stdout, ["TaskName:", "Status:", "Task To Run:"]) ||
          "task exists"
        : (result.stderr || result.stdout || `schtasks exited ${result.code}`).trim(),
  };
}

function firstMatchingLine(output: string, labels: ReadonlyArray<string>) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return labels
    .map((label) => lines.find((line) => line.toLowerCase().startsWith(label.toLowerCase())))
    .filter((line): line is string => line !== undefined)
    .join("; ");
}

async function checkConvex(config: HealthCheckConfig): Promise<ReadonlyArray<CheckResult>> {
  const results: CheckResult[] = [];
  if (config.convexSiteUrl !== undefined) {
    results.push(
      await checkFetch(
        "convex health",
        `${config.convexSiteUrl.replace(/\/$/, "")}/health`,
        config.timeoutMs,
      ),
    );
  } else {
    results.push({
      name: "convex health",
      ok: false,
      details: "set T3CODE_HEALTH_CONVEX_SITE_URL or ORCHESTRATOR_BASE_URL",
    });
  }

  const events = await runCommand(
    "bunx",
    ["convex", "run", "observability:listRecent", "--", '{ "severity": "error", "limit": 5 }'],
    { cwd: config.orchestratorDir, timeoutMs: config.timeoutMs },
  );
  results.push({
    name: "recent orchestrator errors",
    ok: events.code === 0,
    details:
      events.code === 0
        ? summarizeConvexRun(events.stdout)
        : (events.stderr || events.stdout || `convex exited ${events.code}`).trim(),
  });

  return results;
}

function summarizeConvexRun(output: string) {
  const trimmed = output.trim();
  if (!trimmed || trimmed === "[]") return "no recent error events returned";
  return trimmed.split(/\r?\n/).slice(-8).join(" ").slice(0, 500);
}

export async function runHealthChecks(config: HealthCheckConfig) {
  const results: CheckResult[] = [];
  results.push(await checkScheduledTask(config.serverTaskName, config.timeoutMs));
  results.push(await checkScheduledTask(config.tunnelTaskName, config.timeoutMs));
  results.push(await checkFetch("local T3", config.localBaseUrl, config.timeoutMs));
  results.push(await checkFetch("public T3", config.publicBaseUrl, config.timeoutMs));
  results.push(await checkBridge(config));
  results.push(...(await checkConvex(config)));
  return results;
}

function printResults(results: ReadonlyArray<CheckResult>) {
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.details}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runHealthChecks(defaultHealthCheckConfig());
  printResults(results);
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}
