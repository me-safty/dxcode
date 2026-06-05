// Sub-workflow child: invoked via `workflow()` from the parent fixture. Its agent call runs
// black-boxed inside the parent's `workflow` journal entry, so it is not individually
// journaled and does not re-fire when the parent replays.
import { Schema } from "effect";

export const Inputs = Schema.Struct({ name: Schema.String });

export const Outputs = Schema.Struct({ greeting: Schema.String });

export const meta = {
  name: "fixtures.sub-child",
  description: "Greets a name via an agent call; run as a sub-workflow.",
  inputs: Inputs,
  outputs: Outputs,
} as const;

const input = Schema.decodeSync(Inputs)(args);

const greeting = await agent(`greet ${input.name}`);

return { greeting };
