import {
  ProjectBacklogOverviewFilters,
  type ProjectBacklogOverviewFiltersProps,
} from "~/t3work/t3work-ProjectBacklogOverviewFilters";

export function ProjectBacklogOverview({ ...props }: ProjectBacklogOverviewFiltersProps) {
  return <ProjectBacklogOverviewFilters {...props} />;
}
