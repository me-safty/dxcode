import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SlashCommandEntry, SlashCommandListResult } from "@t3tools/contracts";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { result: SlashCommandListResult; scannedAt: number }>();

/** Scan a commands/ directory for .md files (recurses into subdirectories). */
async function scanCommandsDir(
  dir: string,
  source: "user" | "project",
  prefix = "",
): Promise<SlashCommandEntry[]> {
  const entries: SlashCommandEntry[] = [];
  let dirEntries;
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const entry of dirEntries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const nested = await scanCommandsDir(
        path.join(dir, entry.name),
        source,
        prefix ? `${prefix}/${entry.name}` : entry.name,
      );
      entries.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const name = prefix
        ? `${prefix}/${entry.name.replace(/\.md$/, "")}`
        : entry.name.replace(/\.md$/, "");

      const description = await readFirstLine(path.join(dir, entry.name));
      entries.push({ name, source, ...(description ? { description } : {}) });
    }
  }
  return entries;
}

/** Scan a skills/ directory for subdirectories containing SKILL.md with YAML frontmatter. */
async function scanSkillsDir(
  dir: string,
  source: "user" | "project",
): Promise<SlashCommandEntry[]> {
  const entries: SlashCommandEntry[] = [];
  let dirEntries;
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const entry of dirEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillMdPath = path.join(dir, entry.name, "SKILL.md");
    try {
      const content = await readHead(skillMdPath, 1024);
      if (!content) continue;
      const parsed = parseSkillFrontmatter(content);
      if (!parsed) continue;
      entries.push({
        name: parsed.name,
        source,
        ...(parsed.description ? { description: parsed.description.slice(0, 120) } : {}),
      });
      // Skills can contain sub-skills as .md files alongside SKILL.md
      const subFiles = await fs.readdir(path.join(dir, entry.name), { withFileTypes: true });
      for (const sub of subFiles) {
        if (!sub.isFile() || !sub.name.endsWith(".md") || sub.name === "SKILL.md") continue;
        const subName = `${parsed.name}/${sub.name.replace(/\.md$/, "")}`;
        const subDesc = await readFirstLine(path.join(dir, entry.name, sub.name));
        entries.push({ name: subName, source, ...(subDesc ? { description: subDesc } : {}) });
      }
    } catch {
      // Skip unreadable skills
    }
  }
  return entries;
}

/** Read the first N bytes of a file, returning the string or undefined on error. */
async function readHead(filePath: string, bytes: number): Promise<string | undefined> {
  try {
    const fh = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.toString("utf-8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

/** Read the first non-empty, non-heading, non-template-variable line as a description. */
async function readFirstLine(filePath: string): Promise<string | undefined> {
  const head = await readHead(filePath, 256);
  if (!head) return undefined;
  const firstLine = head.split("\n")[0]?.trim();
  if (firstLine && !firstLine.startsWith("$") && !firstLine.startsWith("#") && !firstLine.startsWith("---")) {
    return firstLine.slice(0, 120);
  }
  return undefined;
}

/** Parse YAML frontmatter from a SKILL.md file to extract name and description. */
function parseSkillFrontmatter(content: string): { name: string; description?: string } | null {
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return null;
  const fm = fmMatch[1] ?? "";
  const nameMatch = /^name:\s*(.+)$/m.exec(fm);
  if (!nameMatch) return null;
  const name = nameMatch[1]?.trim().replace(/^["']|["']$/g, "");
  if (!name) return null;
  const descMatch = /^description:\s*(.+)$/m.exec(fm);
  const description = descMatch?.[1]?.trim().replace(/^["']|["']$/g, "");
  return { name, ...(description ? { description } : {}) };
}

/** Built-in Claude Code skills that are bundled inside the CLI binary. */
const BUILTIN_CLAUDE_SKILLS: SlashCommandEntry[] = [
  { name: "batch", source: "user", description: "Research and plan a large-scale change, then execute it in parallel across isolated worktree agents" },
  { name: "claude-api", source: "user", description: "Build apps with the Claude API or Anthropic SDK" },
  { name: "claude-in-chrome", source: "user", description: "Automate your Chrome browser to interact with web pages" },
  { name: "debug", source: "user", description: "Enable debug logging for this session and help diagnose issues" },
  { name: "loop", source: "user", description: "Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo)" },
  { name: "schedule", source: "user", description: "Create, update, list, or run scheduled remote agents on a cron schedule" },
  { name: "simplify", source: "user", description: "Review changed code for reuse, quality, and efficiency, then fix any issues found" },
];

export async function listSlashCommands(cwd: string): Promise<SlashCommandListResult> {
  const cached = cache.get(cwd);
  if (cached && Date.now() - cached.scannedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const homeDir = os.homedir();
  const claudeDir = path.join(homeDir, ".claude");
  const projectClaudeDir = path.join(cwd, ".claude");

  const [userCommands, projectCommands, userSkills, projectSkills] = await Promise.all([
    scanCommandsDir(path.join(claudeDir, "commands"), "user"),
    scanCommandsDir(path.join(projectClaudeDir, "commands"), "project"),
    scanSkillsDir(path.join(claudeDir, "skills"), "user"),
    scanSkillsDir(path.join(projectClaudeDir, "skills"), "project"),
  ]);

  // Built-ins < user < project (later entries override earlier ones)
  const byName = new Map<string, SlashCommandEntry>();
  for (const cmd of BUILTIN_CLAUDE_SKILLS) byName.set(cmd.name, cmd);
  for (const cmd of userCommands) byName.set(cmd.name, cmd);
  for (const cmd of userSkills) byName.set(cmd.name, cmd);
  for (const cmd of projectCommands) byName.set(cmd.name, cmd);
  for (const cmd of projectSkills) byName.set(cmd.name, cmd);

  const result: SlashCommandListResult = {
    commands: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };

  cache.set(cwd, { result, scannedAt: Date.now() });
  if (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  return result;
}
