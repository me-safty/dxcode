import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";

import { DX_LOCAL_UPDATE_UI_ENABLED } from "../../branding";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { dxLocalUpdateEnvironment } from "../../state/dxLocalUpdate";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { DxUpdateDialog } from "./DxUpdateDialog";
import { dxUpdateSummary } from "./dxUpdate.logic";

export function DxUpdatePill() {
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : dxLocalUpdateEnvironment.state({ environmentId, input: {} }),
  );
  const [open, setOpen] = useState(false);
  const state = query.data;
  const summary = dxUpdateSummary(state);
  if (!DX_LOCAL_UPDATE_UI_ENABLED || environmentId === null || !state || !summary) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex h-7 w-full items-center gap-2 rounded-lg bg-primary/15 px-2 text-left text-xs font-medium text-primary hover:bg-primary/22"
              onClick={() => setOpen(true)}
            >
              <ArrowUpIcon className="size-3.5" />
              <span>{summary.title}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{summary.description}</TooltipPopup>
      </Tooltip>
      <DxUpdateDialog
        open={open}
        environmentId={environmentId}
        state={state}
        onOpenChange={setOpen}
      />
    </>
  );
}
