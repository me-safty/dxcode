/**
 * The 25.3 workflow-body primitives bound as globals: `agent` / `agent.task` (one-shot LLM
 * calls journaled through the {@link LlmDispatcher}), the black-boxed composition primitives
 * `parallel` / `pipeline` / `workflow`, the durable timer `wait`, the `budget` accumulator,
 * and the cosmetic `phase` / `log`.
 *
 * Every primitive that produces durable state routes through the runtime's generic
 * `callPrimitive` seat, so replay returns the recorded result without re-invoking the LLM,
 * re-sleeping, or re-running a sub-workflow. The composition primitives run their thunks
 * inside `runBlackBoxed` so the calls inside them are NOT individually journaled — the
 * composition primitive is the journal boundary (a documented Stage-1 tradeoff).
 */

import { setTimeout as sleep } from "node:timers/promises";

import type * as Schema from "effect/Schema";

import { WorkflowError } from "./t3work-sdk.errors.ts";
import { decodeWithSchema } from "./t3work-sdk.internal.ts";
import type {
  AgentOpts,
  AgentResultEnvelope,
  AgentTaskOpts,
  LlmDispatcher,
  WorkflowBudget,
} from "./t3work-sdk.primitiveTypes.ts";
import type * as T from "./t3work-sdk.types.ts";

/** A single `pipeline` stage: receives the previous stage's result, the original item, and
 * the item index. Stage 1's `prev` is the item itself. */
export type PipelineStage = (prev: unknown, item: unknown, index: number) => Promise<unknown>;

/** Callable `agent(prompt, opts?)` with the `agent.task(opts)` method attached. */
export interface AgentFn {
  <R = string>(prompt: string, opts?: AgentOpts<R>): Promise<R>;
  task: <R>(opts: AgentTaskOpts<R>) => Promise<R>;
}

/** The globals this module binds into the workflow body. */
export interface WorkflowPrimitives {
  readonly agent: AgentFn;
  readonly parallel: <R>(thunks: ReadonlyArray<() => Promise<R>>) => Promise<Array<R | null>>;
  readonly pipeline: (
    items: ReadonlyArray<unknown>,
    ...stages: PipelineStage[]
  ) => Promise<unknown[]>;
  readonly workflow: (ref: T.WorkflowRef, args?: unknown) => Promise<unknown>;
  readonly wait: (durationMs: number) => Promise<void>;
  readonly budget: WorkflowBudget;
  readonly phase: (title: string) => void;
  readonly log: (message: string) => void;
}

/** Dependencies the primitives close over — supplied by the workflow runner. */
export interface WorkflowPrimitivesDeps {
  readonly callPrimitive: <R>(call: T.PrimitiveCall<R>) => Promise<R>;
  readonly runBlackBoxed: <R>(fn: () => Promise<R>) => Promise<R>;
  readonly spentAgentTokens: () => number;
  readonly hostNow: () => number;
  readonly llm: LlmDispatcher;
  readonly budgetTotal: number;
  readonly onPhase: (title: string) => void;
  readonly onLog: (message: string) => void;
  /** Run a sub-workflow body to completion. Absent for a nested workflow, which makes
   * `workflow()` throw (one level of nesting only). */
  readonly runSubWorkflow?: (ref: T.WorkflowRef, args: unknown) => Promise<unknown>;
}

