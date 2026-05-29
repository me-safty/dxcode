import { describe, expect, it } from "vitest";

import { defineSidecarSection } from "./sidecarSection.js";

describe("defineSidecarSection", () => {
  it("returns a validated section definition for a well-formed section", () => {
    expect(
      defineSidecarSection({
        id: "quick-starts",
        version: "1.0.0",
        title: "Quick starts",
        shortDescription: "Recipes matched to the active surface.",
        surfaces: ["project.dashboard.backlog", "workitem.detail.sidepanel"],
        component: "quick-starts",
        allowedToolGroups: ["view.state", "thread.handoff"],
        defaults: {
          collapsed: false,
          visible: true,
        },
      }),
    ).toEqual({
      id: "quick-starts",
      version: "1.0.0",
      title: "Quick starts",
      shortDescription: "Recipes matched to the active surface.",
      surfaces: ["project.dashboard.backlog", "workitem.detail.sidepanel"],
      component: "quick-starts",
      allowedToolGroups: ["view.state", "thread.handoff"],
      defaults: {
        collapsed: false,
        visible: true,
      },
    });
  });

  it("rejects malformed section definitions", () => {
    expect(() =>
      defineSidecarSection({
        id: "quick-starts",
        version: "1.0.0",
        title: 42 as never,
        surfaces: ["project.dashboard.backlog"],
        component: "quick-starts",
      }),
    ).toThrow();
  });
});
