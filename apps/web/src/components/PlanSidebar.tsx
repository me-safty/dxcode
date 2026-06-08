import { memo, useState, useCallback } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import ChatMarkdown from "./ChatMarkdown";
import { CheckIcon, EllipsisIcon, LoaderIcon, PanelRightCloseIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActivePlanState } from "../session-logic";
import type { LatestProposedPlanState } from "../session-logic";
import { formatTimestamp } from "../timestampFormat";
import {
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  downloadPlanAsTextFile,
  stripDisplayedPlanMarkdown,
} from "../proposedPlan";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { readEnvironmentApi } from "~/environmentApi";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

function stepStatusIcon(status: string): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
        <LoaderIcon className="size-3 animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  );
}

/**
 * The live task steps section: an optional explanation paragraph followed by
 * the per-step checklist. Rendered either full-width in the main area (no
 * proposed-plan document) or inside the right rail (alongside the plan
 * document), so it is extracted to avoid duplicating the markup.
 */
function PlanSteps({ activePlan }: { activePlan: ActivePlanState }) {
  return (
    <div className="space-y-4">
      {activePlan.explanation ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground/80">
          {activePlan.explanation}
        </p>
      ) : null}
      {activePlan.steps.length > 0 ? (
        <div className="space-y-1">
          <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
            Steps
          </p>
          {activePlan.steps.map((step) => (
            <div
              key={`${step.status}:${step.step}`}
              className={cn(
                "flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200",
                step.status === "inProgress" && "bg-blue-500/5",
                step.status === "completed" && "bg-emerald-500/5",
              )}
            >
              <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
              <p
                className={cn(
                  "text-[13px] leading-snug",
                  step.status === "completed"
                    ? "text-muted-foreground/50 line-through decoration-muted-foreground/20"
                    : step.status === "inProgress"
                      ? "text-foreground/90"
                      : "text-muted-foreground/70",
                )}
              >
                {step.step}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface PlanSidebarProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  label?: string;
  environmentId: EnvironmentId;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  mode?: "sheet" | "sidebar" | "panel";
  onClose: () => void;
}

const PlanSidebar = memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  label = "Plan",
  environmentId,
  markdownCwd,
  workspaceRoot,
  timestampFormat,
  mode = "sidebar",
  onClose,
}: PlanSidebarProps) {
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;

  const handleCopyPlan = useCallback(() => {
    if (!planMarkdown) return;
    copyToClipboard(planMarkdown);
  }, [planMarkdown, copyToClipboard]);

  const handleDownload = useCallback(() => {
    if (!planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    downloadPlanAsTextFile(filename, normalizePlanMarkdownForExport(planMarkdown));
  }, [planMarkdown]);

  const handleSaveToWorkspace = useCallback(() => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !workspaceRoot || !planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    setIsSavingToWorkspace(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath: filename,
        contents: normalizePlanMarkdownForExport(planMarkdown),
      })
      .then((result) => {
        toastManager.add({
          type: "success",
          title: "Plan saved",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save plan",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      })
      .then(
        () => setIsSavingToWorkspace(false),
        () => setIsSavingToWorkspace(false),
      );
  }, [environmentId, planMarkdown, workspaceRoot]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[clamp(18rem,30vw,340px)] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          {mode === "panel" ? null : (
            <Badge
              variant="secondary"
              className="rounded-md bg-blue-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-blue-400 uppercase"
            >
              {label}
            </Badge>
          )}
          {activePlan ? (
            <span className="text-[11px] text-muted-foreground/60">
              {formatTimestamp(activePlan.createdAt, timestampFormat)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {planMarkdown ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground/50 hover:text-foreground/70"
                    aria-label="Plan actions"
                  />
                }
              >
                <EllipsisIcon className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={handleCopyPlan}>
                  {isCopied ? "Copied!" : "Copy to clipboard"}
                </MenuItem>
                <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
                <MenuItem
                  onClick={handleSaveToWorkspace}
                  disabled={!workspaceRoot || isSavingToWorkspace}
                >
                  Save to workspace
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
          {mode === "panel" ? null : (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={onClose}
              aria-label={`Close ${label.toLowerCase()} sidebar`}
              className="text-muted-foreground/50 hover:text-foreground/70"
            >
              <PanelRightCloseIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {planMarkdown ? (
        // Proposed-plan document is the main content; live steps in a right rail.
        <div className="flex min-h-0 flex-1">
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-3">
              <ChatMarkdown
                text={displayedPlanMarkdown ?? ""}
                cwd={markdownCwd}
                isStreaming={false}
              />
            </div>
          </ScrollArea>
          {activePlan && (activePlan.steps.length > 0 || activePlan.explanation) ? (
            <ScrollArea className="min-h-0 w-[clamp(13rem,22vw,260px)] shrink-0 border-l border-border/60">
              <div className="p-3">
                <PlanSteps activePlan={activePlan} />
              </div>
            </ScrollArea>
          ) : null}
        </div>
      ) : activePlan && (activePlan.steps.length > 0 || activePlan.explanation) ? (
        // No proposed-plan document: live steps fill the main area full-width.
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3">
            <PlanSteps activePlan={activePlan} />
          </div>
        </ScrollArea>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-12 text-center">
          <p className="text-[13px] text-muted-foreground/40">No active plan yet.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/30">
            Plans and steps will appear here when generated.
          </p>
        </div>
      )}
    </div>
  );
});

export default PlanSidebar;
export type { PlanSidebarProps };
