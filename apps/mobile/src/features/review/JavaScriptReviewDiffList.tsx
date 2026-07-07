import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactElement,
  type Ref,
} from "react";
import {
  Pressable,
  RefreshControl,
  Text as NativeText,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SymbolView } from "expo-symbols";

import { AppText as Text } from "../../components/AppText";
import { MOBILE_CODE_SURFACE } from "../../lib/typography";
import { cn } from "../../lib/cn";
import type { NativeReviewDiffToken } from "../diffs/nativeReviewDiffSurface";
import type { NativeReviewDiffData } from "./nativeReviewDiffAdapter";
import {
  buildReviewListItems,
  type ReviewListItem,
  type ReviewRenderableLineRow,
} from "./reviewModel";
import {
  changeTone,
  DiffTokenText,
  REVIEW_DIFF_LINE_HEIGHT,
  ReviewChangeBar,
} from "./reviewDiffRendering";
import type { ReviewHighlightedToken } from "./shikiReviewHighlighter";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";

export interface JavaScriptReviewDiffListHandle {
  readonly scrollToFile: (fileId: string, animated?: boolean) => Promise<void>;
  readonly scrollToTop: (animated?: boolean) => Promise<void>;
}

export interface JavaScriptReviewDiffListProps {
  readonly files: ReadonlyArray<import("./reviewModel").ReviewRenderableFile>;
  readonly nativeData: NativeReviewDiffData;
  readonly expandedFileIds: ReadonlyArray<string>;
  readonly viewedFileIds: ReadonlyArray<string>;
  readonly revealedLargeFileIds: ReadonlyArray<string>;
  readonly selectedRowIds: ReadonlyArray<string>;
  readonly tokensPatchJson: string;
  readonly backgroundColor: string;
  readonly refreshing: boolean;
  readonly onPullToRefresh: () => void;
  readonly onToggleFile: (fileId: string) => void;
  readonly onToggleViewedFile: (fileId: string) => void;
  readonly onRevealLargeFile: (fileId: string) => void;
  readonly onPressLine: (
    event: NativeSyntheticEvent<{
      readonly rowId?: string;
      readonly gesture?: "tap" | "longPress";
    }>,
  ) => void;
  readonly onUpdateVisibleRange: (range: {
    readonly firstRowIndex: number;
    readonly lastRowIndex: number;
  }) => void;
  readonly onVisibleFileChange?: (fileId: string | null) => void;
  readonly ListHeaderComponent?: ReactElement | null;
  readonly contentResetKey: string;
}

function convertNativeTokens(
  tokens: ReadonlyArray<NativeReviewDiffToken> | undefined,
): ReadonlyArray<ReviewHighlightedToken> | null {
  if (!tokens || tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => ({
    content: token.content,
    color: token.color,
    fontStyle: token.fontStyle,
  }));
}

function parseTokensByRenderableRowId(
  tokensPatchJson: string,
): Record<string, ReviewHighlightedToken[]> {
  try {
    const parsed = JSON.parse(tokensPatchJson) as {
      tokensByRowId?: Record<string, ReadonlyArray<NativeReviewDiffToken>>;
    };
    const nativeTokens = parsed.tokensByRowId ?? {};
    const next: Record<string, ReviewHighlightedToken[]> = {};
    for (const [nativeRowId, tokens] of Object.entries(nativeTokens)) {
      const converted = convertNativeTokens(tokens);
      if (converted) {
        next[nativeRowId] = [...converted];
      }
    }
    return next;
  } catch {
    return {};
  }
}

function resolveNativeRowId(
  lineRow: ReviewRenderableLineRow,
  rowIdByCommentLineId: ReadonlyMap<string, string>,
): string | null {
  return rowIdByCommentLineId.get(lineRow.id) ?? null;
}

const ReviewFileHeaderRow = memo(function ReviewFileHeaderRow(props: {
  readonly item: Extract<ReviewListItem, { kind: "file-header" }>;
  readonly viewed: boolean;
  readonly onToggleFile: (fileId: string) => void;
  readonly onToggleViewedFile: (fileId: string) => void;
}) {
  const { file, expanded } = props.item;
  return (
    <Pressable
      accessibilityRole="button"
      className="border-b border-border bg-card px-3 py-2.5"
      onPress={() => props.onToggleFile(file.id)}
    >
      <View className="flex-row items-center gap-2">
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColor="#8e8e93"
          type="monochrome"
        />
        <View className="min-w-0 flex-1">
          <Text className="font-mono text-xs font-t3-semibold text-foreground" numberOfLines={1}>
            {file.path}
          </Text>
          {file.previousPath ? (
            <Text className="font-mono text-[10px] text-foreground-muted" numberOfLines={1}>
              {file.previousPath}
            </Text>
          ) : null}
        </View>
        <Text className="font-mono text-[10px] text-emerald-500">+{file.additions}</Text>
        <Text className="font-mono text-[10px] text-rose-500">-{file.deletions}</Text>
        <Pressable
          accessibilityLabel={props.viewed ? "Mark file unviewed" : "Mark file viewed"}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            props.onToggleViewedFile(file.id);
          }}
        >
          <SymbolView
            name={props.viewed ? "eye.fill" : "eye"}
            size={14}
            tintColor={props.viewed ? "#34c759" : "#8e8e93"}
            type="monochrome"
          />
        </Pressable>
      </View>
    </Pressable>
  );
});

