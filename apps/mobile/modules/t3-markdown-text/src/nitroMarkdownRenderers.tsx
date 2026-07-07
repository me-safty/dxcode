import { SymbolView } from "expo-symbols";
import { memo, useState, type ReactNode } from "react";
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  View,
  type ColorValue,
} from "react-native";
import type { CustomRenderers } from "react-native-nitro-markdown";

import { CopyTextButton } from "./CopyTextButton";
import { markdownFileIconSource } from "./markdownFileIcons";
import { resolveMarkdownLinkPresentation } from "./markdownLinks";
import { resolveNitroSkillHref } from "./skillTokens";

const failedMarkdownFaviconHosts = new Set<string>();

const markdownLinkStyles = StyleSheet.create({
  inlineIcon: {
    width: 14,
    height: 14,
    marginHorizontal: 3,
    transform: [{ translateY: 2 }],
  },
  favicon: {
    borderRadius: 3,
  },
  file: {
    fontFamily: "DMSans_700Bold",
    fontWeight: "700",
  },
  skill: {
    fontFamily: "DMSans_500Medium",
    fontWeight: "500",
  },
});

const MarkdownExternalLink = memo(function MarkdownExternalLink(props: {
  readonly children: ReactNode;
  readonly color: string;
  readonly host: string;
  readonly href: string;
}) {
  const [failed, setFailed] = useState(() => failedMarkdownFaviconHosts.has(props.host));

  return (
    <NativeText
      onPress={() => {
        void Linking.openURL(props.href);
      }}
      style={{
        color: props.color,
        fontFamily: "DMSans_400Regular",
        textDecorationLine: "none",
      }}
    >
      {!failed ? (
        <Image
          source={{
            uri: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(props.host)}&sz=32`,
          }}
          style={[markdownLinkStyles.inlineIcon, markdownLinkStyles.favicon]}
          onError={() => {
            failedMarkdownFaviconHosts.add(props.host);
            setFailed(true);
          }}
        />
      ) : (
        <NativeText style={{ color: props.color }}>{" ◉ "}</NativeText>
      )}
      {props.children}
    </NativeText>
  );
});

export interface NitroMarkdownRendererOptions {
  readonly onLinkPress: (href: string) => void;
  readonly inlineTextColor: ColorValue;
  readonly inlineCodeTextColor: ColorValue;
  readonly blockBackgroundColor: ColorValue;
  readonly blockTextColor: ColorValue;
  readonly markdownLinkColor: ColorValue;
  readonly markdownBodyColor: ColorValue;
  readonly markdownHrColor: ColorValue;
  readonly skillTextColor: ColorValue;
  readonly markdownFontSizes: {
    readonly m: number;
    readonly bodyLineHeight: number;
    readonly codeBlockFontSize: number;
    readonly codeBlockLineHeight: number;
  };
  readonly preserveSoftBreaks?: boolean;
}

export function createNitroMarkdownRenderers(
  options: NitroMarkdownRendererOptions,
): CustomRenderers {
  const {
    onLinkPress,
    inlineTextColor,
    inlineCodeTextColor,
    blockBackgroundColor,
    blockTextColor,
    markdownLinkColor,
    markdownBodyColor,
    markdownHrColor,
    skillTextColor,
    markdownFontSizes,
    preserveSoftBreaks = false,
  } = options;

  return {
    link: ({ children, href = "" }) => {
      const skillName = resolveNitroSkillHref(href);
      if (skillName) {
        return (
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <SymbolView name="cube" size={12} tintColor={skillTextColor} type="monochrome" />
            <NativeText
              style={[markdownLinkStyles.skill, { color: skillTextColor, marginLeft: 4 }]}
            >
              {children}
            </NativeText>
          </View>
        );
      }

      const presentation = resolveMarkdownLinkPresentation(href);
      if (presentation.kind === "file") {
        return (
          <NativeText
            onPress={() => onLinkPress(href)}
            style={[markdownLinkStyles.file, { color: inlineTextColor }]}
          >
            <Image
              source={markdownFileIconSource(presentation.icon)}
              style={markdownLinkStyles.inlineIcon}
            />
            {presentation.label}
          </NativeText>
        );
      }
      if (presentation.kind === "external") {
        return (
          <MarkdownExternalLink
            href={presentation.href}
            host={presentation.host}
            color={String(markdownLinkColor)}
          >
            {children}
          </MarkdownExternalLink>
        );
      }
      const linkHref = presentation.href;
      return (
        <NativeText
          onPress={
            linkHref
              ? () => {
                  void Linking.openURL(linkHref);
                }
              : undefined
          }
          style={{
            color: markdownLinkColor,
            textDecorationLine: "underline",
          }}
        >
          {children}
        </NativeText>
      );
    },
    list: ({ node, Renderer, ordered = false, start = 1 }) => (
      <View style={{ marginTop: 2, marginBottom: 8 }}>
        {node.children?.map((child, index) => {
          const childKey = `${child.type}:${child.beg ?? "unknown"}:${child.end ?? "unknown"}`;
          if (child.type === "task_list_item") {
            return (
              <Renderer key={childKey} node={child} depth={1} inListItem parentIsText={false} />
            );
          }
          return (
            <View
              key={childKey}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                marginBottom: 3,
              }}
            >
              <NativeText
                style={{
                  width: ordered ? 22 : 12,
                  marginRight: 5,
                  color: inlineTextColor,
                  fontFamily: "DMSans_400Regular",
                  fontSize: markdownFontSizes.m,
                  lineHeight: markdownFontSizes.bodyLineHeight,
                  textAlign: ordered ? "right" : "center",
                }}
              >
                {ordered ? `${start + index}.` : "•"}
              </NativeText>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Renderer node={child} depth={1} inListItem parentIsText={false} />
              </View>
            </View>
          );
        })}
      </View>
    ),
    code_inline: ({ content }) => {
      const value = content ?? "";
      return (
        <NativeText
          style={{
            color: inlineCodeTextColor,
            fontFamily: "ui-monospace",
            fontSize: markdownFontSizes.codeBlockFontSize,
            lineHeight: markdownFontSizes.bodyLineHeight,
          }}
        >
          {value}
        </NativeText>
      );
    },
    ...(preserveSoftBreaks
      ? {
          soft_break: () => <NativeText>{"\n"}</NativeText>,
        }
      : {}),
    code_block: ({ content, language }) => {
      const code = content ?? "";
      const languageLabel = language?.toUpperCase() ?? "CODE";
      return (
        <View
          style={{
            backgroundColor: blockBackgroundColor,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: markdownHrColor,
            marginVertical: 12,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              minHeight: 42,
              borderBottomWidth: 1,
              borderBottomColor: markdownHrColor,
              paddingLeft: 14,
              paddingRight: 6,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <NativeText
              style={{
                flex: 1,
                color: markdownBodyColor,
                fontFamily: "ui-monospace",
                fontSize: markdownFontSizes.codeBlockFontSize,
                opacity: 0.7,
                textTransform: "uppercase",
              }}
            >
              {languageLabel}
            </NativeText>
            <CopyTextButton
              accessibilityLabel={`Copy ${languageLabel.toLowerCase()} code`}
              text={code}
              tintColor={markdownBodyColor}
              copiedTintColor={markdownLinkColor}
              backgroundColor={blockBackgroundColor}
              borderColor={markdownHrColor}
              buttonSize={34}
              iconSize={14}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <NativeText
              selectable
              style={{
                color: blockTextColor,
                fontFamily: "ui-monospace",
                fontSize: markdownFontSizes.codeBlockFontSize,
                lineHeight: markdownFontSizes.codeBlockLineHeight,
              }}
            >
              {code}
            </NativeText>
          </ScrollView>
        </View>
      );
    },
  };
}
