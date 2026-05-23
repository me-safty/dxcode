import { useEffect, useState } from "react";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import type { ProjectShellProject } from "@t3tools/project-context";

import { CreateProjectDialog } from "~/t3work/t3work-CreateProjectDialog";
import type { ProjectKickoffThreadInput } from "~/t3work/t3work-kickoffTypes";
import type { ProjectThread } from "~/t3work/t3work-types";
import { runT3workViewTransition } from "~/t3work/t3work-runViewTransition";

import { ProjectBrowserEmptyWithChat } from "./t3work-AppMainContentShell";

export function AppMainContentHomeEmptyState({
  onCreate,
  onInlineProjectCreated,
  isFirstRunSetup,
  showAside,
  homeChatProject,
  homeChatProjectThreads,
  providers,
  isConnected,
  onOpenHomeThread,
  onKickoffHomeThread,
}: {
  onCreate: () => void;
  onInlineProjectCreated: (project: ProjectShellProject) => void;
  isFirstRunSetup: boolean;
  showAside: boolean;
  homeChatProject: ProjectShellProject | null;
  homeChatProjectThreads: ProjectThread[];
  providers: ReadonlyArray<ServerProvider>;
  isConnected: boolean;
  onOpenHomeThread: (threadId: string) => void;
  onKickoffHomeThread: (
    kickoffMessage: string,
    kickoffModelSelection: ModelSelection,
    kickoffRuntimeMode: RuntimeMode,
    kickoffInteractionMode: ProviderInteractionMode,
    selectedToolIds: ProjectKickoffThreadInput["selectedToolIds"],
    kickoffContextAttachments: ProjectKickoffThreadInput["kickoffContextAttachments"],
  ) => void;
}) {
  const [showInlineCreateWizard, setShowInlineCreateWizard] = useState(false);

  useEffect(() => {
    if (!isFirstRunSetup) {
      setShowInlineCreateWizard(false);
    }
  }, [isFirstRunSetup]);

  return (
    <ProjectBrowserEmptyWithChat
      onCreate={
        isFirstRunSetup
          ? () =>
              runT3workViewTransition(() => setShowInlineCreateWizard(true), {
                types: ["t3work-wizard-forward"],
              })
          : onCreate
      }
      showAside={showAside}
      emptyContent={
        showInlineCreateWizard ? (
          <CreateProjectDialog
            variant="inline"
            onClose={() =>
              runT3workViewTransition(() => setShowInlineCreateWizard(false), {
                types: ["t3work-wizard-back"],
              })
            }
            onCreated={(project) => {
              onInlineProjectCreated(project);
              setShowInlineCreateWizard(false);
            }}
          />
        ) : undefined
      }
      showInlineCreateWizard={showInlineCreateWizard}
      project={homeChatProject}
      projectThreads={homeChatProjectThreads}
      providers={providers}
      isConnected={isConnected}
      onOpenThread={onOpenHomeThread}
      onKickoffThread={onKickoffHomeThread}
    />
  );
}