const ReviewLineRow = memo(function ReviewLineRow(props: {
  readonly row: ReviewRenderableLineRow;
  readonly selected: boolean;
  readonly tokens: ReadonlyArray<ReviewHighlightedToken> | null;
  readonly nativeRowId: string | null;
  readonly onPressLine: JavaScriptReviewDiffListProps["onPressLine"];
}) {
  const emit = useCallback(
    (gesture: "tap" | "longPress") => {
      if (!props.nativeRowId) {
        return;
      }
      props.onPressLine({
        nativeEvent: { rowId: props.nativeRowId, gesture },
      } as NativeSyntheticEvent<{ rowId?: string; gesture?: "tap" | "longPress" }>);
    },
    [props.nativeRowId, props.onPressLine],
  );

  return (
    <Pressable
      accessibilityRole="button"
      className={cn("flex-row", changeTone(props.row.change), props.selected && "bg-sky-500/10")}
      onLongPress={() => emit("longPress")}
      onPress={() => emit("tap")}
      style={{ minHeight: REVIEW_DIFF_LINE_HEIGHT }}
    >
      <ReviewChangeBar change={props.row.change} />
      <View className="w-[52px] items-end justify-center pr-2">
        <NativeText className="font-mono text-[10px] text-foreground-muted">
          {props.row.oldLineNumber ?? ""}
        </NativeText>
      </View>
      <View className="w-[52px] items-end justify-center pr-2">
        <NativeText className="font-mono text-[10px] text-foreground-muted">
          {props.row.newLineNumber ?? ""}
        </NativeText>
      </View>
      <View className="min-w-0 flex-1 justify-center pr-3">
        <DiffTokenText
          tokens={props.tokens}
          fallback={props.row.content}
          change={props.row.change}
        />
      </View>
    </Pressable>
  );
});

