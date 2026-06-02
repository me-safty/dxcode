import { describe, expect, it } from "vitest";

import { buildSourceControlTree, sourceControlFileName } from "./sourceControlTree";

describe("sourceControlTree", () => {
  it("uses the last non-empty path segment for trailing-slash file paths", () => {
    expect(sourceControlFileName("public/images/")).toBe("images");
    expect(sourceControlFileName("public\\images\\")).toBe("images");
  });

  it("does not render blank file labels for trailing-slash status paths", () => {
    const tree = buildSourceControlTree([
      {
        path: "public/images/",
        status: "untracked",
        insertions: 0,
        deletions: 0,
      },
    ]);

    const publicNode = tree[0];
    expect(publicNode?.type).toBe("dir");
    if (publicNode?.type !== "dir") {
      throw new Error("Expected public directory");
    }

    const imageNode = publicNode.children[0];
    expect(imageNode).toMatchObject({
      type: "file",
      path: "public/images/",
      name: "images",
    });
  });
});
