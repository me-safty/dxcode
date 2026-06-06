import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forceRefreshApp,
  shouldShowDownloadableDiagnostics,
  shouldShowOpenInPicker,
} from "./ChatHeader";

const originalWindow = globalThis.window;

function installWindowStub(input: {
  readonly hasDesktopBridge?: boolean;
  readonly forceReload?: () => Promise<void>;
  readonly reload?: () => void;
}) {
  const desktopBridge = input.forceReload
    ? {
        forceReload: input.forceReload,
      }
    : input.hasDesktopBridge
      ? {}
      : undefined;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ...(desktopBridge ? { desktopBridge } : {}),
      location: {
        reload: input.reload ?? vi.fn(),
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("shouldShowOpenInPicker", () => {
  const primaryEnvironmentId = EnvironmentId.make("environment-primary");

  it("shows the picker for projects in the primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(true);
  });

  it("hides the picker when hosted static mode has no primary environment", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId: null,
      }),
    ).toBe(false);
  });

  it("hides the picker for remote environments", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "codething-mvp",
        activeThreadEnvironmentId: EnvironmentId.make("environment-remote"),
        primaryEnvironmentId,
      }),
    ).toBe(false);
  });

  it("hides the picker when there is no active project", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        activeThreadEnvironmentId: primaryEnvironmentId,
        primaryEnvironmentId,
      }),
    ).toBe(false);
  });
});

describe("shouldShowDownloadableDiagnostics", () => {
  it("shows downloadable diagnostics when the desktop bridge is available", () => {
    installWindowStub({ hasDesktopBridge: true });

    expect(shouldShowDownloadableDiagnostics()).toBe(true);
  });

  it("hides downloadable diagnostics in ordinary browser sessions", () => {
    installWindowStub({});

    expect(shouldShowDownloadableDiagnostics()).toBe(false);
  });
});

describe("forceRefreshApp", () => {
  it("uses the desktop force reload bridge when available", () => {
    const forceReload = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    installWindowStub({ forceReload, reload });

    forceRefreshApp();

    expect(forceReload).toHaveBeenCalledWith();
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to browser reload without the desktop bridge", () => {
    const reload = vi.fn();
    installWindowStub({ reload });

    forceRefreshApp();

    expect(reload).toHaveBeenCalledWith();
  });

  it("falls back to browser reload when desktop force reload fails", async () => {
    const forceReload = vi.fn().mockRejectedValue(new Error("ipc failed"));
    const reload = vi.fn();
    installWindowStub({ forceReload, reload });

    forceRefreshApp();
    await Promise.resolve();

    expect(forceReload).toHaveBeenCalledWith();
    expect(reload).toHaveBeenCalledWith();
  });
});
