import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DxLocalUpdateState, EnvironmentId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpIcon, LoaderIcon, ShieldAlertIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { dxLocalUpdateEnvironment } from "../../state/dxLocalUpdate";
import { useAtomCommand } from "../../state/use-atom-command";
import { DxUpdateProgress } from "./DxUpdateProgress";
import { buildThreadRouteParams } from "../../threadRoutes";

export function DxUpdateDialog(props: {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly state: DxLocalUpdateState;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const prepare = useAtomCommand(dxLocalUpdateEnvironment.prepare, { reportFailure: false });
  const publishAndBuild = useAtomCommand(dxLocalUpdateEnvironment.publishAndBuild, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<"prepare" | "publish" | "install" | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : "DX update failed.";
  };

  const handlePrepare = useCallback(async () => {
    setPending("prepare");
    setError(null);
    const result = await prepare({ environmentId: props.environmentId, input: {} });
    setPending(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
      return;
    }
    setPlanId(result.value.id);
  }, [prepare, props.environmentId]);

  const handlePublish = useCallback(async () => {
    const currentPlanId =
      planId ?? (props.state.status === "awaiting-publish" ? props.state.sessionId : null);
    if (!currentPlanId) return;
    if (
      !window.confirm(
        "Publish the sync branch, update origin/dx/main, and build a local DX DMG? Installation requires a separate confirmation.",
      )
    ) {
      return;
    }
    setPending("publish");
    setError(null);
    const result = await publishAndBuild({
      environmentId: props.environmentId,
      input: { planId: currentPlanId },
    });
    setPending(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setError(failureMessage(result));
    }
  }, [planId, props.environmentId, props.state, publishAndBuild]);

  const handleInstall = useCallback(async () => {
    if (props.state.status !== "awaiting-install") return;
    const bridge = window.desktopBridge;
    if (!bridge) {
      setError("Open the packaged DX Code app to install this local build.");
      return;
    }
    if (
      !window.confirm(
        "Install this unsigned local DX build and restart? The current app will be kept as the latest rollback backup.",
      )
    ) {
      return;
    }
    setPending("install");
    const result = await bridge.installLocalDxUpdate({
      sessionId: planId ?? props.state.artifact.sourceCommit,
      artifact: props.state.artifact,
    });
    setPending(null);
    if (result.status === "unavailable") setError(result.message);
  }, [planId, props.state]);

  const remote =
    props.state.status === "available"
      ? props.state.reasons.find((reason) => reason.kind === "origin-dx-main")
      : null;
  const nightly =
    props.state.status === "available"
      ? props.state.reasons.find((reason) => reason.kind === "upstream-nightly")
      : null;
  const reviewThreadId = props.state.status === "reviewing" ? props.state.session.threadId : null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpIcon className="size-5" />
            DX Code update
          </DialogTitle>
          <DialogDescription>
            Review source changes, publish explicitly, then approve installation separately.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {remote ? (
            <div className="rounded-lg border p-3 text-sm">
              <div className="font-medium">DX changes</div>
              <div className="mt-1 text-xs text-muted-foreground">
                origin/dx/main is {remote.commitsBehind} commits ahead
              </div>
            </div>
          ) : null}
          {nightly ? (
            <div className="rounded-lg border p-3 text-sm">
              <div className="font-medium">T3 nightly</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {nightly.target.tag}
              </div>
            </div>
          ) : null}
          {props.state.status === "reviewing" ? (
            <div className="rounded-lg border p-3 text-sm">
              Guided review prepared for {props.state.session.target.tag}. Complete conflict review
              and required checks before publishing.
            </div>
          ) : null}
          {props.state.status === "awaiting-install" ? (
            <div className="space-y-2 rounded-lg border p-3 text-xs">
              <div className="font-medium">Artifact ready</div>
              <code className="block break-all">{props.state.artifact.artifactPath}</code>
              <div className="flex gap-2 text-warning-foreground">
                <ShieldAlertIcon className="size-4 shrink-0" />
                Unsigned local DX build. Verify provenance before installing.
              </div>
            </div>
          ) : null}
          <DxUpdateProgress state={props.state} />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={pending !== null}
          >
            Later
          </Button>
          {props.state.status === "available" ? (
            <Button onClick={handlePrepare} disabled={pending !== null}>
              {pending === "prepare" ? <LoaderIcon className="animate-spin" /> : null}
              Review and update
            </Button>
          ) : null}
          {props.state.status === "awaiting-publish" ||
          (props.state.status === "reviewing" && planId !== null) ? (
            <Button onClick={handlePublish} disabled={pending !== null}>
              {pending === "publish" ? <LoaderIcon className="animate-spin" /> : null}
              Publish and build
            </Button>
          ) : null}
          {reviewThreadId ? (
            <Button
              onClick={() => {
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(
                    scopeThreadRef(props.environmentId, reviewThreadId),
                  ),
                });
                props.onOpenChange(false);
              }}
            >
              Open guided thread
            </Button>
          ) : null}
          {props.state.status === "awaiting-install" ? (
            <Button onClick={handleInstall} disabled={pending !== null}>
              {pending === "install" ? <LoaderIcon className="animate-spin" /> : null}
              Install and restart
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
