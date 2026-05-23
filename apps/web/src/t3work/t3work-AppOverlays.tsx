import type { ProjectShellProject } from "@t3tools/project-context";

import { T3workCommandPalette } from "~/t3work/components/t3work-CommandPalette";
import { ManageProjectRepositoriesDialog } from "~/t3work/t3work-ManageProjectRepositoriesDialog";
import { CreateProjectDialog } from "~/t3work/t3work-CreateProjectDialog";
import type { ProjectTicket, ProjectThread, ThreadSortOrder } from "~/t3work/t3work-types";

type AppOverlaysProps = {
  showCreate: boolean;
  setShowCreate: (open: boolean) => void;
  onProjectCreated?: (project: ProjectShellProject) => void;
  addProject: (project: ProjectShellProject) => void;
  projects: ReadonlyArray<ProjectShellProject>;
  threads: ReadonlyArray<ProjectThread>;
  threadSortOrder: ThreadSortOrder;
  getTicketsForProject: (projectId: string) => ReadonlyArray<ProjectTicket>;
  onSelectProject: (projectId: string) => void;
  onSelectTicket: (projectId: string, ticketId: string) => void;
  onSelectThread: (projectId: string, threadId: string) => void;
  onOpenSettings?: () => void;
  showSearchPalette: boolean;
  setShowSearchPalette: (open: boolean) => void;
  manageRepositoriesProject: ProjectShellProject | null;
  setManageRepositoriesProjectId: (projectId: string | null) => void;
  updateProject: (projectId: string, project: ProjectShellProject) => void;
};

export function AppOverlays({
  showCreate,
  setShowCreate,
  onProjectCreated,
  addProject,
  projects,
  threads,
  threadSortOrder,
  getTicketsForProject,
  onSelectProject,
  onSelectTicket,
  onSelectThread,
  onOpenSettings,
  showSearchPalette,
  setShowSearchPalette,
  manageRepositoriesProject,
  setManageRepositoriesProjectId,
  updateProject,
}: AppOverlaysProps) {
  return (
    <>
      {showCreate ? (
        <CreateProjectDialog
          onClose={() => setShowCreate(false)}
          onCreated={(project) => {
            addProject(project);
            onProjectCreated?.(project);
            if (!onProjectCreated) {
              setShowCreate(false);
            }
          }}
        />
      ) : null}

      <T3workCommandPalette
        open={showSearchPalette}
        onOpenChange={setShowSearchPalette}
        projects={projects}
        threads={threads}
        threadSortOrder={threadSortOrder}
        getTicketsForProject={getTicketsForProject}
        onSelectProject={onSelectProject}
        onSelectTicket={onSelectTicket}
        onSelectThread={onSelectThread}
        onOpenSettings={onOpenSettings}
        onOpenCreateProject={() => setShowCreate(true)}
      />

      {manageRepositoriesProject ? (
        <ManageProjectRepositoriesDialog
          project={manageRepositoriesProject}
          onClose={() => setManageRepositoriesProjectId(null)}
          onProjectUpdated={(nextProject) => updateProject(nextProject.id, nextProject)}
        />
      ) : null}
    </>
  );
}
