import type {
  ProjectBacklogPlanningState,
  ProjectBacklogViewMode,
} from "~/t3work/t3work-projectBacklogPresentation";

export const projectBacklogViewModes: ReadonlyArray<{
  value: ProjectBacklogViewMode;
  label: string;
}> = [
  { value: "table", label: "Table" },
  { value: "hierarchy", label: "Hierarchy" },
  { value: "planning", label: "Planning lanes" },
  { value: "ownership", label: "Ownership" },
];

export const projectBacklogPlanningLaneOrder = [
  "needs-owner-and-estimate",
  "needs-owner",
  "needs-estimate",
  "ready",
] as const satisfies ReadonlyArray<ProjectBacklogPlanningState>;

export const projectBacklogPlanningMeta: Record<
  ProjectBacklogPlanningState,
  { label: string; description: string }
> = {
  "needs-owner-and-estimate": {
    label: "Needs owner + estimate",
    description: "Tickets that are not ready for sprint commitment yet.",
  },
  "needs-owner": {
    label: "Needs owner",
    description: "Estimated work with no clear owner yet.",
  },
  "needs-estimate": {
    label: "Needs estimate",
    description: "Assigned work that still needs sizing.",
  },
  ready: {
    label: "Ready to pull",
    description: "Owned and estimated tickets that can be scheduled.",
  },
};
