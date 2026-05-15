import { useEffect, useMemo, useRef } from "react";
import {
  DEFAULT_MODEL,
  DEFAULT_RUNTIME_MODE,
  ProviderInstanceId,
  type ModelSelection,
  type RuntimeMode,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import ChatView from "~/components/ChatView";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { useStore } from "~/store";
import { createThreadSelectorByRef } from "~/storeSelectors";
import { useBackend } from "~/t3work/backend/t3work-index";

export interface ThreadChatViewProps {
  threadId: string;
  projectId: string;
  projectTitle: string;
  projectWorkspaceRoot?: string;
  title: string;
  onBack?: () => void;
  hideHeader?: boolean;
  initialUserMessage?: string;
  initialModelSelection?: ModelSelection;
  initialRuntimeMode?: RuntimeMode;
  initialInteractionMode?: ProviderInteractionMode;
  onInitialUserMessageSent?: () => void;
}

export function ThreadChatView({
  threadId,
  projectId,
  projectTitle,
  projectWorkspaceRoot,
  title,
  initialUserMessage,
  initialModelSelection,
  initialRuntimeMode,
  initialInteractionMode,
  onInitialUserMessageSent,
}: ThreadChatViewProps) {
  const backend = useBackend();
  const environmentId = usePrimaryEnvironmentId();
  const threadRef = useMemo(
    () => (environmentId ? scopeThreadRef(environmentId, threadId as never) : null),
    [environmentId, threadId],
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const bootstrapSentRef = useRef(false);

  useEffect(() => {
    if (!backend || !environmentId || serverThread || bootstrapSentRef.current) {
      return;
    }

    bootstrapSentRef.current = true;
    const createdAt = new Date().toISOString();
    const kickoffModelSelection =
      initialModelSelection ??
      ({
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      } as ModelSelection);
    const kickoffRuntimeMode = initialRuntimeMode ?? DEFAULT_RUNTIME_MODE;
    const kickoffInteractionMode = initialInteractionMode ?? ("default" as ProviderInteractionMode);

    const ensureThread = async () => {
      if (projectWorkspaceRoot) {
        try {
          await backend.dispatchCommand({
            type: "project.create",
            commandId: crypto.randomUUID() as any,
            projectId: projectId as any,
            title: projectTitle,
            workspaceRoot: projectWorkspaceRoot,
            createWorkspaceRootIfMissing: true,
            defaultModelSelection: kickoffModelSelection,
            createdAt,
          });
        } catch {
          // Ignore duplicate/already-existing project errors; thread creation below is authoritative.
        }
      }

      if (initialUserMessage) {
        await backend.dispatchCommand({
          type: "thread.turn.start",
          commandId: crypto.randomUUID() as any,
          threadId: threadId as any,
          message: {
            messageId: crypto.randomUUID() as any,
            role: "user",
            text: initialUserMessage,
            attachments: [],
          },
          modelSelection: kickoffModelSelection,
          titleSeed: title,
          runtimeMode: kickoffRuntimeMode,
          interactionMode: kickoffInteractionMode,
          bootstrap: {
            createThread: {
              projectId: projectId as any,
              title,
              modelSelection: kickoffModelSelection,
              runtimeMode: kickoffRuntimeMode,
              interactionMode: kickoffInteractionMode,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        });
        onInitialUserMessageSent?.();
        return;
      }

      await backend.dispatchCommand({
        type: "thread.create",
        commandId: crypto.randomUUID() as any,
        threadId: threadId as any,
        projectId: projectId as any,
        title,
        modelSelection: kickoffModelSelection,
        runtimeMode: kickoffRuntimeMode,
        interactionMode: kickoffInteractionMode,
        branch: null,
        worktreePath: null,
        createdAt,
      });
    };

    void ensureThread().catch(() => {
      bootstrapSentRef.current = false;
    });
  }, [
    backend,
    environmentId,
    initialInteractionMode,
    initialModelSelection,
    initialRuntimeMode,
    initialUserMessage,
    onInitialUserMessageSent,
    projectId,
    projectTitle,
    projectWorkspaceRoot,
    serverThread,
    threadId,
    title,
  ]);

  if (!environmentId) {
    return <div className="flex min-h-0 flex-1 bg-background" />;
  }

  return <ChatView environmentId={environmentId} threadId={threadId as never} routeKind="server" />;
}
