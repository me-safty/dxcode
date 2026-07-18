import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  formatCommitTimestamp,
  formatElapsedDurationLabel,
  formatExpiresInLabel,
  formatRelativeTimeUntilLabel,
  formatShortTimestamp,
  getTimestampFormatOptions,
} from "./timestampFormat";

describe("getTimestampFormatOptions", () => {
  it("omits hour12 when locale formatting is requested", () => {
    expect(getTimestampFormatOptions("locale", true)).toEqual({
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  });

  it("builds a 12-hour formatter with seconds when requested", () => {
    expect(getTimestampFormatOptions("12-hour", true)).toEqual({
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  });

  it("builds a 24-hour formatter without seconds when requested", () => {
    expect(getTimestampFormatOptions("24-hour", false)).toEqual({
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
  });
});

describe("formatCommitTimestamp", () => {
  const localDate = (dayOffset: number, hour = 9, minute = 30) =>
    new Date(2026, 3, 7 + dayOffset, hour, minute).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 7, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the configured wall-clock time for commits made today", () => {
    const committedAt = localDate(0);
    expect(formatCommitTimestamp(committedAt, "24-hour")).toBe(
      formatShortTimestamp(committedAt, "24-hour"),
    );
  });

  it("uses calendar-day labels for recent commits", () => {
    expect(formatCommitTimestamp(localDate(-1), "locale")).toBe("yesterday");
    expect(formatCommitTimestamp(localDate(-2), "locale")).toBe("2 days ago");
    expect(formatCommitTimestamp(localDate(-6), "locale")).toBe("6 days ago");
  });

  it("groups older commits into weeks, months, and years", () => {
    expect(formatCommitTimestamp(localDate(-7), "locale")).toBe("last week");
    expect(formatCommitTimestamp(localDate(-14), "locale")).toBe("2 weeks ago");
    expect(formatCommitTimestamp(localDate(-28), "locale")).toBe("last month");
    expect(formatCommitTimestamp(localDate(-60), "locale")).toBe("2 months ago");
    expect(formatCommitTimestamp(localDate(-365), "locale")).toBe("last year");
    expect(formatCommitTimestamp(localDate(-730), "locale")).toBe("2 years ago");
  });

  it("returns an empty label for an invalid commit date", () => {
    expect(formatCommitTimestamp("not-a-date", "locale")).toBe("");
  });
});

describe("formatRelativeTimeUntilLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Expired when the instant is in the past", () => {
    expect(formatRelativeTimeUntilLabel("2026-04-07T11:59:00.000Z")).toBe("Expired");
  });

  it("formats seconds remaining", () => {
    expect(formatRelativeTimeUntilLabel("2026-04-07T12:00:45.000Z")).toBe("45s left");
  });

  it("formats minutes remaining", () => {
    expect(formatRelativeTimeUntilLabel("2026-04-07T12:15:00.000Z")).toBe("15m left");
  });

  it("formats hours remaining", () => {
    expect(formatRelativeTimeUntilLabel("2026-04-07T18:00:00.000Z")).toBe("6h left");
  });
});

describe("formatExpiresInLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Expired when the instant is in the past", () => {
    expect(formatExpiresInLabel("2026-04-07T11:59:00.000Z")).toBe("Expired");
  });

  it("uses sub-minute second count", () => {
    expect(formatExpiresInLabel("2026-04-07T12:00:45.000Z")).toBe("Expires in 45s");
  });

  it("uses minutes and seconds under one hour", () => {
    expect(formatExpiresInLabel("2026-04-07T12:04:12.000Z")).toBe("Expires in 4m 12s");
    expect(formatExpiresInLabel("2026-04-07T12:15:00.000Z")).toBe("Expires in 15m");
  });

  it("uses hours with minute and second remainder", () => {
    expect(formatExpiresInLabel("2026-04-07T14:02:03.000Z")).toBe("Expires in 2h 2m 3s");
    expect(formatExpiresInLabel("2026-04-07T18:00:00.000Z")).toBe("Expires in 6h");
  });
});

describe("formatElapsedDurationLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns just now when the instant is current or in the future", () => {
    expect(formatElapsedDurationLabel("2026-04-07T12:00:00.000Z")).toBe("just now");
    expect(formatElapsedDurationLabel("2026-04-07T12:01:00.000Z")).toBe("just now");
  });

  it("formats seconds, minutes, hours, and days", () => {
    expect(formatElapsedDurationLabel("2026-04-07T11:59:45.000Z")).toBe("15s");
    expect(formatElapsedDurationLabel("2026-04-07T11:45:00.000Z")).toBe("15m");
    expect(formatElapsedDurationLabel("2026-04-07T06:00:00.000Z")).toBe("6h");
    expect(formatElapsedDurationLabel("2026-04-03T12:00:00.000Z")).toBe("4d");
  });
});
