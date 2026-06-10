import { describe, expect, it } from "vitest";

import { nextOfflineBannerMode } from "./OfflineBanner.logic";

describe("nextOfflineBannerMode", () => {
  it("shows the offline banner whenever the device is offline", () => {
    expect(nextOfflineBannerMode("hidden", false)).toBe("offline");
    expect(nextOfflineBannerMode("offline", false)).toBe("offline");
    expect(nextOfflineBannerMode("reconnected", false)).toBe("offline");
  });

  it("enters the reconnected state only when recovering from offline", () => {
    expect(nextOfflineBannerMode("offline", true)).toBe("reconnected");
  });

  it("never flashes reconnected on a fresh load or while already online", () => {
    expect(nextOfflineBannerMode("hidden", true)).toBe("hidden");
    expect(nextOfflineBannerMode("reconnected", true)).toBe("reconnected");
  });
});
