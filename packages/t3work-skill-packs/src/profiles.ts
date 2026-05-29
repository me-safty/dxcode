import type { RecipeProfileContext, SidecarComposition } from "@t3tools/project-recipes";

export type T3WorkProfileId =
  | "qa-assistant"
  | "product-partner"
  | "support-triage"
  | "delivery-coordinator"
  | "verification-guide"
  | "engineering-copilot";

export type LegacyT3WorkProfileId =
  | "project-partner"
  | "test-engineer"
  | "requirements-engineer"
  | "developer";

export type T3WorkProfileAudience =
  | "mixed"
  | "qa"
  | "product"
  | "support"
  | "delivery"
  | "engineering";

export type T3WorkProfile = {
  readonly id: T3WorkProfileId;
  readonly title: string;
  readonly description: string;
  readonly audience: T3WorkProfileAudience;
  readonly tags?: ReadonlyArray<string>;
  readonly communicationStyle: {
    readonly technicalDepth: "low" | "medium" | "high";
    readonly brevity: "short" | "balanced" | "detailed";
    readonly guidanceStyle: "guided" | "balanced" | "expert";
    readonly defaultLanguage?: string;
  };
  readonly surfaceDefaults?: {
    readonly detailDensity: "guided" | "balanced" | "expert";
    readonly activityOrder?: "newest-first" | "oldest-first";
    readonly collapseLowSignalEvents?: boolean;
  };
  readonly preferredArtifactKinds: ReadonlyArray<string>;
  readonly defaultActionFamilies?: ReadonlyArray<string>;
  readonly defaultRecipeWeights: Readonly<Record<string, number>>;
  readonly sidecarSections?: SidecarComposition | undefined;
  readonly recommendedSkillPackIds: ReadonlyArray<string>;
  readonly hideImplementationComplexity: boolean;
};

const LEGACY_PROFILE_ALIASES: Record<LegacyT3WorkProfileId, T3WorkProfileId> = {
  "project-partner": "product-partner",
  "test-engineer": "qa-assistant",
  "requirements-engineer": "product-partner",
  developer: "engineering-copilot",
};

export const DEFAULT_T3WORK_PROFILE_ID: T3WorkProfileId = "product-partner";

