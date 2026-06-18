import Stack from "expo-router/stack";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import {
  EnvironmentId,
  type ProjectListEntriesResult,
  type ProjectReadFileResult,
  ThreadId,
} from "@t3tools/contracts";

import { AppText as Text } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import { EmptyState } from "../../components/EmptyState";
import { LoadingScreen } from "../../components/LoadingScreen";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import { useEnvironmentQuery } from "../../state/query";
import { projectEnvironment } from "../../state/projects";
import { ReviewHighlighterProvider } from "../review/ReviewHighlighterProvider";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import { FileTreeBrowser } from "./FileTreeBrowser";
import { SourceFileSurface } from "./SourceFileSurface";
import { WorkspaceFileWebPreview } from "./WorkspaceFileWebPreview";
import { basename, fileBreadcrumbs, isBrowserPreviewFile, isMarkdownPreviewFile } from "./filePath";

type FileViewMode = "preview" | "source";

function firstRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeRoutePath(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }
  return value;
}

function normalizeRouteLine(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function defaultViewMode(path: string | null): FileViewMode {
  return path !== null && isBrowserPreviewFile(path) ? "preview" : "source";
}

function ModeButton(props: {
  readonly active: boolean;
  readonly icon: "doc.text" | "eye";
  readonly label: string;
  readonly onPress: () => void;
}) {
  const iconColor = String(
    useThemeColor(props.active ? "--color-primary-foreground" : "--color-icon-muted"),
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.active }}
      className={cn(
        "h-8 flex-row items-center justify-center gap-1.5 rounded-full px-3 active:opacity-70",
        props.active ? "bg-primary" : "bg-subtle",
      )}
      onPress={props.onPress}
    >
      <SymbolView name={props.icon} size={13} tintColor={iconColor} type="monochrome" />
      <Text
        className={cn(
          "text-[12px] font-t3-bold",
          props.active ? "text-primary-foreground" : "text-foreground-muted",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function FilePreviewHeader(props: {
  readonly activeMode: FileViewMode;
  readonly canPreview: boolean;
  readonly projectName: string;
  readonly relativePath: string;
  readonly onShowTree: () => void;
  readonly onSetMode: (mode: FileViewMode) => void;
}) {
  const iconColor = String(useThemeColor("--color-icon-muted"));
  const breadcrumbs = useMemo(
    () => fileBreadcrumbs(props.projectName, props.relativePath),
    [props.projectName, props.relativePath],
  );

  return (
    <View className="border-b border-border bg-card px-3 py-2">
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show file tree"
          className="h-8 w-8 items-center justify-center rounded-full bg-subtle active:opacity-70"
          onPress={props.onShowTree}
        >
          <SymbolView name="folder" size={15} tintColor={iconColor} type="monochrome" />
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="min-w-0 flex-1">
          <View className="h-8 flex-row items-center">
            {breadcrumbs.map((crumb, index) => (
              <View key={crumb.path || "project"} className="flex-row items-center">
                {index > 0 ? (
                  <SymbolView
                    name="chevron.right"
                    size={10}
                    tintColor={iconColor}
                    type="monochrome"
                  />
                ) : null}
                <Text
                  className={cn(
                    "max-w-[180px] px-1 text-[12px]",
                    crumb.kind === "file"
                      ? "font-t3-bold text-foreground"
                      : "font-t3-medium text-foreground-muted",
                  )}
                  numberOfLines={1}
                >
                  {crumb.label}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <CopyTextButton
          accessibilityLabel="Copy file path"
          text={props.relativePath}
          tintColor={iconColor}
          buttonSize={32}
          iconSize={13}
        />
      </View>
      {props.canPreview ? (
        <View className="mt-2 flex-row items-center gap-2">
          <ModeButton
            active={props.activeMode === "preview"}
            icon="eye"
            label="Preview"
            onPress={() => props.onSetMode("preview")}
          />
          <ModeButton
            active={props.activeMode === "source"}
            icon="doc.text"
            label="Source"
            onPress={() => props.onSetMode("source")}
          />
        </View>
      ) : null}
    </View>
  );
}

function FileContent(props: {
  readonly activeMode: FileViewMode;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly fileContents: string | null;
  readonly fileError: string | null;
  readonly relativePath: string;
  readonly initialLine: number | null;
  readonly threadId: ThreadId;
  readonly truncated: boolean;
}) {
  const isMarkdown = isMarkdownPreviewFile(props.relativePath);
  const isBrowserFile = isBrowserPreviewFile(props.relativePath);

  if (props.activeMode === "preview" && isBrowserFile) {
    return (
      <WorkspaceFileWebPreview
        cwd={props.cwd}
        environmentId={props.environmentId}
        relativePath={props.relativePath}
        threadId={props.threadId}
      />
    );
  }

  if (props.fileError && props.fileContents === null) {
    return (
      <View className="flex-1 items-center justify-center bg-card px-6">
        <EmptyState title="File unavailable" detail={props.fileError} />
      </View>
    );
  }

  if (props.fileContents === null) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-card px-6">
        <ActivityIndicator />
        <Text className="text-center text-[13px] text-foreground-muted">Loading file...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-card">
      {props.truncated ? (
        <View className="border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/60 dark:bg-amber-950/40">
          <Text className="text-[11px] font-t3-bold uppercase text-amber-700 dark:text-amber-300">
            Partial file
          </Text>
          <Text className="text-[12px] leading-[17px] text-amber-800 dark:text-amber-200">
            Preview limited to the first 1 MB of a truncated file.
          </Text>
        </View>
      ) : null}
      {props.activeMode === "preview" && isMarkdown ? (
        <FileMarkdownPreview markdown={props.fileContents} />
      ) : (
        <SourceFileSurface
          contents={props.fileContents}
          path={props.relativePath}
          initialLine={props.initialLine}
        />
      )}
    </View>
  );
}

export function ThreadFilesRouteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    environmentId?: string | string[];
    line?: string | string[];
    path?: string | string[];
    threadId?: string | string[];
  }>();
  const routeEnvironmentId = firstRouteParam(params.environmentId);
  const routeThreadId = firstRouteParam(params.threadId);
  const routePath = normalizeRoutePath(firstRouteParam(params.path));
  const routeLine = normalizeRouteLine(firstRouteParam(params.line));
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const [selectedPath, setSelectedPath] = useState<string | null>(routePath);
  const targetLine = routePath !== null && routePath === selectedPath ? routeLine : null;
  const [showTree, setShowTree] = useState(() => routePath === null);
  const [modeOverride, setModeOverride] = useState<{
    readonly path: string;
    readonly mode: FileViewMode;
  } | null>(null);

  useEffect(() => {
    if (routePath !== null && routePath !== selectedPath) {
      setSelectedPath(routePath);
      setShowTree(false);
    }
  }, [routePath, selectedPath]);

  const environmentId =
    routeEnvironmentId !== null
      ? EnvironmentId.make(routeEnvironmentId)
      : (selectedThread?.environmentId ?? null);
  const threadId = routeThreadId !== null ? ThreadId.make(routeThreadId) : null;
  const project = selectedThreadProject as {
    readonly title?: string;
    readonly workspaceRoot?: string;
  } | null;
  const cwd = selectedThreadCwd ?? project?.workspaceRoot ?? null;
  const projectName = project?.title ?? "Files";
  const entriesQuery = useEnvironmentQuery(
    environmentId !== null && cwd !== null
      ? projectEnvironment.listEntries({
          environmentId,
          input: { cwd },
        })
      : null,
  );
  const entriesData = entriesQuery.data as ProjectListEntriesResult | null;
  const canPreview =
    selectedPath !== null &&
    (isMarkdownPreviewFile(selectedPath) || isBrowserPreviewFile(selectedPath));
  const activeMode =
    selectedPath !== null && modeOverride?.path === selectedPath
      ? modeOverride.mode
      : defaultViewMode(selectedPath);
  const resolvedActiveMode = canPreview ? activeMode : "source";
  const needsFileContents =
    selectedPath !== null &&
    (resolvedActiveMode === "source" || isMarkdownPreviewFile(selectedPath));
  const fileQuery = useEnvironmentQuery(
    environmentId !== null && cwd !== null && selectedPath !== null && needsFileContents
      ? projectEnvironment.readFile({
          environmentId,
          input: { cwd, relativePath: selectedPath },
        })
      : null,
  );
  const fileData = fileQuery.data as ProjectReadFileResult | null;

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedPath(path);
      setShowTree(false);
      setModeOverride(null);
      router.setParams({ path, line: undefined });
    },
    [router],
  );

  if (selectedThread === null || environmentId === null || threadId === null) {
    return <LoadingScreen message="Opening files..." messagePlacement="above-spinner" />;
  }

  if (cwd === null) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet px-6">
        <Stack.Screen options={{ title: "Files" }} />
        <EmptyState
          title="Files unavailable"
          detail="This thread does not have an active workspace path."
        />
      </View>
    );
  }

  return (
    <ReviewHighlighterProvider>
      <View className="flex-1 bg-sheet">
        <Stack.Screen
          options={{
            title: selectedPath ? basename(selectedPath) : "Files",
          }}
        />
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={showTree ? "doc.text" : "folder"}
            disabled={showTree && selectedPath === null}
            onPress={() => setShowTree((current) => !current)}
            separateBackground
          />
          <Stack.Toolbar.Button
            icon="arrow.clockwise"
            onPress={() => {
              if (showTree || selectedPath === null) {
                entriesQuery.refresh();
                return;
              }
              fileQuery.refresh();
            }}
          />
        </Stack.Toolbar>

        {showTree || selectedPath === null ? (
          <FileTreeBrowser
            entries={entriesData?.entries ?? []}
            error={entriesQuery.error}
            isPending={entriesQuery.isPending}
            projectName={projectName}
            selectedPath={selectedPath}
            truncated={entriesData?.truncated ?? false}
            onRefresh={entriesQuery.refresh}
            onSelectFile={handleSelectFile}
          />
        ) : (
          <View className="flex-1">
            <FilePreviewHeader
              activeMode={resolvedActiveMode}
              canPreview={canPreview}
              projectName={projectName}
              relativePath={selectedPath}
              onShowTree={() => setShowTree(true)}
              onSetMode={(mode) => {
                setModeOverride({ path: selectedPath, mode });
              }}
            />
            <FileContent
              activeMode={resolvedActiveMode}
              cwd={cwd}
              environmentId={environmentId}
              fileContents={fileData?.contents ?? null}
              fileError={fileQuery.error}
              initialLine={targetLine}
              relativePath={selectedPath}
              threadId={threadId}
              truncated={fileData?.truncated ?? false}
            />
          </View>
        )}
      </View>
    </ReviewHighlighterProvider>
  );
}
