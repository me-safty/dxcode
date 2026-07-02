import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
  startFromOrigin: boolean;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface NewThreadDefaults {
  readonly envMode: DraftThreadEnvMode;
  readonly startFromOrigin: boolean;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
  readonly getNewThreadDefaults?: (environmentId: EnvironmentId) => NewThreadDefaults;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function threadMatchesProject(
  thread: ThreadContextLike | null | undefined,
  projectRef: ScopedProjectRef,
) {
  return (
    thread?.environmentId === projectRef.environmentId && thread.projectId === projectRef.projectId
  );
}

function resolveDefaultThreadOptions(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions | null {
  const defaults = context.getNewThreadDefaults?.(projectRef.environmentId) ?? null;
  if (!defaults) {
    return null;
  }

  return {
    envMode: defaults.envMode,
    startFromOrigin: defaults.startFromOrigin,
  };
}

function buildContextualThreadOptions(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions {
  const defaultOptions = resolveDefaultThreadOptions(context, projectRef);
  if (defaultOptions?.envMode === "worktree") {
    return defaultOptions;
  }

  const activeDraftThread = threadMatchesProject(context.activeDraftThread, projectRef)
    ? context.activeDraftThread
    : null;
  const activeThread = threadMatchesProject(context.activeThread, projectRef)
    ? context.activeThread
    : null;

  if (!activeDraftThread && !activeThread) {
    return defaultOptions ?? {};
  }

  return {
    branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
    worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
    envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
    ...(activeDraftThread
      ? { startFromOrigin: activeDraftThread.startFromOrigin }
      : defaultOptions?.startFromOrigin !== undefined
        ? { startFromOrigin: defaultOptions.startFromOrigin }
        : {}),
  };
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewThread(projectRef, buildContextualThreadOptions(context, projectRef));
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewThreadInProjectFromContext(context, projectRef);
  return true;
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
