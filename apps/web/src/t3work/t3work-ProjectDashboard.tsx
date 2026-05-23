import { EllipsisIcon, Link2 } from "lucide-react";
import type { ProjectShellProject } from "@t3tools/project-context";
import { ScrollArea } from "~/t3work/components/ui/t3work-scroll-area";
import { SidebarTrigger } from "~/t3work/components/ui/t3work-sidebar";
import { t3SurfaceBackdrops } from "~/t3work/components/ui/t3work-surface";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/t3work/components/ui/t3work-menu";
import { AppProjectIcon } from "~/t3work/t3work-AppStatusBits";
import { ToggleGroup } from "~/t3work/t3work-ToggleGroup";
import { useProjectDashboardModeState } from "~/t3work/hooks/t3work-useProjectDashboardModeState";
import { ProjectDashboardBacklogView } from "~/t3work/t3work-ProjectDashboardBacklogView";
import { ProjectDashboardMyWorkView } from "~/t3work/t3work-ProjectDashboardMyWorkView";
import type { ProjectTicket } from "~/t3work/t3work-types";

export function ProjectDashboard({
  project,
  tickets: fallbackTickets,
  onOpenTicket,
  onManageRepositories,
}: {
  project: ProjectShellProject;
  tickets: ProjectTicket[];
  onOpenTicket: (projectId: string, ticketId: string) => void;
  onManageRepositories: (projectId: string) => void;
}) {
  const { state: dashboardState, setState: setDashboardState } = useProjectDashboardModeState(
    project.id,
  );
  const dashboardMode = dashboardState.dashboardMode;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="drag-region flex h-13 shrink-0 items-center gap-2 border-b border-border bg-gradient-to-b from-background to-muted/15 px-3 sm:px-5 wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <AppProjectIcon project={project} />
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <h2 className="min-w-0 truncate text-sm font-medium" title={project.title}>
            {project.title}
          </h2>
          <Menu>
            <MenuTrigger className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="start" side="bottom" className="min-w-48">
              <MenuItem onClick={() => onManageRepositories(project.id)}>
                <Link2 className="size-4" />
                Manage linked repositories
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </header>

      <section className={`h-full min-h-0 flex-1 ${t3SurfaceBackdrops.dashboardContent}`}>
        <ScrollArea className="h-full">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Project dashboard</h3>
                <p className="text-xs text-muted-foreground">
                  Switch between the sprint-planning backlog and the existing assigned-work view.
                </p>
              </div>
              <ToggleGroup
                value={dashboardMode}
                onChange={(value) => {
                  if (value !== "backlog" && value !== "my-work") {
                    return;
                  }

                  setDashboardState({ dashboardMode: value });
                }}
                options={[
                  { value: "backlog", label: "Backlog" },
                  { value: "my-work", label: "My work" },
                ]}
              />
            </div>

            {dashboardMode === "backlog" ? (
              <ProjectDashboardBacklogView project={project} onOpenTicket={onOpenTicket} />
            ) : (
              <ProjectDashboardMyWorkView
                project={project}
                fallbackTickets={fallbackTickets}
                onOpenTicket={onOpenTicket}
              />
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
