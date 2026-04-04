import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";

import type { ProjectListSkillsResult } from "@t3tools/contracts";

const SKILL_DIRS = [".agents/skills", ".agent/skills"] as const;

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match?.[1]) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export async function scanProjectSkills(cwd: string): Promise<ProjectListSkillsResult> {
  const seen = new Set<string>();
  const skills: Array<ProjectListSkillsResult["skills"][number]> = [];

  for (const dir of SKILL_DIRS) {
    const skillsRoot = nodePath.join(cwd, dir);
    let entries: string[];
    try {
      entries = await fsPromises.readdir(skillsRoot);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillMdPath = nodePath.join(skillsRoot, entry, "SKILL.md");
      let content: string;
      try {
        content = await fsPromises.readFile(skillMdPath, "utf-8");
      } catch {
        continue;
      }

      const fm = parseFrontmatter(content);
      const name = fm.name || entry;
      if (seen.has(name)) continue;
      seen.add(name);

      skills.push({
        name,
        description: fm.description ?? "",
        userInvocable: fm["user-invocable"] !== "false",
      });
    }
  }

  return { skills };
}
