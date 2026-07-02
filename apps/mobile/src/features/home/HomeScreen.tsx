import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import {
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  SidebarProjectGroupingMode,
  SidebarThreadSortOrder,
} from "@t3tools/contracts";
import { SymbolView } from "expo-symbols";
import { memo, useCallback, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Platform, Pressable, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColor } from "../../lib/useThemeColor";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import type { WorkspaceState } from "../../state/workspaceModel";
import type { SavedRemoteConnection } from "../../lib/connection";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { relativeTime } from "../../lib/time";
import { useThreadPr } from "../../state/use-thread-pr";
import { resolveThreadStatus } from "../threads/threadPresentation";
import type { HomeListFilterMenuEnvironment } from "./home-list-filter-menu";
import {
  buildHomeListLayout,
  DEFAULT_GROUP_DISPLAY_STATE,
  nextGroupDisplayState,
  type HomeGroupDisplayAction,
  type HomeGroupDisplayState,
  type HomeListItem,
} from "./homeListItems";
import { buildHomeThreadGroups, type HomeProjectSortOrder } from "./homeThreadList";
import { ThreadSwipeable } from "./thread-swipe-actions";
import { WorkspaceConnectionStatus } from "./WorkspaceConnectionStatus";
import { shouldShowWorkspaceConnectionStatus } from "./workspace-connection-status";

/* ─── Types ──────────────────────────────────────────────────────────── */

interface HomeScreenProps {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly catalogState: WorkspaceState;
  readonly savedConnectionsById: Readonly<Record<string, SavedRemoteConnection>>;
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectSortOrderChange: (sortOrder: HomeProjectSortOrder) => void;
  readonly onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  readonly onProjectGroupingModeChange: (mode: SidebarProjectGroupingMode) => void;
  readonly onAddConnection: () => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
}

/* ─── Layout constants ───────────────────────────────────────────────── */

const ESTIMATED_THREAD_ROW_HEIGHT = 64;
/** Left inset that aligns secondary rows with the thread title column. */
const THREAD_TEXT_COLUMN_INSET = 20;
/** Height of the floating custom header on non-iOS platforms. */
const CUSTOM_HEADER_HEIGHT = 78;

function deriveEmptyState(props: {
  readonly catalogState: WorkspaceState;
  readonly projectCount: number;
}): { readonly title: string; readonly detail: string; readonly loading: boolean } {
  const { catalogState } = props;
  if (catalogState.isLoadingConnections) {
    return {
      title: "Loading environments",
      detail: "Checking saved environments on this device.",
      loading: true,
    };
  }

  if (!catalogState.hasConnections) {
    return {
      title: "No environments connected",
      detail: "Add an environment to load projects and start coding sessions.",
      loading: false,
    };
  }

  if (
    (catalogState.connectionState === "available" ||
      catalogState.connectionState === "offline" ||
      catalogState.connectionState === "error") &&
    !catalogState.hasLoadedShellSnapshot
  ) {
    return {
      title: "Environment unavailable",
      detail:
        catalogState.connectionError ??
        "The saved environment is offline. Check the URL or start the environment, then retry.",
      loading: false,
    };
  }

  if (
    catalogState.hasConnectingEnvironment &&
    !catalogState.hasLoadedShellSnapshot &&
    catalogState.connectionError === null
  ) {
    return {
      title: "Connecting to environment",
      detail: "Loading projects and threads from the saved environment.",
      loading: true,
    };
  }

  if (props.projectCount === 0 && catalogState.hasLoadedShellSnapshot) {
    return {
      title: "No projects found",
      detail: "The connected environment did not report any projects.",
      loading: false,
    };
  }

  return {
    title: "No threads yet",
    detail: "Create a task to start a new coding session in one of your connected projects.",
    loading: false,
  };
}

/* ─── Project group header ───────────────────────────────────────────── */

