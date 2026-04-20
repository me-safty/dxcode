import { describe, expect, it } from "vitest";

import {
  formatProviderUsagePercent,
  formatProviderUsageResetAt,
  orderProviderUsageWindows,
  primaryProviderUsageWindow,
  shortProviderPlanLabel,
} from "./providerUsage";

describe("primaryProviderUsageWindow", () => {
  it("prefers the short-term usage window before longer windows", () => {
    const primary = primaryProviderUsageWindow([
      {
        id: "7d",
        label: "7d",
        percentUsed: 60,
        resetsAt: null,
        level: "normal",
        exhausted: false,
      },
      {
        id: "5h",
        label: "5h",
        percentUsed: 20,
        resetsAt: null,
        level: "normal",
        exhausted: false,
      },
    ]);

    expect(primary?.id).toBe("5h");
  });
});

describe("shortProviderPlanLabel", () => {
  it("compacts long subscription labels for sidebar display", () => {
    expect(shortProviderPlanLabel("ChatGPT Pro Subscription")).toBe("Pro");
    expect(shortProviderPlanLabel("Claude Max Subscription")).toBe("Max");
    expect(shortProviderPlanLabel("OpenAI API Key")).toBeNull();
  });
});

describe("formatProviderUsagePercent", () => {
  it("keeps one decimal place below ten percent and rounds larger values", () => {
    expect(formatProviderUsagePercent(9.4)).toBe("9.4%");
    expect(formatProviderUsagePercent(42)).toBe("42%");
    expect(formatProviderUsagePercent(null)).toBe("--");
  });
});

describe("formatProviderUsageResetAt", () => {
  it("formats short, hourly, and multi-day reset times relative to now", () => {
    const now = new Date("2026-04-20T00:00:00.000Z");

    expect(formatProviderUsageResetAt("2026-04-20T00:45:00.000Z", now)).toBe("45m");
    expect(formatProviderUsageResetAt("2026-04-20T01:30:00.000Z", now)).toBe("1h 30m");
    expect(formatProviderUsageResetAt("2026-04-22T04:00:00.000Z", now)).toBe("2d 4h");
    expect(formatProviderUsageResetAt("invalid", now)).toBeNull();
    expect(formatProviderUsageResetAt("2026-04-19T23:59:00.000Z", now)).toBeNull();
  });
});

describe("orderProviderUsageWindows", () => {
  it("orders sidebar windows as 5h, then 7d, then preserves the rest", () => {
    expect(
      orderProviderUsageWindows([
        {
          id: "overage",
          label: "Overage",
          percentUsed: null,
          resetsAt: null,
          level: "normal",
          exhausted: false,
        },
        {
          id: "7d",
          label: "7d",
          percentUsed: 60,
          resetsAt: null,
          level: "normal",
          exhausted: false,
        },
        {
          id: "5h",
          label: "5h",
          percentUsed: 20,
          resetsAt: null,
          level: "normal",
          exhausted: false,
        },
        {
          id: "7d-opus",
          label: "7d Opus",
          percentUsed: 80,
          resetsAt: null,
          level: "warning",
          exhausted: false,
        },
      ]).map((window) => window.id),
    ).toEqual(["5h", "7d", "overage", "7d-opus"]);
  });
});
