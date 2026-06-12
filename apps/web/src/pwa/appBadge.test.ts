import { describe, expect, it, vi } from "vitest";

import { canUseAppBadge, writeAppBadgeCount } from "./appBadge";

describe("canUseAppBadge", () => {
  it("requires setAppBadge support", () => {
    expect(canUseAppBadge({ setAppBadge: vi.fn() })).toBe(true);
    expect(canUseAppBadge({ clearAppBadge: vi.fn() })).toBe(false);
    expect(canUseAppBadge(null)).toBe(false);
  });
});

describe("writeAppBadgeCount", () => {
  it("sets a positive badge count", async () => {
    const navigatorLike = {
      setAppBadge: vi.fn(async () => {}),
      clearAppBadge: vi.fn(async () => {}),
    };

    await expect(writeAppBadgeCount(3, navigatorLike)).resolves.toBe(true);

    expect(navigatorLike.setAppBadge).toHaveBeenCalledWith(3);
    expect(navigatorLike.clearAppBadge).not.toHaveBeenCalled();
  });

  it("clears the badge when count is zero", async () => {
    const navigatorLike = {
      setAppBadge: vi.fn(async () => {}),
      clearAppBadge: vi.fn(async () => {}),
    };

    await expect(writeAppBadgeCount(0, navigatorLike)).resolves.toBe(true);

    expect(navigatorLike.clearAppBadge).toHaveBeenCalledTimes(1);
    expect(navigatorLike.setAppBadge).not.toHaveBeenCalled();
  });

  it("falls back to setAppBadge(0) when clearAppBadge is unavailable", async () => {
    const navigatorLike = {
      setAppBadge: vi.fn(async () => {}),
    };

    await expect(writeAppBadgeCount(0, navigatorLike)).resolves.toBe(true);

    expect(navigatorLike.setAppBadge).toHaveBeenCalledWith(0);
  });

  it("normalizes invalid and fractional counts", async () => {
    const navigatorLike = {
      setAppBadge: vi.fn(async () => {}),
      clearAppBadge: vi.fn(async () => {}),
    };

    await expect(writeAppBadgeCount(2.8, navigatorLike)).resolves.toBe(true);
    await expect(writeAppBadgeCount(Number.NaN, navigatorLike)).resolves.toBe(true);

    expect(navigatorLike.setAppBadge).toHaveBeenCalledWith(2);
    expect(navigatorLike.clearAppBadge).toHaveBeenCalledTimes(1);
  });
});
