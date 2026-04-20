import { describe, expect, it } from "vitest";
import type { ProviderRuntimeEvent, ServerProvider } from "@t3tools/contracts";

import {
  mergeProviderRuntimeEventIntoSnapshot,
  normalizeProviderUsageSnapshot,
} from "./providerUsage.ts";

const CHECKED_AT = "2026-04-20T00:00:00.000Z";

function makeProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: {
      status: "authenticated",
      type: "chatgpt",
      label: "ChatGPT Pro Subscription",
    },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("normalizeProviderUsageSnapshot", () => {
  it("normalizes codex rate-limit snapshots into canonical usage windows", () => {
    const snapshot = normalizeProviderUsageSnapshot(
      {
        limitName: "ChatGPT",
        primary: {
          usedPercent: 72,
          resetsAt: 1_776_628_800,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 91,
          resetsAt: 1_777_233_600,
          windowDurationMins: 10_080,
        },
      },
      CHECKED_AT,
    );

    expect(snapshot.state).toBe("available");
    expect(snapshot.checkedAt).toBe(CHECKED_AT);
    expect(snapshot.windows).toEqual([
      {
        id: "5h",
        label: "5h",
        percentUsed: 72,
        resetsAt: "2026-04-19T20:00:00.000Z",
        level: "warning",
        exhausted: false,
      },
      {
        id: "7d",
        label: "7d",
        percentUsed: 91,
        resetsAt: "2026-04-26T20:00:00.000Z",
        level: "critical",
        exhausted: false,
      },
    ]);
  });

  it("normalizes claude subscription payloads and converts utilization ratios into percentages", () => {
    const snapshot = normalizeProviderUsageSnapshot(
      {
        rate_limit_info: {
          status: "allowed_warning",
          rateLimitType: "seven_day_opus",
          resetsAt: 1_777_233_600,
          utilization: 0.92,
        },
      },
      CHECKED_AT,
    );

    expect(snapshot.state).toBe("available");
    expect(snapshot.windows).toEqual([
      {
        id: "7d-opus",
        label: "7d Opus",
        percentUsed: 92,
        resetsAt: "2026-04-26T20:00:00.000Z",
        level: "critical",
        exhausted: false,
      },
    ]);
  });

  it("returns syncing snapshots when providers report an in-flight state without windows", () => {
    const snapshot = normalizeProviderUsageSnapshot(
      {
        status: "syncing",
        message: "Waiting for provider usage data.",
      },
      CHECKED_AT,
    );

    expect(snapshot).toEqual({
      state: "syncing",
      checkedAt: CHECKED_AT,
      windows: [],
      message: "Waiting for provider usage data.",
    });
  });
});

describe("mergeProviderRuntimeEventIntoSnapshot", () => {
  it("merges account.rate-limits.updated events into provider usage snapshots", () => {
    const provider = makeProvider();
    const event = {
      eventId: "event-1" as never,
      provider: "codex",
      threadId: "thread-1" as never,
      createdAt: CHECKED_AT,
      type: "account.rate-limits.updated",
      payload: {
        rateLimits: {
          primary: {
            usedPercent: 72,
            resetsAt: 1_776_628_800,
            windowDurationMins: 300,
          },
        },
      },
    } satisfies ProviderRuntimeEvent;

    const merged = mergeProviderRuntimeEventIntoSnapshot(provider, event);

    expect(merged.usage).toEqual({
      state: "available",
      checkedAt: CHECKED_AT,
      windows: [
        {
          id: "5h",
          label: "5h",
          percentUsed: 72,
          resetsAt: "2026-04-19T20:00:00.000Z",
          level: "warning",
          exhausted: false,
        },
      ],
    });
  });

  it("clears stale codex usage when account.updated switches to api key auth", () => {
    const provider = makeProvider({
      usage: {
        state: "available",
        checkedAt: CHECKED_AT,
        windows: [
          {
            id: "5h",
            label: "5h",
            percentUsed: 84,
            resetsAt: "2026-04-20T00:00:00.000Z",
            level: "warning",
            exhausted: false,
          },
        ],
      },
    });
    const event = {
      eventId: "event-2" as never,
      provider: "codex",
      threadId: "thread-1" as never,
      createdAt: CHECKED_AT,
      type: "account.updated",
      payload: {
        account: {
          authMode: "apikey",
          planType: "pro",
        },
      },
    } satisfies ProviderRuntimeEvent;

    const merged = mergeProviderRuntimeEventIntoSnapshot(provider, event);

    expect(merged.usage).toBeUndefined();
    expect(merged.auth.type).toBe("apiKey");
    expect(merged.auth.label).toBe("OpenAI API Key");
  });
});
