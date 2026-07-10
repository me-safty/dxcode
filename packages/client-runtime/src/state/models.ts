import type {
  EnvironmentId,
  OrchestrationMessage,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import type { ThreadDetailData } from "./windowedThread.ts";

export interface EnvironmentProject extends OrchestrationProjectShell {
  readonly environmentId: EnvironmentId;
}

export interface EnvironmentThreadShell extends OrchestrationThreadShell {
  readonly environmentId: EnvironmentId;
}

export type EnvironmentMessage = OrchestrationMessage;

export type EnvironmentThread = ThreadDetailData & {
  readonly environmentId: EnvironmentId;
};

export function scopeProject(
  environmentId: EnvironmentId,
  project: OrchestrationProjectShell,
): EnvironmentProject {
  return { ...project, environmentId };
}

export function scopeThreadShell(
  environmentId: EnvironmentId,
  thread: OrchestrationThreadShell,
): EnvironmentThreadShell {
  return { ...thread, environmentId };
}

export function scopeThread(
  environmentId: EnvironmentId,
  thread: ThreadDetailData,
): EnvironmentThread {
  return { ...thread, environmentId };
}

export function selectEnvironmentThreadShell(
  snapshot: OrchestrationShellSnapshot | null,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): EnvironmentThreadShell | null {
  const thread = snapshot?.threads.find((candidate) => candidate.id === threadId) ?? null;
  return thread ? scopeThreadShell(environmentId, thread) : null;
}
