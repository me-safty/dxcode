// pipeline fixture: per-item, two-stage pipeline. Stage 1 runs a (black-boxed) agent call;
// stage 2 is a pure transform. The whole `pipeline` is ONE journal entry (kind "pipeline"),
// so on resume the recorded array replays and the agent dispatcher is not re-invoked.
import { Schema } from "effect";

export const Inputs = Schema.Struct({ labels: Schema.Array(Schema.String) });

export const Outputs = Schema.Struct({ out: Schema.Array(Schema.String) });

export const meta = {
  name: "fixtures.pipeline-primitive",
  description: "Two-stage pipeline: agent echo then a pure suffix transform.",
  inputs: Inputs,
  outputs: Outputs,
} as const;

const input = Schema.decodeSync(Inputs)(args);

const out = await pipeline(
  [...input.labels],
  async (item) => agent(`echo ${item}`),
  async (prev) => `${prev}!`,
);

return { out };
