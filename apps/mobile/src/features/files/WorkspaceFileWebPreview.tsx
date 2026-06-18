import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import { useAssetUrl } from "../../state/assets";
import { resolveWorkspaceFilePath } from "./filePath";

export function WorkspaceFileWebPreview(props: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly relativePath: string;
  readonly threadId: ThreadId;
}) {
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const iconColor = String(useThemeColor("--color-icon-muted"));
  const absolutePath = useMemo(
    () => resolveWorkspaceFilePath(props.cwd, props.relativePath),
    [props.cwd, props.relativePath],
  );
  const uri = useAssetUrl(props.environmentId, {
    _tag: "workspace-file",
    threadId: props.threadId,
    path: absolutePath,
  });

  if (uri === null) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-card px-6">
        <ActivityIndicator />
        <Text className="text-center text-[13px] text-foreground-muted">Preparing preview...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-card">
      <View className="h-9 flex-row items-center gap-2 border-b border-border bg-card px-3">
        <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
          <View
            className="h-full rounded-full bg-foreground-muted"
            style={{ width: `${Math.max(6, Math.round(loadProgress * 100))}%` }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open preview externally"
          hitSlop={8}
          className="h-7 w-7 items-center justify-center rounded-full bg-subtle"
          onPress={() => {
            void Linking.openURL(uri);
          }}
        >
          <SymbolView name="safari" size={14} tintColor={iconColor} type="monochrome" />
        </Pressable>
      </View>
      {loadError ? (
        <View className="border-b border-border bg-card px-4 py-2">
          <Text className="text-[12px] font-t3-bold text-foreground">Preview failed</Text>
          <Text className="mt-0.5 text-[12px] leading-[17px] text-foreground-muted">
            {loadError}
          </Text>
        </View>
      ) : null}
      <WebView
        source={{ uri }}
        originWhitelist={["*"]}
        allowsBackForwardNavigationGestures
        allowsFullscreenVideo
        setSupportMultipleWindows={false}
        startInLoadingState
        onLoadProgress={(event) => {
          setLoadProgress(event.nativeEvent.progress);
        }}
        onLoadStart={() => {
          setLoadError(null);
        }}
        onError={(event) => {
          setLoadError(event.nativeEvent.description || "The file could not be rendered.");
        }}
        renderLoading={() => (
          <View className="absolute inset-0 items-center justify-center bg-card">
            <ActivityIndicator />
          </View>
        )}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