export const T3WORK_PROFILES: Record<T3WorkProfileId, T3WorkProfile> = {
  "qa-assistant": {
    id: "qa-assistant",
    title: "QA Assistant",
    description: "Short verification guidance with test matrices, repro steps, and risk notes.",
    audience: "qa",
    tags: ["qa", "verification"],
    communicationStyle: {
      technicalDepth: "medium",
      brevity: "short",
      guidanceStyle: "guided",
    },
    surfaceDefaults: {
      detailDensity: "guided",
      activityOrder: "newest-first",
      collapseLowSignalEvents: true,
    },
    preferredArtifactKinds: [
      "test-matrix",
      "risk-list",
      "repro-steps",
      "open-questions",
      "checklist",
    ],
    defaultActionFamilies: ["qa", "verification", "delivery"],
    defaultRecipeWeights: {
      "create-qa-test-plan": 35,
      "review-acceptance-criteria": 20,
      "draft-jira-comment": 10,
      "release-handoff-checklist": 10,
    },
    recommendedSkillPackIds: ["qa", "delivery"],
    hideImplementationComplexity: true,
  },
  "product-partner": {
    id: "product-partner",
    title: "Product Partner",
    description: "Plain-language summaries, ambiguity checks, and stakeholder-ready updates.",
    audience: "product",
    tags: ["product", "planning"],
    communicationStyle: {
      technicalDepth: "low",
      brevity: "short",
      guidanceStyle: "guided",
    },
    surfaceDefaults: {
      detailDensity: "guided",
      activityOrder: "newest-first",
      collapseLowSignalEvents: true,
    },
    preferredArtifactKinds: ["summary", "decision-notes", "open-questions", "status-update"],
    defaultActionFamilies: ["product", "delivery", "summary"],
    defaultRecipeWeights: {
      "explain-selected-work": 25,
      "review-acceptance-criteria": 20,
      "stakeholder-update": 30,
      "summarize-project-risk": 10,
    },
    recommendedSkillPackIds: ["product", "delivery"],
    hideImplementationComplexity: true,
  },
  "support-triage": {
    id: "support-triage",
    title: "Support Triage",
    description: "Customer-readable issue framing with escalation and reproduction requests first.",
    audience: "support",
    tags: ["support", "triage"],
    communicationStyle: {
      technicalDepth: "low",
      brevity: "short",
      guidanceStyle: "guided",
    },
    surfaceDefaults: {
      detailDensity: "guided",
      activityOrder: "newest-first",
      collapseLowSignalEvents: true,
    },
    preferredArtifactKinds: [
      "escalation-summary",
      "impact-summary",
      "repro-steps",
      "status-update",
    ],
    defaultActionFamilies: ["support", "product"],
    defaultRecipeWeights: {
      "support-escalation-summary": 35,
      "draft-jira-comment": 15,
      "explain-selected-work": 10,
    },
    recommendedSkillPackIds: ["support", "qa"],
    hideImplementationComplexity: true,
  },
  "delivery-coordinator": {
    id: "delivery-coordinator",
    title: "Delivery Coordinator",
    description: "Concise status, blockers, dependencies, and release-checklist guidance.",
    audience: "delivery",
    tags: ["delivery", "release"],
    communicationStyle: {
      technicalDepth: "low",
      brevity: "short",
      guidanceStyle: "guided",
    },
    surfaceDefaults: {
      detailDensity: "guided",
      activityOrder: "newest-first",
      collapseLowSignalEvents: true,
    },
    preferredArtifactKinds: ["status-update", "blocker-list", "checklist", "timeline"],
    defaultActionFamilies: ["delivery", "release"],
    defaultRecipeWeights: {
      "draft-status-update": 30,
      "release-handoff-checklist": 25,
      "summarize-project-risk": 20,
    },
    recommendedSkillPackIds: ["delivery", "release"],
    hideImplementationComplexity: true,
  },
  "verification-guide": {
    id: "verification-guide",
    title: "Verification Guide",
    description:
      "Guided summaries with verification checklists, blockers, and deployment cues first.",
    audience: "qa",
    tags: ["verification", "release"],
    communicationStyle: {
      technicalDepth: "medium",
      brevity: "balanced",
      guidanceStyle: "guided",
    },
    surfaceDefaults: {
      detailDensity: "guided",
      activityOrder: "newest-first",
      collapseLowSignalEvents: false,
    },
    preferredArtifactKinds: ["checklist", "verification-plan", "risk-list", "handoff-note"],
    defaultActionFamilies: ["verification", "qa", "release"],
    defaultRecipeWeights: {
      "create-qa-test-plan": 25,
      "release-handoff-checklist": 20,
      "summarize-project-risk": 15,
    },
    recommendedSkillPackIds: ["qa", "release"],
    hideImplementationComplexity: false,
  },
  "engineering-copilot": {
    id: "engineering-copilot",
    title: "Engineering Copilot",
    description:
      "Technical implementation guidance with diff-first and verification-oriented defaults.",
    audience: "engineering",
    tags: ["engineering", "implementation"],
    communicationStyle: {
      technicalDepth: "high",
      brevity: "balanced",
      guidanceStyle: "expert",
    },
    surfaceDefaults: {
      detailDensity: "expert",
      activityOrder: "newest-first",
      collapseLowSignalEvents: false,
    },
    preferredArtifactKinds: [
      "implementation-plan",
      "technical-checklist",
      "verification-plan",
      "diff-summary",
    ],
    defaultActionFamilies: ["engineering", "release"],
    defaultRecipeWeights: {
      "technical-implementation-plan": 40,
      "release-handoff-checklist": 10,
      "next-best-task": 10,
    },
    sidecarSections: {
      sections: [{ sectionId: "recent-conversations" }, { sectionId: "quick-starts" }],
    },
    recommendedSkillPackIds: ["engineering", "release"],
    hideImplementationComplexity: false,
  },
};

export function resolveT3WorkProfileId(profileId: string | undefined): T3WorkProfileId {
  if (!profileId) {
    return DEFAULT_T3WORK_PROFILE_ID;
  }

  if (profileId in T3WORK_PROFILES) {
    return profileId as T3WorkProfileId;
  }

  if (profileId in LEGACY_PROFILE_ALIASES) {
    return LEGACY_PROFILE_ALIASES[profileId as LegacyT3WorkProfileId];
  }

  return DEFAULT_T3WORK_PROFILE_ID;
}

export function getT3WorkProfile(profileId?: string): T3WorkProfile {
  return T3WORK_PROFILES[resolveT3WorkProfileId(profileId)];
}

export function listT3WorkProfiles(): ReadonlyArray<T3WorkProfile> {
  return Object.values(T3WORK_PROFILES);
}

export function toRecipeProfileContext(
  profile: T3WorkProfile | string | undefined,
): RecipeProfileContext {
  const resolvedProfile =
    typeof profile === "string" || profile === undefined ? getT3WorkProfile(profile) : profile;

  return {
    technicalDepth: resolvedProfile.communicationStyle.technicalDepth,
    brevity: resolvedProfile.communicationStyle.brevity,
    guidanceStyle: resolvedProfile.communicationStyle.guidanceStyle,
    detailDensity: resolvedProfile.surfaceDefaults?.detailDensity ?? "balanced",
    preferredArtifactKinds: resolvedProfile.preferredArtifactKinds,
    defaultActionFamilies: resolvedProfile.defaultActionFamilies ?? [],
    defaultRecipeWeights: resolvedProfile.defaultRecipeWeights,
  };
}
