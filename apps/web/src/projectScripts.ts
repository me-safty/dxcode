import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type KeybindingCommand,
  type ProjectScript,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import * as Schema from "effect/Schema";
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export const commandForProjectScript = (scriptId: string): KeybindingCommand =>
  SCRIPT_RUN_COMMAND_PATTERN.make(`script.${scriptId}.run`);

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!isScriptRunCommand(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  // This last-resort fallback only triggers after exhausting thousands of suffixes.
  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function primaryProjectScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  const regular = scripts.find((script) => !script.runOnWorktreeCreate);
  return regular ?? scripts[0] ?? null;
}

export function projectsSharingActions(
  project: EnvironmentProject,
  projects: ReadonlyArray<EnvironmentProject>,
  sharingEnabled: boolean,
): EnvironmentProject[] {
  const repositoryKey = project.repositoryIdentity?.canonicalKey;
  if (!sharingEnabled || !repositoryKey) return [project];
  const related = projects.filter(
    (candidate) =>
      candidate.environmentId === project.environmentId &&
      candidate.repositoryIdentity?.canonicalKey === repositoryKey,
  );
  return related.length > 0 ? related : [project];
}

export function sharedProjectScripts(
  project: EnvironmentProject,
  projects: ReadonlyArray<EnvironmentProject>,
  sharingEnabled: boolean,
): ReadonlyArray<ProjectScript> {
  const related = projectsSharingActions(project, projects, sharingEnabled);
  return related.find((candidate) => candidate.scripts.length > 0)?.scripts ?? project.scripts;
}

export type ProjectScriptsUpdateTarget = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "scripts"
>;

export async function updateProjectScriptsWithRollback<Result>(input: {
  readonly projects: ReadonlyArray<ProjectScriptsUpdateTarget>;
  readonly nextScripts: ReadonlyArray<ProjectScript>;
  readonly update: (
    project: ProjectScriptsUpdateTarget,
    scripts: ReadonlyArray<ProjectScript>,
  ) => Promise<Result>;
  readonly isFailure: (result: Result) => boolean;
}): Promise<ReadonlyArray<Result>> {
  const updateResults = await Promise.all(
    input.projects.map((project) => input.update(project, input.nextScripts)),
  );
  if (!updateResults.some(input.isFailure)) return updateResults;

  await Promise.all(
    input.projects.flatMap((project, index) =>
      input.isFailure(updateResults[index]!) ? [] : [input.update(project, project.scripts)],
    ),
  );
  return updateResults;
}
