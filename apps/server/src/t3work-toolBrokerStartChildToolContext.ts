import { type ThreadId } from "@t3tools/contracts";

import type { T3workTurnToolContext } from "./t3work-toolBroker.ts";

type ThreadToolContextView = {
  readonly kind?: unknown;
  readonly ticketId?: unknown;
  readonly displayMode?: unknown;
};

function readThreadToolContextView(
  toolContext: T3workTurnToolContext | undefined,
): ThreadToolContextView | undefined {
  if (!toolContext || toolContext.surface !== "t3work") {
    return undefined;
  }
  if (
    !toolContext.state ||
    typeof toolContext.state !== "object" ||
    Array.isArray(toolContext.state)
  ) {
    return undefined;
  }

  const rawView = (toolContext.state as { readonly view?: unknown }).view;
  if (!rawView || typeof rawView !== "object" || Array.isArray(rawView)) {
    return undefined;
  }

  const candidate = rawView as ThreadToolContextView;
  return candidate.kind === "thread" ? candidate : undefined;
}

export function readTicketIdFromThreadToolContext(
  toolContext: T3workTurnToolContext | undefined,
): string | undefined {
  const candidate = readThreadToolContextView(toolContext);
  if (typeof candidate?.ticketId !== "string") {
    return undefined;
  }

  const ticketId = candidate.ticketId.trim();
  return ticketId.length > 0 ? ticketId : undefined;
}

export function readThreadDisplayModeFromToolContext(
  toolContext: T3workTurnToolContext | undefined,
): "embedded" | "thread" | undefined {
  const displayMode = readThreadToolContextView(toolContext)?.displayMode;
  return displayMode === "embedded" || displayMode === "thread" ? displayMode : undefined;
}

export function createChildThreadToolContext(input: {
  readonly parentToolContext: T3workTurnToolContext | undefined;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly ticketId?: string;
}): T3workTurnToolContext | undefined {
  const { parentToolContext } = input;
  if (!parentToolContext || parentToolContext.surface !== "t3work") {
    return undefined;
  }

  return {
    surface: "t3work",
    tools: parentToolContext.tools,
    state: {
      view: {
        kind: "thread",
        projectId: input.projectId,
        projectTitle: input.projectTitle,
        workspaceRoot: input.workspaceRoot,
        threadId: input.threadId,
        threadTitle: input.threadTitle,
        displayMode: "thread",
        ...(input.ticketId ? { ticketId: input.ticketId } : {}),
      },
    },
  };
}
