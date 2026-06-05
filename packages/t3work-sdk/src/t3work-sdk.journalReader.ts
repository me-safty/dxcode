/**
 * Read and decode `.t3work-runs/<run-id>/journal.jsonl` into a `seq → JournalEntry` map.
 *
 * ── File shape ──────────────────────────────────────────────────────────────
 * One JSON object per line, one line per *journaled primitive call*, in `seq` order:
 *
 *   { seq, callId, kind, refId, argsHash, result?, startedAt, endedAt }
 *
 * The `result` field is a *result envelope*: `{ "v": <value> }` for a normal return, or
 * `{ "void": true }` for a handler that returned `undefined`. The wrapper is what lets a
 * `undefined`/void result survive the JSON round-trip — a bare `result: undefined` key
 * is silently dropped by `JSON.stringify`, and Effect Schema then rejects the missing key
 * on read. The envelope is ABSENT for `"script-never"` markers.
 *
 * ── Torn-tail recovery ──────────────────────────────────────────────────────
 * A single *torn final line* — the final line fails to parse AND the file does not end
 * in `\n` — is dropped with a warning (a crash mid-append is recoverable). Mid-file
 * corruption still fails loud.
 */

import { createRequire } from "node:module";

import * as Schema from "effect/Schema";

import type { PrimitiveKind } from "./t3work-sdk.types.ts";

const nodeRequire = createRequire(import.meta.url);
interface NodeFsModule {
  readonly existsSync: (path: string) => boolean;
  readonly readFileSync: (path: string, encoding: "utf8") => string;
}
const fs = nodeRequire("node:fs") as NodeFsModule;

/** The recorded return value, replayed verbatim instead of re-executing. */
const ResultEnvelopeSchema = Schema.Union([
  Schema.Struct({ v: Schema.Unknown }),
  Schema.Struct({ void: Schema.Literal(true) }),
]);

export const JournalEntrySchema = Schema.Struct({
  /** Monotonic per-run counter; the position this call occupies in the body's call order. */
  seq: Schema.Number,
  /** `"<seq>:<kind>:<refId>"` — stable identity of the call site for this run. */
  callId: Schema.String,
  kind: Schema.Literals([
    "tool",
    "script",
    "script-never",
    "now",
    "random",
    "uuid",
    "wait",
    "agent",
    "agent.task",
    "parallel",
    "pipeline",
    "workflow",
  ]),
  /** Tool id (e.g. `github.pull_request.merge`) or script registration name. */
  refId: Schema.String,
  /** SHA-256 (hex) of canonical-JSON args. Compared on replay to detect drift. */
  argsHash: Schema.String,
  /** Result envelope; absent for `script-never` markers. */
  result: Schema.optional(ResultEnvelopeSchema),
  startedAt: Schema.String,
  endedAt: Schema.String,
});

export interface JournalEntry {
  readonly seq: number;
  readonly callId: string;
  // Widest the journal `kind` can be (the {@link PrimitiveKind} union). Only the journaled
  // subset above is ever *written*; the read-side `Schema.Literals` validates that subset.
  readonly kind: PrimitiveKind;
  readonly refId: string;
  readonly argsHash: string;
  /**
   * The *unwrapped* recorded value (the envelope is an on-disk detail). `undefined` both
   * for a void handler result and for a `script-never` marker — disambiguate via `kind`:
   * a `"script-never"` entry is a marker that always re-runs and is never replayed.
   */
  readonly result: unknown;
  readonly startedAt: string;
  readonly endedAt: string;
}

// Hoisted: keep the compiled decoder at module scope (see no-inline-schema-compile).
const decodeJournalEntry = Schema.decodeUnknownSync(JournalEntrySchema);

function unwrapResult(wire: typeof JournalEntrySchema.Type): unknown {
  const envelope = wire.result;
  if (envelope === undefined || "void" in envelope) return undefined;
  return envelope.v;
}

/**
 * Read and validate every entry in a journal file, keyed by `seq`. A missing file yields
 * an empty map. A single torn final line is dropped with a warning; any other malformed
 * line throws loudly — a corrupt journal must not be silently replayed.
 */
export function readJournal(
  journalPath: string,
  onWarn: (message: string) => void = () => {},
): ReadonlyMap<number, JournalEntry> {
  const entries = new Map<number, JournalEntry>();
  if (!fs.existsSync(journalPath)) return entries;

  const text = fs.readFileSync(journalPath, "utf8");
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  let lastContentIndex = -1;
  for (const [index, rawLine] of lines.entries()) {
    if (rawLine.trim().length > 0) lastContentIndex = index;
  }

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const wire = decodeJournalEntry(parsed);
      entries.set(wire.seq, {
        seq: wire.seq,
        callId: wire.callId,
        kind: wire.kind,
        refId: wire.refId,
        argsHash: wire.argsHash,
        result: unwrapResult(wire),
        startedAt: wire.startedAt,
        endedAt: wire.endedAt,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (index === lastContentIndex && !endsWithNewline) {
        // Torn tail: a crash interrupted the final append before the newline landed.
        onWarn(
          `Dropping a torn final line in '${journalPath}' (line ${index + 1}): ${reason}. A crash likely interrupted the last append; the run resumes from the prior durable entry.`,
        );
        continue;
      }
      throw new Error(`Corrupt journal entry at ${journalPath}:${index + 1}: ${reason}`, {
        cause: error,
      });
    }
  }
  return entries;
}
