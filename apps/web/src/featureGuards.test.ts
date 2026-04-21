import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(__dirname);
const readSrc = (relativePath: string) =>
  fs.readFileSync(path.resolve(SRC_DIR, relativePath), "utf-8");
const fileExists = (relativePath: string) => fs.existsSync(path.resolve(SRC_DIR, relativePath));

describe("MarCode feature guards", () => {
  it("CSS content-visibility is used (no JS virtualizer)", () => {
    const source = readSrc("components/chat/MessagesTimeline.tsx");
    expect(source).not.toContain("@tanstack/react-virtual");
    expect(source).not.toContain("useVirtualizer");
  });

  it("text reveal animation exists", () => {
    const source = readSrc("components/chat/MessagesTimeline.tsx");
    expect(source).toContain("TextReveal");
  });

  it("selection reply toolbar exists", () => {
    const source = readSrc("components/chat/MessagesTimeline.tsx");
    expect(source).toContain("SelectionReplyToolbar");
  });

  it("inline diff preview component exists", () => {
    expect(fileExists("components/chat/InlineDiffPreview.tsx")).toBe(true);
    const source = readSrc("components/chat/InlineDiffPreview.tsx");
    expect(source).toContain("InlineDiffPreview");
  });

  it("message copy button exists", () => {
    expect(fileExists("components/chat/MessageCopyButton.tsx")).toBe(true);
    const source = readSrc("components/chat/MessageCopyButton.tsx");
    expect(source).toContain("MessageCopyButton");
  });

  it("agent group card exists", () => {
    expect(fileExists("components/chat/AgentGroupCard.tsx")).toBe(true);
    const source = readSrc("components/chat/AgentGroupCard.tsx");
    expect(source).toContain("AgentGroupCard");
  });

  it("composer attachments popover exists", () => {
    expect(fileExists("components/chat/ComposerAttachmentsPopover.tsx")).toBe(true);
    const source = readSrc("components/chat/ComposerAttachmentsPopover.tsx");
    expect(source).toContain("ComposerAttachmentsPopover");
  });

  it("directory picker popover exists", () => {
    expect(fileExists("components/chat/DirectoryPickerPopover.tsx")).toBe(true);
    const source = readSrc("components/chat/DirectoryPickerPopover.tsx");
    expect(source).toContain("DirectoryPickerPopover");
  });

  it("fullscreen state handling exists", () => {
    const source = readSrc("components/Sidebar.tsx");
    expect(source).toContain("onFullscreenChange");
  });

  it("inline user message editing exists", () => {
    const source = readSrc("components/chat/MessagesTimeline.tsx");
    expect(source).toContain("editingUserMessage");
  });

  it("jira task inline chip exists", () => {
    expect(fileExists("components/chat/JiraTaskInlineChip.tsx")).toBe(true);
  });

  it("jira settings section exists", () => {
    expect(fileExists("components/settings/JiraSettingsSection.tsx")).toBe(true);
  });

  it("no PostHog/telemetry imports in web app", () => {
    const files = fs.globSync("**/*.{ts,tsx}", {
      cwd: SRC_DIR,
      exclude: (p) => p.includes("node_modules") || p.includes(".test.") || p.includes(".browser."),
    });
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(SRC_DIR, file), "utf-8");
      expect(content, `PostHog found in ${file}`).not.toMatch(/from\s+["']posthog/);
    }
  });

  it("no upstream branding references in key source files", () => {
    const keyFiles = ["store.ts", "session-logic.ts", "types.ts"];
    for (const file of keyFiles) {
      if (!fileExists(file)) continue;
      const content = readSrc(file);
      expect(content, `@t3tools found in ${file}`).not.toContain("@t3tools");
      expect(content, `t3code found in ${file}`).not.toMatch(/\bt3code\b/i);
    }
  });

  it("MarCode branding in package imports", () => {
    const storeSource = readSrc("store.ts");
    expect(storeSource).toContain("@marcode/contracts");
  });

  it("streaming shell + thread subscription pattern", () => {
    const storeSource = readSrc("store.ts");
    expect(storeSource).toContain("threadShellById");
    expect(storeSource).toContain("syncServerShellSnapshot");
    expect(storeSource).toContain("applyShellEvent");
    expect(storeSource).toContain("syncServerThreadDetail");
  });

  it("bootstrap uses subscribeShell stream, not RPC calls", () => {
    const connectionSource = readSrc("environments/runtime/connection.ts");
    expect(connectionSource).toContain("subscribeShell");
    expect(connectionSource).not.toContain("getListingSnapshot");
    expect(connectionSource).not.toContain("getSnapshot(");
  });

  it("service handler maps to syncShellSnapshot + applyShellEvent", () => {
    const serviceSource = readSrc("environments/runtime/service.ts");
    const handlerBody = serviceSource.slice(
      serviceSource.indexOf("createEnvironmentConnectionHandlers"),
    );
    expect(handlerBody).toContain("syncShellSnapshot");
    expect(handlerBody).toContain("applyShellEvent");
  });

  it("route retains thread detail subscription on mount", () => {
    const routeSource = readSrc("routes/_chat.$environmentId.$threadId.tsx");
    expect(routeSource).toContain("retainThreadDetailSubscription");
    expect(routeSource).not.toContain("needsHydration");
    expect(routeSource).not.toContain("hydrateThread");
    expect(routeSource).not.toContain("MAX_HYDRATION_RETRIES");
  });
});
