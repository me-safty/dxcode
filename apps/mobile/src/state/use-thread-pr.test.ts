import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { presentThreadPr } from "./thread-pr-presentation";

const pullRequest: NonNullable<VcsStatusResult["pr"]> = {
  number: 3774,
  title: "Desktop-style pull request indicator",
  url: "https://github.com/t3tools/t3code/pull/3774",
  baseRef: "main",
  headRef: "codex/desktop-style-pr-indicator",
  state: "merged",
};

describe("presentThreadPr", () => {
  it("uses the compact desktop-style pull request number label", () => {
    expect(presentThreadPr(pullRequest)).toMatchObject({
      label: "#3774",
      textClassName: "text-violet-600 dark:text-violet-400",
    });
  });
});
