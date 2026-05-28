import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface LocalOrchestratorConfig {
  readonly host: string;
  readonly port: number;
  readonly dbPath: string;
  readonly t3WebAppBaseUrl?: string;
}

function envString(name: string) {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function envPort(name: string, fallback: number) {
  const value = envString(name);
  if (value === undefined) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function defaultBaseDir() {
  return resolve(envString("T3CODE_HOME") ?? join(homedir(), ".t3"));
}

export function readLocalOrchestratorConfig(): LocalOrchestratorConfig {
  const baseDir = defaultBaseDir();
  const t3WebAppBaseUrl =
    envString("T3_WEB_APP_BASE_URL") ?? envString("T3_EXECUTION_BRIDGE_BASE_URL");
  return {
    host: envString("ORCHESTRATOR_HOST") ?? "127.0.0.1",
    port: envPort("ORCHESTRATOR_PORT", 3774),
    dbPath: envString("ORCHESTRATOR_DB_PATH") ?? join(baseDir, "userdata", "orchestrator.sqlite"),
    ...(t3WebAppBaseUrl !== undefined ? { t3WebAppBaseUrl } : {}),
  };
}
