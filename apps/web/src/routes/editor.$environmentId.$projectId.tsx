import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { FileWarningIcon } from "lucide-react";

import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { EditorPanel, type EditorMentionRef } from "../components/ide/EditorPanel";
import { startChatWithMention } from "../components/ide/editorMention";
import { selectProjectByRef, useStore } from "../store";

export interface EditorRouteSearch {
  /** Relative path of a file to open on load (e.g. from a pinned file). */
  file?: string | undefined;
  /** Relative path of a directory to reveal/expand on load. */
  reveal?: string | undefined;
}

export const Route = createFileRoute("/editor/$environmentId/$projectId")({
  validateSearch: (search: Record<string, unknown>): EditorRouteSearch => ({
    file: typeof search.file === "string" && search.file.length > 0 ? search.file : undefined,
    reveal:
      typeof search.reveal === "string" && search.reveal.length > 0 ? search.reveal : undefined,
  }),
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: EditorRouteView,
});

function EditorRouteView() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const environmentId = params.environmentId as EnvironmentId;
  const projectId = params.projectId as ProjectId;

  const project = useStore((state) => selectProjectByRef(state, { environmentId, projectId }));

  const handleMention = useCallback(
    (ref: EditorMentionRef) => {
      void startChatWithMention(scopeProjectRef(environmentId, projectId), ref, (options) =>
        navigate(options),
      );
    },
    [environmentId, projectId, navigate],
  );

  if (!project) {
    return (
      <SidebarInset className="flex h-svh min-h-0 flex-col items-center justify-center gap-3 bg-background text-muted-foreground md:h-dvh">
        <FileWarningIcon className="size-6" />
        <p className="text-sm">This project is not available.</p>
        <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/" })}>
          Back
        </Button>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden bg-background text-foreground md:h-dvh">
      <EditorPanel
        environmentId={environmentId}
        projectId={projectId}
        cwd={project.cwd}
        projectName={project.name}
        variant="page"
        onMention={handleMention}
        openFilePath={search.file}
        revealPath={search.reveal}
      />
    </SidebarInset>
  );
}
