import { describe, expect, it } from "vitest";

import { parseFolderFromArgv } from "./projectPathArg.ts";

describe("parseFolderFromArgv", () => {
  const electronBinary = "/Applications/T3 Code.app";
  const knownDirectories = new Set([
    "/tmp/project-sample",
    "/tmp/project-other",
    "/tmp/project-parent/child",
    "/tmp/project-parent",
  ]);
  const options = {
    realpath: (input: string) => input,
    isDirectory: (candidate: string) => knownDirectories.has(candidate),
  };

  it("returns null for empty argv", () => {
    expect(parseFolderFromArgv([], options)).toBeNull();
  });

  it("picks up a bare positional directory after the electron binary", () => {
    expect(parseFolderFromArgv([electronBinary, "/tmp/project-sample"], options)).toBe(
      "/tmp/project-sample",
    );
  });

  it("skips Chromium switches that would otherwise land before the path", () => {
    expect(
      parseFolderFromArgv(
        [electronBinary, "--allow-file-access-from-files", "/tmp/project-sample"],
        options,
      ),
    ).toBe("/tmp/project-sample");
  });

  it("prefers the --t3-project-path= atomic form over any positional", () => {
    expect(
      parseFolderFromArgv(
        [electronBinary, "/tmp/project-other", "--t3-project-path=/tmp/project-sample"],
        options,
      ),
    ).toBe("/tmp/project-sample");
  });

  it("ignores --t3-project-path= with an empty value and falls back to positional", () => {
    expect(
      parseFolderFromArgv([electronBinary, "--t3-project-path=", "/tmp/project-sample"], options),
    ).toBe("/tmp/project-sample");
  });

  it("resolves `..` via realpath before checking isDirectory", () => {
    const resolvingRealpath = (input: string) =>
      input === "/tmp/project-parent/child/.." ? "/tmp/project-parent" : input;
    expect(
      parseFolderFromArgv([electronBinary, "/tmp/project-parent/child/.."], {
        ...options,
        realpath: resolvingRealpath,
      }),
    ).toBe("/tmp/project-parent");
  });

  it("skips tokens whose realpath throws (non-existent paths)", () => {
    const failingRealpath = (input: string) => {
      if (input === "/does/not/exist") throw new Error("ENOENT");
      return input;
    };
    expect(
      parseFolderFromArgv([electronBinary, "/does/not/exist", "/tmp/project-sample"], {
        ...options,
        realpath: failingRealpath,
      }),
    ).toBe("/tmp/project-sample");
  });

  it("skips tokens that resolve to a file, not a directory", () => {
    expect(
      parseFolderFromArgv(
        [electronBinary, "/tmp/project-sample.txt", "/tmp/project-sample"],
        options,
      ),
    ).toBe("/tmp/project-sample");
  });

  it("returns null when no argv token resolves to a directory", () => {
    expect(
      parseFolderFromArgv(
        [electronBinary, "--allow-file-access-from-files", "--some-switch=value"],
        options,
      ),
    ).toBeNull();
  });

  it("resolves a relative positional `.` against the provided cwd", () => {
    expect(
      parseFolderFromArgv([electronBinary, "."], {
        ...options,
        cwd: "/tmp/project-sample",
      }),
    ).toBe("/tmp/project-sample");
  });

  it("resolves a relative positional `./child` against the provided cwd", () => {
    expect(
      parseFolderFromArgv([electronBinary, "./child"], {
        ...options,
        cwd: "/tmp/project-parent",
      }),
    ).toBe("/tmp/project-parent/child");
  });

  it("resolves --t3-project-path= with a relative value against the provided cwd", () => {
    const knownWithTmpSample = new Set([...knownDirectories, "/tmp/sample"]);
    expect(
      parseFolderFromArgv([electronBinary, "--t3-project-path=./sample"], {
        realpath: (input: string) => input,
        isDirectory: (candidate: string) => knownWithTmpSample.has(candidate),
        cwd: "/tmp",
      }),
    ).toBe("/tmp/sample");
  });

  it("leaves absolute positional paths unchanged when cwd is set", () => {
    expect(
      parseFolderFromArgv([electronBinary, "/tmp/project-sample"], {
        ...options,
        cwd: "/some/other/cwd",
      }),
    ).toBe("/tmp/project-sample");
  });
});
