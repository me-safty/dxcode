import { afterEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  listSkills,
  parseSkillAgentsDefinition,
  parseSkillFrontmatter,
  resolveCodexHomePath,
} from "./skills";

describe("parseSkillFrontmatter", () => {
  it("reads name and description from SKILL.md frontmatter", () => {
    expect(
      parseSkillFrontmatter(`---
name: example-skill
description: Does useful work
---

Body`),
    ).toEqual({
      name: "example-skill",
      description: "Does useful work",
    });
  });

  it("returns null when required fields are missing", () => {
    expect(parseSkillFrontmatter("---\nname: only-name\n---\n")).toBeNull();
  });
});

describe("parseSkillAgentsDefinition", () => {
  it("reads supported UI metadata fields", () => {
    expect(
      parseSkillAgentsDefinition(`display_name: Skill Display
short_description: Short copy
default_prompt: Start here`),
    ).toEqual({
      displayName: "Skill Display",
      shortDescription: "Short copy",
      defaultPrompt: "Start here",
    });
  });
});

describe("resolveCodexHomePath", () => {
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(() => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
      return;
    }
    process.env.CODEX_HOME = originalCodexHome;
  });

  it("prefers the explicit home path", () => {
    process.env.CODEX_HOME = "/env/codex";
    expect(resolveCodexHomePath("~/custom-codex")).toBe(path.join(os.homedir(), "custom-codex"));
  });
});

describe("listSkills", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  it("maps native codex app-server skills into UI skill definitions", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "t3-skills-"));
    const systemSkillDir = path.join(tempDir, "skills", ".system", "skill-installer");
    await mkdir(path.join(systemSkillDir, "agents"), { recursive: true });
    await writeFile(
      path.join(systemSkillDir, "agents", "openai.yaml"),
      `display_name: Install Skill
short_description: Install a skill
default_prompt: Install a skill for me`,
    );

    const userSkillDir = path.join(tempDir, "skills", "my-skill");
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(path.join(userSkillDir, "SKILL.md"), "# placeholder");

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin,
      killed: false,
      kill: vi.fn(function kill() {
        child.killed = true;
        return true;
      }),
      removeAllListeners: EventEmitter.prototype.removeAllListeners,
    });
    const spawnMock = vi.spyOn(childProcess, "spawn").mockReturnValue(child as never);

    queueMicrotask(() => {
      stdout.write('{"id":1,"result":{"ok":true}}\n');
      stdout.write(
        `${JSON.stringify({
          id: 2,
          result: {
            data: [
              {
                cwd: tempDir,
                skills: [
                  {
                    name: "skill-installer",
                    description: "Install skills from other repos",
                    path: path.join(systemSkillDir, "SKILL.md"),
                    scope: "system",
                    enabled: true,
                    interface: {
                      displayName: "Install Skill",
                      shortDescription: "Install a skill",
                      defaultPrompt: "Install a skill for me",
                    },
                  },
                  {
                    name: "my-skill",
                    description: "My custom helper",
                    path: path.join(userSkillDir, "SKILL.md"),
                    scope: "user",
                    enabled: false,
                  },
                ],
                errors: [],
              },
            ],
          },
        })}\n`,
      );
    });

    const skills = await listSkills({ homePath: tempDir });
    spawnMock.mockRestore();

    expect(skills).toHaveLength(2);
    expect(skills[0]).toMatchObject({
      name: "skill-installer",
      enabled: true,
      scope: "system",
      displayName: "Install Skill",
      shortDescription: "Install a skill",
      defaultPrompt: "Install a skill for me",
      agentsDefinitionPath: path.join(systemSkillDir, "agents", "openai.yaml"),
      skillFilePath: path.join(systemSkillDir, "SKILL.md"),
    });
    expect(skills[1]).toMatchObject({
      name: "my-skill",
      enabled: false,
      scope: "user",
      skillFilePath: path.join(userSkillDir, "SKILL.md"),
    });
  });

  it("uses the configured codex binary when requesting skills", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin,
      killed: false,
      kill: vi.fn(function kill() {
        child.killed = true;
        return true;
      }),
      removeAllListeners: EventEmitter.prototype.removeAllListeners,
    });
    const spawnMock = vi.spyOn(childProcess, "spawn").mockReturnValue(child as never);

    queueMicrotask(() => {
      stdout.write('{"id":1,"result":{"ok":true}}\n');
      stdout.write('{"id":2,"result":{"data":[]}}\n');
    });

    await listSkills({ binaryPath: "/custom/bin/codex" });
    expect(spawnMock).toHaveBeenCalledWith(
      "/custom/bin/codex",
      ["app-server"],
      expect.objectContaining({
        shell: process.platform === "win32",
      }),
    );

    spawnMock.mockRestore();
  });
});