function ReviewDiffListRow(props: {
  readonly item: ReviewListItem;
  readonly viewedFileIds: ReadonlySet<string>;
  readonly selectedRowIds: ReadonlySet<string>;
  readonly tokensByNativeRowId: Record<string, ReviewHighlightedToken[]>;
  readonly rowIdByCommentLineId: ReadonlyMap<string, string>;
  readonly onToggleFile: (fileId: string) => void;
  readonly onToggleViewedFile: (fileId: string) => void;
  readonly onRevealLargeFile: (fileId: string) => void;
  readonly onPressLine: JavaScriptReviewDiffListProps["onPressLine"];
}) {
  switch (props.item.kind) {
    case "file-header":
      return (
        <ReviewFileHeaderRow
          item={props.item}
          viewed={props.viewedFileIds.has(props.item.fileId)}
          onToggleFile={props.onToggleFile}
          onToggleViewedFile={props.onToggleViewedFile}
        />
      );
    case "file-suppressed":
      return (
        <View className="border-b border-border bg-card px-4 py-4">
          <Text className="text-xs leading-normal text-foreground-muted">{props.item.message}</Text>
          {props.item.actionLabel ? (
            <Pressable
              className="mt-2 self-start"
              onPress={() => props.onRevealLargeFile(props.item.fileId)}
            >
              <Text className="text-xs font-t3-semibold text-sky-500">
                {props.item.actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    case "hunk":
      return (
        <View className="bg-sky-500/10 px-3 py-1.5">
          <Text className="font-mono text-[11px] font-t3-medium text-sky-600 dark:text-sky-300">
            {props.item.row.header}
          </Text>
          {props.item.row.context ? (
            <Text className="font-mono text-[10px] text-foreground-muted">
              {props.item.row.context}
            </Text>
          ) : null}
        </View>
      );
    case "line": {
      const nativeRowId = resolveNativeRowId(props.item.row, props.rowIdByCommentLineId);
      const tokens = nativeRowId ? (props.tokensByNativeRowId[nativeRowId] ?? null) : null;
      return (
        <ReviewLineRow
          nativeRowId={nativeRowId}
          row={props.item.row}
          selected={nativeRowId ? props.selectedRowIds.has(nativeRowId) : false}
          tokens={tokens}
          onPressLine={props.onPressLine}
        />
      );
    }
    default:
      return null;
  }
}

export const JavaScriptReviewDiffList = forwardRef(function JavaScriptReviewDiffList(
  props: JavaScriptReviewDiffListProps,
  ref: Ref<JavaScriptReviewDiffListHandle>,
) {
  const listRef = useRef<LegendListRef | null>(null);
  const { nativeReviewDiffStyle } = useAppearanceCodeSurface();
  const rowHeight = nativeReviewDiffStyle.rowHeight ?? MOBILE_CODE_SURFACE.rowHeight;

  const listItems = useMemo(
    () =>
      buildReviewListItems({
        files: props.files,
        expandedFileIds: props.expandedFileIds,
        revealedLargeFileIds: props.revealedLargeFileIds,
      }),
    [props.expandedFileIds, props.files, props.revealedLargeFileIds],
  );

  const fileHeaderIndexById = useMemo(() => {
    const map = new Map<string, number>();
    listItems.forEach((item, index) => {
      if (item.kind === "file-header") {
        map.set(item.fileId, index);
      }
    });
    return map;
  }, [listItems]);

  const tokensByNativeRowId = useMemo(
    () => parseTokensByRenderableRowId(props.tokensPatchJson),
    [props.tokensPatchJson],
  );

  const viewedFileIds = useMemo(() => new Set(props.viewedFileIds), [props.viewedFileIds]);
  const selectedRowIds = useMemo(() => new Set(props.selectedRowIds), [props.selectedRowIds]);

  const extraData = useMemo(
    () => ({
      viewedFileIds: props.viewedFileIds,
      selectedRowIds: props.selectedRowIds,
      tokensPatchJson: props.tokensPatchJson,
      expandedFileIds: props.expandedFileIds,
      revealedLargeFileIds: props.revealedLargeFileIds,
    }),
    [
      props.expandedFileIds,
      props.revealedLargeFileIds,
      props.selectedRowIds,
      props.tokensPatchJson,
      props.viewedFileIds,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToFile: async (fileId, animated = true) => {
        const index = fileHeaderIndexById.get(fileId);
        if (index === undefined) {
          return;
        }
        listRef.current?.scrollToIndex({ index, animated, viewPosition: 0 });
      },
      scrollToTop: async (animated = true) => {
        listRef.current?.scrollToIndex({ index: 0, animated, viewPosition: 0 });
      },
    }),
    [fileHeaderIndexById],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const firstRowIndex = Math.max(0, Math.floor(offsetY / rowHeight));
      const visibleCount = Math.ceil(event.nativeEvent.layoutMeasurement.height / rowHeight) + 4;
      props.onUpdateVisibleRange({
        firstRowIndex,
        lastRowIndex: Math.min(props.nativeData.rows.length - 1, firstRowIndex + visibleCount),
      });
    },
    [props.nativeData.rows.length, props.onUpdateVisibleRange, rowHeight],
  );

  const handleViewableItemsChanged = useCallback(
    (info: { viewableItems: ReadonlyArray<{ index: number | null; item: ReviewListItem }> }) => {
      const firstVisible = info.viewableItems.find((entry) => entry.index !== null);
      const fileId =
        firstVisible?.item.kind === "file-header"
          ? firstVisible.item.fileId
          : firstVisible?.item.kind === "line" ||
              firstVisible?.item.kind === "hunk" ||
              firstVisible?.item.kind === "file-suppressed"
            ? firstVisible.item.fileId
            : null;
      props.onVisibleFileChange?.(fileId);
    },
    [props.onVisibleFileChange],
  );

  const renderItem = useCallback(
    ({ item }: { item: ReviewListItem }) => (
      <ReviewDiffListRow
        item={item}
        rowIdByCommentLineId={props.nativeData.rowIdByCommentLineId}
        selectedRowIds={selectedRowIds}
        tokensByNativeRowId={tokensByNativeRowId}
        viewedFileIds={viewedFileIds}
        onPressLine={props.onPressLine}
        onRevealLargeFile={props.onRevealLargeFile}
        onToggleFile={props.onToggleFile}
        onToggleViewedFile={props.onToggleViewedFile}
      />
    ),
    [
      props.nativeData.rowIdByCommentLineId,
      props.onPressLine,
      props.onRevealLargeFile,
      props.onToggleFile,
      props.onToggleViewedFile,
      selectedRowIds,
      tokensByNativeRowId,
      viewedFileIds,
    ],
  );

  return (
    <LegendList
      key={props.contentResetKey}
      ref={listRef}
      data={listItems}
      drawDistance={500}
      estimatedItemSize={rowHeight}
      extraData={extraData}
      getItemType={(item) => item.kind}
      keyExtractor={(item) => item.id}
      recycleItems
      renderItem={renderItem}
      ListHeaderComponent={props.ListHeaderComponent}
      contentContainerStyle={{ backgroundColor: props.backgroundColor }}
      onScroll={handleScroll}
      onViewableItemsChanged={handleViewableItemsChanged}
      refreshControl={
        <RefreshControl refreshing={props.refreshing} onRefresh={props.onPullToRefresh} />
      }
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1, backgroundColor: props.backgroundColor }}
    />
  );
});
