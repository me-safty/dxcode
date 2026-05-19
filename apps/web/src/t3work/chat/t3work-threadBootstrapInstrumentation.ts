import type { ThreadBootstrapDispatchState } from "~/t3work/chat/t3work-threadBootstrapPlan";
import {
  recordT3WorkThreadDebug,
  summarizeT3WorkServerThread,
} from "~/t3work/chat/t3work-threadDebug";

export function recordThreadBootstrapSkipped(input: { threadId: string; reason: string }) {
  recordT3WorkThreadDebug("thread-bootstrap.skipped", input);
}

export function recordThreadBootstrapPlan(input: {
  environmentId: string;
  threadId: string;
  canonicalProjectId: string;
  projectExists: boolean;
  action: ThreadBootstrapAction | "none";
  shouldEnsureProject: boolean;
  hasServerThread: boolean;
  hasInitialUserMessage: boolean;
  serverThread: unknown;
  dispatchState: ThreadBootstrapDispatchState;
}) {
  recordT3WorkThreadDebug("thread-bootstrap.plan", {
    environmentId: input.environmentId,
    threadId: input.threadId,
    canonicalProjectId: input.canonicalProjectId,
    projectExists: input.projectExists,
    action: input.action,
    shouldEnsureProject: input.shouldEnsureProject,
    hasServerThread: input.hasServerThread,
    hasInitialUserMessage: input.hasInitialUserMessage,
    serverThread: summarizeT3WorkServerThread(input.serverThread),
    dispatchState: {
      threadId: input.dispatchState.threadId,
      projectEnsured: input.dispatchState.projectEnsured,
      threadCreateSent: input.dispatchState.threadCreateSent,
      kickoffSent: input.dispatchState.kickoffSent,
    },
  });
}

export type ThreadBootstrapAction = "kickoff" | "create";

export function recordThreadBootstrapEvent(
  name:
    | "thread-bootstrap.project-create.start"
    | "thread-bootstrap.project-create.success"
    | "thread-bootstrap.project-create.ignored-error"
    | "thread-bootstrap.kickoff.start"
    | "thread-bootstrap.kickoff.success"
    | "thread-bootstrap.thread-create.start"
    | "thread-bootstrap.thread-create.success",
  input: {
    environmentId?: string;
    threadId: string;
    canonicalProjectId: string;
    projectWorkspaceRoot?: string;
    title?: string;
  },
) {
  recordT3WorkThreadDebug(name, {
    ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    threadId: input.threadId,
    canonicalProjectId: input.canonicalProjectId,
    ...(input.projectWorkspaceRoot ? { projectWorkspaceRoot: input.projectWorkspaceRoot } : {}),
    ...(input.title ? { title: input.title } : {}),
  });
}

export function recordThreadBootstrapFailure(input: {
  environmentId: string;
  threadId: string;
  canonicalProjectId: string;
  action: string;
  error: string;
}) {
  recordT3WorkThreadDebug("thread-bootstrap.failure", input);
}
