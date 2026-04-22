#!/usr/bin/env node

import { exec, execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const OUTPUT_PATH = path.join(
  import.meta.dirname,
  "..",
  "src",
  "provider",
  "providerTestedVersions.generated.json",
);

const PROVIDERS = {
  codex: {
    binary: process.env.T3CODE_TESTED_CODEX_BINARY || "codex",
    args: ["--version"],
    parse: parseSemver,
  },
  claudeAgent: {
    binary: process.env.T3CODE_TESTED_CLAUDE_BINARY || "claude",
    args: ["--version"],
    parse: parseSemver,
  },
  cursor: {
    binary: process.env.T3CODE_TESTED_CURSOR_BINARY || "agent",
    args: ["about", "--format", "json"],
    parse: parseCursorAboutVersion,
  },
  opencode: {
    binary: process.env.T3CODE_TESTED_OPENCODE_BINARY || "opencode",
    args: ["--version"],
    parse: parseSemver,
  },
} as const;

function quoteWindowsCommandArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function resolveWindowsBinary(binary: string): Promise<string> {
  if (binary.includes("\\") || binary.includes("/") || path.extname(binary)) {
    return binary;
  }

  try {
    const result = await execFileAsync("where.exe", [binary], {
      timeout: 2_000,
      windowsHide: true,
    });
    const candidates = result.stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    return (
      candidates.find((candidate) => candidate.toLowerCase().endsWith(".exe")) ??
      candidates.find((candidate) => candidate.toLowerCase().endsWith(".cmd")) ??
      candidates[0] ??
      binary
    );
  } catch {
    return binary;
  }
}

async function execProviderCommand(binary: string, args: ReadonlyArray<string>) {
  if (process.platform !== "win32") {
    return execFileAsync(binary, [...args], {
      timeout: 5_000,
      windowsHide: true,
    });
  }

  const resolvedBinary = await resolveWindowsBinary(binary);
  if (resolvedBinary.toLowerCase().endsWith(".exe")) {
    return execFileAsync(resolvedBinary, [...args], {
      timeout: 5_000,
      windowsHide: true,
    });
  }

  const commandLine = [resolvedBinary, ...args].map(quoteWindowsCommandArg).join(" ");
  return execAsync(commandLine, {
    timeout: 5_000,
    windowsHide: true,
  });
}

function parseSemver(output: string): string | null {
  return output.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

function parseCursorAboutVersion(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { cliVersion?: unknown };
    return typeof parsed.cliVersion === "string" && parsed.cliVersion.trim()
      ? parsed.cliVersion.trim()
      : null;
  } catch {
    return output.match(/^CLI Version\s{2,}(.+)$/im)?.[1]?.trim() ?? null;
  }
}

async function probeProviderVersion(provider: keyof typeof PROVIDERS): Promise<string | null> {
  const config = PROVIDERS[provider];
  const envKey = `T3CODE_TESTED_${provider.toUpperCase()}_VERSION`;
  const override = process.env[envKey]?.trim();
  if (override) {
    return override;
  }

  try {
    const result = await execProviderCommand(config.binary, config.args);
    return config.parse(`${result.stdout}\n${result.stderr}`);
  } catch {
    if (provider === "cursor") {
      try {
        const result = await execProviderCommand(config.binary, ["about"]);
        return config.parse(`${result.stdout}\n${result.stderr}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function main(): Promise<void> {
  const entries = await Promise.all(
    Object.keys(PROVIDERS).map(async (provider) => [
      provider,
      { testedVersion: await probeProviderVersion(provider as keyof typeof PROVIDERS) },
    ]),
  );
  const manifest = {
    generatedAt: new Date().toISOString(),
    providers: Object.fromEntries(entries),
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tmpPath, OUTPUT_PATH);
}

await main();
