/**
 * Types for the 25.3 primitive layer — the LLM dispatcher the host injects, the per-call
 * `agent`/`agent.task` options, the token budget surface, and the internal journaled
 * wrapper for an agent result. Kept in their own module so `t3work-sdk.types.ts` (near its
 * additive-guard LOC ceiling) only has to add the run-option fields that reference them.
 */

import type * as Schema from "effect/Schema";

import type { ModelRef } from "./t3work-sdk.types.ts";

/** A per-call model choice: a project-configured provider-instance id + a typed `ModelRef`. */
export interface ModelSelection {
  readonly provider: string;
  readonly model: ModelRef;
}

/** What the host's {@link LlmDispatcher} is handed for one `agent`/`agent.task` invocation. */
export interface LlmRequest {
  readonly kind: "agent" | "agent.task";
  readonly prompt: string;
  // `| undefined` (not just `?`) so a caller can pass `schema`/`model` through unconditionally
  // under `exactOptionalPropertyTypes`.
  readonly schema?: Schema.Schema<unknown> | undefined;
  readonly model?: ModelSelection | undefined;
}

/** What the dispatcher returns: the raw text, the token count, and (when a schema was
 * supplied) the already-validated structured value. The engine journals the structured
 * value (or the text) plus the token count. */
export interface LlmResult {
  readonly text: string;
  readonly tokens: number;
  readonly structured?: unknown;
}

/**
 * The host-provided seam the engine calls to talk to a real LLM. It owns provider
 * selection, transient-error retries, schema validation + retry-on-mismatch (throwing
 * {@link SchemaExhaustedError} once exhausted), and token accounting. The engine only
 * journals the result and the token count.
 */
export type LlmDispatcher = (req: LlmRequest) => Promise<LlmResult>;

/** Options for `agent(prompt, opts?)`. `schema` is the contract (excluded from the args
 * hash); `model`/`label`/`phase` are part of the call identity. */
export interface AgentOpts<R = string> {
  readonly schema?: Schema.Schema<R>;
  readonly model?: ModelSelection;
  readonly label?: string;
  readonly phase?: string;
}

/** Options for `agent.task(opts)` — same shape as {@link AgentOpts} but the prompt rides in
 * `opts` and a `schema` is required (the call always returns a typed structured value). */
export interface AgentTaskOpts<R> {
  readonly prompt: string;
  readonly schema: Schema.Schema<R>;
  readonly model?: ModelSelection;
  readonly label?: string;
  readonly phase?: string;
}

/** The `budget` global: a runtime accumulator over the journaled `agent`/`agent.task`
 * token counts. Not journaled itself — reads are deterministic because they sum recorded
 * (or freshly-journaled) entries. */
export interface WorkflowBudget {
  readonly total: number;
  readonly spent: () => number;
  readonly remaining: () => number;
}

/** The internal journaled shape of an `agent`/`agent.task` call: the body-visible output
 * (text or structured) plus the token count budget reads. The body never sees the wrapper —
 * `agent()` unwraps `output` before returning. */
export interface AgentResultEnvelope {
  readonly output: unknown;
  readonly tokens: number;
}
