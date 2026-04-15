import { ThreadId, type TurnId } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as NativeText,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { getEnvironmentClient } from "../../state/use-remote-environment-registry";
import { useSelectedThreadDetail } from "../../state/use-thread-detail";
import { useThreadSelection } from "../../state/use-thread-selection";
import {
  parseUnifiedDiff,
  type ParsedDiffFile,
  type ParsedDiffLine,
} from "./review/diffParser";
import {
  REVIEW_MONO_FONT_FAMILY,
  renderVisibleWhitespace,
} from "./review/reviewDiffRendering";

// ── Types ─────────────────────────────────────────────────────────

interface CheckpointTurn {
  turnId: TurnId;
  checkpointTurnCount: number;
  completedAt: string;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
}

// ── Helpers ───────────────────────────────────────────────────────

const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatShortTime(isoDate: string): string {
  try {
    return shortTimeFormatter.format(new Date(isoDate));
  } catch {
    return "";
  }
}

function computeFileStats(file: ParsedDiffFile): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of file.lines) {
    if (line.type === "add") additions++;
    else if (line.type === "delete") deletions++;
  }
  return { additions, deletions };
}

function lineBgClass(type: ParsedDiffLine["type"]): string {
  if (type === "add") return "bg-emerald-500/12";
  if (type === "delete") return "bg-rose-500/12";
  if (type === "hunk") return "bg-sky-500/10";
  return "";
}

// ── Sub-components ────────────────────────────────────────────────

