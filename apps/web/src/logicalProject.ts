import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "./lib/projectPaths";
import type { Project } from "./types";

function deriveRepositoryRelativeProjectPath(
  project: Pick<Project, "cwd" | "repositoryIdentity">,
): string | null {
  const rootPath = project.repositoryIdentity?.rootPath?.trim();
  if (!rootPath) {
    return null;
  }

  const normalizedProjectPath = normalizeProjectPathForComparison(project.cwd);
  const normalizedRootPath = normalizeProjectPathForComparison(rootPath);
  if (normalizedProjectPath.length === 0 || normalizedRootPath.length === 0) {
    return null;
  }

  if (normalizedProjectPath === normalizedRootPath) {
    return "";
  }

  const separator = normalizedRootPath.includes("\\") ? "\\" : "/";
  const rootPrefix = `${normalizedRootPath}${separator}`;
  if (!normalizedProjectPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedProjectPath.slice(rootPrefix.length).replaceAll("\\", "/");
}

function deriveRepositoryScopedKey(
  project: Pick<Project, "cwd" | "repositoryIdentity">,
): string | null {
  const canonicalKey = project.repositoryIdentity?.canonicalKey;
  if (!canonicalKey) {
    return null;
  }

  const relativeProjectPath = deriveRepositoryRelativeProjectPath(project);
  if (relativeProjectPath === null) {
    return canonicalKey;
  }

  return relativeProjectPath.length === 0
    ? canonicalKey
    : `${canonicalKey}::${relativeProjectPath}`;
}

export function deriveLogicalProjectKey(
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
): string {
  return (
    deriveRepositoryScopedKey(project) ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "cwd" | "repositoryIdentity"> | null | undefined,
): string {
  return (project ? deriveRepositoryScopedKey(project) : null) ?? scopedProjectKey(projectRef);
}
