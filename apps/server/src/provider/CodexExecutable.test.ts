import { describe, expect, it } from "vite-plus/test";

import { codexBinaryCandidates } from "./CodexExecutable.ts";

describe("codexBinaryCandidates", () => {
  it("falls back to the Codex Desktop bundled CLI on macOS", () => {
    expect(codexBinaryCandidates("codex", "darwin", "/Users/tester")).toEqual([
      "codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Users/tester/Applications/Codex.app/Contents/Resources/codex",
    ]);
  });

  it("does not replace an explicit binary path", () => {
    expect(codexBinaryCandidates("/custom/codex", "darwin", "/Users/tester")).toEqual([
      "/custom/codex",
    ]);
  });
});