const ProjectGroupHeader = memo(function ProjectGroupHeader(props: {
  readonly project: EnvironmentProject;
  readonly title: string;
  readonly threadCount: number;
  readonly collapsed: boolean;
  readonly isFirst: boolean;
  readonly groupKey: string;
  readonly onGroupAction: (key: string, action: HomeGroupDisplayAction) => void;
}) {
  const iconSubtleColor = useThemeColor("--color-icon-subtle");
  const { groupKey, onGroupAction } = props;
  const handleToggle = useCallback(
    () => onGroupAction(groupKey, "toggle-collapsed"),
    [groupKey, onGroupAction],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !props.collapsed }}
      accessibilityLabel={`${props.title}, ${props.threadCount} threads`}
      accessibilityHint={props.collapsed ? "Expands the project" : "Collapses the project"}
      className="bg-screen"
      onPress={handleToggle}
    >
      <View
        className={`flex-row items-center gap-2.5 px-5 pb-3 ${props.isFirst ? "pt-2" : "pt-6"}`}
        style={{ minHeight: 44 }}
      >
        <ProjectFavicon
          environmentId={props.project.environmentId}
          size={22}
          projectTitle={props.project.title}
          workspaceRoot={props.project.workspaceRoot}
        />
        <Text
          className="flex-shrink text-base font-t3-bold text-foreground-muted"
          style={{ letterSpacing: 0.2 }}
          numberOfLines={1}
        >
          {props.title}
        </Text>
        <Text className="flex-1 text-sm font-t3-medium text-foreground-tertiary">
          {props.threadCount}
        </Text>
        <SymbolView
          name={props.collapsed ? "chevron.right" : "chevron.down"}
          size={13}
          tintColor={iconSubtleColor}
          type="monochrome"
          weight="semibold"
        />
      </View>
    </Pressable>
  );
});

/* ─── Show more / show less row ──────────────────────────────────────── */

const ShowMoreRow = memo(function ShowMoreRow(props: {
  readonly hiddenCount: number;
  readonly canShowLess: boolean;
  readonly groupKey: string;
  readonly onGroupAction: (key: string, action: HomeGroupDisplayAction) => void;
}) {
  const iconSubtleColor = useThemeColor("--color-icon-subtle");
  const showsMore = props.hiddenCount > 0;
  const { groupKey, onGroupAction } = props;
  const handleShowMore = useCallback(
    () => onGroupAction(groupKey, "show-more"),
    [groupKey, onGroupAction],
  );
  const handleShowLess = useCallback(
    () => onGroupAction(groupKey, "show-less"),
    [groupKey, onGroupAction],
  );

  return (
    <View
      className="flex-row items-center gap-2.5 bg-screen"
      style={{
        paddingLeft: THREAD_TEXT_COLUMN_INSET,
        paddingRight: 18,
        paddingVertical: 12,
      }}
    >
      {showsMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show more threads"
          className="rounded-full bg-subtle"
          hitSlop={6}
          onPress={handleShowMore}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderCurve: "continuous",
          })}
        >
          <View className="flex-row items-center gap-1.5">
            <SymbolView
              name="chevron.down"
              size={10}
              tintColor={iconSubtleColor}
              type="monochrome"
              weight="semibold"
            />
            <Text className="text-sm font-t3-medium text-foreground-muted">Show more</Text>
          </View>
        </Pressable>
      ) : null}
      {props.canShowLess ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show fewer threads"
          className="rounded-full bg-subtle"
          hitSlop={6}
          onPress={handleShowLess}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderCurve: "continuous",
          })}
        >
          <View className="flex-row items-center gap-1.5">
            <SymbolView
              name="chevron.up"
              size={10}
              tintColor={iconSubtleColor}
              type="monochrome"
              weight="semibold"
            />
            <Text className="text-sm font-t3-medium text-foreground-muted">Show less</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});

function HomeTopContentSpacer(props: { readonly topInset: number }) {
  return <View style={{ height: props.topInset + CUSTOM_HEADER_HEIGHT }} />;
}

/* ─── Thread row ─────────────────────────────────────────────────────── */

