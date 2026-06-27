import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId, PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  desktopLocalBackendId,
  desktopLocalConnectionId,
  isDesktopLocalConnectionTarget,
  readDesktopSecondaryBootstrapsResult,
} from "./desktopLocal";

describe("desktop local connection identity", () => {
  it("preserves the desktop backend instance id", () => {
    const target = new BearerConnectionTarget({
      connectionId: desktopLocalConnectionId("wsl:Ubuntu"),
      environmentId: EnvironmentId.make("environment-wsl"),
      label: "WSL (Ubuntu)",
    });

    expect(isDesktopLocalConnectionTarget(target)).toBe(true);
    expect(desktopLocalBackendId(target)).toBe("wsl:Ubuntu");
  });

  it("does not classify the primary environment as desktop-local", () => {
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("environment-primary"),
      httpBaseUrl: "http://127.0.0.1:3773",
      label: "This device",
      wsBaseUrl: "ws://127.0.0.1:3773",
    });

    expect(isDesktopLocalConnectionTarget(target)).toBe(false);
    expect(desktopLocalBackendId(target)).toBeNull();
  });
});

describe("desktop local topology reads", () => {
  it("distinguishes a successful empty topology from a read failure", () => {
    expect(
      readDesktopSecondaryBootstrapsResult({ getLocalEnvironmentBootstraps: () => [] }),
    ).toEqual({ _tag: "Success", bootstraps: [] });

    const cause = new Error("IPC unavailable");
    expect(
      readDesktopSecondaryBootstrapsResult({
        getLocalEnvironmentBootstraps: () => {
          throw cause;
        },
      }),
    ).toEqual({ _tag: "Failure", cause });
  });

  it("filters the primary bootstrap from successful topology reads", () => {
    const secondary = {
      id: "wsl:Ubuntu",
      label: "WSL: Ubuntu",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };

    expect(
      readDesktopSecondaryBootstrapsResult({
        getLocalEnvironmentBootstraps: () => [
          {
            ...secondary,
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: "Windows",
          },
          secondary,
        ],
      }),
    ).toEqual({ _tag: "Success", bootstraps: [secondary] });
  });
});
