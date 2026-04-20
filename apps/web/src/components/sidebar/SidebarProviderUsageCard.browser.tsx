import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { LocalApi, ServerProvider } from "@t3tools/contracts";

const { ensureLocalApiMock, useServerProvidersMock } = vi.hoisted(() => ({
  ensureLocalApiMock: vi.fn(),
  useServerProvidersMock: vi.fn(),
}));

vi.mock("../../localApi", () => ({
  ensureLocalApi: ensureLocalApiMock,
}));

vi.mock("../../rpc/serverState", () => ({
  useServerProviders: useServerProvidersMock,
}));

import { SidebarProviderUsageCard } from "./SidebarProviderUsageCard";

function mockLocalApi(refreshProviders: LocalApi["server"]["refreshProviders"]) {
  ensureLocalApiMock.mockReturnValue({
    server: {
      refreshProviders,
    },
  } as Pick<LocalApi, "server"> as LocalApi);
}

function createProviders(): ReadonlyArray<ServerProvider> {
  return [
    {
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
        label: "ChatGPT Pro Subscription",
      },
      checkedAt: "2026-04-20T00:00:00.000Z",
      usage: {
        state: "available",
        checkedAt: "2026-04-20T00:00:00.000Z",
        windows: [
          {
            id: "7d",
            label: "7d",
            percentUsed: 82,
            resetsAt: "2026-04-27T00:00:00.000Z",
            level: "warning",
            exhausted: false,
          },
          {
            id: "5h",
            label: "5h",
            percentUsed: 42,
            resetsAt: "2026-04-20T05:00:00.000Z",
            level: "normal",
            exhausted: false,
          },
        ],
      },
      models: [],
      slashCommands: [],
      skills: [],
    },
    {
      provider: "claudeAgent",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
        label: "Claude Max Subscription",
      },
      checkedAt: "2026-04-20T00:00:00.000Z",
      usage: {
        state: "available",
        checkedAt: "2026-04-20T00:00:00.000Z",
        windows: [
          {
            id: "7d-opus",
            label: "7d Opus",
            percentUsed: 88,
            resetsAt: "2026-04-27T00:00:00.000Z",
            level: "critical",
            exhausted: false,
          },
        ],
      },
      models: [],
      slashCommands: [],
      skills: [],
    },
  ];
}

async function mountCard() {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<SidebarProviderUsageCard />, { container: host });

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("SidebarProviderUsageCard", () => {
  it("renders both providers and orders windows as 5h then 7d", async () => {
    useServerProvidersMock.mockReturnValue(createProviders());
    mockLocalApi(vi.fn().mockResolvedValue({ providers: createProviders() }));

    const mounted = await mountCard();

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Usage limits");
        expect(document.body.textContent).toContain("Codex");
        expect(document.body.textContent).toContain("Claude");
      });

      const codexSection = document.querySelector<HTMLElement>(
        '[data-provider-usage-provider="codex"]',
      );
      expect(codexSection).not.toBeNull();
      const orderedIds = Array.from(
        codexSection!.querySelectorAll<HTMLElement>("[data-provider-usage-window]"),
      ).map((element) => element.dataset.providerUsageWindow);
      expect(orderedIds).toEqual(["5h", "7d"]);
      expect(document.body.textContent).toContain("Pro");
      expect(document.body.textContent).toContain("Max");
    } finally {
      await mounted.cleanup();
    }
  });

  it("calls server.refreshProviders from the refresh button", async () => {
    const refreshProviders = vi.fn().mockResolvedValue({ providers: createProviders() });
    useServerProvidersMock.mockReturnValue(createProviders());
    mockLocalApi(refreshProviders);

    const mounted = await mountCard();

    try {
      await page.getByRole("button", { name: "Refresh provider usage" }).click();
      expect(refreshProviders).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables the refresh button while a refresh is in flight", async () => {
    let resolveRefresh!: (value: { providers: ReadonlyArray<ServerProvider> }) => void;
    const refreshProviders = vi.fn(
      () =>
        new Promise<{ providers: ReadonlyArray<ServerProvider> }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    useServerProvidersMock.mockReturnValue(createProviders());
    mockLocalApi(refreshProviders);

    const mounted = await mountCard();

    try {
      const button = page.getByRole("button", { name: "Refresh provider usage" });
      await button.click();

      await vi.waitFor(() => {
        const element = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Refresh provider usage"]',
        );
        expect(element?.disabled).toBe(true);
      });

      resolveRefresh({ providers: createProviders() });

      await vi.waitFor(() => {
        const element = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Refresh provider usage"]',
        );
        expect(element?.disabled).toBe(false);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders syncing fallback copy when a provider is still refreshing usage", async () => {
    const providers = createProviders();
    useServerProvidersMock.mockReturnValue([
      {
        ...providers[0]!,
        usage: {
          state: "syncing",
          checkedAt: "2026-04-20T00:00:00.000Z",
          windows: [],
          message: "Syncing usage limits from Codex...",
        },
      },
    ]);
    mockLocalApi(vi.fn().mockResolvedValue({ providers }));

    const mounted = await mountCard();

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Syncing usage limits from Codex...");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders fallback copy for missing and unavailable usage", async () => {
    useServerProvidersMock.mockReturnValue([
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: {
          status: "authenticated",
        },
        checkedAt: "2026-04-20T00:00:00.000Z",
        message: "Usage data has not been reported yet.",
        models: [],
        slashCommands: [],
        skills: [],
      },
      {
        provider: "claudeAgent",
        enabled: true,
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: {
          status: "authenticated",
        },
        checkedAt: "2026-04-20T00:00:00.000Z",
        usage: {
          state: "unavailable",
          checkedAt: "2026-04-20T00:00:00.000Z",
          windows: [],
          message: "Usage is unavailable for this account.",
        },
        models: [],
        slashCommands: [],
        skills: [],
      },
    ]);
    mockLocalApi(vi.fn().mockResolvedValue({ providers: [] }));

    const mounted = await mountCard();

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Usage data has not been reported yet.");
        expect(document.body.textContent).toContain("Usage is unavailable for this account.");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
