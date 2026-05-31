import type {
  RecipeSurface,
  SidecarComposition,
  SidecarPersonalization,
} from "@t3tools/project-recipes";

import type { T3workDeterministicWorkflowLaunch } from "~/t3work/t3work-inlineRecipeLaunch";
import {
  buildT3workSidecarItemResetPlan,
  buildT3workSidecarSectionResetPlan,
  type T3workSidecarResetPlan,
} from "~/t3work/t3work-sidecarPersonalizationResetState";

export const T3WORK_SIDECAR_APPLY_PERSONALIZATION_RESET_TOOL =
  "t3work.sidecar.apply_personalization_reset";

export type T3workSidecarPersonalizationResetToolInput = {
  readonly nextPersonalization: SidecarPersonalization;
  readonly promptText: string;
};

function toLaunch(input: {
  readonly surface: RecipeSurface;
  readonly launchId: string;
  readonly plan: T3workSidecarResetPlan;
}): T3workDeterministicWorkflowLaunch {
  return {
    launchId: input.launchId,
    title: input.plan.launchTitle,
    description: input.plan.cardBody,
    surface: input.surface,
    workflow: {
      steps: [
        {
          kind: "present-message",
          id: "preview-reset",
          message: {
            card: {
              kind: "approval",
              id: `${input.launchId}:approve`,
              title: input.plan.cardTitle,
              body: input.plan.cardBody,
              fields: input.plan.fieldRows,
              actions: [{ id: "approve", label: "Reset to defaults", style: "danger" }],
            },
          },
        },
        {
          kind: "collect-input",
          id: "approve-reset",
          request: { kind: "card-action", actionId: "approve" },
        },
        {
          kind: "tool",
          id: "apply-reset",
          toolName: T3WORK_SIDECAR_APPLY_PERSONALIZATION_RESET_TOOL,
          input: {
            nextPersonalization: input.plan.nextPersonalization,
            promptText: input.plan.promptText,
          },
        },
      ],
    },
    source: "bundled",
  };
}

export function buildT3workSidecarSectionResetLaunch(input: {
  readonly surface: RecipeSurface;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly defaultComposition: SidecarComposition;
  readonly personalization: SidecarPersonalization;
}) {
  const plan = buildT3workSidecarSectionResetPlan(input);
  return plan
    ? toLaunch({
        surface: input.surface,
        launchId: `sidecar.reset-section.${input.sectionId}`,
        plan,
      })
    : null;
}

export function buildT3workSidecarItemResetLaunch(input: {
  readonly surface: RecipeSurface;
  readonly sectionId: string;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly personalization: SidecarPersonalization;
}) {
  const plan = buildT3workSidecarItemResetPlan(input);
  return plan
    ? toLaunch({
        surface: input.surface,
        launchId: `sidecar.reset-item.${input.sectionId}.${input.itemId}`,
        plan,
      })
    : null;
}