export function createWorkflowPrimitives(deps: WorkflowPrimitivesDeps): WorkflowPrimitives {
  const runAgent = async (
    kind: "agent" | "agent.task",
    prompt: string,
    opts: {
      readonly schema?: Schema.Schema<unknown>;
      readonly model?: AgentOpts["model"];
      readonly label?: string;
      readonly phase?: string;
    },
  ): Promise<unknown> => {
    const { schema } = opts;
    const envelope = await deps.callPrimitive<AgentResultEnvelope>({
      kind,
      refId: kind,
      // Args hash covers the call identity (prompt + model/label/phase) but NOT the schema —
      // the schema is the output contract, not an input.
      args: { prompt, model: opts.model, label: opts.label, phase: opts.phase },
      exec: async () => {
        const res = await deps.llm({ kind, prompt, schema, model: opts.model });
        const output =
          schema === undefined
            ? res.text
            : await decodeWithSchema(schema, res.structured, "Invalid agent structured output");
        return { output, tokens: res.tokens };
      },
      decodeRecorded: async (recorded) => {
        const w = recorded as AgentResultEnvelope;
        const output =
          schema === undefined
            ? w.output
            : await decodeWithSchema(schema, w.output, "Invalid recorded agent output");
        return { output, tokens: w.tokens };
      },
    });
    return envelope.output;
  };

  const agent = ((prompt: string, opts: AgentOpts<unknown> = {}) =>
    runAgent("agent", prompt, opts)) as AgentFn;
  agent.task = <R>(opts: AgentTaskOpts<R>) =>
    runAgent("agent.task", opts.prompt, opts) as Promise<R>;

  const parallel = <R>(thunks: ReadonlyArray<() => Promise<R>>): Promise<Array<R | null>> =>
    deps.callPrimitive<Array<R | null>>({
      kind: "parallel",
      refId: "parallel",
      args: { thunkCount: thunks.length },
      exec: () =>
        deps.runBlackBoxed(() =>
          Promise.all(
            thunks.map((thunk) =>
              Promise.resolve()
                .then(thunk)
                .then(
                  (value) => value,
                  () => null,
                ),
            ),
          ),
        ),
      decodeRecorded: (recorded) => recorded as Array<R | null>,
    });

  const pipeline = (
    items: ReadonlyArray<unknown>,
    ...stages: PipelineStage[]
  ): Promise<unknown[]> =>
    deps.callPrimitive<unknown[]>({
      kind: "pipeline",
      refId: "pipeline",
      args: { itemCount: items.length, stageCount: stages.length },
      exec: () =>
        deps.runBlackBoxed(() =>
          Promise.all(
            items.map(async (item, index) => {
              try {
                let prev: unknown = item;
                for (const stage of stages) prev = await stage(prev, item, index);
                return prev;
              } catch {
                return null;
              }
            }),
          ),
        ),
      decodeRecorded: (recorded) => recorded as unknown[],
    });

  const workflow = (ref: T.WorkflowRef, args?: unknown): Promise<unknown> => {
    const runSub = deps.runSubWorkflow;
    if (runSub === undefined) {
      throw new WorkflowError(
        "workflow() supports one level of nesting only: a sub-workflow cannot call workflow() again.",
      );
    }
    return deps.callPrimitive<unknown>({
      kind: "workflow",
      refId: "workflow",
      args: { workflowName: ref.path, subArgs: args ?? null },
      exec: () => deps.runBlackBoxed(() => runSub(ref, args)),
      decodeRecorded: (recorded) => recorded,
    });
  };

  const wait = async (durationMs: number): Promise<void> => {
    const { deadline } = await deps.callPrimitive<{ readonly deadline: number }>({
      kind: "wait",
      refId: "wait",
      args: { durationMs },
      // Live: pin the deadline off the host clock (real time advances, so this is not the
      // journaled `now`). Replay returns the recorded deadline without re-running this.
      exec: async () => ({ deadline: deps.hostNow() + durationMs }),
      decodeRecorded: (recorded) => recorded as { readonly deadline: number },
    });
    const remaining = deadline - deps.hostNow();
    if (remaining > 0) await sleep(remaining);
  };

  const budget: WorkflowBudget = {
    total: deps.budgetTotal,
    spent: () => deps.spentAgentTokens(),
    remaining: () => deps.budgetTotal - deps.spentAgentTokens(),
  };

  return {
    agent,
    parallel,
    pipeline,
    workflow,
    wait,
    budget,
    phase: (title: string) => deps.onPhase(title),
    log: (message: string) => deps.onLog(message),
  };
}
