import { describe, expect, it, vi } from "vitest";

import { getLinuxWindowControlsLayout } from "./linuxWindowControls";

describe("getLinuxWindowControlsLayout", () => {
  it("reads KDE button placement from kwinrc", () => {
    const layout = getLinuxWindowControlsLayout({
      existsSync: vi.fn().mockReturnValue(true),
      homeDir: "/home/tester",
      readFileSync: vi
        .fn()
        .mockReturnValue("[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nButtonsOnRight=M\n"),
      spawnSync: vi.fn(),
    });

    expect(layout).toEqual({
      left: ["close", "minimize", "maximize"],
      right: [],
    });
  });

  it("falls back to GNOME button placement when KDE config is unavailable", () => {
    const layout = getLinuxWindowControlsLayout({
      existsSync: vi.fn().mockReturnValue(false),
      homeDir: "/home/tester",
      readFileSync: vi.fn(),
      spawnSync: vi.fn().mockReturnValue({
        status: 0,
        stdout: "'close,minimize:maximize'\n",
      }),
    });

    expect(layout).toEqual({
      left: ["close", "minimize"],
      right: ["maximize"],
    });
  });

  it("falls back when kwinrc exists but does not define button placement", () => {
    const layout = getLinuxWindowControlsLayout({
      existsSync: vi.fn().mockReturnValue(true),
      homeDir: "/home/tester",
      readFileSync: vi.fn().mockReturnValue("[org.kde.kdecoration2]\n"),
      spawnSync: vi.fn().mockReturnValue({
        status: 0,
        stdout: "'close,minimize:maximize'\n",
      }),
    });

    expect(layout).toEqual({
      left: ["close", "minimize"],
      right: ["maximize"],
    });
  });

  it("falls back to GNOME when reading kwinrc throws", () => {
    const layout = getLinuxWindowControlsLayout({
      existsSync: vi.fn().mockReturnValue(true),
      homeDir: "/home/tester",
      readFileSync: vi.fn().mockImplementation(() => {
        throw new Error("permission denied");
      }),
      spawnSync: vi.fn().mockReturnValue({
        status: 0,
        stdout: "'close,minimize:maximize'\n",
      }),
    });

    expect(layout).toEqual({
      left: ["close", "minimize"],
      right: ["maximize"],
    });
  });

  it("uses the default right-side controls when no desktop layout is available", () => {
    const layout = getLinuxWindowControlsLayout({
      existsSync: vi.fn().mockReturnValue(false),
      homeDir: "/home/tester",
      readFileSync: vi.fn(),
      spawnSync: vi.fn().mockReturnValue({
        status: 1,
        stdout: "",
      }),
    });

    expect(layout).toEqual({
      left: [],
      right: ["minimize", "maximize", "close"],
    });
  });
});
