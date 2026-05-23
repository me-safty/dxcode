import type { ProjectDashboardMode } from "~/t3work/t3work-projectDashboardModeState";
import type { ProjectThread, ViewState } from "~/t3work/t3work-types";

export type ProjectThreadDisplayMode = "embedded" | "thread";

type ProjectThreadViewStateInput = {
  projectId: string;
  threadId: string;
  ticketId?: string;
  dashboardMode?: ProjectDashboardMode;
  displayMode?: ProjectThreadDisplayMode;
};

export function buildProjectThreadViewState({
  projectId,
  threadId,
  ticketId,
  dashboardMode,
  displayMode = "embedded",
}: ProjectThreadViewStateInput): ViewState {
  if (ticketId) {
    return {
      type: "ticket",
      projectId,
      ticketId,
      embeddedThreadId: threadId,
    };
  }

  if (dashboardMode || displayMode === "embedded") {
    return {
      type: "dashboard",
      projectId,
      embeddedThreadId: threadId,
    };
  }

  return {
    type: "thread",
    projectId,
    threadId,
  };
}

export function buildExistingProjectThreadViewState(
  projectId: string,
  thread: Pick<ProjectThread, "id" | "ticketId" | "dashboardMode">,
): ViewState {
  return buildProjectThreadViewState({
    projectId,
    threadId: thread.id,
    ...(thread.ticketId ? { ticketId: thread.ticketId } : {}),
    ...(thread.dashboardMode ? { dashboardMode: thread.dashboardMode } : {}),
    displayMode: thread.ticketId || thread.dashboardMode ? "embedded" : "thread",
  });
}

export function isEmbeddedProjectThread(
  thread: Pick<ProjectThread, "ticketId" | "dashboardMode"> | null | undefined,
): boolean {
  return Boolean(thread?.ticketId || thread?.dashboardMode);
}
