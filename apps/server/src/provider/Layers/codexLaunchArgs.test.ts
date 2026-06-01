import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { codexAppServerArgs } from "./CodexProvider.ts";

describe("codexAppServerArgs", () => {
  it("returns the app-server command for empty launch args", () => {
    assert.deepStrictEqual(codexAppServerArgs(""), ["app-server"]);
  });

  it("appends whitespace-split launch args after app-server", () => {
    assert.deepStrictEqual(codexAppServerArgs("--strict-config --enable foo"), [
      "app-server",
      "--strict-config",
      "--enable",
      "foo",
    ]);
  });
});
