/**
 * The Thread model (Epic 25 §The thread model) — the author-facing globals `thread`,
 * `spawnThread`, and `agent`, plus the `Thread` interface they hand back. An interactive
 * conversation IS the Handle pattern: every verb reduces to a `sent`/`resolved` pair routed
 * through {@link HandleDispatch}, so there is no separate suspension machinery.
 *
 * The 2×2 surface is recipient (Agent / User) × mode (ask = drive + await a typed reply /
 * notify = fire-and-forget):
 *   • `askAgent`   → `thread.turn`    (ask)  — start an agent turn, await its final message.
 *   • `notifyAgent`→ `thread.message` (one-way, recipient "agent") — post a message, no turn.
 *   • `askUser`    → `user.input`     (ask)  — request user input, await the reply.
 *   • `notifyUser` → `thread.message` (one-way, recipient "user") — a user-visible message.
 *   • `spawnThread`→ `thread.create`  (one-way) — make an isolated thread; its id is the
 *     `thread.create` correlationId, so it re-derives identically on replay.
 *   • `agent(p, o)`= `spawnThread(o).askAgent(p, o)` — one-shot; the thread is not retained.
 *
 * Ask verbs with a `schema` enforce it via an internal corrective-retry loop: the reply is
 * decoded against the schema, and on mismatch the verb re-asks (a fresh turn, a fresh `seq`)
 * up to {@link MAX_SCHEMA_ATTEMPTS} before throwing {@link SchemaExhaustedError}. Each attempt
 * is journaled, so the loop replays deterministically.
 */

import type * as Schema from "effect/Schema";

import type { MessageBroker } from "./t3work-sdk.broker.ts";
import { PermissionDeniedError, SchemaExhaustedError } from "./t3work-sdk.errors.ts";
import type { HandleDispatch, ReplyResolver } from "./t3work-sdk.handles.ts";
import { decodeWithSchema } from "./t3work-sdk.internal.ts";
import type { ModelSelection } from "./t3work-sdk.types.ts";

/** A reference to a thread the workflow can drive. `id` is the thread's stable id. */
export interface ThreadRef {
  readonly kind: "thread-ref";
  readonly id: string;
}

/** Options for an ask verb (`agent` / `askAgent` / `askUser`). */
export interface AskOpts<R = string> {
  readonly schema?: Schema.Schema<R>;
  readonly model?: ModelSelection;
}

/** Options for `spawnThread`. */
export interface SpawnThreadOpts {
  readonly name?: string;
  readonly model?: ModelSelection;
}

/** The one Thread type, shared by the ambient launching thread and any spawned one. */
export interface Thread {
  askAgent<R = string>(prompt: string, opts?: AskOpts<R>): Promise<R>;
  notifyAgent(msg: string): void;
  askUser<R = string>(question: string, opts?: AskOpts<R>): Promise<R>;
  notifyUser(msg: string): void;
  readonly id: ThreadRef;
}

/** The globals this module binds into the workflow body. */
export interface WorkflowThreadPrimitives {
  /** The thread the workflow runs in (the chat the user launched from); `undefined` if
   * headless (cron/automation, no chat surface). */
  readonly thread: Thread | undefined;
  readonly spawnThread: (opts?: SpawnThreadOpts) => Thread;
  readonly agent: <R = string>(prompt: string, opts?: AskOpts<R>) => Promise<R>;
}

/** One attempt + two corrective retries. */
const MAX_SCHEMA_ATTEMPTS = 3;

const SCHEMA_INSTRUCTION =
  "Respond with ONLY a single JSON value matching the required schema — no prose, no code fence.";

/** Coerce a raw reply into a value a schema can decode: parse a JSON string (tolerating a
 * ```json fence); pass objects through; leave an unparseable string as-is so the decode fails
 * and the retry loop fires. */
function coerceReply(reply: unknown): unknown {
  if (typeof reply !== "string") return reply;
  const unfenced = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    return reply;
  }
}

