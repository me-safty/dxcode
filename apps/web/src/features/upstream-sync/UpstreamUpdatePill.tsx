import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { APP_BASE_NAME } from "../../branding";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { upstreamSyncEnvironment } from "../../state/upstreamSync";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { UpstreamUpdateDialog } from "./UpstreamUpdateDialog";
import { upstreamPillView } from "./upstreamUpdate.logic";

export function UpstreamUpdatePill() {
  const environmentId = usePrimaryEnvironment()?.environmentId ?? null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : upstreamSyncEnvironment.state({ environmentId, input: {} }),
  );
  const dismiss = useAtomCommand(upstreamSyncEnvironment.dismiss, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const state = query.data;
  const view = upstreamPillView(state);

  const handleDismiss = useCallback(async () => {
    if (environmentId === null || state?.status !== "available") return;
    const result = await dismiss({
      environmentId,
      input: { target: state.target },
    });
    if (result._tag === "Failure" && isAtomCommandInterrupted(result)) return;
  }, [dismiss, environmentId, state]);

  if (APP_BASE_NAME !== "DX Code" || environmentId === null || !state || !view) return null;

  return (
    <>
      <div className="group/upstream-update relative flex h-7 w-full items-center rounded-lg bg-primary/15 text-xs font-medium text-primary">
        <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.upstream-update-main:hover]/upstream-update:bg-primary/22" />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={view.description}
                className="upstream-update-main relative flex h-full flex-1 items-center gap-2 px-2 text-left"
                onClick={() => setOpen(true)}
              >
                <ArrowUpIcon className="size-3.5" />
                <span>{view.title}</span>
              </button>
            }
          />
          <TooltipPopup side="top">{view.description}</TooltipPopup>
        </Tooltip>
        {view.dismissible ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Dismiss this nightly"
                  className="relative mr-1 inline-flex size-5 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
                  onClick={handleDismiss}
                >
                  <XIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="top">
              Hide this nightly. You will be notified when a newer nightly is available.
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <UpstreamUpdateDialog
        open={open}
        environmentId={environmentId}
        state={state}
        onOpenChange={setOpen}
      />
    </>
  );
}
