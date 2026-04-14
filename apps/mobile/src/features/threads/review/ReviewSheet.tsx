import {
  ThreadId,
  type GitReviewDiffSection,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as NativeText,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../../components/AppText";
import { ControlPill } from "../../../components/ControlPill";
import { cn } from "../../../lib/cn";
import { getEnvironmentClient } from "../../../state/use-remote-environment-registry";
import { useSelectedThreadDetail } from "../../../state/use-thread-detail";
import { useThreadSelection } from "../../../state/use-thread-selection";
import { appendReviewCommentToDraft } from "../use-thread-composer-state";
import {
  buildReviewParsedDiff,
  getReadyReviewCheckpoints,
  buildReviewSectionItems,
  getDefaultReviewSectionId,
  getReviewSectionIdForCheckpoint,
  type ReviewRenderableFile,
  type ReviewRenderableLineRow,
} from "./reviewModel";
import {
  highlightReviewFile,
  type ReviewDiffTheme,
  type ReviewHighlightedFile,
  type ReviewHighlightedToken,
} from "./shikiReviewHighlighter";

interface ActiveCommentTarget {
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly line: ReviewRenderableLineRow;
}

function formatCommentContext(target: ActiveCommentTarget, comment: string): string {
  const lineLabel =
    target.line.newLineNumber !== null
      ? `new line ${target.line.newLineNumber}`
      : target.line.oldLineNumber !== null
        ? `old line ${target.line.oldLineNumber}`
        : "file";

  return [
    "Review comment:",
    `Source: ${target.sectionTitle}`,
    `File: ${target.filePath}`,
    `Line: ${lineLabel}`,
    `Comment: ${comment.trim()}`,
  ].join("\n");
}

function changeTone(change: ReviewRenderableLineRow["change"]): string {
  if (change === "add") return "bg-emerald-500/12";
  if (change === "delete") return "bg-rose-500/12";
  return "bg-card";
}

function changeMarker(change: ReviewRenderableLineRow["change"]): string {
  if (change === "add") return "+";
  if (change === "delete") return "-";
  return " ";
}

function changeTypeLabel(type: ReviewRenderableFile["changeType"]): string {
  switch (type) {
    case "new":
      return "Added";
    case "deleted":
      return "Deleted";
    case "rename-pure":
      return "Renamed";
    case "rename-changed":
      return "Renamed + edited";
    default:
      return "Edited";
  }
}

function DiffTokenText(props: {
  readonly tokens: ReadonlyArray<ReviewHighlightedToken> | null;
  readonly fallback: string;
}) {
  if (!props.tokens || props.tokens.length === 0) {
    return (
      <Text className="font-mono text-[12px] leading-[19px] text-foreground">
        {props.fallback || " "}
      </Text>
    );
  }

  return (
    <Text className="font-mono text-[12px] leading-[19px] text-foreground">
      {(() => {
        let offset = 0;

        return props.tokens.map((token) => {
          const start = offset;
          offset += token.content.length;

          const fontWeight =
            token.fontStyle !== null && (token.fontStyle & 2) === 2
              ? ("700" as const)
              : ("400" as const);
          const fontStyle =
            token.fontStyle !== null && (token.fontStyle & 1) === 1
              ? ("italic" as const)
              : ("normal" as const);

          return (
            <NativeText
              key={`${start}:${token.content.length}:${token.color ?? ""}:${token.fontStyle ?? ""}`}
              selectable
              style={{
                color: token.color ?? undefined,
                fontWeight,
                fontStyle,
              }}
            >
              {token.content.length > 0 ? token.content : " "}
            </NativeText>
          );
        });
      })()}
    </Text>
  );
}

function ReviewLineRow(props: {
  readonly line: ReviewRenderableLineRow;
  readonly tokens: ReadonlyArray<ReviewHighlightedToken> | null;
  readonly viewportWidth: number;
  readonly onComment: () => void;
}) {
  return (
    <View
      className={cn(
        "flex-row items-start border-b border-border/60",
        changeTone(props.line.change),
      )}
      style={{ minWidth: props.viewportWidth }}
    >
      <Text className="w-11 px-2 py-2 text-right text-[11px] font-t3-medium text-foreground-muted">
        {props.line.oldLineNumber ?? ""}
      </Text>
      <Text className="w-11 px-2 py-2 text-right text-[11px] font-t3-medium text-foreground-muted">
        {props.line.newLineNumber ?? ""}
      </Text>
      <Text className="w-5 px-1 py-2 text-center font-mono text-[12px] text-foreground-muted">
        {changeMarker(props.line.change)}
      </Text>
      <View className="min-w-0 flex-1 flex-shrink-0 px-2 py-2">
        <DiffTokenText tokens={props.tokens} fallback={props.line.content} />
      </View>
      <Pressable
        className="px-2 py-2"
        accessibilityRole="button"
        accessibilityLabel="Comment on line"
        onPress={props.onComment}
      >
        <SymbolView name="text.bubble" size={15} tintColor="#8a8a8a" type="monochrome" />
      </Pressable>
    </View>
  );
}

function ReviewFileCard(props: {
  readonly file: ReviewRenderableFile;
  readonly expanded: boolean;
  readonly highlightedFile: ReviewHighlightedFile | null;
  readonly viewportWidth: number;
  readonly onToggle: () => void;
  readonly onSelectLine: (line: ReviewRenderableLineRow) => void;
}) {
  return (
    <View className="overflow-hidden rounded-[18px] border border-border bg-card">
      <Pressable className="gap-3 px-4 py-3" onPress={props.onToggle}>
        <View className="flex-row items-start gap-3">
          <SymbolView
            name={props.expanded ? "chevron.down" : "chevron.right"}
            size={14}
            tintColor="#8a8a8a"
            type="monochrome"
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-mono text-[13px] leading-[18px] text-foreground">
              {props.file.path}
            </Text>
            {props.file.previousPath && props.file.previousPath !== props.file.path ? (
              <Text className="font-mono text-[11px] leading-[16px] text-foreground-muted">
                {props.file.previousPath}
              </Text>
            ) : null}
          </View>
        </View>
        <View className="ml-5 flex-row items-center gap-3">
          <Text className="text-[11px] font-t3-bold uppercase text-foreground-muted">
            {changeTypeLabel(props.file.changeType)}
          </Text>
          <Text className="text-[12px] font-t3-bold text-emerald-600">+{props.file.additions}</Text>
          <Text className="text-[12px] font-t3-bold text-rose-600">-{props.file.deletions}</Text>
        </View>
      </Pressable>

      {props.expanded ? (
        <ScrollView
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          className="border-t border-border"
        >
          <View style={{ minWidth: props.viewportWidth }}>
            {props.file.rows.map((row) => {
              if (row.kind === "hunk") {
                return (
                  <View
                    key={row.id}
                    className="border-b border-border/60 bg-sky-500/10 px-4 py-2"
                    style={{ minWidth: props.viewportWidth }}
                  >
                    <Text className="font-mono text-[12px] leading-[18px] text-sky-700 dark:text-sky-300">
                      {row.header}
                      {row.context ? ` ${row.context}` : ""}
                    </Text>
                  </View>
                );
              }

              const tokens =
                row.change === "delete"
                  ? (props.highlightedFile?.deletionLines[row.deletionTokenIndex ?? -1] ?? null)
                  : (props.highlightedFile?.additionLines[row.additionTokenIndex ?? -1] ?? null);

              return (
                <ReviewLineRow
                  key={row.id}
                  line={row}
                  tokens={tokens}
                  viewportWidth={props.viewportWidth}
                  onComment={() => props.onSelectLine(row)}
                />
              );
            })}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

export function ReviewSheet() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const { environmentId, threadId } = useLocalSearchParams<{
    environmentId: string;
    threadId: string;
  }>();
  const { selectedThreadProject } = useThreadSelection();
  const selectedThread = useSelectedThreadDetail();
  const [gitSections, setGitSections] = useState<ReadonlyArray<GitReviewDiffSection>>([]);
  const [turnDiffById, setTurnDiffById] = useState<Record<string, string>>({});
  const [loadingTurnIds, setLoadingTurnIds] = useState<Record<string, boolean>>({});
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [loadingGitDiffs, setLoadingGitDiffs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFileIdBySection, setExpandedFileIdBySection] = useState<
    Record<string, string | null>
  >({});
  const [highlightedFileByKey, setHighlightedFileByKey] = useState<
    Record<string, ReviewHighlightedFile>
  >({});
  const [activeCommentTarget, setActiveCommentTarget] = useState<ActiveCommentTarget | null>(null);
  const [commentText, setCommentText] = useState("");

  const cwd = selectedThread?.worktreePath ?? selectedThreadProject?.workspaceRoot ?? null;
  const readyCheckpoints = useMemo(
    () => getReadyReviewCheckpoints(selectedThread?.checkpoints ?? []),
    [selectedThread?.checkpoints],
  );

  const checkpointBySectionId = useMemo(() => {
    return Object.fromEntries(
      readyCheckpoints.map((checkpoint) => [
        getReviewSectionIdForCheckpoint(checkpoint),
        checkpoint,
      ]),
    ) as Record<string, OrchestrationCheckpointSummary>;
  }, [readyCheckpoints]);

  const reviewSections = useMemo(
    () =>
      buildReviewSectionItems({
        checkpoints: readyCheckpoints,
        gitSections,
        turnDiffById,
        loadingTurnIds,
      }),
    [gitSections, loadingTurnIds, readyCheckpoints, turnDiffById],
  );

  const selectedSection =
    reviewSections.find((section) => section.id === selectedSectionId) ?? reviewSections[0] ?? null;
  const parsedDiff = useMemo(
    () => buildReviewParsedDiff(selectedSection?.diff, selectedSection?.id ?? "mobile-review"),
    [selectedSection?.diff, selectedSection?.id],
  );

  const selectedTheme = (colorScheme === "dark" ? "dark" : "light") satisfies ReviewDiffTheme;
  const expandedFileId =
    selectedSectionId && parsedDiff.kind === "files"
      ? (expandedFileIdBySection[selectedSectionId] ?? parsedDiff.files[0]?.id ?? null)
      : null;
  const expandedFile =
    parsedDiff.kind === "files"
      ? (parsedDiff.files.find((file) => file.id === expandedFileId) ?? parsedDiff.files[0] ?? null)
      : null;
  const highlightedFileKey =
    selectedSection && expandedFile
      ? `${selectedSection.id}:${selectedTheme}:${expandedFile.cacheKey}`
      : null;

  const loadGitDiffs = useCallback(async () => {
    if (!environmentId || !cwd) {
      return;
    }

    const client = getEnvironmentClient(environmentId);
    if (!client) {
      setError("Remote connection is not ready.");
      return;
    }

    setLoadingGitDiffs(true);
    setError(null);
    try {
      const result = await client.git.getReviewDiffs({ cwd });
      setGitSections(result.sections);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load review diffs.");
    } finally {
      setLoadingGitDiffs(false);
    }
  }, [cwd, environmentId]);

  const loadTurnDiff = useCallback(
    async (checkpoint: OrchestrationCheckpointSummary, force = false) => {
      if (!environmentId || !threadId) {
        return;
      }

      const sectionId = getReviewSectionIdForCheckpoint(checkpoint);
      setSelectedSectionId(sectionId);

      if (!force && turnDiffById[sectionId] !== undefined) {
        return;
      }

      const client = getEnvironmentClient(environmentId);
      if (!client) {
        setError("Remote connection is not ready.");
        return;
      }

      setLoadingTurnIds((current) => ({ ...current, [sectionId]: true }));
      setError(null);
      try {
        const result = await client.orchestration.getTurnDiff({
          threadId: ThreadId.make(threadId),
          fromTurnCount: Math.max(0, checkpoint.checkpointTurnCount - 1),
          toTurnCount: checkpoint.checkpointTurnCount,
        });
        setTurnDiffById((current) => ({ ...current, [sectionId]: result.diff }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load turn diff.");
      } finally {
        setLoadingTurnIds((current) => {
          const next = { ...current };
          delete next[sectionId];
          return next;
        });
      }
    },
    [environmentId, threadId, turnDiffById],
  );

  useEffect(() => {
    void loadGitDiffs();
  }, [loadGitDiffs]);

  useEffect(() => {
    if (reviewSections.length === 0) {
      return;
    }

    const fallbackId = getDefaultReviewSectionId(reviewSections);
    if (!selectedSectionId || !reviewSections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(fallbackId);
    }
  }, [reviewSections, selectedSectionId]);

  useEffect(() => {
    const latest = readyCheckpoints[0];
    if (!latest) {
      return;
    }

    const latestId = getReviewSectionIdForCheckpoint(latest);
    if (turnDiffById[latestId] !== undefined || loadingTurnIds[latestId]) {
      return;
    }

    void loadTurnDiff(latest);
  }, [loadTurnDiff, loadingTurnIds, readyCheckpoints, turnDiffById]);

  useEffect(() => {
    if (!selectedSection || selectedSection.kind !== "turn" || selectedSection.diff !== null) {
      return;
    }

    const checkpoint = checkpointBySectionId[selectedSection.id];
    if (checkpoint && !loadingTurnIds[selectedSection.id]) {
      void loadTurnDiff(checkpoint);
    }
  }, [checkpointBySectionId, loadTurnDiff, loadingTurnIds, selectedSection]);

  useEffect(() => {
    if (!selectedSectionId || parsedDiff.kind !== "files") {
      return;
    }

    setExpandedFileIdBySection((current) => {
      const currentFileId = current[selectedSectionId];
      if (currentFileId && parsedDiff.files.some((file) => file.id === currentFileId)) {
        return current;
      }
      return { ...current, [selectedSectionId]: parsedDiff.files[0]?.id ?? null };
    });
  }, [parsedDiff, selectedSectionId]);

  useEffect(() => {
    if (!highlightedFileKey || !expandedFile || highlightedFileByKey[highlightedFileKey]) {
      return;
    }

    let cancelled = false;
    void highlightReviewFile(expandedFile, selectedTheme)
      .then((result) => {
        if (!cancelled) {
          setHighlightedFileByKey((current) => ({
            ...current,
            [highlightedFileKey]: result,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          return;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expandedFile, highlightedFileByKey, highlightedFileKey, selectedTheme]);

  const refreshSelectedSection = useCallback(async () => {
    if (!selectedSection) {
      return;
    }

    if (selectedSection.kind === "turn") {
      const checkpoint = checkpointBySectionId[selectedSection.id];
      if (checkpoint) {
        await loadTurnDiff(checkpoint, true);
      }
      return;
    }

    await loadGitDiffs();
  }, [checkpointBySectionId, loadGitDiffs, loadTurnDiff, selectedSection]);

  const submitComment = useCallback(() => {
    if (!activeCommentTarget || commentText.trim().length === 0 || !environmentId || !threadId) {
      return;
    }

    appendReviewCommentToDraft({
      environmentId,
      threadId,
      text: formatCommentContext(activeCommentTarget, commentText),
    });
    setActiveCommentTarget(null);
    setCommentText("");
  }, [activeCommentTarget, commentText, environmentId, threadId]);

  return (
    <View className="flex-1 bg-sheet">
      <View className="gap-4 px-5 pb-4 pt-4">
        <View className="flex-row items-start gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-[18px] font-t3-bold text-foreground">
              {selectedSection?.title ?? "Files changed"}
            </Text>
            <Text className="text-[12px] leading-[18px] text-foreground-muted">
              {selectedSection?.subtitle ??
                "Inspect turn diffs, worktree changes, and branch drift."}
            </Text>
          </View>
          <ControlPill
            icon="arrow.clockwise"
            disabled={
              loadingGitDiffs ||
              (selectedSection?.kind === "turn" && loadingTurnIds[selectedSection.id] === true)
            }
            onPress={() => void refreshSelectedSection()}
          />
        </View>

        <ScrollView
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 20 }}
        >
          {reviewSections.map((section) => {
            const selected = section.id === selectedSection?.id;
            return (
              <Pressable
                key={section.id}
                className={cn(
                  "min-h-[40px] rounded-full border px-4 py-2",
                  selected ? "border-foreground bg-foreground" : "border-border bg-card",
                )}
                onPress={() => setSelectedSectionId(section.id)}
              >
                <View className="flex-row items-center gap-2">
                  <Text
                    className={cn(
                      "text-[12px] font-t3-bold",
                      selected ? "text-background" : "text-foreground",
                    )}
                  >
                    {section.title}
                  </Text>
                  {section.isLoading ? (
                    <ActivityIndicator size="small" color={selected ? "#ffffff" : "#8a8a8a"} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {parsedDiff.kind === "files" ? (
          <View className="rounded-[18px] border border-border bg-card px-4 py-3">
            <View className="flex-row items-end justify-between gap-3">
              <View className="gap-1">
                <Text className="text-[12px] font-t3-bold uppercase text-foreground-muted">
                  Files changed
                </Text>
                <Text className="text-[15px] font-t3-bold text-foreground">
                  {parsedDiff.fileCount} file{parsedDiff.fileCount === 1 ? "" : "s"}
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                <Text className="text-[18px] font-t3-bold text-emerald-600">
                  +{parsedDiff.additions}
                </Text>
                <Text className="text-[18px] font-t3-bold text-rose-600">
                  -{parsedDiff.deletions}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      {error ? (
        <View className="mx-5 mb-4 rounded-[18px] border border-border bg-card px-4 py-3">
          <Text className="text-[13px] font-t3-bold text-foreground">Review unavailable</Text>
          <Text className="text-[12px] leading-[18px] text-foreground-muted">{error}</Text>
        </View>
      ) : null}

      {parsedDiff.kind !== "empty" && parsedDiff.notice ? (
        <View className="mx-5 mb-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/40">
          <Text className="text-[12px] font-t3-bold uppercase text-amber-700 dark:text-amber-300">
            Partial diff
          </Text>
          <Text className="text-[12px] leading-[18px] text-amber-800 dark:text-amber-200">
            {parsedDiff.notice}
          </Text>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(insets.bottom, 18) + (activeCommentTarget ? 168 : 18),
          gap: 12,
        }}
      >
        {!selectedSection ? (
          <View className="rounded-[18px] border border-border bg-card px-4 py-5">
            <Text className="text-[14px] font-t3-bold text-foreground">No review diffs</Text>
            <Text className="text-[12px] leading-[18px] text-foreground-muted">
              This thread has no ready turn diffs and the worktree diff is empty.
            </Text>
          </View>
        ) : selectedSection.isLoading && selectedSection.diff === null ? (
          <View className="items-center gap-3 rounded-[18px] border border-border bg-card px-4 py-6">
            <ActivityIndicator size="small" />
            <Text className="text-[12px] text-foreground-muted">Loading diff…</Text>
          </View>
        ) : parsedDiff.kind === "empty" ? (
          <View className="rounded-[18px] border border-border bg-card px-4 py-5">
            <Text className="text-[14px] font-t3-bold text-foreground">No changes</Text>
            <Text className="text-[12px] leading-[18px] text-foreground-muted">
              {selectedSection.subtitle ?? "This diff is empty."}
            </Text>
          </View>
        ) : parsedDiff.kind === "raw" ? (
          <View className="gap-3 rounded-[18px] border border-border bg-card px-4 py-4">
            <Text className="text-[12px] leading-[18px] text-foreground-muted">
              {parsedDiff.reason}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
              <Text selectable className="font-mono text-[12px] leading-[19px] text-foreground">
                {parsedDiff.text}
              </Text>
            </ScrollView>
          </View>
        ) : (
          parsedDiff.files.map((file) => {
            const isExpanded = file.id === expandedFileId;
            const fileHighlightKey =
              selectedSection !== null
                ? `${selectedSection.id}:${selectedTheme}:${file.cacheKey}`
                : null;
            const fileHighlights =
              fileHighlightKey !== null ? (highlightedFileByKey[fileHighlightKey] ?? null) : null;

            return (
              <ReviewFileCard
                key={file.id}
                file={file}
                expanded={isExpanded}
                highlightedFile={isExpanded ? fileHighlights : null}
                viewportWidth={Math.max(width - 40, 280)}
                onToggle={() =>
                  setExpandedFileIdBySection((current) => ({
                    ...current,
                    [selectedSection.id]: current[selectedSection.id] === file.id ? null : file.id,
                  }))
                }
                onSelectLine={(line) =>
                  setActiveCommentTarget({
                    sectionTitle: selectedSection.title,
                    filePath: file.path,
                    line,
                  })
                }
              />
            );
          })
        )}
      </ScrollView>

      {activeCommentTarget ? (
        <View
          className="border-t border-border bg-sheet px-5 py-4"
          style={{ paddingBottom: Math.max(insets.bottom, 14) }}
        >
          <Text className="text-[13px] font-t3-bold text-foreground">
            Comment on {activeCommentTarget.filePath}
          </Text>
          <TextInput
            multiline
            className="mt-2 min-h-[72px] rounded-[18px] border border-border bg-card px-3 py-3 text-[14px] text-foreground"
            placeholder="What should the agent know?"
            value={commentText}
            onChangeText={setCommentText}
          />
          <View className="mt-3 flex-row gap-3">
            <Pressable
              className="min-h-[44px] flex-1 items-center justify-center rounded-[18px] border border-border bg-card"
              onPress={() => {
                setActiveCommentTarget(null);
                setCommentText("");
              }}
            >
              <Text className="text-[12px] font-t3-bold uppercase text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              className="min-h-[44px] flex-1 items-center justify-center rounded-[18px] bg-foreground"
              onPress={submitComment}
            >
              <Text className="text-[12px] font-t3-bold uppercase text-background">
                Add to next turn
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
