import { useEffect, useMemo } from "react";
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import type { StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../../components/AppText";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import type { WorkspaceState } from "../../state/workspaceModel";
import { HomeHeader } from "../home/HomeHeader";
import { HomeScreen } from "../home/HomeScreen";
import { ThreadDetailScreen } from "../threads/ThreadDetailScreen";
import { ThreadListGroupHeader, ThreadListRow } from "../threads/thread-list-items";
import { TerminalSurface } from "../terminal/NativeTerminalSurface";
import { getPierreTerminalTheme } from "../terminal/terminalTheme";
import {
  NATIVE_REVIEW_DIFF_CONTENT_WIDTH,
  buildNativeReviewDiffData,
  createNativeReviewDiffStyle,
  createNativeReviewDiffTheme,
} from "../review/nativeReviewDiffAdapter";
import { buildReviewParsedDiff } from "../review/reviewModel";
import { resolveNativeReviewDiffView } from "../diffs/nativeReviewDiffSurface";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  SHOWCASE_DIFF,
  SHOWCASE_ENVIRONMENT_ID,
  SHOWCASE_SCENES,
  SHOWCASE_TERMINAL_BUFFER,
  createShowcaseFixture,
  type ShowcaseFixture,
  type ShowcaseScene,
} from "./showcaseData";
import { markNativeShowcaseReady } from "./nativeShowcaseScene";

const NOOP = () => undefined;
const NOOP_ASYNC = async () => undefined;
const ANDROID_SHOWCASE_TERMINAL_BUFFER = [
  "\u001b[38;5;75m",
  "\u001b[38;5;212m",
  "\u001b[32m",
  "\u001b[0m",
].reduce((buffer, sequence) => buffer.replaceAll(sequence, ""), SHOWCASE_TERMINAL_BUFFER);
const CONNECTED_WORKSPACE: WorkspaceState = {
  isLoadingConnections: false,
  hasConnections: true,
  hasLoadedShellSnapshot: true,
  hasPendingShellSnapshot: false,
  hasReadyEnvironment: true,
  hasConnectingEnvironment: false,
  connectingEnvironments: [],
  connectionState: "connected",
  connectionError: null,
  shellSnapshotError: null,
  latestCachedSnapshotReceivedAt: null,
  networkStatus: "online",
};

function resolveScene(value: string | string[] | undefined): ShowcaseScene {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SHOWCASE_SCENES.find((scene) => scene === candidate) ?? "thread";
}

