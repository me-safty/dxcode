// Budget fixture: reads budget.spent() between two agent calls and budget.total / remaining()
// at the end. The accumulator sums the journaled agent token counts, so every read replays
// identically on resume (the recorded tokens rebuild the running sum in body order).
import { Schema } from "effect";

export const Inputs = Schema.Struct({});

export const Outputs = Schema.Struct({
  afterFirst: Schema.Number,
  afterSecond: Schema.Number,
  total: Schema.Number,
  remaining: Schema.Number,
});

export const meta = {
  name: "fixtures.budget-primitive",
  description: "Reads budget.spent()/total/remaining() across two agent calls.",
  inputs: Inputs,
  outputs: Outputs,
} as const;

await agent("budget q1");
const afterFirst = budget.spent();
await agent("budget q2");
const afterSecond = budget.spent();

return { afterFirst, afterSecond, total: budget.total, remaining: budget.remaining() };
