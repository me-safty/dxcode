import type { SelectableMarkdownSkill } from "./SelectableMarkdownText.types";

export const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;
export const NITRO_SKILL_LINK_PREFIX = "t3-skill:";

export function formatSkillLabel(skill: SelectableMarkdownSkill): string {
  const displayName = skill.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return skill.name
    .split(/[\s:_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function resolveNitroSkillHref(href: string): string | null {
  if (!href.startsWith(NITRO_SKILL_LINK_PREFIX)) {
    return null;
  }
  const name = href.slice(NITRO_SKILL_LINK_PREFIX.length);
  return name.length > 0 ? name : null;
}
