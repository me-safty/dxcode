# Epic 25: Workflow Engine

## Purpose

This epic defines the **TS-native, replay-based durable-execution workflow engine** that
backs every action recipes can launch, every cross-thread interaction, and every script
that t3work runs on a user's behalf.

It supersedes the step-union JSON model and the forward-only execution loop described in
[Epic 16 — Workflows](./16-action-recipes.md#workflows). Recipes, surfaces, applicability,
and discovery are still owned by Epic 16; this epic owns the **engine** and the **author
surface**.

Treat this doc as authoritative for:

- workflow file shape (`.workflow.ts`),
- the `meta` block contract,
- the globals injected into the workflow body,
- the durable-execution / replay model,
- the determinism contract authors must follow (and how the engine enforces it),
- the `Handle<R>` pattern for primitives that fire something into the system,
- error classes and the workflow-catchable taxonomy,
- capability gating via `meta.capabilities`,
- how recipes thread typed workflow references into views.

## Why now

The current workflow runtime is a forward-only cursor over a persisted step list (see
[Epic 16 — Stateless, forward-only execution](./16-action-recipes.md)). It enables resume
across a single `collect-input` checkpoint and isolates per-step failures, but it cannot
express the things authors actually want:

- branching on the outcome of a previous step (try/catch, if/else),
- composing multiple LLM calls or scripts with intermediate transforms,
- structured request/response across threads or child sessions,
- escalation to the user mid-run with a typed reply,
- waiting on multi-hour or multi-day external events,
- safely calling another workflow as a sub-routine.

Today's authoring path is also a step-array of `{kind, …}` JSON objects with embedded
expression strings — exactly the heavy-JSON-config pattern that
[the project's authoring philosophy](./16-action-recipes.md#plugin-modules) rejects.

The new engine is **a real TypeScript workflow body** that runs under replay-based
durable execution (Temporal / Restate / DBOS / Inngest idiom). Authors write idiomatic
async TS with `try`/`catch`/`if`/`for` and call typed primitives. The engine journals
every primitive call and replays the body on resume to reach the next live call.

## Workflow file shape

A workflow lives in its own `.workflow.ts` file. There is no `defineWorkflow(async (ctx) => …)`
wrapper inside the file — the body **is** the function:

```ts
// .t3work/recipes/pr-review/actions/approve-and-merge.workflow.ts
import { Schema } from "effect";

export const Inputs = Schema.Struct({
  prId: Schema.String,
});

export const Outputs = Schema.Union(
  Schema.Struct({ status: Schema.Literal("merged"), sha: Schema.String }),
  Schema.Struct({ status: Schema.Literal("blocked"), reason: Schema.String }),
);

export const meta = {
  name: "pr-review.approve-and-merge",
  description: "Approve a PR and merge it, escalating on protected-branch errors.",
  inputs: Inputs,
  outputs: Outputs,
  capabilities: ["user", "tool:github.write"],
  phases: [{ title: "Approve" }, { title: "Merge" }],
};

const input = Schema.decodeSync(Inputs)(args);

phase("Approve");
await tool("github.pull_request.approve", { id: input.prId });

phase("Merge");
try {
  const { sha } = await tool("github.pull_request.merge", { id: input.prId });
  return { status: "merged", sha };
} catch (e) {
  if (e instanceof PermissionDeniedError) {
    const ask = await user.ask({
      title: "Branch protected — request admin override?",
      responseSchema: Schema.Struct({ proceed: Schema.Boolean }),
    });
    const decision = await ask.response;
    if (!decision.proceed) {
      return { status: "blocked", reason: "Branch protected; user declined override." };
    }
    const { sha } = await tool("github.pull_request.merge", {
      id: input.prId,
      adminOverride: true,
    });
    return { status: "merged", sha };
  }
  throw e;
}
```

Three things make this file shape work under replay:

1. **`meta` is the first non-`const`/non-`import` statement** and is itself a pure
   literal (or references to top-level `const`s declared above it in the same file). The
   loader evaluates the consts in a no-globals sandbox and then extracts `meta` without
   running the body — needed for the launcher UI, capability gating, and applicability
   matching.
2. **The body is implicit async with top-level await.** No `async function` wrapper; the
   engine wraps the module's top-level statements.
3. **`args` is a global**, validated against `meta.inputs` *before* the body runs. The
   `Schema.decodeSync(Inputs)(args)` line gives the body a typed handle without a build
   step.

Files conventionally live alongside the recipe that owns them, but workflows can also
live at the project root for shared use:

```text
.t3work/
  recipes/
    pr-review/
      recipe.ts
      actions/
        start-review.workflow.ts
        approve-and-merge.workflow.ts
        request-changes.workflow.ts
      views/
        PrItem.tsx
  workflows/
    release-notes-from-pr.workflow.ts       # shared, no recipe owner
```

Discovery is by filesystem scan for `*.workflow.ts`. Ownership comes from where
`defineWorkflow(path)` is called, not from where the file sits.

## The `meta` block

```ts
export const meta = {
  name: string;                          // required, kebab-case, unique within the project
  description: string;                   // required, one sentence
  inputs?:  Schema.Schema<unknown>;      // Effect Schema; validated before body runs
  outputs?: Schema.Schema<unknown>;      // Effect Schema; validated before result is returned
  capabilities?: ReadonlyArray<string>;  // gates which globals are bound; see §Capabilities
  phases?: ReadonlyArray<{ title: string; detail?: string }>; // progress UI groups
  model?: ModelSelection;                // default model for agent/agent.task calls
};
```

### Static-extraction rules

`meta` is read at workflow-load time **before** the body runs. The loader evaluates only
the top-level `const` declarations referenced by `meta` (e.g. `Inputs`, `Outputs`) in a
sandbox that exposes no engine primitives. This is what makes capability gating and
permission UI safe to display before the user authorizes execution.

What's allowed in `meta`:

- Pure literals.
- Identifiers bound to top-level `const`s declared above `meta` in the same file.
- Effect Schema combinators (`Schema.Struct`, `Schema.Union`, `Schema.Literal`, etc.) —
  these are pure and side-effect-free.
- Imports from `effect` and other declared-pure modules listed in the engine's allowlist.

What's forbidden in `meta`:

- Function calls that touch engine globals (`agent`, `script`, `tool`, …) — these aren't
  bound during meta extraction and will throw.
- Any expression with side effects (reads from `fs`, `process`, `globalThis`, …).
- Conditional logic (`?:`, `&&`, `||` in identity-affecting positions) — keep `meta`
  declarative.

## Globals — the surface

The engine injects globals into the workflow body. There are no `import` statements for
engine APIs. Authors get full IntelliSense via a `.workflow.ts`-specific ambient `.d.ts`
that ships with `@t3work/workflow-sdk`.

### LLM and orchestration (inherited from the Claude Code Workflow tool, adapted)

| Global                   | Returns                  | Notes                                                                                          |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `agent(prompt, opts?)`   | `Promise<string \| T>`   | Spawn a one-shot agent in a fresh context window. With `schema: Schema<T>`, returns typed `T`. |
| `agent.task(opts)`       | `Promise<T>`             | Non-interactive LLM call with a structured-output schema. Never touches a thread.              |
| `parallel(thunks)`       | `Promise<R[]>`           | Concurrent fanout with a barrier. Failing thunks resolve to `null`.                            |
| `pipeline(items, …stgs)` | `Promise<R[]>`           | Per-item pipelined fanout — no barrier between stages.                                         |
| `workflow(ref, args?)`   | `Promise<O>`             | Run another workflow inline as a sub-step. One level of nesting; cycles refused.               |
| `phase(title)`           | `void`                   | Start a progress group. Title must match a `meta.phases[].title`.                              |
| `log(message)`           | `void`                   | Emit a narrator line above the progress tree.                                                  |
| `args`                   | `unknown`                | The workflow's input; validated against `meta.inputs` before the body runs.                    |
| `budget`                 | `{ total, spent, remaining }` | Token budget shared with nested workflows.                                                |

### Side-effect primitives (the Handle pattern)

Every primitive that fires something into the system returns a `Handle<R>`. If the call
declares a `responseSchema`, the handle's type is `Handle<R>` with `.response: Promise<R>`.
If not, it's `Handle<never>` and `.response` is not on the type. See [§The Handle pattern](#the-handle-pattern) for the contract.

| Global                                  | Handle type                  | Purpose                                                          |
| --------------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `ui.show(view)`                         | `Handle<ResponseOf<View>>`   | Render a View into the current conversation as a system message. |
| `thread.send(target, payload, opts?)`   | `Handle<R>`                  | Send a payload to a thread (parent, child, or by id).            |
| `child.spawn(opts)`                     | `Handle<R>`                  | Spawn a child thread; inherits parent's context by default.      |
| `user.ask(opts)`                        | `Handle<R>`                  | Escalate to the user out-of-band; needs `responseSchema`.        |
| `user.notify(message \| view)`          | `Handle<never>`              | Fire-and-forget user notification (toast or escalation panel).   |

### Other primitives — durable timers and journaled side effects

| Global                          | Returns         | Notes                                                                                          |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `script(modulePath, args)`      | `Promise<T>`    | Run an arbitrary TS module from the project. Result is journaled.                              |
| `tool(name, args)`              | `Promise<T>`    | Call a broker tool. Gated by `meta.capabilities` (`tool:<group>`).                             |
| `wait(durationMs)`              | `Promise<void>` | Durable timer — suspends the workflow if the deadline hasn't passed. Survives server restart.  |
| `random()`                      | `number`        | Journaled `[0, 1)` PRNG. Use instead of `Math.random()`.                                       |
| `now()`                         | `number`        | Journaled epoch millis. Use instead of `Date.now()`.                                           |
| `uuid()`                        | `string`        | Journaled UUIDv4. Use instead of `crypto.randomUUID()`.                                        |

`script` and `tool` may take arbitrary wall-clock time but don't durably suspend — they
block on a Promise that the engine awaits and journals when it resolves. `wait` is the
only non-Handle primitive that can suspend the workflow durably across a server restart.

### Read-only ambient

| Global              | What it is                                                                          |
| ------------------- | ----------------------------------------------------------------------------------- |
| `context`           | The reactive Queryable surface from Epic 16 — `context.activeWorkItem`, etc.        |
| `views`             | View component refs imported from the owning recipe, addressable by id.             |
| `cancellation`      | A global `AbortSignal` for cooperative cancellation; pass into long-running calls.  |

### Error classes (also globals, also catchable)

```ts
class WorkflowError extends Error {}
class TimeoutError           extends WorkflowError {}
class SchemaExhaustedError   extends WorkflowError {}
class ProviderUnavailableError extends WorkflowError {}
class PermissionDeniedError  extends WorkflowError {}
class TargetMissingError     extends WorkflowError {}
class CancelledError         extends WorkflowError {}
class ReplayDriftError       extends WorkflowError {}
```

The engine classifies every primitive failure into exactly one of these. Authors use
`instanceof` for branching. Anything outside the taxonomy is an engine bug.

## The Handle pattern

All primitives that fire something into the system return a typed handle:

```ts
type Handle<R = never> = R extends never
  ? {
      readonly id: string;
      update(view: View<never>): Promise<void>;   // ui.show only
      dismiss(): Promise<void>;
    }
  : {
      readonly id: string;
      update(view: View<R>): Promise<void>;       // ui.show only — same response type
      dismiss(): Promise<void>;
      readonly response: Promise<R>;
    };
```

The handle's `id` is **stable across replay**. The engine guarantees that the same call
site, same args, same journal entry → same `id`. This is what makes `handle.update(...)`
and `handle.dismiss(...)` durable: they reference the original side effect by id, and the
engine knows which system message / which child thread / which open question they refer
to.

### Two-await pattern is canonical

```ts
const banner = await ui.show(views.statusBanner({ message: "Working…" }));
// banner: Handle<never>
banner.update(views.statusBanner({ message: "Done." }));

const card = await ui.show(views.approvalCard({ summary }));
// card: Handle<ApprovalDecision>
const decision = await card.response;
if (!decision.approved) { /* … */ }
```

Two awaits in the response case is honest — the first journals the render, the second
journals the user's reply. They're different events; the user's reply can take hours.
We deliberately do **not** ship `ui.collect` / `child.request` / `thread.request` as
separate primitives — the unified `Handle<R>` model is the only one.

If you want a one-liner for the common ask-and-await pattern, the SDK ships pure-sugar
helpers in its prelude:

```ts
const decision = await askView(views.approvalCard({ summary }));
const summary  = await askChild({ name: "Summarize", kickoffPrompt, responseSchema });
const decision = await askUser({ title, responseSchema });
```

Sugar only — they call the underlying primitive and `.then(h => h.response)`.

## The determinism contract — replay safety

> **This is the most important section of this doc.** The engine replays the workflow
> body from the top on every resume. Authors who break determinism break replay; the
> engine catches what it can but cannot catch everything.

### How replay works

Every primitive call writes a journal entry: `{ callId, argsHash, result, timestamp }`.
On resume:

1. The engine re-runs the workflow body from the top.
2. Each primitive call's `(callId, argsHash)` is compared against the journal.
3. **Matched:** return the recorded `result` synchronously without re-executing.
4. **Not journaled yet:** run the primitive live, journal the result, return it.
5. **Mismatched argsHash:** throw `ReplayDriftError` with the diverging call site.

`callId` is derived from the call's lexical position in the workflow body (file, line,
column) — not from a runtime counter. This is why **adding or removing primitive calls
between two existing ones is a workflow-version-incompatible change**: every call after
the insertion point shifts its lexical position.

### Rules authors must follow

**1. No ambient nondeterminism in workflow bodies.** Banned globals at workflow load
time (lint-checked; runtime throws if they leak in):

| Banned                          | Use instead                                        |
| ------------------------------- | -------------------------------------------------- |
| `Date.now()`, `new Date()`      | `now()` global (journaled)                         |
| `Math.random()`                 | `random()` global (journaled)                      |
| `crypto.randomUUID()`           | `uuid()` global (journaled)                        |
| `setTimeout`, `setInterval`     | `wait(ms)` global (journaled, suspend-aware)       |
| `fetch`                         | call from inside a `script` module — never inline  |
| `process.env`, `process.cwd()`  | pass via `args` or read from `context`             |
| Module-level mutable state      | `let`/`var` at module level is refused by the linter |

**2. Imports are types-only.** Runtime imports change the module graph on replay — if a
dependency's behavior changes between original run and resume, replay diverges. Only
`import type { … } from "…"` is allowed in `.workflow.ts` files. The linter enforces
this; the loader refuses files that contain non-type runtime imports.

The single exception is `import { Schema } from "effect"` (and other allowlisted
pure-value modules). The allowlist is hard-coded; you cannot extend it project-locally.

**3. Schema decode at top.** `const input = Schema.decodeSync(Inputs)(args)` runs once,
deterministically, before any primitive calls. Don't decode lazily; don't decode in a
branch.

**4. Pure code between primitive calls.** Computation between `await agent(...)` and the
next primitive call must be deterministic given the prior journaled results. If you
branch on `now() > someThreshold`, that's fine (`now()` is journaled). If you branch on
a closure over a mutable outer variable, you'll diverge.

**5. `script()` modules must be deterministic OR pinned.** The engine journals `script`
return values, so on replay you get the recorded result. But if the *original* run had a
non-deterministic script (e.g. `fetch` from a 3rd-party API that returns different data
on each call), the recorded value is correct for replay — what's wrong is making
*decisions* based on the assumption that re-running the script would produce the same
result. Authors should treat all `script()` results as journaled facts, not re-derivable
values.

For scripts that intentionally must run fresh (no replay), the engine offers
`script.fresh(modulePath, args)` — never journals, always re-runs. Use sparingly; this
breaks replay determinism for everything downstream.

### What the engine catches automatically

| Detected                                      | When                       | Effect                                  |
| --------------------------------------------- | -------------------------- | --------------------------------------- |
| Banned global usage (`Date.now`, etc.)        | Lint + workflow load time  | Workflow refuses to load                |
| Non-type runtime imports                      | Workflow load time         | Workflow refuses to load                |
| Module-level mutable state                    | Lint + load time           | Workflow refuses to load                |
| `meta` referencing non-extractable values     | Workflow load time         | Workflow refuses to load                |
| Mismatched `argsHash` on replay               | Replay execution           | `ReplayDriftError` at the diverging site|
| Primitive call after `cancellation` aborted   | Runtime                    | `CancelledError`                        |
| Capability mismatch (`tool` without `"tool:<group>"`) | Workflow load time | Workflow refuses to load                |

### What the engine cannot catch

| Not detected                                          | Mitigation                                        |
| ----------------------------------------------------- | ------------------------------------------------- |
| Branching on closure over a mutable outer variable    | Lint heuristic + determinism contract in docs     |
| `script` modules that read from non-journaled sources | Documented contract; reviewer eye                 |
| Non-deterministic order in `parallel` callbacks       | The engine journals each thunk's result in input order; order-of-completion is not part of state |
| Hoisted top-level `var` that's later reassigned       | Lint refuses module-level `let`/`var`             |

Authors who follow the rules get correctness for free. Authors who break them get loud,
specific errors at the boundary that broke (e.g. `ReplayDriftError` cites the file, line,
and a side-by-side hash of expected vs. observed args).

## Capability gating

`meta.capabilities` is a declarative allowlist that gates which globals are bound at
workflow-body-load time. A workflow that doesn't declare `"script"` has `script` as
`undefined` — calling it is an immediate `PermissionDeniedError` at the call site.

```ts
export const meta = {
  name: "release-notes-from-pr",
  capabilities: [
    "thread",                  // thread.send + handle responses
    "child",                   // child.spawn
    "user",                    // user.ask + user.notify
    "script",                  // script()
    "tool:github.read",        // tool() for github.read.*
    "tool:release-notes.write", // tool() for release-notes.write.*
  ],
  // …
};
```

The capability list:

| Capability         | Unlocks                                            |
| ------------------ | -------------------------------------------------- |
| `thread`           | `thread.send`                                      |
| `child`            | `child.spawn`                                      |
| `user`             | `user.ask`, `user.notify`                          |
| `script`           | `script()` and `script.fresh()`                    |
| `ui`               | `ui.show` (auto-granted if recipe has views)       |
| `tool:<group>`     | `tool()` for tools in that group                   |
| `workflow`         | `workflow()` (sub-workflow invocation)             |

Globals not listed in this table — `agent`, `agent.task`, `parallel`, `pipeline`, `phase`,
`log`, `args`, `budget`, `wait`, `random`, `now`, `uuid`, `context`, `views`,
`cancellation`, and the error classes — are **unconditionally bound**. They have no
capability gate because their effects are either contained to the workflow run (timers,
journaled values), gated elsewhere (`agent` and `agent.task` consume the workflow's
declared model), or read-only.

Capabilities surface in the **pre-execution permission UI** the user sees before any
workflow with elevated capabilities runs. This is the one place declarative JSON beats
TS-as-config — the user needs to see the request *before* executing the code that would
ask for it.

Nested workflows can declare a subset of the parent's capabilities but never a superset.
The engine intersects at invocation.

## Recipes and workflow references

A recipe imports workflow types via type-only imports and registers them as typed refs:

```ts
// .t3work/recipes/pr-review/recipe.ts
import type * as StartReview     from "./actions/start-review.workflow.ts";
import type * as ApproveAndMerge from "./actions/approve-and-merge.workflow.ts";
import type * as RequestChanges  from "./actions/request-changes.workflow.ts";

export const startReview     = defineWorkflow<typeof StartReview>("./actions/start-review.workflow.ts");
export const approveAndMerge = defineWorkflow<typeof ApproveAndMerge>("./actions/approve-and-merge.workflow.ts");
export const requestChanges  = defineWorkflow<typeof RequestChanges>("./actions/request-changes.workflow.ts");

export default defineRecipe({
  id: "pr-review",
  applicability: { /* … */ },
  surfaces: ["project.dashboard.myWork", "thread.context"],
  defaultAction: startReview,                                // typed binding
  sidecarSection:   defineSidecarSection({ /* … */ }),
  conversationCard: defineConversationCard({ /* … */ }),
});
```

`defineWorkflow<typeof Module>("./path")` returns a `WorkflowRef<Inputs, Outputs>` whose
types are inferred from the file's exported `Inputs`/`Outputs` schemas via the type-only
import. The type-only import doesn't pull the workflow body into the host module graph at
runtime — TypeScript strips it — so the body stays sandboxed in the engine's VM at
invocation time.

View code consumes workflow refs by typed variable, with `host` injected as a prop:

```tsx
// .t3work/recipes/pr-review/views/PrItem.tsx
import { approveAndMerge, requestChanges } from "../recipe.ts";

export const PrItem = ({ pr, host }: PrItemProps) => (
  <div>
    <Button onClick={() => host.run(approveAndMerge, { prId: pr.id })}>
      Approve and merge
    </Button>
    <Button onClick={() => host.run(requestChanges, { prId: pr.id, reason: "…" })}>
      Request changes
    </Button>
  </div>
);
```

`host.run<I, O>(ref: WorkflowRef<I, O>, args: I): Promise<O>` is typed end-to-end. Wrong
args is a compile error. Missing fields is a compile error. The return type is the
workflow's declared `Outputs`. For long-running workflows where the view needs a handle
(progress, cancellation), use `host.start(ref, args): RunHandle<O>` — same args, returns
a richer handle with `status$`, `cancel()`, and `.result: Promise<O>`.

There is no string-keyed action registry on the recipe; views fire workflows directly via
the imported ref. The recipe's `defaultAction` is the only binding the launcher needs
statically — it's what the Quick Starts card / `/<slashAlias>` selection runs.

Sub-workflow invocation from inside another workflow body uses the `workflow()` global,
which also accepts a `WorkflowRef`:

```ts
// inside another .workflow.ts
import type * as Degraded from "./degraded.workflow.ts";
const degraded = defineWorkflow<typeof Degraded>("./degraded.workflow.ts");

// later in the body:
const result = await workflow(degraded, args);   // typed
```

A string form (`workflow("name-or-path", args)`) is supported as an escape hatch for
dynamic dispatch but returns `Promise<unknown>`.

## Agents vs. workflows — the asymmetry

Agents and workflows live in different runtime worlds, deliberately. Agents are
**in-flight** — the LLM streams tokens to its provider in a single open connection;
suspending an agent mid-turn means killing and re-establishing that connection. Workflows
are **durable** — every primitive call is a journaled checkpoint; suspending a workflow
parks it cheaply and resumes it on the next external event.

This asymmetry shapes the surface each side gets:

| Capability                                            | Agent | Workflow |
| ----------------------------------------------------- | ----- | -------- |
| Spawn a child thread                                  | ✅    | ✅       |
| Fire-and-forget message to another thread             | ✅    | ✅       |
| Receive messages from other threads                   | ✅ (inbound on next turn) | ✅ (via `Handle.response`) |
| Blocking ask with schema-typed response               | ❌    | ✅       |
| Escalate to user and await typed reply                | ❌    | ✅       |
| Branch on typed errors with try/catch                 | ❌    | ✅       |
| Compose multiple LLM calls with intermediate transforms | partial (in one turn) | ✅ |

Agents get the simplified, fire-and-forget surface (`t3work.thread.start_child`,
`t3work.thread.send` with `kind: "notify"`). Anything more — request/response,
suspend-and-resume, user escalation — belongs in a workflow.

When an agent needs schema-typed output, it spawns a workflow that does the work and
returns the typed result via `thread.send` to the agent's thread on the next turn. The
agent reads it as a normal inbound message. The workflow does the suspension.

## Implementation phasing

This engine is not yet built. The current runtime is the forward-only step-list cursor in
`apps/server/src/t3work-recipeWorkflowRuntime*.ts`. The migration:

| Phase | Scope                                                                                          | Status   |
| ----- | ---------------------------------------------------------------------------------------------- | -------- |
| 25.1  | `.workflow.ts` file loader + `meta` static extractor + `defineWorkflow` SDK + ambient types    | Planned  |
| 25.2  | Durable-execution engine prototype: journal, replay, `argsHash`, `ReplayDriftError`            | Planned  |
| 25.3  | Inherited primitives: `agent`, `agent.task`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow`; plus the journaled-value primitives `random`, `now`, `uuid`, `wait`, and the `script` / `tool` invocation primitives | Planned |
| 25.4  | Handle primitives: `ui.show`, `child.spawn`, `thread.send`, `user.ask`, `user.notify` (depends on the cross-thread messaging broker work catalogued in Epic 16) | Planned |
| 25.5  | Determinism enforcement: lint rules, banned-global throws, capability gating at load time      | Planned  |
| 25.6  | Migration tooling: legacy `recipe.json` + step-union → `.workflow.ts` conversion script        | Planned  |
| 25.7  | Retire the step-union runtime; remove `recipeWorkflowRuntime*` once all recipes migrated       | Planned  |

The old and new engines run side by side until phase 25.7. A recipe declares which engine
it's authored against via its module extension (`recipe.json` → old engine; `recipe.ts`
+ `*.workflow.ts` → new engine).

## Open questions

1. **VM isolation strategy.** Stage 1 trusts project code (current). Stage 2 needs real
   sandboxing — likely via `node:vm` + a frozen-realm pattern, or a worker thread with a
   tightly typed message channel. Decide before phase 25.2 ships.
2. **Journal storage.** Per-run journal lives in `runs/<run-id>/journal.jsonl` for MVP;
   long-term may move into the SQL-backed local cache from Epic 16. Append-only either
   way.
3. **`agent.task` model selection for cost discipline.** When `meta.model` declares a
   default and a single `agent.task` call wants a cheaper model, the per-call `model:`
   override should be a strict subset of the workflow's declared capability for that
   provider. Surface the rule in the lint.
4. **Cancellation semantics for `child.spawn` orphans.** When a parent workflow throws
   without explicitly dismissing a child handle, does the engine cascade-cancel the
   child? Default proposal: yes, on parent failure or cancellation, propagate
   `CancelledError` to all open handles' targets via `thread.cancelled` system messages.
5. **`view.update` schema-change semantics.** `handle.update(view)` for a handle with a
   response schema must take a `View<SameR>` — different response types require a new
   `show` + new handle. The lint enforces this; the type system also catches it.

## References

- [Epic 16: Action Recipes](./16-action-recipes.md) — recipe shape, discovery, surfaces,
  applicability, kickoff UX.
- [Epic 19: Workspace Miniapps](./19-workspace-miniapps.md) — View placements and the
  miniapp contract that `ui.show` renders against.
- [Epic 21: Context & Tool Catalog](./21-context-tool-catalog.md) — tool groups for
  `tool:<group>` capability gating.
- [Epic 24: Tiered Message Composition](./24-tiered-message-composition.md) — system
  message envelope and the three-author conversation model that workflow messages slot
  into.
- The Claude Code `Workflow` tool — the inspiration; this engine extends it with
  arbitrary script execution, child sessions, cross-thread messaging, user escalation,
  and capability gating.
