import { scopeProjectRef } from "@t3tools/client-runtime";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { resolveProjectFaviconUrl } from "../components/ProjectFavicon";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { useDocumentFavicon } from "../lib/documentFavicon";
import {
  deriveProjectTitleName,
  formatDocumentTitle,
  useDocumentTitle,
} from "../lib/documentTitle";
import {
  createProjectSelectorByRef,
  createThreadSelectorAcrossEnvironments,
} from "../storeSelectors";
import { useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);

  const projectRef = useMemo(
    () =>
      draftSession ? scopeProjectRef(draftSession.environmentId, draftSession.projectId) : null,
    [draftSession],
  );
  const project = useStore(useMemo(() => createProjectSelectorByRef(projectRef), [projectRef]));
  const repoName = deriveProjectTitleName(project);
  useDocumentTitle(formatDocumentTitle(repoName ? `${repoName} · New thread` : "New thread"));
  useDocumentFavicon(
    project
      ? resolveProjectFaviconUrl({ environmentId: project.environmentId, cwd: project.cwd })
      : null,
  );

  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
