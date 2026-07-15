import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../../components/AppText";
import { LoadingStrip } from "../../../components/LoadingStrip";
import { SymbolView } from "../../../components/AppSymbol";
import { useThemeColor } from "../../../lib/useThemeColor";

function webDocumentIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

interface SettingsLegalDocumentRouteScreenProps {
  readonly documentName: string;
  readonly documentUrl: string;
}

export function SettingsLegalDocumentRouteScreen({
  documentName,
  documentUrl,
}: SettingsLegalDocumentRouteScreenProps) {
  const iconColor = useThemeColor("--color-icon");
  const initialDocumentIdentity = webDocumentIdentity(documentUrl);
  const allowedDocumentIdentityRef = useRef(initialDocumentIdentity);
  const isInitialLoadRef = useRef(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const openExternalUrl = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  }, []);

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-sheet px-8">
        <SymbolView
          name="exclamationmark.triangle"
          size={32}
          tintColor={iconColor}
          type="monochrome"
          weight="regular"
        />
        <View className="items-center gap-2">
          <Text className="text-center font-t3-bold text-lg text-foreground">
            Couldn&apos;t load the {documentName.toLowerCase()}
          </Text>
          <Text selectable className="text-center text-sm leading-normal text-foreground-muted">
            {loadError}
          </Text>
        </View>
        <View className="w-full max-w-[320px] gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              allowedDocumentIdentityRef.current = initialDocumentIdentity;
              isInitialLoadRef.current = true;
              setLoadError(null);
              setReloadKey((value) => value + 1);
            }}
            className="items-center rounded-xl bg-foreground px-4 py-3 active:opacity-80"
          >
            <Text className="font-t3-bold text-base text-sheet">Try Again</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => openExternalUrl(documentUrl)}
            className="items-center rounded-xl px-4 py-3 active:bg-foreground/5"
          >
            <Text className="font-t3-medium text-base text-foreground-muted">Open in Browser</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="relative flex-1 bg-sheet">
      {loadProgress > 0 && loadProgress < 1 ? <LoadingStrip progress={loadProgress} /> : null}
      <WebView
        key={reloadKey}
        source={{ uri: documentUrl }}
        originWhitelist={["http://*", "https://*", "mailto:*"]}
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        domStorageEnabled={false}
        incognito
        javaScriptEnabled={false}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        startInLoadingState
        onShouldStartLoadWithRequest={(request) => {
          const isConfiguredDocument =
            webDocumentIdentity(request.url) === allowedDocumentIdentityRef.current;
          const isInitialRedirect = isInitialLoadRef.current && request.navigationType === "other";
          if (isConfiguredDocument || isInitialRedirect) return true;

          openExternalUrl(request.url);
          return false;
        }}
        onLoadProgress={(event) => {
          setLoadProgress(event.nativeEvent.progress);
        }}
        onLoadStart={() => {
          setLoadProgress(0.05);
          setLoadError(null);
        }}
        onLoadEnd={(event) => {
          allowedDocumentIdentityRef.current =
            webDocumentIdentity(event.nativeEvent.url) ?? initialDocumentIdentity;
          isInitialLoadRef.current = false;
          setLoadProgress(0);
        }}
        onError={(event) => {
          isInitialLoadRef.current = false;
          setLoadProgress(0);
          setLoadError(event.nativeEvent.description || "The page could not be loaded.");
        }}
        onHttpError={(event) => {
          isInitialLoadRef.current = false;
          setLoadProgress(0);
          setLoadError(`The server returned status ${event.nativeEvent.statusCode}.`);
        }}
        renderLoading={() => (
          <View className="absolute inset-0 items-center justify-center bg-sheet">
            <ActivityIndicator />
          </View>
        )}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