const ThreadRow = memo(function ThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly environmentLabel: string | null;
  readonly projectCwd: string | null;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly simultaneousSwipeGesture?: ComponentProps<
    typeof ThreadSwipeable
  >["simultaneousWithExternalGesture"];
  readonly isLast: boolean;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const separatorColor = useThemeColor("--color-separator");
  const iconSubtleColor = useThemeColor("--color-icon-subtle");
  const screenColor = useThemeColor("--color-screen");
  const { thread, onSelectThread, onArchiveThread, onDeleteThread } = props;
  const status = resolveThreadStatus(thread);
  const pr = useThreadPr(thread, props.projectCwd);
  const timestamp = relativeTime(
    thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
  );
  const branch = thread.branch;
  const subtitleParts = [props.environmentLabel, branch].filter((part): part is string =>
    Boolean(part),
  );
  const handleDelete = useCallback(() => onDeleteThread(thread), [onDeleteThread, thread]);
  const primaryAction = useMemo(
    () => ({
      accessibilityLabel: `Archive ${thread.title}`,
      icon: "archivebox" as const,
      label: "Archive",
      onPress: () => onArchiveThread(thread),
    }),
    [onArchiveThread, thread],
  );

  return (
    <ThreadSwipeable
      backgroundColor={screenColor}
      fullSwipeWidth={windowWidth - 32}
      onDelete={handleDelete}
      onSwipeableClose={props.onSwipeableClose}
      onSwipeableWillOpen={props.onSwipeableWillOpen}
      primaryAction={primaryAction}
      simultaneousWithExternalGesture={props.simultaneousSwipeGesture}
      threadTitle={thread.title}
    >
      {(close) => (
        <Pressable
          accessibilityHint="Swipe left for archive and delete actions"
          accessibilityLabel={thread.title}
          accessibilityRole="button"
          className="bg-screen"
          onPress={() => {
            close();
            onSelectThread(thread);
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View
            style={{
              paddingLeft: THREAD_TEXT_COLUMN_INSET,
              paddingRight: 18,
              paddingTop: 10,
            }}
          >
            <View
              style={{
                gap: 3,
                borderBottomWidth: props.isLast ? 0 : 1,
                borderBottomColor: separatorColor,
                paddingBottom: 10,
              }}
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-lg font-t3-bold text-foreground" numberOfLines={1}>
                  {thread.title}
                </Text>
                <View className="flex-row items-center gap-2">
                  {status ? (
                    <View
                      className={status.pillClassName}
                      style={{ borderRadius: 99, paddingHorizontal: 6, paddingVertical: 2 }}
                    >
                      <Text className={`text-3xs font-t3-bold ${status.textClassName}`}>
                        {status.label}
                      </Text>
                    </View>
                  ) : null}
                  <Text
                    className="text-base text-foreground-tertiary"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {timestamp}
                  </Text>
                  <SymbolView
                    name="chevron.right"
                    size={13}
                    tintColor={iconSubtleColor}
                    type="monochrome"
                  />
                </View>
              </View>

              {subtitleParts.length > 0 || pr !== null ? (
                <View className="flex-row items-center gap-1.5" style={{ marginTop: 1 }}>
                  {subtitleParts.length > 0 ? (
                    <>
                      <SymbolView
                        name="arrow.triangle.branch"
                        size={10}
                        tintColor={iconSubtleColor}
                        type="monochrome"
                      />
                      <Text
                        className="text-sm text-foreground-muted"
                        numberOfLines={1}
                        style={{ flexShrink: 1 }}
                      >
                        {subtitleParts.join(" · ")}
                      </Text>
                    </>
                  ) : null}
                  {pr !== null ? (
                    <Text className={`text-sm font-t3-medium ${pr.textClassName}`}>
                      {pr.label}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      )}
    </ThreadSwipeable>
  );
});

/* ─── Main screen ────────────────────────────────────────────────────── */

export function HomeScreen(props: HomeScreenProps) {
  const [groupDisplayStates, setGroupDisplayStates] = useState<
    ReadonlyMap<string, HomeGroupDisplayState>
  >(() => new Map());
  const openSwipeableRef = useRef<SwipeableMethods | null>(null);
  const listRef = useRef<LegendListRef | null>(null);
  const insets = useSafeAreaInsets();
  const accentColor = useThemeColor("--color-icon-muted");

  const updateGroupDisplay = useCallback(
    (key: string, action: HomeGroupDisplayAction) => {
      setGroupDisplayStates((previous) => {
        const next = new Map(previous);
        next.set(
          key,
          nextGroupDisplayState(previous.get(key) ?? DEFAULT_GROUP_DISPLAY_STATE, action),
        );
        return next;
      });
    },
    [],
  );

  const handleSwipeableWillOpen = useCallback((methods: SwipeableMethods) => {
    if (openSwipeableRef.current !== methods) {
      openSwipeableRef.current?.close();
      openSwipeableRef.current = methods;
    }
  }, []);

  const handleSwipeableClose = useCallback((methods: SwipeableMethods) => {
    if (openSwipeableRef.current === methods) {
      openSwipeableRef.current = null;
    }
  }, []);

  const projectGroups = useMemo(
    () =>
      buildHomeThreadGroups({
        projects: props.projects,
        threads: props.threads,
        environmentId: props.selectedEnvironmentId,
        searchQuery: props.searchQuery,
        projectSortOrder: props.projectSortOrder,
        threadSortOrder: props.threadSortOrder,
        projectGroupingMode: props.projectGroupingMode,
      }),
    [
      props.projectGroupingMode,
      props.projects,
      props.projectSortOrder,
      props.searchQuery,
      props.selectedEnvironmentId,
      props.threadSortOrder,
      props.threads,
    ],
  );

  const hasSearchQuery = props.searchQuery.trim().length > 0;
  const listLayout = useMemo(
    () =>
      buildHomeListLayout({
        groups: projectGroups,
        displayStates: groupDisplayStates,
        showAllThreads: hasSearchQuery,
      }),
    [projectGroups, groupDisplayStates, hasSearchQuery],
  );

  const projectCwdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of props.projects) {
      map.set(scopedProjectKey(project.environmentId, project.id), project.workspaceRoot);
    }
    return map;
  }, [props.projects]);

  const extraData = useMemo(
    () => ({ savedConnectionsById: props.savedConnectionsById, projectCwdByKey }),
    [props.savedConnectionsById, projectCwdByKey],
  );

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<HomeListItem>) => {
      switch (item.type) {
        case "header":
          return (
            <ProjectGroupHeader
              collapsed={item.collapsed}
              isFirst={item.isFirst}
              groupKey={item.group.key}
              onGroupAction={updateGroupDisplay}
              project={item.group.representative}
              threadCount={item.group.threads.length}
              title={item.group.title}
            />
          );
        case "thread": {
          const thread = item.thread;
          return (
            <ThreadRow
              thread={thread}
              environmentLabel={
                props.savedConnectionsById[thread.environmentId]?.environmentLabel ?? null
              }
              projectCwd={
                projectCwdByKey.get(scopedProjectKey(thread.environmentId, thread.projectId)) ??
                null
              }
              isLast={item.isLast}
              onArchiveThread={props.onArchiveThread}
              onDeleteThread={props.onDeleteThread}
              onSelectThread={props.onSelectThread}
              onSwipeableClose={handleSwipeableClose}
              onSwipeableWillOpen={handleSwipeableWillOpen}
            />
          );
        }
        case "show-more":
          return (
            <ShowMoreRow
              hiddenCount={item.hiddenCount}
              canShowLess={item.canShowLess}
              groupKey={item.groupKey}
              onGroupAction={updateGroupDisplay}
            />
          );
      }
    },
    [
      handleSwipeableClose,
      handleSwipeableWillOpen,
      projectCwdByKey,
      props.onArchiveThread,
      props.onDeleteThread,
      props.onSelectThread,
      props.savedConnectionsById,
      updateGroupDisplay,
    ],
  );

  const keyExtractor = useCallback((item: HomeListItem) => item.key, []);

  // Item objects are rebuilt on every collapse/show-more toggle; without this
  // LegendList would consider every mounted row changed and re-render all of
  // them (each carrying a swipeable + a vcs-status subscription), which made
  // taps visibly laggy. Group/thread references are stable across toggles.
  const itemsAreEqual = useCallback((previous: HomeListItem, item: HomeListItem) => {
    if (previous.type !== item.type) return false;
    switch (item.type) {
      case "header":
        return (
          previous.type === "header" &&
          previous.group === item.group &&
          previous.collapsed === item.collapsed &&
          previous.isFirst === item.isFirst
        );
      case "thread":
        return (
          previous.type === "thread" &&
          previous.thread === item.thread &&
          previous.isLast === item.isLast
        );
      case "show-more":
        return (
          previous.type === "show-more" &&
          previous.groupKey === item.groupKey &&
          previous.hiddenCount === item.hiddenCount &&
          previous.canShowLess === item.canShowLess
        );
    }
  }, []);

  /* Empty states */
  const hasAnyThreads = props.threads.some((thread) => thread.archivedAt === null);
  const hasResults = projectGroups.length > 0;
  const selectedEnvironmentLabel =
    props.selectedEnvironmentId === null
      ? null
      : (props.savedConnectionsById[props.selectedEnvironmentId]?.environmentLabel ??
        "this environment");
  const shouldShowConnectionStatus = shouldShowWorkspaceConnectionStatus(props.catalogState);
  const emptyState = deriveEmptyState({
    catalogState: props.catalogState,
    projectCount: props.projects.length,
  });
  const connectionStatus =
    shouldShowConnectionStatus && Platform.OS !== "ios" ? (
      <View
        className="absolute left-0 right-0 items-center"
        style={{ bottom: Math.max(insets.bottom, 18) + 76 }}
      >
        <WorkspaceConnectionStatus state={props.catalogState} onPress={props.onOpenEnvironments} />
      </View>
    ) : null;

  if (!hasAnyThreads) {
    return (
      <View
        className="flex-1 items-center justify-center bg-screen px-8"
        style={{
          paddingBottom: Math.max(insets.bottom, 24),
          paddingTop: Platform.OS === "ios" ? insets.top + 72 : insets.top,
        }}
      >
        <View className="w-full max-w-[430px]">
          <EmptyState
            title={emptyState.title}
            detail={emptyState.detail}
            actionLabel={!props.catalogState.hasReadyEnvironment ? "Add environment" : undefined}
            onAction={!props.catalogState.hasReadyEnvironment ? props.onAddConnection : undefined}
            variant="plain"
          />
          {emptyState.loading ? (
            <View className="mt-4 items-center">
              <ActivityIndicator color={accentColor} />
            </View>
          ) : null}
        </View>
        {connectionStatus}
      </View>
    );
  }

  const listHeader = (
    <>
      {Platform.OS === "ios" ? null : <HomeTopContentSpacer topInset={insets.top} />}

      {shouldShowConnectionStatus && Platform.OS === "ios" ? (
        <View style={{ paddingBottom: 16 }}>
          <WorkspaceConnectionStatus
            state={props.catalogState}
            onPress={props.onOpenEnvironments}
            variant="sidebar"
          />
        </View>
      ) : null}
    </>
  );

  const listEmpty = !hasResults ? (
    hasSearchQuery ? (
      <EmptyState title="No results" detail={`No threads matching "${props.searchQuery}".`} />
    ) : selectedEnvironmentLabel ? (
      <EmptyState
        title={`No threads in ${selectedEnvironmentLabel}`}
        detail="Choose another environment or create a new task."
      />
    ) : (
      <EmptyState title="No threads yet" detail="Create a task to start a new coding session." />
    )
  ) : null;

  return (
    <View className="flex-1 bg-screen">
      {/* Sticky headers are deliberately not wired up: LegendList's JS sticky
          implementation mispositions pinned headers at mount under iOS
          automatic content insets (headers render one nav-inset too low until
          the first scroll event) and blanks non-pinned headers after
          collapse/expand data changes. The flattened layout still exposes
          `stickyHeaderIndices` if this gets revisited. */}
      <LegendList
        ref={listRef}
        data={listLayout.items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        itemsAreEqual={itemsAreEqual}
        estimatedItemSize={ESTIMATED_THREAD_ROW_HEIGHT}
        extraData={extraData}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        style={{ flex: 1 }}
        automaticallyAdjustsScrollIndicatorInsets={Platform.OS === "ios"}
        contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : "never"}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => openSwipeableRef.current?.close()}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingBottom: Platform.OS === "ios" ? Math.max(insets.bottom, 24) + 24 : 24,
        }}
        scrollIndicatorInsets={
          Platform.OS === "ios"
            ? {
                bottom: Math.max(insets.bottom, 16) + 24,
                top: 0,
              }
            : undefined
        }
      />
      {connectionStatus}
    </View>
  );
}
