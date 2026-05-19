import { useCallback } from "react";
import type { MouseEvent } from "react";
import { useRouterState } from "@tanstack/react-router";
import { readLocalApi } from "~/localApi";
import { useT3WorkActiveChatStore } from "~/t3work/t3work-activeChatStore";
import { useT3WorkAddToChatStore } from "~/t3work/t3work-addToChatStore";
import { useBackend } from "~/t3work/backend/t3work-index";
import type { T3WorkContextAttachment } from "~/t3work/t3work-contextAttachment";
import {
  registerContextAttachmentRequest,
  syncContextAttachmentFromRequest,
} from "~/t3work/t3work-contextAttachmentSync";
import {
  buildContextAttachment,
  buildPendingContextAttachment,
  type AddToChatRequest,
} from "~/t3work/t3work-addToChatUtils";
import { parseActiveThreadFromPath } from "~/t3work/t3work-threadRoutePath";

function addContextAttachmentToThread(threadId: string, attachment: T3WorkContextAttachment): void {
  useT3WorkAddToChatStore.getState().enqueueThreadAttachment(threadId, attachment);
}

type AddToChatTarget =
  | { type: "thread"; threadId: string }
  | { type: "kickoff"; projectId: string; ticketId: string };

type ResolvedAddToChatTarget = AddToChatTarget | { type: "project"; projectId: string };

function enqueueAttachmentForTarget(
  target: ResolvedAddToChatTarget,
  attachment: T3WorkContextAttachment,
): void {
  if (target.type === "thread") {
    addContextAttachmentToThread(target.threadId, attachment);
    return;
  }

  if (target.type === "kickoff") {
    useT3WorkAddToChatStore.getState().enqueueKickoff({
      projectId: target.projectId,
      ticketId: target.ticketId,
      attachment,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  useT3WorkAddToChatStore.getState().enqueue({
    projectId: target.projectId,
    attachment,
    createdAt: new Date().toISOString(),
  });
}

function routeAttachmentUpdateToTarget(
  target: ResolvedAddToChatTarget,
  attachmentId: string,
  attachment: T3WorkContextAttachment,
): void {
  const state = useT3WorkAddToChatStore.getState();
  if (target.type === "thread") {
    state.replaceThreadAttachment(target.threadId, attachmentId, attachment);
    return;
  }
  if (target.type === "kickoff") {
    const replaced = state.replaceKickoffAttachment(
      target.projectId,
      target.ticketId,
      attachmentId,
      attachment,
    );
    if (!replaced) {
      enqueueAttachmentForTarget(target, attachment);
    }
    return;
  }

  const replaced = state.replaceProjectAttachment(target.projectId, attachmentId, attachment);
  if (!replaced) {
    enqueueAttachmentForTarget(target, attachment);
  }
}

export function useAddToChat() {
  const backend = useBackend();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeChatTarget = useT3WorkActiveChatStore((state) => state.target);

  const addToChatFromRequest = useCallback(
    async (request: AddToChatRequest, target?: AddToChatTarget) => {
      const resolvedTarget: ResolvedAddToChatTarget = target
        ? target
        : activeChatTarget && activeChatTarget.projectId === request.projectId
          ? activeChatTarget.type === "thread"
            ? { type: "thread", threadId: activeChatTarget.threadId }
            : {
                type: "kickoff",
                projectId: request.projectId,
                ticketId: activeChatTarget.ticketId,
              }
          : (() => {
              const activeThread = parseActiveThreadFromPath(pathname);
              if (activeThread && activeThread.projectId === request.projectId) {
                return { type: "thread" as const, threadId: activeThread.threadId };
              }
              return { type: "project" as const, projectId: request.projectId };
            })();

      const attachment = buildPendingContextAttachment({ request });
      registerContextAttachmentRequest(attachment.id, request);
      enqueueAttachmentForTarget(resolvedTarget, attachment);

      void syncContextAttachmentFromRequest({
        attachmentId: attachment.id,
        request,
        ...(backend ? { backend } : {}),
        onUpdate: (nextAttachment) => {
          routeAttachmentUpdateToTarget(resolvedTarget, attachment.id, nextAttachment);
        },
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to sync attached context.";
        routeAttachmentUpdateToTarget(
          resolvedTarget,
          attachment.id,
          buildContextAttachment({
            id: attachment.id,
            request,
            syncStatus: "error",
            syncError: message,
          }),
        );
      });
    },
    [activeChatTarget, backend, pathname],
  );

  const showAddToChatContextMenu = useCallback(
    async (event: MouseEvent, request: AddToChatRequest) => {
      event.preventDefault();
      event.stopPropagation();
      const localApi = readLocalApi();
      if (!localApi) {
        return;
      }
      const action = await localApi.contextMenu.show(
        [{ id: "add-to-chat", label: "Add to chat" }],
        { x: event.clientX, y: event.clientY },
      );
      if (action !== "add-to-chat") {
        return;
      }
      await addToChatFromRequest(request);
    },
    [addToChatFromRequest],
  );

  return {
    addToChatFromRequest,
    showAddToChatContextMenu,
  };
}
