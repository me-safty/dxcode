import { describe, expect, it } from "vite-plus/test";

import {
  applyWslEnvironmentConfiguration,
  parseWslUncPath,
  resolveWslProjectSelection,
} from "./wslPaths";

describe("parseWslUncPath", () => {
  it("parses wsl.localhost UNC paths into distro and POSIX path", () => {
    expect(parseWslUncPath("\\\\wsl.localhost\\Ubuntu-22.04\\home\\josh\\repo")).toEqual({
      distro: "Ubuntu-22.04",
      linuxPath: "/home/josh/repo",
    });
  });

  it("parses wsl$ UNC roots as distro root", () => {
    expect(parseWslUncPath("\\\\wsl$\\Debian")).toEqual({
      distro: "Debian",
      linuxPath: "/",
    });
  });

  it("rejects non-WSL paths and invalid distro names", () => {
    expect(parseWslUncPath("C:\\Users\\Josh\\repo")).toBeNull();
    expect(parseWslUncPath("\\\\wsl.localhost\\bad!name\\home")).toBeNull();
  });
});

describe("resolveWslProjectSelection", () => {
  it("routes a UNC path to the matching WSL backend", () => {
    expect(
      resolveWslProjectSelection("\\\\wsl.localhost\\Ubuntu\\home\\theo\\repo", [
        { environmentId: "env-debian", backendId: "wsl:Debian" },
        { environmentId: "env-ubuntu", backendId: "wsl:Ubuntu" },
      ]),
    ).toEqual({
      distro: "Ubuntu",
      environmentId: "env-ubuntu",
      linuxPath: "/home/theo/repo",
    });
  });

  it("does not route to the only WSL backend when its distro is unknown", () => {
    expect(
      resolveWslProjectSelection("\\\\wsl.localhost\\Ubuntu\\home\\theo\\repo", [
        { environmentId: "env-wsl", backendId: "wsl:default" },
      ]),
    ).toBeNull();
  });

  it("does not route to a sole WSL backend for a different distro", () => {
    expect(
      resolveWslProjectSelection("\\\\wsl.localhost\\Debian\\home\\theo\\repo", [
        { environmentId: "env-ubuntu", backendId: "wsl:Ubuntu" },
      ]),
    ).toBeNull();
  });

  it("does not guess when multiple WSL backends fail to match", () => {
    expect(
      resolveWslProjectSelection("\\\\wsl.localhost\\Fedora\\home\\theo\\repo", [
        { environmentId: "env-debian", backendId: "wsl:Debian" },
        { environmentId: "env-ubuntu", backendId: "wsl:Ubuntu" },
      ]),
    ).toBeNull();
  });
});

describe("applyWslEnvironmentConfiguration", () => {
  const ubuntuConfiguration = {
    enabled: true,
    wslOnly: false,
    distro: null,
    distros: [
      { name: "Debian", isDefault: false },
      { name: "Ubuntu", isDefault: true },
    ],
  };

  it("resolves a default-distro backend to its installed distro", () => {
    expect(
      applyWslEnvironmentConfiguration(
        [{ environmentId: "env-wsl", backendId: "wsl:default" }],
        "env-primary",
        ubuntuConfiguration,
      ),
    ).toEqual([{ environmentId: "env-wsl", backendId: "wsl:Ubuntu" }]);
  });

  it("represents the primary environment as WSL in WSL-only mode", () => {
    expect(
      applyWslEnvironmentConfiguration([], "env-primary", {
        ...ubuntuConfiguration,
        wslOnly: true,
      }),
    ).toEqual([{ environmentId: "env-primary", backendId: "wsl:Ubuntu" }]);
  });

  it("does not represent the primary environment for a missing configured distro", () => {
    expect(
      applyWslEnvironmentConfiguration([], "env-primary", {
        ...ubuntuConfiguration,
        wslOnly: true,
        distro: "Fedora",
      }),
    ).toEqual([]);
  });
});
