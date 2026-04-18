/**
 * piRuntime - Helpers for probing and invoking the pi CLI.
 *
 * pi auth differs from other providers: there is no `pi login` subcommand.
 * pi reads provider-specific API keys or OAuth tokens from environment
 * variables. We surface those requirements through the provider snapshot
 * (install status, configured-backend, env-var readiness) rather than
 * silently inheriting another provider's credentials.
 *
 * @module piRuntime
 */
import { spawn } from "node:child_process";
import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";

export interface PiCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export async function runPiCommand(input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
}): Promise<PiCommandResult> {
  const child = spawn(input.binaryPath, [...input.args], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: process.env,
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  const stdoutChunks: Array<string> = [];
  const stderrChunks: Array<string> = [];

  child.stdout?.on("data", (chunk: string) => stdoutChunks.push(chunk));
  child.stderr?.on("data", (chunk: string) => stderrChunks.push(chunk));

  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 0));
  });

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    code,
  };
}

export const DEFAULT_PI_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

/**
 * Minimum pi version we test against. Below this, pi may lack `--mode rpc`
 * stability required by the adapter (Slice 3) — warn but do not block.
 */
export const PI_MIN_RECOMMENDED_VERSION = "0.60.0";

/**
 * Baseline model slugs surfaced when pi is installed. Users can add more via
 * PiSettings.customModels; Slice 3 will enrich this by querying pi directly.
 */
export const DEFAULT_PI_BUILTIN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "anthropic/claude-sonnet-4-6",
    name: "anthropic/claude-sonnet-4-6",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "anthropic/claude-opus-4-7",
    name: "anthropic/claude-opus-4-7",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "anthropic/claude-haiku-4-5",
    name: "anthropic/claude-haiku-4-5",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "openai/gpt-5",
    name: "openai/gpt-5",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
  {
    slug: "google/gemini-2.5-pro",
    name: "google/gemini-2.5-pro",
    isCustom: false,
    capabilities: DEFAULT_PI_MODEL_CAPABILITIES,
  },
];

export interface PiBackendOption {
  /** Stable id matching pi's `--provider <name>` flag. */
  readonly id: string;
  /** Human-readable label for the settings dropdown. */
  readonly label: string;
  /** Environment variables pi will read for this backend, in priority order. */
  readonly envVars: ReadonlyArray<string>;
  /** Short instruction for the setup UI when no env var is detected. */
  readonly setupHint: string;
}

export const PI_BACKEND_OPTIONS: ReadonlyArray<PiBackendOption> = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVars: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
    setupHint:
      "Export ANTHROPIC_API_KEY (or ANTHROPIC_OAUTH_TOKEN from a Claude Pro/Max session) before starting the server.",
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    envVars: ["OPENAI_API_KEY"],
    setupHint: "Export OPENAI_API_KEY before starting the server.",
  },
  {
    id: "google",
    label: "Google (Gemini)",
    envVars: ["GEMINI_API_KEY"],
    setupHint: "Export GEMINI_API_KEY before starting the server.",
  },
  {
    id: "groq",
    label: "Groq",
    envVars: ["GROQ_API_KEY"],
    setupHint: "Export GROQ_API_KEY before starting the server.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envVars: ["OPENROUTER_API_KEY"],
    setupHint: "Export OPENROUTER_API_KEY before starting the server.",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    envVars: ["XAI_API_KEY"],
    setupHint: "Export XAI_API_KEY before starting the server.",
  },
  {
    id: "mistral",
    label: "Mistral",
    envVars: ["MISTRAL_API_KEY"],
    setupHint: "Export MISTRAL_API_KEY before starting the server.",
  },
];

export function findPiBackendOption(backendId: string): PiBackendOption | undefined {
  const trimmed = backendId.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return PI_BACKEND_OPTIONS.find((option) => option.id === trimmed);
}

export interface PiAuthDetection {
  readonly authenticated: boolean;
  readonly detectedEnvVar: string | undefined;
  readonly checkedBackend: PiBackendOption | undefined;
}

/**
 * Decide whether pi has a usable credential, based on the user's configured
 * defaultProvider and the live process env. If defaultProvider is empty, we
 * fall back to "any recognized pi backend env var is present."
 *
 * We intentionally do NOT auto-adopt Codex/Claude credentials here: users may
 * want pi pointed at a different account or provider entirely.
 */
export function detectPiAuth(input: {
  readonly defaultProvider: string;
  readonly env: NodeJS.ProcessEnv;
}): PiAuthDetection {
  const configured = findPiBackendOption(input.defaultProvider);

  if (configured) {
    for (const envVar of configured.envVars) {
      const value = input.env[envVar];
      if (typeof value === "string" && value.trim().length > 0) {
        return {
          authenticated: true,
          detectedEnvVar: envVar,
          checkedBackend: configured,
        };
      }
    }
    return {
      authenticated: false,
      detectedEnvVar: undefined,
      checkedBackend: configured,
    };
  }

  for (const option of PI_BACKEND_OPTIONS) {
    for (const envVar of option.envVars) {
      const value = input.env[envVar];
      if (typeof value === "string" && value.trim().length > 0) {
        return {
          authenticated: true,
          detectedEnvVar: envVar,
          checkedBackend: option,
        };
      }
    }
  }

  return {
    authenticated: false,
    detectedEnvVar: undefined,
    checkedBackend: undefined,
  };
}

/**
 * Compare two semver-ish version strings. Returns -1, 0, or 1. Non-numeric
 * components are treated as 0. Used for the min-recommended-version warning —
 * not security-sensitive, so "close enough" lexicographic handling is fine.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v.split(".").slice(0, 3);
    const asNum = (index: number): number => {
      const raw = parts[index];
      if (raw === undefined) return 0;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : 0;
    };
    return [asNum(0), asNum(1), asNum(2)];
  };
  const [am, an, ap] = parse(a);
  const [bm, bn, bp] = parse(b);
  if (am !== bm) return am > bm ? 1 : -1;
  if (an !== bn) return an > bn ? 1 : -1;
  if (ap !== bp) return ap > bp ? 1 : -1;
  return 0;
}
