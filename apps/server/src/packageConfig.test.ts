import { describe, expect, it } from "vite-plus/test";

import { shouldBundleCliDependency } from "../vite.config.ts";

describe("server package config", () => {
  it("bundles CLI dependencies that rely on workspace-only export patches", () => {
    expect(shouldBundleCliDependency("@pierre/diffs")).toBe(true);
    expect(shouldBundleCliDependency("@pierre/diffs/utils/parsePatchFiles")).toBe(true);
  });

  it("keeps normal third-party dependencies external", () => {
    expect(shouldBundleCliDependency("effect")).toBe(false);
    expect(shouldBundleCliDependency("node-pty")).toBe(false);
  });
});
