import type { ProjectSkill } from "@t3tools/contracts";
import { WandIcon } from "lucide-react";
import { slashCommandRegistry } from "./slashCommandRegistry";

export function registerProjectSkills(skills: readonly ProjectSkill[] | undefined): () => void {
  if (!skills || skills.length === 0) return () => {};

  const unregisterFns: Array<() => void> = [];
  for (const skill of skills) {
    if (!skill.userInvocable) continue;
    unregisterFns.push(
      slashCommandRegistry.register({
        name: skill.name,
        description: skill.description || `Use the ${skill.name} skill`,
        icon: WandIcon,
        action: {
          type: "prompt-prefix",
          prefix: `Use the /${skill.name} skill.\n\n`,
        },
      }),
    );
  }

  return () => {
    for (const unregister of unregisterFns) {
      unregister();
    }
  };
}
