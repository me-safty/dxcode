import { describe, expect, it } from "vite-plus/test";

import { parsePorcelainPaths } from "./RepositoryReviewSource.ts";

describe("parsePorcelainPaths", () => {
  it("returns every changed path once, including both sides of a rename", () => {
    expect(
      parsePorcelainPaths(
        [" M src/a.ts", "?? src/new.ts", "R  src/new-name.ts", "src/old-name.ts", ""].join("\0"),
      ),
    ).toEqual(["src/a.ts", "src/new-name.ts", "src/new.ts", "src/old-name.ts"]);
  });
});
