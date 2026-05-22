export interface IntakeProjectRouteCandidate {
  readonly githubRepo: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveMentionedProject<TProject extends IntakeProjectRouteCandidate>(
  text: string,
  projects: ReadonlyArray<TProject>,
): TProject | null {
  const normalized = text.toLowerCase();

  for (const project of projects) {
    const githubRepo = project.githubRepo.trim().toLowerCase();
    if (githubRepo.length === 0) {
      continue;
    }

    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(githubRepo)}([^a-z0-9]|$)`, "i");
    const result = pattern.exec(normalized);
    if (result === null || result.index < 0) {
      continue;
    }

    return project;
  }

  return null;
}
