const PROJECT_ALIASES = ["nextcard", "t3code"] as const;

export type IntakeProjectAlias = (typeof PROJECT_ALIASES)[number];

export function resolveMentionedProjectAlias(text: string): IntakeProjectAlias | null {
  const normalized = text.toLowerCase();
  let match: { readonly alias: IntakeProjectAlias; readonly index: number } | null = null;

  for (const alias of PROJECT_ALIASES) {
    const pattern = new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`, "i");
    const result = pattern.exec(normalized);
    if (result === null || result.index < 0) {
      continue;
    }

    const index = result.index + result[1]!.length;
    if (match === null || index < match.index) {
      match = { alias, index };
    }
  }

  return match?.alias ?? null;
}
