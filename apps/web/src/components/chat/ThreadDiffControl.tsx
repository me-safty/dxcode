import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, FileDiffIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "~/diffPanelStore";
import { useClientSettings } from "~/hooks/useSettings";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import type { TurnDiffSummary } from "~/types";
import { DiffScopeMenuItems, orderDiffTurns } from "~/components/diffs/DiffScopeMenuItems";
import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

interface ThreadDiffControlProps {
  readonly threadRef: ScopedThreadRef;
  readonly cwd: string | null;
  readonly available: boolean;
  readonly turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  readonly inferredTurnCountByTurnId: Readonly<Record<string, number>>;
  readonly onOpenDiff: () => void;
}

export function ThreadDiffControl(props: ThreadDiffControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const settings = useClientSettings();
  const selection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(state.byThreadKey, props.threadRef),
  );
  const diffPreview = useEnvironmentQuery(
    menuOpen && props.available && props.cwd
      ? reviewEnvironment.diffPreview({
          environmentId: props.threadRef.environmentId,
          input: {
            cwd: props.cwd,
            ignoreWhitespace: settings.diffIgnoreWhitespace,
            selection: { _tag: "all" },
          },
        })
      : null,
  );
  const latestTurn = useMemo(
    () => orderDiffTurns(props.turnDiffSummaries, props.inferredTurnCountByTurnId)[0],
    [props.inferredTurnCountByTurnId, props.turnDiffSummaries],
  );
  const selectAndOpen = (select: () => void) => {
    select();
    props.onOpenDiff();
  };

  const control = (
    <ButtonGroup>
      <Button
        size="xs"
        variant="outline"
        disabled={!props.available}
        aria-label="Open latest turn diff"
        onClick={() =>
          selectAndOpen(() => {
            if (latestTurn) {
              useDiffPanelStore.getState().selectTurn(props.threadRef, latestTurn.turnId);
              return;
            }
            useDiffPanelStore.getState().selectGitScope(props.threadRef, "unstaged");
          })
        }
      >
        <FileDiffIcon />
        <span className="sr-only @3xl/header-actions:not-sr-only">Diff</span>
      </Button>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="outline"
              disabled={!props.available}
              aria-label="Choose diff scope"
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DiffScopeMenuItems
            selection={selection}
            commits={diffPreview.data?.commits ?? []}
            commitsPending={diffPreview.isPending}
            turns={props.turnDiffSummaries}
            inferredTurnCountByTurnId={props.inferredTurnCountByTurnId}
            onSelectWorkingTree={() =>
              selectAndOpen(() =>
                useDiffPanelStore.getState().selectGitScope(props.threadRef, "unstaged"),
              )
            }
            onSelectBranch={() =>
              selectAndOpen(() =>
                useDiffPanelStore.getState().selectGitScope(props.threadRef, "branch"),
              )
            }
            onSelectCommit={(sha) =>
              selectAndOpen(() => useDiffPanelStore.getState().selectCommit(props.threadRef, sha))
            }
            onSelectTurn={(turnId) =>
              selectAndOpen(() => useDiffPanelStore.getState().selectTurn(props.threadRef, turnId))
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );

  if (props.available) return control;
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="inline-flex">{control}</div>} />
      <TooltipPopup>Diff is only available for Git-backed server threads.</TooltipPopup>
    </Tooltip>
  );
}
