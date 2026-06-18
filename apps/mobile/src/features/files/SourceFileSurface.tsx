import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "../../lib/cn";

const SOURCE_LINE_HEIGHT = 24;
const SOURCE_LINE_NUMBER_WIDTH = 58;

type HighlightRequest = Readonly<{
  path: string;
  contents: string;
  theme: "dark" | "light";
}>;

type HighlightResult = Readonly<{
  request: HighlightRequest | null;
  tokens: ReadonlyArray<ReadonlyArray<ReviewHighlightedToken>> | null;
  status: "highlighting" | "ready" | "error";
}>;

function splitSourceLines(contents: string): ReadonlyArray<string> {
  return contents.replace(/\r\n?/g, "\n").split("\n");
}

const HighlightedSourceLine = memo(function HighlightedSourceLine(props: {
  readonly index: number;
  readonly line: string;
  readonly tokens: ReadonlyArray<ReviewHighlightedToken> | null;
  readonly highlighted: boolean;
}) {
  return (
    <View
      className={cn("flex-row", props.highlighted && "bg-primary/10")}
      style={{ minHeight: SOURCE_LINE_HEIGHT }}
    >
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

export function SourceFileSurface(props: {
  readonly contents: string;
  readonly path: string;
  readonly initialLine?: number | null;
}) {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? "dark" : "light";
  const listRef = useRef<FlatList<string>>(null);
  const normalizedContents = useMemo(
    () => props.contents.replace(/\r\n?/g, "\n"),
    [props.contents],
  );
  const lines = useMemo(() => splitSourceLines(props.contents), [props.contents]);
  const targetIndex =
    props.initialLine !== null && props.initialLine !== undefined && props.initialLine > 0
      ? Math.min(Math.floor(props.initialLine) - 1, Math.max(0, lines.length - 1))
      : null;
  const highlightRequest = useMemo<HighlightRequest>(
    () => ({ path: props.path, contents: normalizedContents, theme }),
    [normalizedContents, props.path, theme],
  );
  const [highlightResult, setHighlightResult] = useState<HighlightResult>({
    request: null,
    tokens: null,
    status: "highlighting",
  });
  const isCurrentHighlight = highlightResult.request === highlightRequest;
  const tokens = isCurrentHighlight ? highlightResult.tokens : null;
  const status = isCurrentHighlight ? highlightResult.status : "highlighting";

  useEffect(() => {
    let active = true;

    void highlightSourceFile(highlightRequest)
      .then((highlighted) => {
        if (!active) {
          return;
        }
        setHighlightResult({ request: highlightRequest, tokens: highlighted, status: "ready" });
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setHighlightResult({ request: highlightRequest, tokens: null, status: "error" });
      });

    return () => {
      active = false;
    };
  }, [highlightRequest]);

  useEffect(() => {
    if (targetIndex === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0.3 });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.path, targetIndex]);

  const renderLine = useCallback(
    ({ item, index }: { item: string; index: number }) => (
      <HighlightedSourceLine
        index={index}
        line={item}
        tokens={tokens?.[index] ?? null}
        highlighted={index === targetIndex}
      />
    ),
    [targetIndex, tokens],
  );

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
          ref={listRef}
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
          renderItem={renderLine}
        />
      </ScrollView>
    </View>
  );
}
