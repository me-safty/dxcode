import { describe, expect, it } from "vitest";

import {
  compareDesktopVersions,
  doesVersionMatchDesktopUpdateChannel,
  isDesktopVersionOlderThanCurrent,
  isNightlyDesktopVersion,
  resolveDefaultDesktopUpdateChannel,
  selectBestDesktopUpdateCandidate,
} from "./updateChannels.ts";

describe("isNightlyDesktopVersion", () => {
  it("detects packaged nightly versions", () => {
    expect(isNightlyDesktopVersion("0.0.17-nightly.20260415.1")).toBe(true);
  });

  it("does not flag stable versions as nightly", () => {
    expect(isNightlyDesktopVersion("0.0.17")).toBe(false);
  });
});

describe("resolveDefaultDesktopUpdateChannel", () => {
  it("defaults stable builds to latest", () => {
    expect(resolveDefaultDesktopUpdateChannel("0.0.17")).toBe("latest");
  });

  it("defaults nightly builds to nightly", () => {
    expect(resolveDefaultDesktopUpdateChannel("0.0.17-nightly.20260415.1")).toBe("nightly");
  });
});

describe("doesVersionMatchDesktopUpdateChannel", () => {
  it("accepts nightly releases on the nightly channel", () => {
    expect(doesVersionMatchDesktopUpdateChannel("0.0.17-nightly.20260416.1", "nightly")).toBe(true);
  });

  it("rejects stable releases on the nightly channel", () => {
    expect(doesVersionMatchDesktopUpdateChannel("0.0.17", "nightly")).toBe(false);
  });

  it("rejects nightly releases on the stable channel", () => {
    expect(doesVersionMatchDesktopUpdateChannel("0.0.17-nightly.20260416.1", "latest")).toBe(false);
  });
});

describe("compareDesktopVersions", () => {
  it("treats stable as newer than nightly for the same base version", () => {
    expect(compareDesktopVersions("0.0.17", "0.0.17-nightly.20260416.1")).toBe(1);
  });

  it("allows the next nightly base to outrank the current stable", () => {
    expect(compareDesktopVersions("0.0.18-nightly.20260416.1", "0.0.17")).toBe(1);
  });

  it("orders nightly builds by date and run number", () => {
    expect(compareDesktopVersions("0.0.18-nightly.20260416.2", "0.0.18-nightly.20260416.1")).toBe(
      1,
    );
    expect(compareDesktopVersions("0.0.18-nightly.20260415.9", "0.0.18-nightly.20260416.1")).toBe(
      -1,
    );
  });

  it("returns null for unsupported versions", () => {
    expect(compareDesktopVersions("dev", "0.0.17")).toBeNull();
  });
});

describe("isDesktopVersionOlderThanCurrent", () => {
  it("detects an older nightly candidate", () => {
    expect(isDesktopVersionOlderThanCurrent("0.0.17-nightly.20260416.1", "0.0.17")).toBe(true);
  });

  it("keeps newer nightly candidates actionable", () => {
    expect(isDesktopVersionOlderThanCurrent("0.0.18-nightly.20260416.1", "0.0.17")).toBe(false);
  });
});

describe("selectBestDesktopUpdateCandidate", () => {
  it("picks stable when it outranks the nightly candidate", () => {
    expect(
      selectBestDesktopUpdateCandidate(
        [
          { channel: "latest", version: "0.0.20" },
          { channel: "nightly", version: "0.0.19-nightly.20260417.4" },
        ],
        "0.0.19-nightly.20260417.3",
      ),
    ).toEqual({ channel: "latest", version: "0.0.20" });
  });

  it("picks nightly when it outranks the stable candidate", () => {
    expect(
      selectBestDesktopUpdateCandidate(
        [
          { channel: "latest", version: "0.0.20" },
          { channel: "nightly", version: "0.0.21-nightly.20260417.4" },
        ],
        "0.0.19-nightly.20260417.3",
      ),
    ).toEqual({ channel: "nightly", version: "0.0.21-nightly.20260417.4" });
  });

  it("ignores candidates that do not outrank the current version", () => {
    expect(
      selectBestDesktopUpdateCandidate(
        [
          { channel: "latest", version: "0.0.20" },
          { channel: "nightly", version: "0.0.21-nightly.20260417.4" },
        ],
        "0.0.21-nightly.20260417.5",
      ),
    ).toBeNull();
  });
});
