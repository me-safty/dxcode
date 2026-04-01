import fsPromises from "node:fs/promises";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractClaudeRespectGitignore, resolveClaudeRespectGitignore } from "./claudeSettings.ts";

const runWithNodeServices = <A>(effect: Effect.Effect<A, never, NodeServices.NodeServices>) =>
  Effect.runPromise(Effect.provide(effect, NodeServices.layer));

describe("extractClaudeRespectGitignore", () => {
  it("reads top-level settings.json values", () => {
    expect(extractClaudeRespectGitignore({ respectGitignore: false })).toBe(false);
    expect(extractClaudeRespectGitignore({ respectGitignore: true })).toBe(true);
  });

  it("falls back to a nested legacy settings object", () => {
    expect(extractClaudeRespectGitignore({ settings: { respectGitignore: false } })).toBe(false);
  });

  it("returns undefined for unrelated shapes", () => {
    expect(extractClaudeRespectGitignore({})).toBeUndefined();
    expect(extractClaudeRespectGitignore(null)).toBeUndefined();
    expect(extractClaudeRespectGitignore("false")).toBeUndefined();
  });
});

describe("resolveClaudeRespectGitignore", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => fsPromises.rm(directory, { force: true, recursive: true })),
    );
  });

  it("defaults to respecting gitignore when no Claude setting is present", async () => {
    const cwd = await fsPromises.mkdtemp(
      path.join(process.env.TMPDIR ?? "/tmp", "t3code-claude-settings-cwd-"),
    );
    const homeDir = await fsPromises.mkdtemp(
      path.join(process.env.TMPDIR ?? "/tmp", "t3code-claude-settings-home-"),
    );
    tempDirectories.push(cwd, homeDir);

    await expect(
      runWithNodeServices(resolveClaudeRespectGitignore(cwd, { homeDirectory: homeDir })),
    ).resolves.toBe(true);
  });

  it("applies project-local settings over user settings", async () => {
    const cwd = await fsPromises.mkdtemp(
      path.join(process.env.TMPDIR ?? "/tmp", "t3code-claude-settings-cwd-"),
    );
    const homeDir = await fsPromises.mkdtemp(
      path.join(process.env.TMPDIR ?? "/tmp", "t3code-claude-settings-home-"),
    );
    tempDirectories.push(cwd, homeDir);

    await fsPromises.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    await fsPromises.mkdir(path.join(cwd, ".claude"), { recursive: true });
    await fsPromises.writeFile(
      path.join(homeDir, ".claude", "settings.json"),
      '{"respectGitignore":true}',
    );
    await fsPromises.writeFile(
      path.join(cwd, ".claude", "settings.local.json"),
      '{"respectGitignore":false}',
    );

    await expect(
      runWithNodeServices(resolveClaudeRespectGitignore(cwd, { homeDirectory: homeDir })),
    ).resolves.toBe(false);
  });
});
