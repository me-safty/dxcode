import { CheckIcon, ChevronDownIcon, UserRoundIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import type { ProjectBacklogAssigneeFilterOption } from "~/t3work/t3work-projectBacklogUtils";

export function ProjectBacklogOverviewAssigneeFilter({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<ProjectBacklogAssigneeFilterOption>;
}) {
  const selectedOption =
    options.find((option) => option.value === value) ??
    options.find((option) => option.value === "__all__") ??
    options[0];
  const triggerLabel = selectedOption?.label ?? "All assignees";
  const statusText = `${options.length} assignee option${options.length === 1 ? "" : "s"}`;

  return (
    <Combobox
      items={options.map((option) => option.value)}
      value={value}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string" && nextValue) {
          onValueChange(nextValue);
        }
      }}
    >
      <ComboboxTrigger
        render={<Button variant="outline" size="xs" />}
        className="w-[11rem] justify-between gap-1.5 font-normal"
        aria-label="Filter backlog by assignee"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <UserRoundIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" side="bottom" className="w-[15rem]">
        <div className="border-b p-1">
          <ComboboxInput
            className="[&_input]:font-sans rounded-md"
            inputClassName="ring-0"
            placeholder="Search assignees..."
            showTrigger={false}
            size="sm"
          />
        </div>
        <ComboboxEmpty>No matching assignees.</ComboboxEmpty>
        <ComboboxList className="max-h-56">
          {options.map((option) => (
            <ComboboxItem
              key={option.value}
              value={option.value}
              className="text-xs"
              contentClassName="flex min-w-0 items-center gap-2"
            >
              <span className="truncate">{option.label}</span>
              {option.value === value ? <CheckIcon className="ml-auto size-3.5" /> : null}
            </ComboboxItem>
          ))}
        </ComboboxList>
        <ComboboxStatus>{statusText}</ComboboxStatus>
      </ComboboxPopup>
    </Combobox>
  );
}