function ShowcaseSidebar(props: { readonly fixture: ShowcaseFixture }) {
  return (
    <View className="h-full border-r border-separator bg-drawer" style={{ width: 344 }}>
      <View className="px-5 pb-3 pt-5">
        <View className="mb-4 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-t3-bold text-foreground">Threads</Text>
            <Text className="mt-0.5 text-xs text-foreground-muted">
              {props.fixture.environmentLabel}
            </Text>
          </View>
          <View className="size-10 items-center justify-center rounded-full bg-foreground">
            <SymbolView name="square.and.pencil" size={17} tintColor="#ffffff" />
          </View>
        </View>
        <View className="flex-row items-center gap-2 rounded-xl bg-subtle px-3 py-2.5">
          <SymbolView name="magnifyingglass" size={14} tintColor="#8e8e93" />
          <Text className="text-sm text-foreground-tertiary">Search projects and threads</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <ThreadListGroupHeader
          variant="sidebar"
          collapsed={false}
          groupKey="showcase-lumen-notes"
          isFirst
          newThreadTarget={props.fixture.project}
          project={props.fixture.project}
          threadCount={props.fixture.threads.length}
          title={props.fixture.project.title}
          onGroupAction={NOOP}
          onNewThread={NOOP}
        />
        <View className="px-2">
          {props.fixture.threads.map((thread, index) => (
            <ThreadListRow
              key={thread.id}
              variant="sidebar"
              environmentLabel={props.fixture.environmentLabel}
              isLast={index === props.fixture.threads.length - 1}
              projectCwd={props.fixture.project.workspaceRoot}
              selected={thread.id === props.fixture.selectedThread.id}
              thread={thread}
              onArchiveThread={NOOP}
              onDeleteThread={NOOP}
              onSelectThread={NOOP}
              onSwipeableClose={NOOP}
              onSwipeableWillOpen={NOOP}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function ShowcaseThread(props: { readonly fixture: ShowcaseFixture; readonly split: boolean }) {
  const thread = props.fixture.selectedThread;
  return (
    <View className="flex-1 bg-screen">
      <ThreadDetailScreen
        activePendingApproval={null}
        activePendingUserInput={null}
        activePendingUserInputAnswers={null}
        activePendingUserInputDrafts={{}}
        activeThreadBusy={false}
        activeWorkStartedAt={null}
        connectionError={null}
        connectionStateLabel="connected"
        contentPresentation={{ kind: "ready" }}
        draftAttachments={[]}
        draftMessage=""
        environmentId={SHOWCASE_ENVIRONMENT_ID}
        environmentLabel={props.fixture.environmentLabel}
        layoutVariant={props.split ? "split" : "compact"}
        projectWorkspaceRoot={props.fixture.project.workspaceRoot}
        respondingApprovalId={null}
        respondingUserInputId={null}
        screenTone={{
          label: "Ready",
          pillClassName: "bg-emerald-500/12",
          textClassName: "text-emerald-600",
        }}
        selectedThread={thread}
        selectedThreadFeed={props.fixture.feed}
        selectedThreadQueueCount={0}
        serverConfig={null}
        threadCwd={thread.worktreePath}
        threadSyncStatus="live"
        usesAutomaticContentInsets={!props.split}
        onChangeDraftMessage={NOOP}
        onChangeUserInputCustomAnswer={NOOP}
        onNativePasteImages={NOOP_ASYNC}
        onOpenConnectionEditor={NOOP}
        onPickDraftImages={NOOP_ASYNC}
        onReconnectEnvironment={NOOP}
        onRemoveDraftImage={NOOP}
        onRespondToApproval={NOOP_ASYNC}
        onSelectUserInputOption={NOOP}
        onSendMessage={async () => null}
        onStopThread={NOOP}
        onSubmitUserInput={NOOP_ASYNC}
        onUpdateThreadInteractionMode={NOOP}
        onUpdateThreadModelSelection={NOOP}
        onUpdateThreadRuntimeMode={NOOP}
      />
    </View>
  );
}

function ShowcaseTerminal() {
  const appearanceScheme = useColorScheme() === "light" ? "light" : "dark";
  const theme = getPierreTerminalTheme(appearanceScheme);
  return (
    <View
      className="flex-1 bg-screen px-3 pb-3"
      style={{ paddingTop: Platform.OS === "ios" ? 8 : 12 }}
    >
      <View className="mb-2 flex-row items-center justify-between px-1">
        <View className="flex-row items-center gap-2">
          <View className="size-2.5 rounded-full bg-emerald-500" />
          <Text className="font-mono text-xs text-foreground-muted">feat/command-palette</Text>
        </View>
        <Text className="font-mono text-xs text-foreground-tertiary">zsh · 104 × 32</Text>
      </View>
      <TerminalSurface
        autoFocus={false}
        buffer={
          Platform.OS === "android" ? ANDROID_SHOWCASE_TERMINAL_BUFFER : SHOWCASE_TERMINAL_BUFFER
        }
        fontSize={13}
        isRunning
        terminalKey="showcase-terminal"
        theme={theme}
        style={{ flex: 1, borderRadius: 12, overflow: "hidden" }}
        onInput={NOOP}
        onResize={NOOP}
      />
    </View>
  );
}

function ShowcaseReview() {
  const appearanceScheme = useColorScheme() === "light" ? "light" : "dark";
  const { codeSurface } = useAppearanceCodeSurface();
  const NativeReviewDiffView = resolveNativeReviewDiffView();
  const parsedDiff = useMemo(() => buildReviewParsedDiff(SHOWCASE_DIFF, "showcase"), []);
  const data = useMemo(() => buildNativeReviewDiffData(parsedDiff), [parsedDiff]);
  const theme = useMemo(() => createNativeReviewDiffTheme(appearanceScheme), [appearanceScheme]);
  const style = useMemo(() => createNativeReviewDiffStyle(codeSurface), [codeSurface]);

  return (
    <View className="flex-1 bg-sheet">
      <View className="flex-row items-center justify-between border-b border-separator px-4 py-3">
        <View>
          <Text className="text-sm font-t3-bold text-foreground">Ready to review</Text>
          <Text className="mt-0.5 text-xs text-foreground-muted">2 files changed</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <Text className="font-mono text-xs font-t3-bold text-emerald-600">+19</Text>
          <Text className="font-mono text-xs font-t3-bold text-rose-600">−4</Text>
        </View>
      </View>
      {NativeReviewDiffView ? (
        <View className="flex-1" collapsable={false}>
          <NativeReviewDiffView
            appearanceScheme={appearanceScheme}
            contentWidth={NATIVE_REVIEW_DIFF_CONTENT_WIDTH}
            rowHeight={style.rowHeight}
            rowsJson={JSON.stringify(data.rows)}
            style={StyleSheet.absoluteFill}
            styleJson={JSON.stringify(style)}
            themeJson={JSON.stringify(theme)}
          />
        </View>
      ) : (
        <ScrollView className="flex-1 px-4 py-3">
          <Text className="font-mono text-xs leading-5 text-foreground">{SHOWCASE_DIFF}</Text>
        </ScrollView>
      )}
    </View>
  );
}

function ShowcaseThreads(props: { readonly fixture: ShowcaseFixture }) {
  return (
    <>
      <HomeHeader
        environments={[
          { environmentId: SHOWCASE_ENVIRONMENT_ID, label: props.fixture.environmentLabel },
        ]}
        projectGroupingMode="repository"
        projectSortOrder="updated_at"
        searchQuery=""
        selectedEnvironmentId={null}
        threadSortOrder="updated_at"
        onEnvironmentChange={NOOP}
        onOpenSettings={NOOP}
        onProjectGroupingModeChange={NOOP}
        onProjectSortOrderChange={NOOP}
        onSearchQueryChange={NOOP}
        onStartNewTask={NOOP}
        onThreadSortOrderChange={NOOP}
      />
      <HomeScreen
        catalogState={CONNECTED_WORKSPACE}
        environments={[
          { environmentId: SHOWCASE_ENVIRONMENT_ID, label: props.fixture.environmentLabel },
        ]}
        pendingTasks={[]}
        persistGroupDisplayState={false}
        projectGroupingMode="repository"
        projects={props.fixture.projects}
        projectSortOrder="updated_at"
        savedConnectionsById={{}}
        searchQuery=""
        selectedEnvironmentId={null}
        threads={props.fixture.threads}
        threadSortOrder="updated_at"
        onAddConnection={NOOP}
        onArchiveThread={NOOP}
        onDeletePendingTask={NOOP}
        onDeleteThread={NOOP}
        onEnvironmentChange={NOOP}
        onNewThreadInProject={NOOP}
        onOpenEnvironments={NOOP}
        onOpenSettings={NOOP}
        onProjectGroupingModeChange={NOOP}
        onProjectSortOrderChange={NOOP}
        onSearchQueryChange={NOOP}
        onSelectPendingTask={NOOP}
        onSelectThread={NOOP}
        onStartNewTask={NOOP}
        onThreadSortOrderChange={NOOP}
      />
    </>
  );
}

type ShowcaseRouteProps = StaticScreenProps<{ readonly scene?: string }>;

export function ShowcaseRouteScreen(props: ShowcaseRouteProps) {
  const scene = resolveScene(props.route.params?.scene);
  const { width } = useWindowDimensions();
  const split = width >= 760;

  useEffect(() => {
    if (scene === "terminal") Keyboard.dismiss();
    let readyFrame: number | null = null;
    const renderFrame = requestAnimationFrame(() => {
      readyFrame = requestAnimationFrame(() => markNativeShowcaseReady(scene));
    });
    return () => {
      cancelAnimationFrame(renderFrame);
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
    };
  }, [scene]);
  const fixture = useMemo(() => createShowcaseFixture(), []);
  const sheetColor = useThemeColor("--color-sheet");
  const usesSolidHeader = split || scene === "terminal" || scene === "review";
  const title =
    scene === "threads"
      ? "Threads"
      : scene === "terminal"
        ? "Terminal"
        : scene === "review"
          ? "Review changes"
          : fixture.selectedThread.title;

  return (
    <View
      accessible
      accessibilityLabel={`showcase-ready-${scene}`}
      className="flex-1"
      testID={`showcase-ready-${scene}`}
    >
      <NativeStackScreenOptions
        options={{
          headerBackVisible: false,
          headerLargeTitle: false,
          headerStyle: usesSolidHeader
            ? { backgroundColor: String(sheetColor) }
            : Platform.OS === "ios"
              ? { backgroundColor: "transparent" }
              : undefined,
          headerTransparent: Platform.OS === "ios" && !usesSolidHeader,
          headerTitle: split ? "" : title,
          title: split ? "" : title,
        }}
      />
      {split ? (
        <View className="flex-1 flex-row bg-screen">
          <ShowcaseSidebar fixture={fixture} />
          {scene === "terminal" ? (
            <View className="flex-1">
              <ShowcaseTerminal />
            </View>
          ) : scene === "review" ? (
            <View className="flex-1">
              <ShowcaseReview />
            </View>
          ) : (
            <ShowcaseThread fixture={fixture} split />
          )}
        </View>
      ) : scene === "threads" ? (
        <ShowcaseThreads fixture={fixture} />
      ) : scene === "terminal" ? (
        <ShowcaseTerminal />
      ) : scene === "review" ? (
        <ShowcaseReview />
      ) : (
        <ShowcaseThread fixture={fixture} split={false} />
      )}
    </View>
  );
}
