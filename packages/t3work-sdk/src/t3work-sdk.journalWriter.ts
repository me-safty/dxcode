/**
 * Append-only `journal.jsonl` writer. Holds one long-lived append fd and `fsync`s after
 * every line so the entry is durable before the engine returns. Stage-1 durability only;
 * stage-2 atomic-rename lives behind a separate epic.
 */

import { createRequire } from "node:module";

import type { JournalEntry } from "./t3work-sdk.journalReader.ts";

const nodeRequire = createRequire(import.meta.url);
interface NodeFsModule {
  readonly openSync: (path: string, flags: string) => number;
  readonly writeSync: (fd: number, data: string) => number;
  readonly fsyncSync: (fd: number) => void;
  readonly closeSync: (fd: number) => void;
}
const fs = nodeRequire("node:fs") as NodeFsModule;

export class JournalWriter {
  readonly path: string;
  private fd: number | undefined;

  constructor(journalPath: string) {
    this.path = journalPath;
    this.fd = fs.openSync(journalPath, "a");
  }

  append(entry: JournalEntry): void {
    if (this.fd === undefined) {
      throw new Error(`JournalWriter for '${this.path}' was used after dispose().`);
    }
    fs.writeSync(this.fd, `${JSON.stringify(toWire(entry))}\n`);
    fs.fsyncSync(this.fd);
  }

  dispose(): void {
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
      this.fd = undefined;
    }
  }
}

/** Build the on-disk wire object: wrap the result, or omit it for a `script-never` marker. */
function toWire(entry: JournalEntry): Record<string, unknown> {
  const base = {
    seq: entry.seq,
    callId: entry.callId,
    kind: entry.kind,
    refId: entry.refId,
    argsHash: entry.argsHash,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
  };
  if (entry.kind === "script-never") return base;
  return { ...base, result: entry.result === undefined ? { void: true } : { v: entry.result } };
}
