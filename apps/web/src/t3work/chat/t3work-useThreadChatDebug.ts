import { useEffect } from "react";

import type { BackendApi } from "~/t3work/backend/t3work-types";
import {
  recordT3WorkThreadDebug,
  summarizeT3WorkThreadEvent,
} from "~/t3work/chat/t3work-threadDebug";

type ThreadChatDebugInput = {
  backend: BackendApi | null | undefined;
  environmentId: string | null | undefined;
  projectId: string;
  threadId: string;
  projectWorkspaceRoot: string | undefined;
  canonicalProjectId: string;
  projectExists: boolean;
  hasInitialUserMessage: boolean;
  hasServerThread: boolean;
  serverThreadSummary: Record<string, unknown> | null;
};

export function useThreadChatDebug({
  backend,
  environmentId,
  projectId,
  threadId,
  projectWorkspaceRoot,
  canonicalProjectId,
  projectExists,
  hasInitialUserMessage,
  hasServerThread,
  serverThreadSummary,
}: ThreadChatDebugInput) {
  useEffect(() => {
    recordT3WorkThreadDebug("thread-chat-view.handoff", {
      environmentId,
      routeProjectId: projectId,
      threadId,
      projectWorkspaceRoot: projectWorkspaceRoot ?? null,
      canonicalProjectId,
      projectExists,
      hasInitialUserMessage,
      serverThread: serverThreadSummary,
    });
  }, [
    canonicalProjectId,
    environmentId,
    hasInitialUserMessage,
    projectExists,
    projectId,
    projectWorkspaceRoot,
    serverThreadSummary,
    threadId,
  ]);

  useEffect(() => {
    if (!backend) {
      recordT3WorkThreadDebug("thread-chat-view.subscribe-thread.skipped", {
        reason: "missing-backend",
        threadId,
      });
      return;
    }

    if (!hasServerThread) {
      recordT3WorkThreadDebug("thread-chat-view.subscribe-thread.skipped", {
        reason: "missing-server-thread",
        threadId,
      });
      return;
    }

    recordT3WorkThreadDebug("thread-chat-view.subscribe-thread.start", {
      environmentId,
      threadId,
    });

    const unsubscribe = backend.subscribeThread(threadId, (event) => {
      recordT3WorkThreadDebug("thread-chat-view.subscribe-thread.event", {
        threadId,
        event: summarizeT3WorkThreadEvent(event),
      });
    });

    return () => {
      recordT3WorkThreadDebug("thread-chat-view.subscribe-thread.stop", {
        environmentId,
        threadId,
      });
      unsubscribe();
    };
  }, [backend, environmentId, hasServerThread, threadId]);
}
