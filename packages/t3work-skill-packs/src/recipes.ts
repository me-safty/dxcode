import type { Recipe } from "@t3tools/project-recipes";

export type BundledT3WorkRecipe = Recipe & {
  readonly version: string;
  readonly manifestDisplayName: string;
  readonly allowedToolGroups: ReadonlyArray<string>;
};

const DEFAULT_ALLOWED_TOOL_GROUPS = ["integration.read", "artifact.rw", "ui.render"] as const;

function createBundledRecipe(
  recipe: Omit<BundledT3WorkRecipe, "version" | "allowedToolGroups"> & {
    readonly allowedToolGroups?: ReadonlyArray<string>;
  },
): BundledT3WorkRecipe {
  return {
    version: "0.1.0",
    allowedToolGroups: recipe.allowedToolGroups ?? DEFAULT_ALLOWED_TOOL_GROUPS,
    ...recipe,
  };
}

const BUNDLED_RECIPES: ReadonlyArray<BundledT3WorkRecipe> = [
  createBundledRecipe({
    id: "explain-selected-work",
    title: "Explain this simply",
    manifestDisplayName: "Explain {{selectedWorkLabel}}",
    shortDescription: "Summarize the selected work with user impact, checks, and open questions.",
    surfaces: ["project.dashboard", "workitem.detail.sidepanel"],
    promptTemplate:
      "Explain {{selectedWorkLabel}} in plain language. Cover user impact, what is changing, what needs checking, and any unclear points.",
    icon: "sparkles",
    appliesTo: {},
    requiredContext: [
      { key: "project.summary", description: "Project overview" },
      { key: "selected-work.summary", description: "Selected work summary", optional: true },
    ],
    skillRef: { id: "summary.explain" },
    outputPreference: "markdown",
    artifactKinds: ["summary", "open-questions"],
    actionFamilies: ["summary", "product"],
    rankHint: 16,
  }),
  createBundledRecipe({
    id: "review-acceptance-criteria",
    title: "Review acceptance criteria",
    manifestDisplayName: "Review acceptance criteria for {{selectedWorkLabel}}",
    shortDescription: "Call out ambiguity, missing testability notes, and follow-up questions.",
    surfaces: ["workitem.detail.sidepanel"],
    promptTemplate:
      "Review the acceptance criteria for {{selectedWorkLabel}}. Return a checklist, ambiguity warnings, missing testability notes, and the questions that should be resolved before implementation or QA.",
    icon: "clipboard-list",
    appliesTo: {
      resourceKinds: ["ticket"],
      technicalDepths: ["low", "medium", "high"],
    },
    requiredContext: [{ key: "ticket.summary", description: "Ticket summary" }],
    skillRef: { id: "qa.acceptance-review" },
    outputPreference: "blocks",
    artifactKinds: ["acceptance-criteria", "open-questions"],
    actionFamilies: ["qa", "product", "engineering"],
    rankHint: 20,
  }),
  createBundledRecipe({
    id: "create-qa-test-plan",
    title: "Create QA test plan",
    manifestDisplayName: "Create QA plan for {{selectedWorkLabel}}",
    shortDescription: "Build a test matrix with regression, smoke, and edge-case coverage.",
    surfaces: ["workitem.detail.sidepanel"],
    promptTemplate:
      "Create a QA test plan for {{selectedWorkLabel}}. Include a test matrix, environment assumptions, edge cases, regression versus smoke coverage, and explicit open questions.",
    icon: "bug",
    appliesTo: {
      resourceKinds: ["ticket"],
      requiredSkillPackIds: ["qa"],
      technicalDepths: ["low", "medium"],
      guidanceStyles: ["guided", "balanced"],
    },
    requiredContext: [{ key: "ticket.summary", description: "Ticket summary" }],
    skillRef: { id: "qa.test-plan" },
    outputPreference: "plan",
    artifactKinds: ["test-matrix", "risk-list", "checklist"],
    actionFamilies: ["qa", "verification"],
    rankHint: 26,
  }),
  createBundledRecipe({
    id: "draft-jira-comment",
    title: "Draft Jira comment",
    manifestDisplayName: "Draft Jira comment for {{selectedWorkLabel}}",
    shortDescription: "Prepare a concise update the team can quickly review and post.",
    surfaces: ["workitem.detail.sidepanel"],
    promptTemplate:
      "Draft a concise Jira comment for {{selectedWorkLabel}}. Include current status, assumptions, blockers, and the next concrete step. Keep it editable and avoid overcommitting.",
    icon: "message-square",
    appliesTo: {
      resourceKinds: ["ticket"],
      projectSourceKinds: ["atlassian"],
    },
    requiredContext: [{ key: "ticket.summary", description: "Ticket summary" }],
    skillRef: { id: "delivery.jira-comment" },
    outputPreference: "comment",
    artifactKinds: ["status-update"],
    actionFamilies: ["delivery", "product", "support"],
    rankHint: 18,
    allowedToolGroups: ["integration.read", "artifact.rw", "mutation.prepare", "ui.render"],
  }),
  createBundledRecipe({
    id: "summarize-project-risk",
    title: "Summarize project risk",
    manifestDisplayName: "Summarize project risk",
    shortDescription: "Highlight blockers, unclear work, and the next high-leverage actions.",
    surfaces: ["project.dashboard"],
    promptTemplate:
      "Summarize risk for {{projectTitle}}. Group it into blockers, unclear work, dependency risks, and the next actions that would reduce risk fastest.",
    icon: "triangle-alert",
    appliesTo: {},
    requiredContext: [{ key: "project.summary", description: "Project overview" }],
    skillRef: { id: "delivery.project-risk" },
    outputPreference: "blocks",
    artifactKinds: ["risk-board", "blocker-list"],
    actionFamilies: ["delivery", "qa", "release"],
    rankHint: 22,
  }),
  createBundledRecipe({
    id: "next-best-task",
    title: "Suggest next best task",
    manifestDisplayName: "Suggest next best task",
    shortDescription: "Recommend the highest-leverage next task based on current project context.",
    surfaces: ["project.dashboard"],
    promptTemplate:
      "Based on the current context for {{projectTitle}}, recommend the next highest-leverage task to do now. Explain why it should come next, what it depends on, and what could block it.",
    icon: "arrow-right",
    appliesTo: {},
    requiredContext: [{ key: "project.summary", description: "Project overview" }],
    skillRef: { id: "delivery.next-task" },
    outputPreference: "plan",
    artifactKinds: ["priority-list", "next-step"],
    actionFamilies: ["delivery", "engineering", "product"],
    rankHint: 12,
  }),
  createBundledRecipe({
    id: "stakeholder-update",
    title: "Draft stakeholder update",
    manifestDisplayName: "Draft stakeholder update",
    shortDescription: "Turn current status into a low-jargon update for stakeholders or customers.",
    surfaces: ["project.dashboard"],
    promptTemplate:
      "Draft a stakeholder update for {{projectTitle}}. Lead with what changed, why it matters, current risk, and the decisions or follow-ups that need attention. Keep jargon low.",
    icon: "newspaper",
    appliesTo: {
      technicalDepths: ["low", "medium"],
      brevities: ["short", "balanced"],
      requiredSkillPackIds: ["product", "support"],
    },
    requiredContext: [{ key: "project.summary", description: "Project overview" }],
    skillRef: { id: "product.stakeholder-update" },
    outputPreference: "markdown",
    artifactKinds: ["status-update", "decision-notes"],
    actionFamilies: ["product", "support"],
    rankHint: 24,
  }),
  createBundledRecipe({
    id: "draft-status-update",
    title: "Draft status update",
    manifestDisplayName: "Draft status update",
    shortDescription: "Prepare a concise status, blocker, and next-step update for the team.",
    surfaces: ["project.dashboard"],
    promptTemplate:
      "Draft a concise status update for {{projectTitle}}. Include done, in progress, blocked, next, and the single most important dependency or risk to watch.",
    icon: "clipboard-check",
    appliesTo: {
      technicalDepths: ["low", "medium"],
      requiredSkillPackIds: ["delivery"],
    },
    requiredContext: [{ key: "project.summary", description: "Project overview" }],
    skillRef: { id: "delivery.status-update" },
    outputPreference: "comment",
    artifactKinds: ["status-update", "blocker-list"],
    actionFamilies: ["delivery", "release"],
    rankHint: 24,
  }),
  createBundledRecipe({
    id: "technical-implementation-plan",
    title: "Draft implementation plan",
    manifestDisplayName: "Draft implementation plan for {{selectedWorkLabel}}",
    shortDescription: "Map impacted areas, sequencing, risks, and verification for implementation.",
    surfaces: ["workitem.detail.sidepanel"],
    promptTemplate:
      "Draft a concrete implementation plan for {{selectedWorkLabel}}. Include likely impacted areas, rollout order, failure modes, validation steps, and anything that should be clarified before coding.",
    icon: "code-2",
    appliesTo: {
      resourceKinds: ["ticket"],
      requiredSkillPackIds: ["engineering"],
      technicalDepths: ["high"],
      guidanceStyles: ["expert", "balanced"],
      detailDensities: ["balanced", "expert"],
    },
    requiredContext: [{ key: "ticket.summary", description: "Ticket summary" }],
    skillRef: { id: "engineering.implementation-plan" },
    outputPreference: "plan",
    artifactKinds: ["implementation-plan", "technical-checklist", "verification-plan"],
    actionFamilies: ["engineering"],
    rankHint: 28,
  }),
  createBundledRecipe({
    id: "release-handoff-checklist",
    title: "Prepare release handoff",
    manifestDisplayName: "Prepare release handoff for {{selectedWorkLabel}}",
    shortDescription: "Summarize what changed, what to verify, and what could block rollout.",
    surfaces: ["project.dashboard", "workitem.detail.sidepanel"],
    promptTemplate:
      "Prepare a release or QA handoff for {{selectedWorkLabel}}. Cover what changed, what to verify, rollout or deployment cues, blockers, and ownership for the next step.",
    icon: "ship",
    appliesTo: {
      requiredSkillPackIds: ["release"],
      technicalDepths: ["low", "medium", "high"],
    },
    requiredContext: [{ key: "project.summary", description: "Project overview" }],
    skillRef: { id: "release.handoff" },
    outputPreference: "plan",
    artifactKinds: ["checklist", "handoff-note", "verification-plan"],
    actionFamilies: ["release", "delivery", "verification"],
    rankHint: 26,
  }),
  createBundledRecipe({
    id: "support-escalation-summary",
    title: "Create escalation summary",
    manifestDisplayName: "Create escalation summary for {{selectedWorkLabel}}",
    shortDescription:
      "Summarize customer impact, reproduction details, and the best escalation path.",
    surfaces: ["workitem.detail.sidepanel"],
    promptTemplate:
      "Create a support escalation summary for {{selectedWorkLabel}}. Include customer impact, severity, current evidence, reproduction gaps, and the exact follow-up needed from engineering or product.",
    icon: "life-buoy",
    appliesTo: {
      resourceKinds: ["ticket"],
      requiredSkillPackIds: ["support"],
      technicalDepths: ["low", "medium"],
    },
    requiredContext: [{ key: "ticket.summary", description: "Ticket summary" }],
    skillRef: { id: "support.escalation-summary" },
    outputPreference: "comment",
    artifactKinds: ["escalation-summary", "impact-summary"],
    actionFamilies: ["support"],
    rankHint: 24,
  }),
] as const;

export function listBundledT3WorkRecipes(): ReadonlyArray<BundledT3WorkRecipe> {
  return BUNDLED_RECIPES;
}

export function getBundledT3WorkRecipe(recipeId: string): BundledT3WorkRecipe | undefined {
  return BUNDLED_RECIPES.find((recipe) => recipe.id === recipeId);
}
