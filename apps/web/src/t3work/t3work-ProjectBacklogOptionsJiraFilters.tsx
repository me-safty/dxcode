import type {
  AtlassianBacklogBoard,
  AtlassianBacklogSavedFilter,
  AtlassianBacklogSprint,
} from "~/t3work/backend/t3work-types";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "~/t3work/components/ui/t3work-menu";
import {
  menuShortcutClassName,
  menuSubPopupClassName,
  radioItemClassName,
  stackedRadioGroupClassName,
} from "~/t3work/t3work-ProjectBacklogOptionsMenuMeta";

const ALL_SAVED_FILTERS_VALUE = "__all_saved_filters__";
const ALL_SPRINTS_VALUE = "all";

export function ProjectBacklogOptionsJiraFilters({
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
  const hasBoards = boards.length > 0;
  const hasSprintOptions = hasBoards || sprints.length > 0;
  const selectedFilterLabel =
    savedFilters.find((savedFilter) => savedFilter.id === selectedFilterId)?.name ??
    "No saved filter";
  const selectedBoardValue =
    hasBoards && boards.some((board) => board.id === selectedBoardId)
      ? selectedBoardId
      : boards[0]?.id;
  const selectedBoardLabel =
    boards.find((board) => board.id === selectedBoardValue)?.name ?? "No sprint boards";
  const selectedSprintLabel = hasSprintOptions
    ? (sprints.find((sprint) => sprint.id === selectedSprintId)?.name ?? "All board issues")
    : "No sprints";

  return (
    <>
      <MenuSub>
        <MenuSubTrigger className={radioItemClassName}>
          Saved filter
          <MenuShortcut className={menuShortcutClassName}>{selectedFilterLabel}</MenuShortcut>
        </MenuSubTrigger>
        <MenuSubPopup className={menuSubPopupClassName}>
          <MenuRadioGroup
            className={stackedRadioGroupClassName}
            value={selectedFilterId ?? ALL_SAVED_FILTERS_VALUE}
            onValueChange={(value) =>
              onFilterChange(value === ALL_SAVED_FILTERS_VALUE ? undefined : value)
            }
          >
            <MenuRadioItem value={ALL_SAVED_FILTERS_VALUE} className={radioItemClassName}>
              No saved filter
            </MenuRadioItem>
            {savedFilters.map((savedFilter) => (
              <MenuRadioItem
                key={savedFilter.id}
                value={savedFilter.id}
                className={radioItemClassName}
              >
                {savedFilter.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubPopup>
      </MenuSub>

      <MenuSub>
        <MenuSubTrigger className={radioItemClassName}>
          Sprint board
          <MenuShortcut className={menuShortcutClassName}>{selectedBoardLabel}</MenuShortcut>
        </MenuSubTrigger>
        <MenuSubPopup className={menuSubPopupClassName}>
          {hasBoards ? (
            <MenuRadioGroup
              className={stackedRadioGroupClassName}
              value={selectedBoardValue ?? ""}
              onValueChange={(value) => onBoardChange(value)}
            >
              {boards.map((board) => (
                <MenuRadioItem key={board.id} value={board.id} className={radioItemClassName}>
                  {board.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          ) : (
            <MenuItem disabled className={radioItemClassName}>
              Jira did not return any sprint boards for this project yet.
            </MenuItem>
          )}
        </MenuSubPopup>
      </MenuSub>

      <MenuSub>
        <MenuSubTrigger className={radioItemClassName}>
          Sprint
          <MenuShortcut className={menuShortcutClassName}>{selectedSprintLabel}</MenuShortcut>
        </MenuSubTrigger>
        <MenuSubPopup className={menuSubPopupClassName}>
          {hasSprintOptions ? (
            <MenuRadioGroup
              className={stackedRadioGroupClassName}
              value={selectedSprintId ?? ALL_SPRINTS_VALUE}
              onValueChange={(value) =>
                onSprintChange(value === ALL_SPRINTS_VALUE ? undefined : value)
              }
            >
              <MenuRadioItem value={ALL_SPRINTS_VALUE} className={radioItemClassName}>
                All board issues
              </MenuRadioItem>
              {sprints.map((sprint) => (
                <MenuRadioItem key={sprint.id} value={sprint.id} className={radioItemClassName}>
                  {sprint.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          ) : (
            <MenuItem disabled className={radioItemClassName}>
              Jira did not return any sprints for this project yet.
            </MenuItem>
          )}
        </MenuSubPopup>
      </MenuSub>
    </>
  );
}
