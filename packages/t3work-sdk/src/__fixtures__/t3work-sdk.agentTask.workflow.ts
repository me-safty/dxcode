// agent.task fixture: a non-interactive LLM call whose schema-typed structured result is
// journaled (kind "agent.task"). Exercises the prompt-rides-in-opts shape and the typed
// return; on resume the recorded plan replays without re-invoking the dispatcher.
import { Schema } from "effect";

export const Inputs = Schema.Struct({ goal: Schema.String });

export const Outputs = Schema.Struct({ stepCount: Schema.Number });

export const meta = {
  name: "fixtures.agent-task",
  description: "Schema-typed agent.task call, returning the number of planned steps.",
  inputs: Inputs,
  outputs: Outputs,
} as const;

const input = Schema.decodeSync(Inputs)(args);

const Plan = Schema.Struct({ steps: Schema.Array(Schema.String) });
const plan = await agent.task({ prompt: `plan ${input.goal}`, schema: Plan });

return { stepCount: plan.steps.length };
