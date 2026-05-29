import { describe, expect, it } from "vitest";

import { resolveSidecarComposition } from "./sidecarComposition.js";

const BUNDLED_DEFAULT = {
  sections: [
    { sectionId: "quick-starts", visible: true, collapsed: false },
    { sectionId: "recent-conversations", visible: true, collapsed: false },
  ],
} as const;

describe("resolveSidecarComposition", () => {
  it("returns the bundled default order when no overrides are present", () => {
    expect(resolveSidecarComposition({ bundledDefault: BUNDLED_DEFAULT }).sections).toEqual([
      { sectionId: "quick-starts", visible: true, collapsed: false },
      { sectionId: "recent-conversations", visible: true, collapsed: false },
    ]);
  });

  it("respects profile ordering above the bundled default", () => {
    expect(
      resolveSidecarComposition({
        bundledDefault: BUNDLED_DEFAULT,
        profileDefault: {
          sections: [{ sectionId: "recent-conversations" }, { sectionId: "quick-starts" }],
        },
      }).sections.map((section) => section.sectionId),
    ).toEqual(["recent-conversations", "quick-starts"]);
  });

  it("drops hidden user-overridden sections and lets user collapse state beat profile state", () => {
    expect(
      resolveSidecarComposition({
        bundledDefault: BUNDLED_DEFAULT,
        profileDefault: {
          sections: [
            { sectionId: "recent-conversations", collapsed: false },
            { sectionId: "quick-starts", collapsed: false },
          ],
        },
        userOverrides: {
          sections: [
            { sectionId: "recent-conversations", collapsed: true },
            { sectionId: "quick-starts", visible: false },
          ],
        },
      }).sections,
    ).toEqual([{ sectionId: "recent-conversations", visible: true, collapsed: true }]);
  });
});
