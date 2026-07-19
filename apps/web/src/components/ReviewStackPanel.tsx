import { CodeView } from "@pierre/diffs/react";
import {
  EnvironmentId,
  ReviewStackSnapshot,
  ReviewStackSnapshotId,
  ReviewStackTarget,
  ThreadId,
} from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getRenderablePatch, resolveDiffThemeName } from "~/lib/diffRendering";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";

import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";

type Theme = "light" | "dark";

export function summarizeReviewStackError(errorMessage: string | null): string | null {
  const value = errorMessage?.trim();
  if (!value || value.length <= 600) return value ?? null;

  const structuredMessage = /"message"\s*:\s*"([^"\n]+)"/.exec(value)?.[1];
  if (structuredMessage) return `Review generation failed: ${structuredMessage}`;
  if (value.includes("missing field `supports_reasoning_summaries`")) {
    return "Review generation failed because the Codex model cache is incompatible. Retry the review; if it continues, restart Codex.";
  }
  return "Review generation failed. The provider returned an oversized error; see the server logs for details.";
}

export function ReviewStackPanel(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  target: ReviewStackTarget;
  ignoreWhitespace: boolean;
  currentSourceHash: string | null;
  theme: Theme;
  diffStyle: "stacked" | "split";
  wordWrap: boolean;
  onOpenFile: (path: string) => void;
}) {
  const targetKey = JSON.stringify([props.threadId, props.target, props.ignoreWhitespace]);
  const ensure = useAtomCommand(reviewEnvironment.reviewStackEnsure, {
    label: "generate review stack",
    reportFailure: false,
  });
  const cancel = useAtomCommand(reviewEnvironment.reviewStackCancel, "cancel review stack");
  const ensuredKeys = useRef(new Set<string>());
  const [selectedId, setSelectedId] = useState<ReviewStackSnapshotId | null>(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [commandError, setCommandError] = useState<string | null>(null);

  const list = useEnvironmentQuery(
    reviewEnvironment.reviewStackListSnapshots({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        target: props.target,
        ignoreWhitespace: props.ignoreWhitespace,
      },
    }),
  );
  const events = useEnvironmentQuery(
    reviewEnvironment.reviewStackEvents({ environmentId: props.environmentId, input: {} }),
  );
  const snapshot = useEnvironmentQuery(
    selectedId
      ? reviewEnvironment.reviewStackGetSnapshot({
          environmentId: props.environmentId,
          input: { threadId: props.threadId, snapshotId: selectedId },
        })
      : null,
  );

  const runEnsure = async (force: boolean) => {
    setCommandError(null);
    const result = await ensure({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        target: props.target,
        ignoreWhitespace: props.ignoreWhitespace,
        ...(force ? { force: true } : {}),
      },
    });
    if (result._tag === "Success") {
      setSelectedId(result.value.snapshotId);
      list.refresh();
    } else {
      setCommandError("Review generation could not be started.");
    }
  };

  useEffect(() => {
    if (ensuredKeys.current.has(targetKey) || list.data === null) return;
    const exact =
      props.currentSourceHash === null
        ? list.data[0]
        : list.data.find((item) => item.sourceHash === props.currentSourceHash);
    const displayed = exact ?? list.data[0];
    if (displayed) {
      ensuredKeys.current.add(targetKey);
      setSelectedId(displayed.snapshotId);
      return;
    }
    ensuredKeys.current.add(targetKey);
    void runEnsure(false);
  }, [list.data, props.currentSourceHash, targetKey]);

  useEffect(() => {
    setActiveLayer(0);
    setOverviewOpen(true);
  }, [selectedId]);

  useEffect(() => {
    if (events.data?.threadId !== props.threadId) return;
    list.refresh();
    snapshot.refresh();
  }, [events.data, props.threadId]);

  const value = snapshot.data;
  const layers = value?.review?.layers ?? [];
  const selectedLayerIndex = Math.min(activeLayer, Math.max(0, layers.length - 1));
  const selectedLayer = layers[selectedLayerIndex];
  const isRunning = value?.metadata.status === "queued" || value?.metadata.status === "running";
  const outdated =
    value !== null &&
    props.currentSourceHash !== null &&
    value.metadata.sourceHash !== props.currentSourceHash;

  const cancelGeneration = async () => {
    if (!value) return;
    await cancel({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, snapshotId: value.metadata.snapshotId },
    });
    list.refresh();
    snapshot.refresh();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if (layers.length === 0) return;
      if (event.key.toLowerCase() === "j")
        setActiveLayer((current) => Math.min(layers.length - 1, current + 1));
      if (event.key.toLowerCase() === "k") setActiveLayer((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layers.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2 text-[11px]">
        <select
          aria-label="Review stack snapshot"
          className="h-7 max-w-56 rounded-md border border-border bg-background px-2"
          value={selectedId ?? ""}
          onChange={(event) => setSelectedId(ReviewStackSnapshotId.make(event.target.value))}
        >
          {(list.data ?? []).map((item) => (
            <option key={item.snapshotId} value={item.snapshotId}>
              {new Date(item.createdAt).toLocaleString()} · {item.modelSelection.model}
            </option>
          ))}
        </select>
        {value && (
          <span className="text-muted-foreground">
            {value.metadata.sourceHash.slice(0, 8)} · {value.metadata.modelSelection.model}
          </span>
        )}
        {outdated && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">Outdated</span>
        )}
        {isRunning && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <LoaderCircleIcon className="size-3 animate-spin" />
            {value.metadata.stage}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {outdated ? (
            <Button size="xs" variant="outline" onClick={() => void runEnsure(false)}>
              Generate latest
            </Button>
          ) : (
            <Button size="xs" variant="outline" onClick={() => void runEnsure(true)}>
              <RefreshCwIcon className="size-3" />
              Regenerate
            </Button>
          )}
          {isRunning && value && (
            <Button size="xs" variant="outline" onClick={() => void cancelGeneration()}>
              <SquareIcon className="size-3" />
              Cancel
            </Button>
          )}
          {(value?.metadata.status === "failed" || value?.metadata.status === "cancelled") && (
            <Button size="xs" onClick={() => void runEnsure(true)}>
              Retry
            </Button>
          )}
        </div>
      </div>
      {value?.metadata.sourceTruncated && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <AlertTriangleIcon className="size-3.5" />
          Incomplete review: source diff was truncated.
        </div>
      )}
      {(commandError ?? list.error ?? snapshot.error) && (
        <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {commandError ?? list.error ?? snapshot.error}
        </p>
      )}
      {value?.review && (
        <Collapsible
          className="border-b border-border/70 px-3 py-3"
          open={overviewOpen}
          onOpenChange={setOverviewOpen}
        >
          <div className="flex flex-wrap items-center gap-2">
            <CollapsibleTrigger
              aria-label={overviewOpen ? "Collapse review overview" : "Expand review overview"}
              className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  "size-3 transition-transform",
                  overviewOpen ? "rotate-90" : "rotate-0",
                )}
              />
              Overview
            </CollapsibleTrigger>
            {value.review.mergeAssessment && (
              <>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                    value.review.mergeAssessment.recommendation === "merge"
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {value.review.mergeAssessment.recommendation === "merge"
                    ? "Merge"
                    : "Do not merge"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Confidence {value.review.mergeAssessment.confidence}/5
                </span>
              </>
            )}
          </div>
          <CollapsiblePanel>
            <p className="mt-2 whitespace-pre-line text-xs leading-relaxed">
              {value.review.summary}
            </p>
            {value.review.mergeAssessment && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {value.review.mergeAssessment.rationale}
              </p>
            )}
            {value.review.references && value.review.references.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">References:</span>
                {value.review.references.map((reference) => {
                  if (reference._tag === "file") {
                    return (
                      <button
                        key={`file:${reference.path}`}
                        type="button"
                        className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => props.onOpenFile(reference.path)}
                      >
                        {reference.path}
                      </button>
                    );
                  }
                  const layerIndex = layers.findIndex((layer) => layer.id === reference.layerId);
                  const layer = layers[layerIndex];
                  if (!layer) return null;
                  return (
                    <button
                      key={`layer:${reference.layerId}`}
                      type="button"
                      className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setActiveLayer(layerIndex)}
                    >
                      Step {layerIndex + 1}: {layer.title}
                    </button>
                  );
                })}
              </div>
            )}
          </CollapsiblePanel>
        </Collapsible>
      )}
      {!value || snapshot.isPending ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
          Loading review stack…
        </div>
      ) : value.metadata.status === "failed" || value.metadata.status === "cancelled" ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {value.metadata.status === "cancelled"
            ? "Review generation cancelled."
            : (summarizeReviewStackError(value.metadata.errorMessage) ??
              "Review generation failed.")}
        </div>
      ) : isRunning && !value.review ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
          {value.metadata.stage}…
        </div>
      ) : value.review?.layers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No changes to review.
        </div>
      ) : (
        <div className="@container flex min-h-0 flex-1 flex-col @min-[680px]:flex-row">
          <select
            aria-label="Review layer"
            className="m-2 h-8 rounded-md border border-border bg-background px-2 @min-[680px]:hidden"
            value={activeLayer}
            onChange={(event) => setActiveLayer(Number(event.target.value))}
          >
            {layers.map((layer, index) => (
              <option key={layer.id} value={index}>
                {index + 1}. {layer.title}
              </option>
            ))}
          </select>
          <nav
            className="hidden w-52 shrink-0 overflow-auto border-r border-border/70 p-2 @min-[680px]:block"
            aria-label="Review stack layers"
          >
            {layers.map((layer, index) => (
              <button
                key={layer.id}
                type="button"
                className={cn(
                  "mb-1 w-full rounded-md px-2 py-2 text-left text-xs",
                  index === activeLayer
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
                onClick={() => setActiveLayer(index)}
              >
                <span className="mr-2 text-[10px] tabular-nums">{index + 1}</span>
                {layer.title}
              </button>
            ))}
          </nav>
          {selectedLayer && (
            <LayerContent
              snapshot={value}
              layerIndex={selectedLayerIndex}
              theme={props.theme}
              diffStyle={props.diffStyle}
              wordWrap={props.wordWrap}
              onOpenFile={props.onOpenFile}
            />
          )}
        </div>
      )}
    </div>
  );
}

