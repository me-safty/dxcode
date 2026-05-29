import {
  defineSidecarSection,
  type SidecarComposition,
  type SidecarSectionDefinition,
} from "@t3tools/project-recipes";

const BUNDLED_SIDECAR_SECTIONS: ReadonlyArray<SidecarSectionDefinition> = [
  defineSidecarSection({
    id: "quick-starts",
    version: "1.0.0",
    title: "Quick starts",
    shortDescription: "Recipes matched to the active view.",
    surfaces: [
      "project.dashboard.backlog",
      "project.dashboard.myWork",
      "workitem.detail.sidepanel",
    ],
    component: "quick-starts",
    allowedToolGroups: ["view.state", "thread.handoff"],
    defaults: { collapsed: false, visible: true },
  }),
  defineSidecarSection({
    id: "recent-conversations",
    version: "1.0.0",
    title: "Recent conversations",
    shortDescription: "Resume or revisit recent thread activity.",
    surfaces: [
      "project.dashboard.backlog",
      "project.dashboard.myWork",
      "workitem.detail.sidepanel",
    ],
    component: "recent-conversations",
    defaults: { collapsed: false, visible: true },
  }),
];

export const DEFAULT_SIDECAR_COMPOSITION: SidecarComposition = {
  sections: BUNDLED_SIDECAR_SECTIONS.map((section) => ({
    sectionId: section.id,
    ...(section.defaults?.visible !== undefined ? { visible: section.defaults.visible } : {}),
    ...(section.defaults?.collapsed !== undefined ? { collapsed: section.defaults.collapsed } : {}),
  })),
};

export function listBundledSidecarSections(): ReadonlyArray<SidecarSectionDefinition> {
  return BUNDLED_SIDECAR_SECTIONS;
}

export function getBundledSidecarSection(id: string): SidecarSectionDefinition | undefined {
  return BUNDLED_SIDECAR_SECTIONS.find((section) => section.id === id);
}
