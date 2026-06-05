/**
 * Per-run plumbing: read the journal, build the tool/script handler contexts, run the
 * workflow body, and persist/verify the recorded inputs hash. The {@link executeRun}
 * entry point is shared by {@link startWorkflow} and {@link resumeWorkflow}.
 */

import * as DateTime from "effect/DateTime";

import { buildWorkflowPrimitives, runPreparedBody } from "./t3work-sdk.bodyRunner.ts";
import { hashArgs, hashPrefix } from "./t3work-sdk.canonicalJson.ts";
import {
  createDurableWorkflowRuntime,
  type DurableWorkflowRuntime,
} from "./t3work-sdk.durableRuntime.ts";
import { ReplayDriftError, WorkflowError } from "./t3work-sdk.errors.ts";
import { journalFilePath, readRunMeta, runDirPath, runMetaFilePath } from "./t3work-sdk.journal.ts";
import { readJournal } from "./t3work-sdk.journalReader.ts";
import { JournalWriter } from "./t3work-sdk.journalWriter.ts";
import { executeToolHandler, listRegisteredTools } from "./t3work-sdk.ts";
import type * as T from "./t3work-sdk.types.ts";

const noopLogger: T.ToolLogger = { info: () => {}, warn: () => {}, error: () => {} };
const unsupportedFetch: T.FetchLike = async () => {
  throw new WorkflowError(
    "This workflow run was started without a `fetch` implementation; provide one via run options to call tools that use it.",
  );
};
const unsupportedWorkspace: T.ToolWorkspace = {
  readText: async () => {
    throw new WorkflowError("This workflow run was started without a workspace filesystem.");
  },
  writeText: async () => {
    throw new WorkflowError("This workflow run was started without a workspace filesystem.");
  },
  exists: async () => false,
};

/** Host clock for journal timestamps. Workflow *bodies* are forbidden from reading wall-clock. */
export function nowIso(): string {
  return DateTime.formatIso(DateTime.nowUnsafe());
}

function buildRunContexts(opts: {
  readonly runId: string;
  readonly runDir: string;
  readonly options: T.WorkflowRunOptions;
}): { readonly toolCtx: T.ToolHandlerCtx; readonly scriptCtx: T.ScriptHandlerCtx } {
  const log = opts.options.log ?? noopLogger;
  const fetch = opts.options.fetch ?? unsupportedFetch;
  const workspace = opts.options.workspace ?? unsupportedWorkspace;
  const workspaceRoot = opts.options.workspaceRoot ?? opts.runDir;
  // Black-box nested dispatch: see the engine module header for why handlers don't journal.
  const shared = { runId: opts.runId, workspaceRoot, log, fetch, workspace };
  let toolCtxRef!: T.ToolHandlerCtx;
  const callTool = <I, R>(ref: T.ToolRef<I, R>, args: I) =>
    executeToolHandler(ref, args, toolCtxRef);
  toolCtxRef = { ...shared, callTool };
  return { toolCtx: toolCtxRef, scriptCtx: { ...shared, callTool } };
}

export async function executeRun<O>(opts: {
  readonly runId: string;
  readonly ref: T.WorkflowRef<unknown, O>;
  readonly args: unknown;
  readonly runsRoot: string;
  readonly options: T.WorkflowRunOptions;
}): Promise<O> {
  const runDir = runDirPath(opts.runsRoot, opts.runId);
  const journalPath = journalFilePath(opts.runsRoot, opts.runId);
  const log = opts.options.log ?? noopLogger;
  const journal = readJournal(journalPath, (message) => log.warn(message));
  const writer = new JournalWriter(journalPath);
  const toolRefs = opts.options.tools ?? listRegisteredTools();
  const scripts = opts.options.scripts ?? {};
  const scriptNames = new Map<T.AnyScriptRef, string>(
    Object.entries(scripts).map(([name, ref]) => [ref, name] as const),
  );
  const { toolCtx, scriptCtx } = buildRunContexts({
    runId: opts.runId,
    runDir,
    options: opts.options,
  });
  const runtime: DurableWorkflowRuntime = createDurableWorkflowRuntime({
    journal,
    writer,
    toolCtx,
    scriptCtx,
    scriptNames,
    filePath: opts.ref.absolutePath,
    nowIso,
  });
  try {
    const primitives = buildWorkflowPrimitives({
      runtime,
      options: opts.options,
      toolRefs,
      scripts,
    });
    const result = await runPreparedBody({
      runtime,
      ref: opts.ref,
      args: opts.args,
      toolRefs,
      scripts,
      primitives,
    });
    return result as O;
  } finally {
    writer.dispose();
  }
}

/** Verify a resume's args hash matches the recorded runMeta; seq-0 drift boundary. */
export function assertInputArgsMatch(opts: {
  readonly runsRoot: string;
  readonly runId: string;
  readonly args: unknown;
  readonly absolutePath: string;
}): void {
  const meta = readRunMeta(runMetaFilePath(opts.runsRoot, opts.runId));
  if (meta === undefined) return; // pre-this-version run, no recorded inputs to compare
  const suppliedHash = hashArgs(opts.args);
  if (meta.argsHash !== suppliedHash) {
    throw new ReplayDriftError({
      seq: 0,
      reason: "args",
      expected: { argsHash: hashPrefix(meta.argsHash) },
      observed: { argsHash: hashPrefix(suppliedHash) },
      filePath: opts.absolutePath,
    });
  }
}
