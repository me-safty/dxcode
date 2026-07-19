import { describe, expect, it } from "vite-plus/test";

import {
  parseNameStatusPathGroups,
  parsePorcelainPathGroups,
  parsePorcelainPaths,
} from "./RepositoryReviewSource.ts";

describe("parsePorcelainPaths", () => {
  it("returns every changed path once, including both sides of a rename", () => {
    expect(
      parsePorcelainPaths(
        [" M src/a.ts", "?? src/new.ts", "R  src/new-name.ts", "src/old-name.ts", ""].join("\0"),
      ),
    ).toEqual(["src/a.ts", "src/new-name.ts", "src/new.ts", "src/old-name.ts"]);
  });

  it("keeps both sides of immutable rename entries in one path group", () => {
    expect(
      parseNameStatusPathGroups(["M", "src/a.ts", "R100", "old.ts", "new.ts", ""].join("\0")),
    ).toEqual([
      { paths: ["src/a.ts"], displayPath: "src/a.ts", isUntracked: false },
      { paths: ["old.ts", "new.ts"], displayPath: "new.ts", isUntracked: false },
    ]);
  });

  it("marks only porcelain ?? entries as untracked", () => {
    expect(parsePorcelainPathGroups([" M tracked.ts", "?? new.ts", ""].join("\0"))).toEqual([
      { paths: ["new.ts"], displayPath: "new.ts", isUntracked: true },
      { paths: ["tracked.ts"], displayPath: "tracked.ts", isUntracked: false },
    ]);
  });
});
