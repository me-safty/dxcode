import { SubagentSkill } from "@t3tools/contracts";
import { Option, ServiceMap } from "effect";
import type { Effect } from "effect";

export interface SkillCatalogShape {
  readonly listSkills: () => Effect.Effect<ReadonlyArray<SubagentSkill>>;
  readonly getSkillById: (skillId: string) => Effect.Effect<Option.Option<SubagentSkill>>;
}

export class SkillCatalog extends ServiceMap.Service<SkillCatalog, SkillCatalogShape>()(
  "t3/subagents/Services/SkillCatalog",
) {}
