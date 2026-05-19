export const PROJECT_DASHBOARD_KICKOFF_QUICK_STARTS = [
  {
    id: "plan",
    title: "Plan project priorities",
    prompt:
      "Review the active work and propose a prioritized execution plan with dependencies and risk notes.",
  },
  {
    id: "status",
    title: "Generate status update",
    prompt:
      "Draft a concise project status update with what is done, in progress, blocked, and next.",
  },
  {
    id: "next",
    title: "Suggest next best task",
    prompt: "Based on project context, recommend the next highest-leverage task to execute now.",
  },
] as const;
