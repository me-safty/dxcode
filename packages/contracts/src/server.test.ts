import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerProvider } from "./server.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding legacy snapshots", () => {
    const parsed = decodeServerProvider({
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
  });

  it("decodes normalized provider usage snapshots", () => {
    const parsed = decodeServerProvider({
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
        label: "ChatGPT Pro Subscription",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      usage: {
        state: "available",
        checkedAt: "2026-04-10T00:00:00.000Z",
        windows: [
          {
            id: "5h",
            label: "5h",
            percentUsed: 72,
            resetsAt: "2026-04-10T05:00:00.000Z",
            level: "warning",
            exhausted: false,
          },
        ],
      },
      models: [],
    });

    expect(parsed.usage).toEqual({
      state: "available",
      checkedAt: "2026-04-10T00:00:00.000Z",
      windows: [
        {
          id: "5h",
          label: "5h",
          percentUsed: 72,
          resetsAt: "2026-04-10T05:00:00.000Z",
          level: "warning",
          exhausted: false,
        },
      ],
    });
  });
});