/** Horizontal scrollable turn chip strip */
const DiffTurnStrip = memo(function DiffTurnStrip(props: {
  turns: ReadonlyArray<CheckpointTurn>;
  selectedTurnId: TurnId | null;
  onSelectTurn: (turnId: TurnId | null) => void;
}) {
  const { turns, selectedTurnId, onSelectTurn } = props;

  return (
    <View className="border-b border-border">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          gap: 6,
        }}
      >
        {/* "All" chip */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show all turns"
          onPress={() => onSelectTurn(null)}
        >
          <View
            className={cn(
              "rounded-lg border px-3 py-1.5",
              selectedTurnId === null
                ? "border-border bg-card"
                : "border-border-subtle",
            )}
          >
            <Text
              className={cn(
                "text-[11px]",
                selectedTurnId === null
                  ? "font-t3-bold text-foreground"
                  : "font-t3-medium text-foreground-muted",
              )}
            >
              All turns
            </Text>
          </View>
        </Pressable>

        {/* Individual turn chips */}
        {turns.map((turn) => {
          const isSelected = turn.turnId === selectedTurnId;
          return (
            <Pressable
              key={turn.turnId}
              accessibilityRole="button"
              accessibilityLabel={`Turn ${turn.checkpointTurnCount}`}
              onPress={() => onSelectTurn(turn.turnId)}
            >
              <View
                className={cn(
                  "rounded-lg border px-3 py-1.5",
                  isSelected
                    ? "border-border bg-card"
                    : "border-border-subtle",
                )}
              >
                <View className="flex-row items-center gap-1.5">
                  <Text
                    className={cn(
                      "text-[11px]",
                      isSelected
                        ? "font-t3-bold text-foreground"
                        : "font-t3-medium text-foreground-muted",
                    )}
                  >
                    Turn {turn.checkpointTurnCount}
                  </Text>
                  <Text className="text-[10px] text-foreground-tertiary">
                    {formatShortTime(turn.completedAt)}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

/** Aggregate stats bar: file count + total additions / deletions */
const DiffStatsBar = memo(function DiffStatsBar(props: {
  fileCount: number;
  additions: number;
  deletions: number;
}) {
  return (
    <View className="flex-row items-center gap-2 px-2 pb-1 pt-2">
      <Text className="text-[13px] font-t3-medium text-foreground-muted">
        {props.fileCount} file{props.fileCount !== 1 ? "s" : ""}
      </Text>
      {props.additions > 0 && (
        <Text className="text-[13px] font-t3-bold text-emerald-600 dark:text-emerald-400">
          +{props.additions}
        </Text>
      )}
      {props.deletions > 0 && (
        <Text className="text-[13px] font-t3-bold text-rose-600 dark:text-rose-400">
          -{props.deletions}
        </Text>
      )}
    </View>
  );
});

/** Sticky file header with path and per-file stats */
const DiffFileHeader = memo(function DiffFileHeader(props: {
  path: string;
  additions: number;
  deletions: number;
}) {
  return (
    <View className="flex-row items-center border-b border-border bg-card-alt px-3 py-2.5">
      <NativeText
        numberOfLines={1}
        style={{ fontFamily: REVIEW_MONO_FONT_FAMILY }}
        className="flex-1 text-[12px] text-foreground"
      >
        {props.path}
      </NativeText>
      <View className="ml-2 flex-row items-center gap-1.5">
        {props.additions > 0 && (
          <Text className="text-[11px] font-t3-bold text-emerald-600 dark:text-emerald-400">
            +{props.additions}
          </Text>
        )}
        {props.deletions > 0 && (
          <Text className="text-[11px] font-t3-bold text-rose-600 dark:text-rose-400">
            -{props.deletions}
          </Text>
        )}
      </View>
    </View>
  );
});

/** A single diff line: hunk header, addition, deletion, or context */
const DiffLineRow = memo(function DiffLineRow(props: {
  line: ParsedDiffLine;
}) {
  const { line } = props;

  if (line.type === "meta") return null;

  if (line.type === "hunk") {
    return (
      <View className="border-b border-border/60 bg-sky-500/10 px-2 py-1.5">
        <NativeText
          selectable
          style={{ fontFamily: REVIEW_MONO_FONT_FAMILY }}
          className="text-[11px] leading-[17px] text-foreground-muted"
        >
          {line.content}
        </NativeText>
      </View>
    );
  }

  const marker =
    line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";
  const lineNum =
    line.type === "delete" ? line.oldLine : line.newLine;

  return (
    <View className={cn("flex-row", lineBgClass(line.type))}>
      {/* Line number */}
      <NativeText
        style={{
          fontFamily: REVIEW_MONO_FONT_FAMILY,
          width: 38,
          textAlign: "right",
          paddingRight: 4,
        }}
        className="text-[10px] leading-[17px] text-foreground-tertiary"
      >
        {lineNum ?? ""}
      </NativeText>

      {/* Change marker */}
      <NativeText
        style={{
          fontFamily: REVIEW_MONO_FONT_FAMILY,
          width: 18,
          textAlign: "center",
        }}
        className={cn(
          "text-[11px] leading-[17px]",
          line.type === "add"
            ? "text-emerald-600 dark:text-emerald-400"
            : line.type === "delete"
              ? "text-rose-600 dark:text-rose-400"
              : "text-foreground-tertiary",
        )}
      >
        {marker}
      </NativeText>

      {/* Content */}
      <NativeText
        selectable
        style={{ fontFamily: REVIEW_MONO_FONT_FAMILY }}
        className="text-[12px] leading-[17px] text-foreground"
      >
        {renderVisibleWhitespace(line.content) || " "}
      </NativeText>
    </View>
  );
});

/** A single file card: header + horizontally scrollable diff lines */
const DiffFileCard = memo(function DiffFileCard(props: {
  file: ParsedDiffFile;
}) {
  const { file } = props;
  const path = file.newPath ?? file.oldPath ?? "unknown";
  const stats = useMemo(() => computeFileStats(file), [file]);

  return (
    <View className="overflow-hidden rounded-[14px] border border-border">
      <DiffFileHeader
        path={path}
        additions={stats.additions}
        deletions={stats.deletions}
      />
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={{ minWidth: "100%" }}>
          {file.lines.map((line) => (
            <DiffLineRow key={line.id} line={line} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
});

// ── Main Screen ───────────────────────────────────────────────────

/**
 * Full-screen diff route that slides in from the right.
 *
 * Accessed via `router.push("/threads/[environmentId]/[threadId]/diff")`.
 * Shows turn-by-turn or combined diffs with file-level cards,
 * colored line-level additions / deletions, and a scrollable turn
 * chip strip modelled on the web DiffPanel.
 */
export const ThreadDiffScreen = memo(function ThreadDiffScreen() {
  const { selectedThread } = useThreadSelection();
  const threadDetail = useSelectedThreadDetail();
  const environmentId = selectedThread?.environmentId ?? "";
  const insets = useSafeAreaInsets();

  // ── Derive turns from checkpoints ─────────────────────────────

  const readyCheckpoints = useMemo(() => {
    if (!threadDetail) return [];
    return threadDetail.checkpoints
      .filter((cp) => cp.status === "ready" && cp.checkpointTurnCount > 0)
      .sort((a, b) => a.checkpointTurnCount - b.checkpointTurnCount);
  }, [threadDetail]);

  const turns: CheckpointTurn[] = useMemo(
    () =>
      readyCheckpoints.map((cp) => ({
        turnId: cp.turnId,
        checkpointTurnCount: cp.checkpointTurnCount,
        completedAt: cp.completedAt,
        fileCount: cp.files.length,
        totalAdditions: cp.files.reduce((s, f) => s + f.additions, 0),
        totalDeletions: cp.files.reduce((s, f) => s + f.deletions, 0),
      })),
    [readyCheckpoints],
  );

  const maxTurnCount = useMemo(() => {
    if (readyCheckpoints.length === 0) return null;
    let best = readyCheckpoints[0]!.checkpointTurnCount;
    for (let i = 1; i < readyCheckpoints.length; i++) {
      if (readyCheckpoints[i]!.checkpointTurnCount > best) {
        best = readyCheckpoints[i]!.checkpointTurnCount;
      }
    }
    return best;
  }, [readyCheckpoints]);

  // ── Turn selection state ──────────────────────────────────────

  const [selectedTurnId, setSelectedTurnId] = useState<TurnId | null>(null);

  const selectedTurn = useMemo(
    () =>
      selectedTurnId !== null
        ? (turns.find((t) => t.turnId === selectedTurnId) ?? null)
        : null,
    [selectedTurnId, turns],
  );

  // ── Diff fetch ────────────────────────────────────────────────

  const [diffText, setDiffText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedKey, setFetchedKey] = useState<string | null>(null);

  const currentFetchKey = useMemo(() => {
    if (!threadDetail) return null;
    if (selectedTurn) {
      return `turn:${selectedTurn.turnId}:${selectedTurn.checkpointTurnCount}`;
    }
    if (maxTurnCount !== null) {
      return `all:${maxTurnCount}`;
    }
    return null;
  }, [threadDetail, selectedTurn, maxTurnCount]);

  useEffect(() => {
    if (!threadDetail || currentFetchKey === null) return;
    if (fetchedKey === currentFetchKey) return;

    const client = getEnvironmentClient(environmentId);
    if (!client) {
      setError("Not connected");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const threadId = ThreadId.make(threadDetail.id);

    const promise = selectedTurn
      ? client.orchestration.getTurnDiff({
          threadId,
          fromTurnCount: Math.max(
            0,
            selectedTurn.checkpointTurnCount - 1,
          ) as typeof selectedTurn.checkpointTurnCount,
          toTurnCount: selectedTurn.checkpointTurnCount,
        })
      : maxTurnCount !== null
        ? client.orchestration.getFullThreadDiff({
            threadId,
            toTurnCount: maxTurnCount,
          })
        : null;

    if (!promise) {
      setLoading(false);
      return;
    }

    void promise
      .then((result) => {
        if (!cancelled) {
          setDiffText(result.diff);
          setFetchedKey(currentFetchKey);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Failed to load diff",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    threadDetail,
    currentFetchKey,
    fetchedKey,
    environmentId,
    selectedTurn,
    maxTurnCount,
  ]);

  // ── Parsed diff files ─────────────────────────────────────────

  const parsedFiles = useMemo(() => {
    if (!diffText) return [];
    return parseUnifiedDiff(diffText);
  }, [diffText]);

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of parsedFiles) {
      const s = computeFileStats(file);
      additions += s.additions;
      deletions += s.deletions;
    }
    return { fileCount: parsedFiles.length, additions, deletions };
  }, [parsedFiles]);

  // ── Callbacks ─────────────────────────────────────────────────

  const handleSelectTurn = useCallback((turnId: TurnId | null) => {
    setSelectedTurnId(turnId);
  }, []);

  // ── Render ────────────────────────────────────────────────────

  if (!threadDetail) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet">
        <ActivityIndicator size="small" />
        <Text className="mt-3 text-[13px] text-foreground-muted">
          Loading…
        </Text>
      </View>
    );
  }

  if (readyCheckpoints.length === 0) {
    return (
      <View className="flex-1 bg-sheet">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-[14px] font-t3-bold text-foreground">
            No diffs available
          </Text>
          <Text className="mt-1 text-center text-[13px] text-foreground-muted">
            The agent hasn't made any file changes yet in this thread.
          </Text>
        </View>
      </View>
    );
  }

  const hasNoNetChanges =
    typeof diffText === "string" && diffText.trim().length === 0;

  return (
    <View className="flex-1 bg-sheet">
      {/* ── Turn chip strip ──────────────────────────────────────── */}
      <DiffTurnStrip
        turns={turns}
        selectedTurnId={selectedTurnId}
        onSelectTurn={handleSelectTurn}
      />

      {/* ── Content ──────────────────────────────────────────────── */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
          <Text className="mt-3 text-[13px] text-foreground-muted">
            Loading diff…
          </Text>
        </View>
      ) : error ? (
        <View className="flex-1 px-4 pt-4">
          <Text className="text-[13px] text-rose-600 dark:text-rose-400">
            {error}
          </Text>
        </View>
      ) : parsedFiles.length > 0 ? (
        <ScrollView
          showsVerticalScrollIndicator
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: Math.max(insets.bottom, 18) + 12,
          }}
        >
          <DiffStatsBar
            fileCount={totalStats.fileCount}
            additions={totalStats.additions}
            deletions={totalStats.deletions}
          />
          <View style={{ gap: 12 }}>
            {parsedFiles.map((file) => (
              <DiffFileCard key={file.id} file={file} />
            ))}
          </View>
        </ScrollView>
      ) : hasNoNetChanges ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-[13px] text-foreground-muted">
            No net changes in this selection.
          </Text>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-[13px] text-foreground-muted">
            No diff content available.
          </Text>
        </View>
      )}
    </View>
  );
});
