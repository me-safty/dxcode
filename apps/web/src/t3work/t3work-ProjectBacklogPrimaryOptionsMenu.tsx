import type {
  AtlassianBacklogBoard,
  AtlassianBacklogSavedFilter,
  AtlassianBacklogSprint,
} from "~/t3work/backend/t3work-types";
import {
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/t3work/components/ui/t3work-menu";
import { ProjectBacklogOptionsJiraFilters } from "~/t3work/t3work-ProjectBacklogOptionsJiraFilters";
import type { ProjectBacklogViewMode } from "~/t3work/t3work-projectBacklogPresentation";
import { projectBacklogViewModes } from "~/t3work/t3work-projectBacklogPresentation";
import type { ProjectBacklogFocusFilter } from "~/t3work/t3work-projectBacklogUtils";
import {
  getSelectedBacklogOptionLabel,
  menuShortcutClassName,
  menuSubPopupClassName,
  projectBacklogFocusFilterOptions,
  radioItemClassName,
  singleColumnRadioGroupClassName,
  twoColumnRadioGroupClassName,
} from "~/t3work/t3work-ProjectBacklogOptionsMenuMeta";

export function ProjectBacklogPrimaryOptionsMenu({
  viewMode,
  onViewModeChange,
  focusFilter,
  onFocusFilterChange,
  boards,
  sprints,
  savedFilters,
  selectedBoardId,
  selectedSprintId,
  selectedFilterId,
  onBoardChange,
  onSprintChange,
  onFilterChange,
}: {
  viewMode: ProjectBacklogViewMode;
  onViewModeChange: (value: ProjectBacklogViewMode) => void;
  focusFilter: ProjectBacklogFocusFilter;
  onFocusFilterChange: (value: ProjectBacklogFocusFilter) => void;
  boards: ReadonlyArray<AtlassianBacklogBoard>;
  sprints: ReadonlyArray<AtlassianBacklogSprint>;
  savedFilters: ReadonlyArray<AtlassianBacklogSavedFilter>;
  selectedBoardId: string | undefined;
  selectedSprintId: string | undefined;
  selectedFilterId: string | undefined;
  onBoardChange: (boardId: string) => void;
  onSprintChange: (sprintId: string | undefined) => void;
  onFilterChange: (filterId: string | undefined) => void;
}) {
  const selectedViewLabel = getSelectedBacklogOptionLabel(projectBacklogViewModes, viewMode);
  const selectedFilterLabel = getSelectedBacklogOptionLabel(
    projectBacklogFocusFilterOptions,
    focusFilter,
  );

  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>Display</MenuGroupLabel>

        <MenuSub>
          <MenuSubTrigger className={radioItemClassName}>
            View
            {selectedViewLabel ? (
              <MenuShortcut className={menuShortcutClassName}>{selectedViewLabel}</MenuShortcut>
            ) : null}
          </MenuSubTrigger>
          <MenuSubPopup className={menuSubPopupClassName}>
            <MenuRadioGroup
              className={twoColumnRadioGroupClassName}
              value={viewMode}
              onValueChange={(value) => onViewModeChange(value as ProjectBacklogViewMode)}
            >
              {projectBacklogViewModes.map((option) => (
                <MenuRadioItem
                  key={option.value}
                  value={option.value}
                  className={radioItemClassName}
                >
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>

        <MenuSub>
          <MenuSubTrigger className={radioItemClassName}>
            Filter
            {selectedFilterLabel ? (
              <MenuShortcut className={menuShortcutClassName}>{selectedFilterLabel}</MenuShortcut>
            ) : null}
          </MenuSubTrigger>
          <MenuSubPopup className={menuSubPopupClassName}>
            <MenuRadioGroup
              className={singleColumnRadioGroupClassName}
              value={focusFilter}
              onValueChange={(value) => onFocusFilterChange(value as ProjectBacklogFocusFilter)}
            >
              {projectBacklogFocusFilterOptions.map((option) => (
                <MenuRadioItem
                  key={option.value}
                  value={option.value}
                  className={radioItemClassName}
                >
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubPopup>
        </MenuSub>
      </MenuGroup>

      <MenuSeparator />

      <MenuGroup>
        <MenuGroupLabel>Jira</MenuGroupLabel>
        <ProjectBacklogOptionsJiraFilters
          boards={boards}
          sprints={sprints}
          savedFilters={savedFilters}
          selectedBoardId={selectedBoardId}
          selectedSprintId={selectedSprintId}
          selectedFilterId={selectedFilterId}
          onBoardChange={onBoardChange}
          onSprintChange={onSprintChange}
          onFilterChange={onFilterChange}
        />
      </MenuGroup>
    </>
  );
}
