import type { ReviewCommit, TurnId } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useMemo } from "react";

import type { DiffPanelSelection } from "~/diffPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { formatRelativeTimeLabel, formatShortTimestamp } from "~/timestampFormat";
import type { TurnDiffSummary } from "~/types";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/menu";

export interface DiffScopeMenuItemsProps {
  readonly selection: DiffPanelSelection;
  readonly commits: ReadonlyArray<ReviewCommit>;
  readonly commitsPending: boolean;
  readonly turns: ReadonlyArray<TurnDiffSummary>;
  readonly turnAvailable?: boolean;
  readonly inferredTurnCountByTurnId: Readonly<Record<string, number>>;
  readonly onSelectWorkingTree: () => void;
  readonly onSelectBranch: () => void;
  readonly onSelectCommit: (sha: string) => void;
  readonly onSelectTurn: (turnId: TurnId) => void;
}

export function orderDiffTurns(
  turns: ReadonlyArray<TurnDiffSummary>,
  inferredTurnCountByTurnId: Readonly<Record<string, number>>,
): ReadonlyArray<TurnDiffSummary> {
  return [...turns].toSorted((left, right) => {
    const leftCount = left.checkpointTurnCount ?? inferredTurnCountByTurnId[left.turnId] ?? 0;
    const rightCount = right.checkpointTurnCount ?? inferredTurnCountByTurnId[right.turnId] ?? 0;
    return rightCount - leftCount || right.completedAt.localeCompare(left.completedAt);
  });
}

export function DiffScopeMenuItems(props: DiffScopeMenuItemsProps) {
  const settings = useClientSettings();
  const turns = useMemo(
    () => orderDiffTurns(props.turns, props.inferredTurnCountByTurnId),
    [props.inferredTurnCountByTurnId, props.turns],
  );
  const latestTurn = turns[0];

  return (
    <>
      <DropdownMenuItem onClick={props.onSelectWorkingTree}>
        <span>Working tree</span>
        {props.selection.kind === "working-tree" && <CheckIcon className="ml-auto" />}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={props.onSelectBranch}>
        <span>Branch changes</span>
        {props.selection.kind === "branch" && <CheckIcon className="ml-auto" />}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Commits</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-96 w-96 overflow-y-auto">
          {props.commits.length > 0 ? (
            props.commits.map((commit) => (
              <DropdownMenuItem key={commit.sha} onClick={() => props.onSelectCommit(commit.sha)}>
                <span className="min-w-0 flex-1 truncate" title={commit.title}>
                  {commit.title}
                </span>
                <span className="ml-3 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTimeLabel(commit.committedAt)}
                </span>
                {props.selection.kind === "commit" && commit.sha === props.selection.sha && (
                  <CheckIcon className="ml-1 shrink-0" />
                )}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>
              {props.commitsPending ? "Loading commits…" : "No branch commits"}
            </DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        disabled={props.turnAvailable === false || !latestTurn}
        onClick={() => {
          if (latestTurn) props.onSelectTurn(latestTurn.turnId);
        }}
      >
        <span>Latest turn</span>
        {props.selection.kind === "turn" && props.selection.turnId === latestTurn?.turnId && (
          <CheckIcon className="ml-auto" />
        )}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={props.turnAvailable === false || turns.length === 0}>
          Turns
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          {turns.map((turn) => (
            <DropdownMenuItem key={turn.turnId} onClick={() => props.onSelectTurn(turn.turnId)}>
              <span>
                {`Turn ${turn.checkpointTurnCount ?? props.inferredTurnCountByTurnId[turn.turnId] ?? "?"}`}
              </span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {formatShortTimestamp(turn.completedAt, settings.timestampFormat)}
              </span>
              {props.selection.kind === "turn" && turn.turnId === props.selection.turnId && (
                <CheckIcon className="ml-1" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
