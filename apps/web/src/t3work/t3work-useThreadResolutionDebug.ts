import { useEffect } from "react";

import { recordT3WorkThreadDebug } from "~/t3work/chat/t3work-threadDebug";

type ThreadResolutionDebugInput = {
  routeProjectId: string | null;
  routeThreadId: string | null;
  resolvedProjectId: string | null;
  resolvedProjectWorkspaceRoot: string | null;
  projectThreadCount: number;
  resolvedThreadId: string | null;
  resolvedThreadProjectId: string | null;
  resolvedThreadStatus: string | null;
  kickoffPending: boolean | null;
};

export function useThreadResolutionDebug({
  routeProjectId,
  routeThreadId,
  resolvedProjectId,
  resolvedProjectWorkspaceRoot,
  projectThreadCount,
  resolvedThreadId,
  resolvedThreadProjectId,
  resolvedThreadStatus,
  kickoffPending,
}: ThreadResolutionDebugInput) {
  useEffect(() => {
    if (!routeProjectId || !routeThreadId) {
      return;
    }

    recordT3WorkThreadDebug("app-main-content.thread-resolution", {
      routeProjectId,
      routeThreadId,
      resolvedProjectId,
      resolvedProjectWorkspaceRoot,
      projectThreadCount,
      resolvedThreadId,
      resolvedThreadProjectId,
      resolvedThreadStatus,
      kickoffPending,
    });
  }, [
    kickoffPending,
    projectThreadCount,
    resolvedProjectId,
    resolvedProjectWorkspaceRoot,
    resolvedThreadId,
    resolvedThreadProjectId,
    resolvedThreadStatus,
    routeProjectId,
    routeThreadId,
  ]);
}
