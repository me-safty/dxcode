import * as OS from "node:os";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

import type { SkillDefinition, SkillScope } from "@t3tools/contracts";

import { buildCodexInitializeParams } from "./codexAppServerManager";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SIMPLE_YAML_PAIR_PATTERN = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/;
const SKILL_REFERENCE_PATTERN = /\$([a-z][a-z0-9-]*)(?=$|[^a-z0-9-])/gi;
const CODEX_RPC_TIMEOUT_MS = 20_000;

interface CodexSkillInterfaceMetadata {
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly defaultPrompt?: string;
}

interface CodexSkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly shortDescription?: string;
  readonly interface?: CodexSkillInterfaceMetadata;
  readonly path: string;
  readonly scope: "admin" | "repo" | "system" | "user";
  readonly enabled: boolean;
}

interface CodexSkillsListEntry {
  readonly cwd: string;
  readonly skills: ReadonlyArray<CodexSkillMetadata>;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

function parseYamlScalar(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return undefined;

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unwrapped = trimmed.slice(1, -1).trim();
    return unwrapped.length > 0 ? unwrapped : undefined;
  }

  return trimmed;
}

function parseSimpleYamlFields(
  source: string,
  targetKeys: ReadonlyArray<string>,
): Partial<Record<string, string>> {
  const remainingKeys = new Set(targetKeys);
  const parsed: Partial<Record<string, string>> = {};

  for (const line of source.split(/\r?\n/)) {
    if (remainingKeys.size === 0) break;
    if (line.startsWith(" ") || line.startsWith("\t")) continue;

    const match = SIMPLE_YAML_PAIR_PATTERN.exec(line);
    if (!match) continue;

    const key = match[1];
    if (!key || !remainingKeys.has(key)) continue;

    const value = parseYamlScalar(match[2] ?? "");
    if (!value) continue;

    parsed[key] = value;
    remainingKeys.delete(key);
  }

  return parsed;
}

export function parseSkillFrontmatter(
  source: string,
): Pick<SkillDefinition, "name" | "description"> | null {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(source);
  if (!frontmatterMatch) return null;

  const parsed = parseSimpleYamlFields(frontmatterMatch[1] ?? "", ["name", "description"]);
  if (!parsed.name || !parsed.description) return null;

  return {
    name: parsed.name,
    description: parsed.description,
  };
}

export function parseSkillAgentsDefinition(
  source: string,
): Pick<SkillDefinition, "displayName" | "shortDescription" | "defaultPrompt"> {
  const parsed = parseSimpleYamlFields(source, [
    "display_name",
    "short_description",
    "default_prompt",
  ]);

  return {
    ...(parsed.display_name ? { displayName: parsed.display_name } : {}),
    ...(parsed.short_description ? { shortDescription: parsed.short_description } : {}),
    ...(parsed.default_prompt ? { defaultPrompt: parsed.default_prompt } : {}),
  };
}

