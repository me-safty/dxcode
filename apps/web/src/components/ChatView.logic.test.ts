import { ThreadId, type ServerProviderStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildExpiredTerminalContextToastCopy,
  deriveComposerSendState,
  resolveProviderHealthBannerStatus,
} from "./ChatView.logic";

function makeProviderStatus(overrides: Partial<ServerProviderStatus> = {}): ServerProviderStatus {
  return {
    provider: "codex",
    status: "error",
    available: false,
    authStatus: "unknown",
    checkedAt: "2026-03-20T00:00:00.000Z",
    message: "Codex CLI (`codex`) is not installed or not on PATH.",
    ...overrides,
  };
}

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("resolveProviderHealthBannerStatus", () => {
  it("keeps the server status when no local Codex overrides are configured", () => {
    const status = makeProviderStatus();

    expect(resolveProviderHealthBannerStatus(status, false)).toEqual(status);
  });

  it("hides Codex status when a custom binary path is configured", () => {
    expect(resolveProviderHealthBannerStatus(makeProviderStatus(), true)).toBeNull();
  });

  it("hides Codex status when a custom CODEX_HOME is configured", () => {
    expect(
      resolveProviderHealthBannerStatus(
        makeProviderStatus({ status: "warning", available: true }),
        true,
      ),
    ).toBeNull();
  });

  it("keeps non-Codex provider status visible even with Codex overrides", () => {
    const status = makeProviderStatus({
      provider: "claudeAgent",
      message: "Claude Agent CLI (`claude`) is not installed or not on PATH.",
    });

    expect(resolveProviderHealthBannerStatus(status, true)).toEqual(status);
  });
});
