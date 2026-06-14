/**
 * The Thread model (Epic 25 §The thread model) — the author-facing globals `thread`,
 * `spawnThread`, and `agent`, plus the `Thread` interface they hand back. An interactive
 * conversation IS the Handle pattern: every verb reduces to a `sent`/`resolved` pair routed
 * through {@link HandleDispatch}, so there is no separate suspension machinery.
 *
 * The 2×2 surface is recipient (Agent / User) × mode (ask = drive + await a typed reply /
 * notify = fire-and-forget): `askAgent`→`thread.turn`, `notifyAgent`→`thread.message`,
 * `askUser`→`user.input`, `notifyUser`→`thread.message`. `spawnThread`→`thread.create` makes
 * an isolated thread whose id is the `thread.create` correlationId (so it re-derives on
 * replay), and `agent(p, o)` = `spawnThread(o).askAgent(p, o)` (one-shot, thread not retained).
 *
 * Ask verbs with a `schema` enforce it via an internal corrective-retry loop: on a decode
 * mismatch the verb re-asks (fresh turn, fresh `seq`) up to {@link MAX_SCHEMA_ATTEMPTS} before
 * throwing {@link SchemaExhaustedError}. Each attempt is journaled, so the loop replays.
 */

import { schemaToAffordance } from "./t3work-sdk.affordance.ts";
import type { MessageBroker } from "./t3work-sdk.broker.ts";
import { PermissionDeniedError, SchemaExhaustedError } from "./t3work-sdk.errors.ts";
import type { HandleDispatch, ReplyResolver } from "./t3work-sdk.handles.ts";
import { decodeWithSchema } from "./t3work-sdk.internal.ts";
import type {
  AskOpts,
  AskUserOpts,
  SpawnThreadOpts,
  Thread,
  WorkflowThreadPrimitives,
} from "./t3work-sdk.threadTypes.ts";
import type { ModelSelection } from "./t3work-sdk.types.ts";

export type {
  AskOpts,
  AskUserAttachment,
  AskUserOpts,
  SpawnThreadOpts,
  Thread,
  ThreadRef,
  WorkflowThreadPrimitives,
} from "./t3work-sdk.threadTypes.ts";

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
    opts: AskUserOpts<R> | undefined,
  ): Promise<R> => {
    const schema = opts?.schema;
    const model = opts?.model ?? deps.defaultModel;
    const promptField = kind === "thread.turn" ? "prompt" : "question";
    // A `user.input` carries everything the host needs to render the decision card: the
    // affordance descriptor derived from the schema (the live schema object stays inside the
    // runtime) and the attachment refs. Derivation is a pure AST walk, so the payload — and its
    // argsHash — re-derives identically on replay. `{ kind: "text" }` is the host's implicit
    // default and is OMITTED, keeping the journaled payload byte-identical to pre-card journals
    // for every non-choice ask — a run parked on an older askUser still resumes. (A run parked
    // on a string-literal-schema askUser recorded before decision cards existed is the one
    // shape that drifts; none can predate the feature.)
    const affordance = kind === "user.input" ? schemaToAffordance(schema) : undefined;
    const choice = affordance?.kind === "choice" ? affordance : undefined;
    const attachments = kind === "user.input" ? opts?.attachments : undefined;
    const renderFields = {
      ...(affordance === undefined || affordance.kind === "text" ? {} : { affordance }),
      ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
    };
    // A choice renders as buttons — the JSON-reply instruction would mislead the user (and leak
    // into the card), so a choice ask keeps the bare question; its corrective re-ask names the
    // offered options instead.
    const correctiveInstruction =
      choice === undefined ? SCHEMA_INSTRUCTION : `Reply with exactly one of: ${choice.options.join(", ")}.`;
    // A reply that IS one of the offered options needs no JSON coercion — the literal string
    // (field-wrapped for a fielded choice) is the value. Running coerceReply on it would corrupt
    // JSON-parseable options ("true" → boolean, "42" → number) and fail the literal decode.
    const coerceChoiceReply = (value: unknown): unknown => {
      if (choice !== undefined && typeof value === "string" && choice.options.includes(value)) {
        return choice.field === undefined ? value : { [choice.field]: value };
      }
      return coerceReply(value);
    };
    let prompt =
      schema === undefined || choice !== undefined ? basePrompt : `${basePrompt}\n\n${SCHEMA_INSTRUCTION}`;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const payload = {
        threadId,
        [promptField]: prompt,
        ...renderFields,
        ...(model === undefined ? {} : { model }),
      };
      const correlationId = await dispatch.send({
        kind,
        refId: kind,
        args: payload,
        fire: fireEnvelope(kind, payload),
      });
      const reply = await dispatch.awaitResolution<unknown>(correlationId, undefined);
      if (schema === undefined) return String(reply) as R;
      try {
        return await decodeWithSchema(schema, coerceChoiceReply(reply), "Invalid thread reply");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (attempt >= MAX_SCHEMA_ATTEMPTS) {
          throw new SchemaExhaustedError(
            `${kind} on thread '${threadId}' did not satisfy the response schema after ${attempt} attempts: ${detail}`,
          );
        }
        prompt = `${basePrompt}\n\nYour previous reply did not match the required schema (${detail}). ${correctiveInstruction}`;
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
      ? <R>(q: string, o?: AskUserOpts<R>) => askVerb<R>("user.input", threadId, q, o)
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