function expandHomePath(input: string): string {
  if (input === "~") return OS.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

export function resolveCodexHomePath(homePath?: string): string {
  const trimmedHomePath = homePath?.trim();
  if (trimmedHomePath && trimmedHomePath.length > 0) {
    return path.resolve(expandHomePath(trimmedHomePath));
  }

  const envHomePath = process.env.CODEX_HOME?.trim();
  if (envHomePath && envHomePath.length > 0) {
    return path.resolve(expandHomePath(envHomePath));
  }

  return path.join(OS.homedir(), ".codex");
}

function normalizeSkillScope(scope: CodexSkillMetadata["scope"]): SkillScope {
  return scope;
}

function skillScopeOrder(scope: SkillScope): number {
  switch (scope) {
    case "system":
      return 0;
    case "admin":
      return 1;
    case "repo":
      return 2;
    case "user":
    default:
      return 3;
  }
}

function mapCodexSkillToDefinition(skill: CodexSkillMetadata): Promise<SkillDefinition> {
  const skillFilePath = path.resolve(skill.path);
  const directoryPath = path.dirname(skillFilePath);
  const agentsDefinitionPath = path.join(directoryPath, "agents", "openai.yaml");
  return access(agentsDefinitionPath)
    .then(
      () =>
        ({
          name: skill.name,
          description: skill.description,
          ...(skill.interface?.displayName ? { displayName: skill.interface.displayName } : {}),
          ...(skill.interface?.shortDescription
            ? { shortDescription: skill.interface.shortDescription }
            : skill.shortDescription
              ? { shortDescription: skill.shortDescription }
              : {}),
          ...(skill.interface?.defaultPrompt
            ? { defaultPrompt: skill.interface.defaultPrompt }
            : {}),
          enabled: skill.enabled,
          scope: normalizeSkillScope(skill.scope),
          directoryPath,
          skillFilePath,
          agentsDefinitionPath,
        }) satisfies SkillDefinition,
    )
    .catch(() => ({
      name: skill.name,
      description: skill.description,
      ...(skill.interface?.displayName ? { displayName: skill.interface.displayName } : {}),
      ...(skill.interface?.shortDescription
        ? { shortDescription: skill.interface.shortDescription }
        : skill.shortDescription
          ? { shortDescription: skill.shortDescription }
          : {}),
      ...(skill.interface?.defaultPrompt ? { defaultPrompt: skill.interface.defaultPrompt } : {}),
      enabled: skill.enabled,
      scope: normalizeSkillScope(skill.scope),
      directoryPath,
      skillFilePath,
    }));
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asArray(value: unknown): ReadonlyArray<unknown> | undefined {
  return Array.isArray(value) ? value : undefined;
}

function parseCodexSkillsListResponse(result: unknown): CodexSkillsListEntry[] {
  const record = asObject(result);
  const rawEntries = asArray(record?.data) ?? [];
  return rawEntries.flatMap((entry) => {
    const parsedEntry = asObject(entry);
    if (!parsedEntry) {
      return [];
    }
    const cwd = asString(parsedEntry?.cwd);
    if (!cwd) {
      return [];
    }
    const rawSkills = asArray(parsedEntry.skills) ?? [];
    const skills = rawSkills.flatMap((rawSkill) => {
      const skill = asObject(rawSkill);
      const name = asString(skill?.name);
      const description = asString(skill?.description);
      const skillPath = asString(skill?.path);
      const scope = asString(skill?.scope);
      const enabled = asBoolean(skill?.enabled);
      if (
        !name ||
        !description ||
        !skillPath ||
        enabled === undefined ||
        (scope !== "admin" && scope !== "repo" && scope !== "system" && scope !== "user")
      ) {
        return [];
      }
      const skillInterface = asObject(skill?.interface);
      const shortDescription = asString(skill?.shortDescription);
      const displayName = skillInterface ? asString(skillInterface.displayName) : undefined;
      const interfaceShortDescription = skillInterface
        ? asString(skillInterface.shortDescription)
        : undefined;
      const defaultPrompt = skillInterface ? asString(skillInterface.defaultPrompt) : undefined;
      const normalizedSkill = {
        name,
        description,
        path: skillPath,
        scope,
        enabled,
        ...(shortDescription ? { shortDescription } : {}),
        ...(displayName || interfaceShortDescription || defaultPrompt
          ? {
              interface: {
                ...(displayName ? { displayName } : {}),
                ...(interfaceShortDescription
                  ? { shortDescription: interfaceShortDescription }
                  : {}),
                ...(defaultPrompt ? { defaultPrompt } : {}),
              },
            }
          : {}),
      } satisfies CodexSkillMetadata;
      return [normalizedSkill];
    });
    const errors = (asArray(parsedEntry.errors) ?? []).flatMap((rawError) => {
      const error = asObject(rawError);
      const errorPath = asString(error?.path);
      const message = asString(error?.message);
      return errorPath && message ? [{ path: errorPath, message }] : [];
    });
    return [{ cwd, skills, errors }];
  });
}

async function requestCodexSkillsList(input: {
  binaryPath?: string;
  homePath?: string;
  cwd?: string;
  forceReload?: boolean;
}): Promise<CodexSkillsListEntry[]> {
  const resolvedCwd = path.resolve(expandHomePath(input.cwd?.trim() || process.cwd()));
  const codexHomePath = resolveCodexHomePath(input.homePath);
  const codexBinaryPath = input.binaryPath?.trim() || "codex";
  const child = spawn(codexBinaryPath, ["app-server"], {
    cwd: resolvedCwd,
    env: {
      ...process.env,
      CODEX_HOME: codexHomePath,
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const output = readline.createInterface({ input: child.stdout });
  let stderr = "";

  return await new Promise<CodexSkillsListEntry[]>((resolve, reject) => {
    let settled = false;
    let phase: "initialize" | "skills-list" = "initialize";

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      output.close();
      child.removeAllListeners();
      child.stderr.removeAllListeners();
      if (!child.killed) {
        child.kill();
      }
      callback();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for Codex skills/list response.")));
    }, CODEX_RPC_TIMEOUT_MS);

    const writeMessage = (message: unknown) => {
      if (!child.stdin.writable) {
        finish(() => reject(new Error("Cannot write to codex app-server stdin.")));
        return;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      const detail = stderr.trim();
      finish(() =>
        reject(
          new Error(
            detail ||
              `codex app-server exited before responding (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
          ),
        ),
      );
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    output.on("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const response = asObject(parsed);
      const responseId = response?.id;
      if (responseId !== 1 && responseId !== 2) {
        return;
      }
      const error = asObject(response?.error);
      if (error?.message) {
        finish(() => reject(new Error(String(error.message))));
        return;
      }

      if (phase === "initialize" && responseId === 1) {
        phase = "skills-list";
        writeMessage({ method: "initialized" });
        writeMessage({
          id: 2,
          method: "skills/list",
          params: {
            ...(input.cwd ? { cwds: [resolvedCwd] } : {}),
            ...(input.forceReload ? { forceReload: true } : {}),
          },
        });
        return;
      }

      if (phase === "skills-list" && responseId === 2) {
        finish(() => resolve(parseCodexSkillsListResponse(response?.result)));
      }
    });

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}

export function extractSkillReferencesFromText(text: string): string[] {
  const matches = new Set<string>();
  for (const match of text.matchAll(SKILL_REFERENCE_PATTERN)) {
    const name = match[1]?.trim();
    if (name) {
      matches.add(name);
    }
  }
  return [...matches];
}

export async function listSkills(
  input: { binaryPath?: string; homePath?: string; cwd?: string } = {},
): Promise<SkillDefinition[]> {
  const entries = await requestCodexSkillsList({
    ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
    ...(input.homePath ? { homePath: input.homePath } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    forceReload: true,
  });
  const skills = (
    await Promise.all(
      entries.flatMap((entry) => entry.skills.map((skill) => mapCodexSkillToDefinition(skill))),
    )
  ).toSorted((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    const scopeDelta = skillScopeOrder(left.scope) - skillScopeOrder(right.scope);
    if (scopeDelta !== 0) {
      return scopeDelta;
    }
    const leftLabel = left.displayName ?? left.name;
    const rightLabel = right.displayName ?? right.name;
    return leftLabel.localeCompare(rightLabel);
  });
  return skills;
}