function LayerContent(props: {
  snapshot: ReviewStackSnapshot;
  layerIndex: number;
  theme: Theme;
  diffStyle: "stacked" | "split";
  wordWrap: boolean;
  onOpenFile: (path: string) => void;
}) {
  const layer = props.snapshot.review?.layers[props.layerIndex];
  const anchors = useMemo(
    () => new Map(props.snapshot.anchorCatalog.map((anchor) => [anchor.id, anchor])),
    [props.snapshot.anchorCatalog],
  );
  if (!layer) return null;
  return (
    <main className="min-w-0 flex-1 overflow-auto p-3">
      <h2 className="text-sm font-semibold">{layer.title}</h2>
      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
        {layer.summary}
      </p>
      {layer.diagram && (
        <section className="mt-3">
          <h3 className="mb-1 text-xs font-medium">{layer.diagram.title}</h3>
          <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px]">
            {layer.diagram.text}
          </pre>
        </section>
      )}
      <div className="mt-4 space-y-4">
        {layer.ranges.map((range) => {
          const anchor = anchors.get(range.anchorId);
          if (!anchor) return null;
          return (
            <section
              key={range.anchorId}
              className="overflow-hidden rounded-md border border-border/70 bg-card/20"
            >
              <div className="p-3">
                <button
                  type="button"
                  className="mb-2 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => props.onOpenFile(anchor.path)}
                >
                  {anchor.path}
                </button>
                <p className="whitespace-pre-line text-xs font-medium leading-relaxed">
                  {range.summary}
                </p>
                {range.risks.map((risk) => (
                  <div
                    key={`${risk.severity}:${risk.summary}:${risk.evidence}`}
                    className="mt-2 rounded border border-border/60 p-2 text-[11px]"
                  >
                    <span
                      className={cn(
                        "mr-2 rounded px-1.5 py-0.5 uppercase",
                        risk.severity === "high"
                          ? "bg-destructive/15 text-destructive"
                          : risk.severity === "medium"
                            ? "bg-warning/15 text-warning"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {risk.severity}
                    </span>
                    {risk.summary}
                    <p className="mt-1 text-muted-foreground">Evidence: {risk.evidence}</p>
                  </div>
                ))}
              </div>
              <ReadOnlyDiff
                patch={anchor.patch}
                theme={props.theme}
                diffStyle={props.diffStyle}
                wordWrap={props.wordWrap}
              />
            </section>
          );
        })}
      </div>
    </main>
  );
}

function ReadOnlyDiff(props: {
  patch: string;
  theme: Theme;
  diffStyle: "stacked" | "split";
  wordWrap: boolean;
}) {
  const parsed = useMemo(
    () => getRenderablePatch(props.patch, `review-stack:${props.theme}`),
    [props.patch, props.theme],
  );
  if (!parsed || parsed.kind !== "files")
    return (
      <pre className="overflow-auto border-t border-border/70 p-3 font-mono text-[11px]">
        {props.patch}
      </pre>
    );
  const items = parsed.files.map((fileDiff, index) => ({
    id: `range-${index}`,
    type: "diff" as const,
    fileDiff,
    annotations: [],
    collapsed: false,
    version: 1,
  }));
  return (
    <CodeView
      items={items}
      options={{
        diffStyle: props.diffStyle === "split" ? "split" : "unified",
        lineDiffType: "none",
        overflow: props.wordWrap ? "wrap" : "scroll",
        theme: resolveDiffThemeName(props.theme),
        themeType: props.theme,
        enableGutterUtility: false,
        enableLineSelection: false,
        stickyHeaders: false,
      }}
    />
  );
}