export function createThreadPrimitives(deps: {
  readonly dispatch: HandleDispatch;
  readonly broker: MessageBroker;
  readonly capabilities: ReadonlySet<string>;
  readonly launchThreadId: string | undefined;
  readonly defaultModel: ModelSelection | undefined;
}): WorkflowThreadPrimitives {
  const { dispatch, broker } = deps;
  const has = (cap: string): boolean => deps.capabilities.has(cap);

  const fireEnvelope =
    (kind: "thread.turn" | "thread.message" | "user.input", payload: unknown) =>
    (correlationId: string, resolver: ReplyResolver): Promise<void> =>
      broker.send({ correlationId, kind, payload }, resolver);

  /** Drive an ask verb (`thread.turn` / `user.input`) with the schema corrective-retry loop. */
  const askVerb = async <R>(
    kind: "thread.turn" | "user.input",
    threadId: string,
    basePrompt: string,
    opts: AskOpts<R> | undefined,
  ): Promise<R> => {
    const schema = opts?.schema;
    const model = opts?.model ?? deps.defaultModel;
    const promptField = kind === "thread.turn" ? "prompt" : "question";
    let prompt = schema === undefined ? basePrompt : `${basePrompt}\n\n${SCHEMA_INSTRUCTION}`;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const payload = { threadId, [promptField]: prompt, ...(model === undefined ? {} : { model }) };
      const correlationId = await dispatch.send({
        kind,
        refId: kind,
        args: payload,
        fire: fireEnvelope(kind, payload),
      });
      const reply = await dispatch.awaitResolution<unknown>(correlationId, undefined);
      if (schema === undefined) return String(reply) as R;
      try {
        return await decodeWithSchema(schema, coerceReply(reply), "Invalid thread reply");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (attempt >= MAX_SCHEMA_ATTEMPTS) {
          throw new SchemaExhaustedError(
            `${kind} on thread '${threadId}' did not satisfy the response schema after ${attempt} attempts: ${detail}`,
          );
        }
        prompt = `${basePrompt}\n\nYour previous reply did not match the required schema (${detail}). ${SCHEMA_INSTRUCTION}`;
      }
    }
  };

  const notify = (threadId: string, recipient: "agent" | "user", text: string): void => {
    const payload = { threadId, recipient, text };
    dispatch.sendOneWay({
      kind: "thread.message",
      refId: "thread.message",
      args: payload,
      fire: fireEnvelope("thread.message", payload),
    });
  };

  const denied = (cap: string, verb: string): (() => never) => () => {
    throw new PermissionDeniedError(
      `'${verb}' requires the '${cap}' capability. Add '${cap}' to this workflow's meta.capabilities.`,
    );
  };

  const withThreadModel = <R>(o: AskOpts<R> | undefined, threadModel: ModelSelection | undefined): AskOpts<R> => {
    const model = o?.model ?? threadModel;
    return { ...o, ...(model === undefined ? {} : { model }) };
  };

  const makeThread = (threadId: string, threadModel: ModelSelection | undefined): Thread => ({
    id: { kind: "thread-ref", id: threadId },
    askAgent: <R>(p: string, o?: AskOpts<R>) =>
      askVerb<R>("thread.turn", threadId, p, withThreadModel(o, threadModel)),
    notifyAgent: (msg: string) => notify(threadId, "agent", msg),
    askUser: has("user")
      ? <R>(q: string, o?: AskOpts<R>) => askVerb<R>("user.input", threadId, q, o)
      : (denied("user", "askUser") as Thread["askUser"]),
    notifyUser: has("user")
      ? (msg: string) => notify(threadId, "user", msg)
      : (denied("user", "notifyUser") as Thread["notifyUser"]),
  });

  const spawnThread = (opts?: SpawnThreadOpts): Thread => {
    const model = opts?.model ?? deps.defaultModel;
    const args = { ...(opts?.name === undefined ? {} : { name: opts.name }) };
    const threadId = dispatch.sendOneWay({
      kind: "thread.create",
      refId: "thread.create",
      args,
      fire: (correlationId, resolver) =>
        broker.send(
          {
            correlationId,
            kind: "thread.create",
            payload: {
              threadId: correlationId,
              ...(opts?.name === undefined ? {} : { name: opts.name }),
              ...(model === undefined ? {} : { model }),
            },
          },
          resolver,
        ),
    });
    return makeThread(threadId, model);
  };

  const agent = <R = string>(prompt: string, opts?: AskOpts<R>): Promise<R> =>
    spawnThread(opts?.model === undefined ? {} : { model: opts.model }).askAgent(prompt, opts);

  return {
    thread:
      deps.launchThreadId === undefined ? undefined : makeThread(deps.launchThreadId, deps.defaultModel),
    spawnThread,
    agent,
  };
}
