import { useMemo, useRef, useState } from "react";
import { useBackend } from "~/t3work/backend/t3work-index";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import { useProjectDashboardInjectedContextAttachments } from "~/t3work/hooks/t3work-useProjectDashboardInjectedContextAttachments";
import type { ProjectDashboardKickoffAsideProps } from "~/t3work/t3work-ProjectDashboardKickoffAsideTypes";
import { EmbeddedThreadAside } from "~/t3work/t3work-EmbeddedThreadAside";
import { readProjectSetupProfileIdFromProject } from "~/t3work/hooks/t3work-createProjectBootstrap";
import { ProjectDashboardKickoffComposer } from "~/t3work/t3work-ProjectDashboardKickoffComposer";
import { T3workSidecarComposition } from "~/t3work/t3work-SidecarComposition";
import { useRunT3workDashboardRecipeAction } from "~/t3work/t3work-dashboardRecipeActions";
import { buildProjectDashboardSelectedRecipe } from "~/t3work/t3work-dashboardRecipeSelection";
import {
  areT3workRecipeQuickStartLaunchCustomizationsEqual,
  buildT3workSelectedRecipeKickoffLaunch,
  type T3workSelectedRecipeQuickStart,
} from "~/t3work/t3work-recipeQuickStartLaunch";
import { useT3workDashboardRecipeViewSummary } from "~/t3work/t3work-dashboardRecipeViewContext";
import { runT3workViewTransition } from "~/t3work/t3work-runViewTransition";
import { type T3workKickoffComposerHandle } from "~/t3work/t3work-TicketKickoffComposer";
import { buildSidecarSectionHost } from "~/t3work/t3work-sidecarSectionHost";

export function ProjectDashboardKickoffAside({
  project,
  dashboardMode,
  projectThreads,
  activeThread,
  providers,
  isConnected,
  onOpenThread,
  onOpenFullThread,
  onThreadKickoffConsumed,
  onKickoffThread,
}: ProjectDashboardKickoffAsideProps) {
  const backend = useBackend();
  const runDashboardRecipeAction = useRunT3workDashboardRecipeAction();
  const composerRef = useRef<T3workKickoffComposerHandle | null>(null);
  const profileId = readProjectSetupProfileIdFromProject(project);
  const { clearInjectedContextAttachments, injectedContextAttachments, removeContextAttachment } =
    useProjectDashboardInjectedContextAttachments(project.id);
  const [selectedRecipe, setSelectedRecipe] = useState<T3workSelectedRecipeQuickStart | null>(null);
  const currentViewSummary = useT3workDashboardRecipeViewSummary();
  const sidecarSurface =
    dashboardMode === "my-work" ? "project.dashboard.myWork" : "project.dashboard.backlog";

  const primaryWorkitemAttachment = useMemo(
    () => injectedContextAttachments.find((attachment) => attachment.kind === "jira-work-item"),
    [injectedContextAttachments],
  );
  const quickStartContextKeys = useMemo(() => {
    const keys = [
      "project.summary",
      dashboardMode === "my-work" ? "dashboard.my-work.summary" : "dashboard.backlog.summary",
    ];
    if (injectedContextAttachments.length > 0) {
      keys.push("attached-context.summary");
    }
    if (primaryWorkitemAttachment) {
      keys.push("selected-work.summary", "ticket.summary");
    }
    return keys;
  }, [dashboardMode, injectedContextAttachments.length, primaryWorkitemAttachment]);
  const quickStartRecipeInput = useMemo(
    () => ({
      backend,
      surface: "project.dashboard" as const,
      project,
      profileId,
      selectedWorkLabel: primaryWorkitemAttachment?.label ?? project.title,
      dashboardMode,
      currentViewSummary: currentViewSummary ?? undefined,
      ...(primaryWorkitemAttachment ? { resourceKind: "ticket" as const } : {}),
      ...(primaryWorkitemAttachment?.jiraIssueType
        ? { jiraIssueType: primaryWorkitemAttachment.jiraIssueType }
        : {}),
      contextAttachments: injectedContextAttachments,
      availableContextKeys: quickStartContextKeys,
    }),
    [
      backend,
      currentViewSummary,
      dashboardMode,
      injectedContextAttachments,
      primaryWorkitemAttachment,
      project,
      quickStartContextKeys,
    ],
  );
  const sidecarHost = useMemo(
    () =>
      buildSidecarSectionHost({
        placement: "sidecar.section",
        surface: sidecarSurface,
        projectId: project.id,
        stageKickoff: (recipe, customization) => {
          const nextSelectedRecipe = buildProjectDashboardSelectedRecipe({
            recipe,
            ...(customization ? { customization } : {}),
            runDashboardRecipeAction,
          });
          if (!nextSelectedRecipe) {
            return;
          }

          setSelectedRecipe((current) => {
            if (
              current?.recipe.id === nextSelectedRecipe.recipe.id &&
              areT3workRecipeQuickStartLaunchCustomizationsEqual(
                current.customization,
                nextSelectedRecipe.customization,
              )
            ) {
              return current;
            }

            return nextSelectedRecipe;
          });
        },
        openThread: onOpenThread,
      }),
    [onOpenThread, project.id, runDashboardRecipeAction, sidecarSurface],
  );

  if (activeThread) {
    return (
      <EmbeddedThreadAside
        thread={activeThread}
        projectId={project.id}
        projectTitle={project.title}
        {...(project.workspace?.rootPath
          ? { projectWorkspaceRoot: project.workspace.rootPath }
          : {})}
        {...(onOpenFullThread ? { onOpenFullThread: () => onOpenFullThread(activeThread.id) } : {})}
        onThreadKickoffConsumed={onThreadKickoffConsumed}
      />
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border/70 bg-background [view-transition-name:t3work-right-sidebar-panel]">
      <ScrollArea className="min-h-0 flex-1">
        <T3workSidecarComposition
          surface={sidecarSurface}
          profileId={profileId}
          host={sidecarHost}
          resolveSectionProps={(sectionId) => {
            if (sectionId === "quick-starts") {
              return {
                recipeInput: quickStartRecipeInput,
                ...(selectedRecipe?.recipe.id
                  ? { selectedRecipeId: selectedRecipe.recipe.id }
                  : {}),
              };
            }

            if (sectionId === "recent-conversations") {
              return { threads: projectThreads };
            }

            return undefined;
          }}
        />
      </ScrollArea>

      <ProjectDashboardKickoffComposer
        ref={composerRef}
        {...(selectedRecipe ? { selectedRecipe } : {})}
        onClearSelectedRecipe={() => setSelectedRecipe(null)}
        providers={providers}
        isConnected={isConnected}
        injectedContextAttachments={injectedContextAttachments}
        onRemoveContextAttachment={removeContextAttachment}
        onSubmit={(text, selection, runtimeMode, interactionMode, selectedToolIds) => {
          runT3workViewTransition(() => {
            const kickoff = selectedRecipe
              ? buildT3workSelectedRecipeKickoffLaunch({
                  selectedRecipe,
                  customMessage: text,
                })
              : {
                  kickoffMessage: text,
                  kickoffPending: true,
                };
            onKickoffThread(
              kickoff.kickoffMessage,
              kickoff.kickoffPending,
              selection,
              runtimeMode,
              interactionMode,
              selectedToolIds,
              injectedContextAttachments,
              selectedRecipe?.recipe.workflow,
            );
            clearInjectedContextAttachments();
            setSelectedRecipe(null);
          });
        }}
      />
    </aside>
  );
}
