import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect, Layer, Option } from "effect";
import { type SubagentSkill } from "@t3tools/contracts";
import { SkillCatalog, type SkillCatalogShape } from "../Services/SkillCatalog.ts";

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function humanizeSkillName(value: string): string {
  return value
    .split(/[-_/]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function extractSkillTitle(markdown: string, fallbackId: string): string {
  for (const line of markdown.split(/\r?\n/g)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (!match?.[1]) {
      continue;
    }
    const title = match[1].trim();
    if (title.length > 0) {
      return title;
    }
  }
  return humanizeSkillName(fallbackId);
}

function extractSkillSummary(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/g);
  const paragraph: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("```")) {
      break;
    }
    paragraph.push(line);
  }
  const summary = paragraph.join(" ").trim();
  return summary.length > 0 ? summary : undefined;
}

const makeSkillCatalog = Effect.sync(() => {
  const resolveSkillRoot = (): string => {
    const codexHome = process.env.CODEX_HOME?.trim();
    if (codexHome) {
      if (codexHome === "~") {
        return path.join(os.homedir(), "skills");
      }
      if (codexHome.startsWith("~/") || codexHome.startsWith("~\\")) {
        return path.join(os.homedir(), codexHome.slice(2), "skills");
      }
      return path.join(codexHome, "skills");
    }
    return path.join(os.homedir(), ".codex", "skills");
  };

  const readSkillDirectory = async (
    rootDir: string,
    directory: string,
  ): Promise<ReadonlyArray<SubagentSkill>> => {
    const skillPath = path.join(directory, "SKILL.md");
    try {
      const skillFileStat = await fs.stat(skillPath);
      if (skillFileStat.isFile()) {
        const promptMarkdown = (await fs.readFile(skillPath, "utf8")).trim();
        if (promptMarkdown.length === 0) {
          return [];
        }
        const relativeDirectory = normalizeRelativePath(path.relative(rootDir, directory));
        const segments = relativeDirectory.split("/").filter((segment) => segment.length > 0);
        const idSegments = segments[0] === ".system" ? segments.slice(1) : segments;
        const skillId = idSegments.join("/");
        if (skillId.length === 0) {
          return [];
        }
        const summary = extractSkillSummary(promptMarkdown);
        return [
          {
            id: skillId,
            title: extractSkillTitle(promptMarkdown, skillId),
            path: skillPath,
            promptMarkdown,
            ...(summary ? { summary } : {}),
          } satisfies SubagentSkill,
        ];
      }
    } catch {
      // Not a skill directory; recurse into children below.
    }

    let entries: ReadonlyArray<string> = [];
    try {
      entries = await fs.readdir(directory);
    } catch {
      return [];
    }

    const nested = await Promise.all(
      entries.map(async (entryName): Promise<ReadonlyArray<SubagentSkill>> => {
        const entryPath = path.join(directory, entryName);
        try {
          const stat = await fs.stat(entryPath);
          if (!stat.isDirectory()) {
            return [];
          }
          return await readSkillDirectory(rootDir, entryPath);
        } catch {
          return [];
        }
      }),
    );
    return nested.flat();
  };

  const listSkills: SkillCatalogShape["listSkills"] = () =>
    Effect.promise(async () => {
      const rootDir = resolveSkillRoot();
      try {
        const rootStat = await fs.stat(rootDir);
        if (!rootStat.isDirectory()) {
          return [] as ReadonlyArray<SubagentSkill>;
        }
      } catch {
        return [] as ReadonlyArray<SubagentSkill>;
      }
      const skills = await readSkillDirectory(rootDir, rootDir);
      return skills.toSorted((left: SubagentSkill, right: SubagentSkill) =>
        left.id.localeCompare(right.id),
      );
    });

  const getSkillById: SkillCatalogShape["getSkillById"] = (skillId) =>
    listSkills().pipe(
      Effect.map((skills) => {
        const match = skills.find((skill) => skill.id === skillId);
        return match ? Option.some(match) : Option.none();
      }),
    );

  return {
    listSkills,
    getSkillById,
  } satisfies SkillCatalogShape;
});

export const SkillCatalogLive = Layer.effect(SkillCatalog, makeSkillCatalog);
