import {
  DEFAULT_T3WORK_PROFILE_ID,
  listT3WorkProfiles,
  resolveT3WorkProfileId,
  type T3WorkProfile,
  type T3WorkProfileId,
} from "@t3tools/t3work-skill-packs";

export const T3WORK_PROJECT_SETUP_VERSION = 1;
export const T3WORK_PROJECT_SETUP_ROOT = ".t3work/setup";
export const T3WORK_PROJECT_CONTEXT_ROOT = ".t3work/context";
export const T3WORK_PROJECT_SKILLS_ROOT = ".t3work/skills";
export const T3WORK_PROJECT_RECIPES_ROOT = ".t3work/recipes";
export const T3WORK_PROJECT_TEMPLATES_ROOT = ".t3work/templates";
export const T3WORK_PROJECT_PROFILE_MANIFEST_PATH = `${T3WORK_PROJECT_SETUP_ROOT}/profile.json`;
export const T3WORK_PROJECT_CONTEXT_ENTRYPOINT_PATH = `${T3WORK_PROJECT_CONTEXT_ROOT}/entrypoint.json`;

export type T3WorkProjectSetupProfileId = T3WorkProfileId;

export type T3WorkProjectSetupProfileSummary = T3WorkProfile;

export const DEFAULT_T3WORK_PROJECT_SETUP_PROFILE_ID: T3WorkProjectSetupProfileId =
  DEFAULT_T3WORK_PROFILE_ID;

export function resolveT3WorkProjectSetupProfileId(
  profileId: string | undefined,
): T3WorkProjectSetupProfileId {
  return resolveT3WorkProfileId(profileId);
}

export function listT3WorkProjectSetupProfiles(): ReadonlyArray<T3WorkProjectSetupProfileSummary> {
  return listT3WorkProfiles();
}
