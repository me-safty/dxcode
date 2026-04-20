import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPOSER_POPOVER_PATH = path.resolve(__dirname, "ComposerAttachmentsPopover.tsx");
const CHATVIEW_PATH = path.resolve(__dirname, "..", "ChatView.tsx");
const SIDEBAR_PATH = path.resolve(__dirname, "..", "Sidebar.tsx");

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

describe("Directory browser integration guard", () => {
  it("ComposerAttachmentsPopover imports and renders DirectoryBrowserDialog", () => {
    const src = readSource(COMPOSER_POPOVER_PATH);
    expect(src).toMatch(
      /import\s*\{\s*DirectoryBrowserDialog\s*\}\s*from\s*"\.\/DirectoryBrowserDialog"/,
    );
    expect(src).toContain("<DirectoryBrowserDialog");
  });

  it("ComposerAttachmentsPopover declares projectCwd and environmentId props", () => {
    const src = readSource(COMPOSER_POPOVER_PATH);
    expect(src).toMatch(/projectCwd:\s*string\s*\|\s*null/);
    expect(src).toMatch(/environmentId:\s*EnvironmentId\s*\|\s*null/);
  });

  it("ChatView passes projectCwd and environmentId to ComposerAttachmentsPopover", () => {
    const src = readSource(CHATVIEW_PATH);
    const composerUsage = src.match(/<ComposerAttachmentsPopover[\s\S]*?\/>/);
    expect(composerUsage).not.toBeNull();
    expect(composerUsage?.[0]).toContain("projectCwd={activeProjectCwd}");
    expect(composerUsage?.[0]).toContain("environmentId={activeThreadEnvironmentId ?? null}");
  });

  it("Sidebar opens DirectoryBrowserDialog for the Add Project button", () => {
    const src = readSource(SIDEBAR_PATH);
    expect(src).toMatch(
      /import\s*\{\s*DirectoryBrowserDialog\s*\}\s*from\s*"\.\/chat\/DirectoryBrowserDialog"/,
    );
    expect(src).toContain("<DirectoryBrowserDialog");
    expect(src).toMatch(/title="Add Project"/);
    expect(src).toMatch(/confirmLabel="Add Project"/);
    expect(src).not.toContain("shouldShowProjectPathEntry");
    expect(src).not.toContain('placeholder="/path/to/project"');
  });

  it("Sidebar reads addProjectBaseDirectory and falls back to ~/ when empty", () => {
    const src = readSource(SIDEBAR_PATH);
    expect(src).toContain("addProjectBaseDirectory");
    expect(src).toMatch(/useSettings\(\(s\)\s*=>\s*s\.addProjectBaseDirectory\)/);
    expect(src).toMatch(
      /addProjectBaseDirectory\.trim\(\)\.length\s*>\s*0\s*[\s\S]*?addProjectBaseDirectory\s*:\s*"~\/"/,
    );
  });

  it("DirectoryBrowserDialog initial path uses projectCwd + /../ for Add folder", () => {
    const src = readSource(COMPOSER_POPOVER_PATH);
    expect(src).toContain('`${projectCwd.replace(/\\/+$/, "")}/../`');
  });
});
