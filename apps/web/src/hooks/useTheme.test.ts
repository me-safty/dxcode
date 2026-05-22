import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function installThemeDom(theme: string | null, matchMedia?: Window["matchMedia"]) {
  const element = {
    name: "",
    setAttribute: vi.fn(),
  };
  const documentElement = {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
    },
    offsetHeight: 0,
    style: {},
  };
  const body = {
    style: {},
  };

  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => theme),
    setItem: vi.fn(),
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    body,
    createElement: vi.fn(() => element),
    documentElement,
    head: {
      append: vi.fn(),
    },
    querySelector: vi.fn(() => null),
  });
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({ backgroundColor: "rgb(1, 2, 3)" })),
  );
}

describe("useTheme module initialization", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("does not read matchMedia for explicit themes", async () => {
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as Window["matchMedia"];
    installThemeDom("dark", matchMedia);

    await import("./useTheme");

    expect(matchMedia).not.toHaveBeenCalled();
  });

  it("does not require matchMedia when an explicit theme is stored", async () => {
    installThemeDom("light");

    await expect(import("./useTheme")).resolves.toBeDefined();
  });
});
