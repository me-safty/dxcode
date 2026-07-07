import type { SelectableMarkdownSkill } from "./SelectableMarkdownText.types";
import { formatSkillLabel, NITRO_SKILL_LINK_PREFIX, SKILL_TOKEN_REGEX } from "./skillTokens";

export function decorateNitroMarkdownWithSkills(
  markdown: string,
  skills: ReadonlyArray<SelectableMarkdownSkill>,
): string {
  if (skills.length === 0) {
    return markdown;
  }
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));
  return markdown.replace(SKILL_TOKEN_REGEX, (match, prefix: string, name: string) => {
    const skill = skillByName.get(name);
    if (!skill) {
      return match;
    }
    const label = formatSkillLabel(skill);
    return `${prefix}[${label}](${NITRO_SKILL_LINK_PREFIX}${name})`;
  });
}
