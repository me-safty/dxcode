import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text as NativeText,
  useColorScheme,
  View,
} from "react-native";

import { AppText as Text } from "../../components/AppText";
import {
  REVIEW_DIFF_LINE_HEIGHT,
  REVIEW_MONO_FONT_FAMILY,
  renderVisibleWhitespace,
} from "../review/reviewDiffRendering";
import { highlightSourceFile, type ReviewHighlightedToken } from "../review/shikiReviewHighlighter";

const SOURCE_LINE_HEIGHT = 24;
const SOURCE_LINE_NUMBER_WIDTH = 58;

type HighlightStatus = "idle" | "highlighting" | "ready" | "error";

function splitSourceLines(contents: string): ReadonlyArray<string> {
  return contents.replace(/\r\n?/g, "\n").split("\n");
}

const HighlightedSourceLine = memo(function HighlightedSourceLine(props: {
  readonly index: number;
  readonly line: string;
  readonly tokens: ReadonlyArray<ReviewHighlightedToken> | null;
}) {
  return (
    <View className="flex-row" style={{ minHeight: SOURCE_LINE_HEIGHT }}>
      <NativeText
        className="select-none pr-3 text-right text-[11px] leading-[24px] text-foreground-tertiary"
        style={{
          width: SOURCE_LINE_NUMBER_WIDTH,
          fontFamily: REVIEW_MONO_FONT_FAMILY,
        }}
      >
        {props.index + 1}
      </NativeText>
      <NativeText
        selectable
        numberOfLines={1}
        className="text-[13px] font-medium leading-[24px] text-foreground"
        style={{ fontFamily: REVIEW_MONO_FONT_FAMILY, minWidth: 320 }}
      >
        {props.tokens && props.tokens.length > 0
          ? (() => {
              let offset = 0;
              return props.tokens.map((token) => {
                const start = offset;
                offset += token.content.length;

                const fontWeight =
                  token.fontStyle !== null && (token.fontStyle & 2) === 2
                    ? ("700" as const)
                    : ("500" as const);
                const fontStyle =
                  token.fontStyle !== null && (token.fontStyle & 1) === 1
                    ? ("italic" as const)
                    : ("normal" as const);

                return (
                  <NativeText
                    key={`${start}:${token.content.length}:${token.color ?? ""}`}
                    selectable
                    style={{
                      color: token.color ?? undefined,
                      fontFamily: REVIEW_MONO_FONT_FAMILY,
                      fontWeight,
                      fontStyle,
                    }}
                  >
                    {token.content.length > 0 ? renderVisibleWhitespace(token.content) : " "}
                  </NativeText>
                );
              });
            })()
          : renderVisibleWhitespace(props.line || " ")}
      </NativeText>
    </View>
  );
});

export function SourceFileSurface(props: { readonly contents: string; readonly path: string }) {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? "dark" : "light";
  const requestIdRef = useRef(0);
  const normalizedContents = useMemo(
    () => props.contents.replace(/\r\n?/g, "\n"),
    [props.contents],
  );
  const lines = useMemo(() => splitSourceLines(props.contents), [props.contents]);
  const [tokens, setTokens] = useState<ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>> | null>(
    null,
  );
  const [status, setStatus] = useState<HighlightStatus>("idle");

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setTokens(null);
    setStatus("highlighting");

    void highlightSourceFile({
      path: props.path,
      contents: normalizedContents,
      theme,
    })
      .then((highlighted) => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setTokens(highlighted);
        setStatus("ready");
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) {
          return;
        }
        setTokens(null);
        setStatus("error");
      });
  }, [normalizedContents, props.path, theme]);

  return (
    <View className="flex-1 bg-card">
      {status === "highlighting" ? (
        <View className="h-8 flex-row items-center gap-2 border-b border-border bg-card px-4">
          <ActivityIndicator size="small" />
          <Text className="text-[11px] font-t3-medium uppercase text-foreground-muted">
            Highlighting
          </Text>
        </View>
      ) : status === "error" ? (
        <View className="border-b border-border bg-card px-4 py-2">
          <Text className="text-[11px] font-t3-medium uppercase text-foreground-muted">
            Plain text
          </Text>
        </View>
      ) : null}
      <ScrollView horizontal bounces={false} className="flex-1">
        <FlatList
          data={lines}
          keyExtractor={(_line, index) => String(index)}
          initialNumToRender={80}
          maxToRenderPerBatch={80}
          windowSize={12}
          getItemLayout={(_data, index) => ({
            length: SOURCE_LINE_HEIGHT,
            offset: SOURCE_LINE_HEIGHT * index,
            index,
          })}
          contentContainerStyle={{
            minWidth: "100%",
            paddingBottom: REVIEW_DIFF_LINE_HEIGHT,
            paddingTop: 8,
          }}
          renderItem={({ item, index }) => (
            <HighlightedSourceLine index={index} line={item} tokens={tokens?.[index] ?? null} />
          )}
        />
      </ScrollView>
    </View>
  );
}
