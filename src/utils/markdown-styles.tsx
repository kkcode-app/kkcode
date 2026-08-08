/**
 * [INPUT]: 依赖 react-native 的基础视图、react-native-gesture-handler 的原生手势 ScrollView，依赖 theme/index 的 Theme 类型，接收可选代码块底色不透明度，依赖 expo-clipboard 与 utils/haptics（仅 copyable 模式）
 * [OUTPUT]: 对外提供 makeMarkdownStyles、makeMarkdownRules，为 react-native-markdown-display 构建主题化样式、自定义渲染规则与不影响文字清晰度的半透明代码块底层
 * [POS]: src/utils 的 Markdown 渲染共享层，被 PartView（聊天）与 file-preview（文件预览）共同消费，确保代码块/行内代码/标题等在两处视觉一致
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
//
// 背景：react-native-markdown-display 的 fence/code_block/code_inline 默认样式
// 是硬编码浅色（白底灰字），不随主题变化。如果不显式覆盖，夜间模式下代码块
// 会出现白底白字。本模块把 PartView 原有的主题化 mdStyles + mdRules 提取出来，
// 供聊天和文件预览复用。
//
// makeMarkdownRules 支持两种模式：
//   · copyable=true（默认）：fence/code_block 渲染为带复制按钮的水平滚动 CodeBlock，
//     用于聊天消息——用户可能想复制 AI 生成的代码。
//   · copyable=false：fence/code_block 渲染为纯水平滚动代码块，无复制按钮，
//     用于文件预览——用户已经在看文件内容，不需要复制按钮，且文件预览页本身
//     有"切换源码"按钮可以查看原始文本。

import { useState } from "react";
import {
  ScrollView as CoreScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import type { Theme } from "../theme";
import { haptic } from "./haptics";

// ── 样式构建 ──────────────────────────────────────────────

export function makeMarkdownStyles(theme: Theme) {
  const { colors, typography, spacing, radius, monoFontFamily } = theme;

  return StyleSheet.create({
    body: {
      ...typography.body,
      color: colors.text,
    },
    // 标题
    heading1: {
      fontSize: 22,
      lineHeight: 30,
      fontWeight: "700",
      color: colors.text,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    heading2: {
      fontSize: 18,
      lineHeight: 26,
      fontWeight: "700",
      color: colors.text,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    heading3: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.text,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    heading4: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      color: colors.textSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    heading5: {
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "600",
      color: colors.textSecondary,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    heading6: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      color: colors.textTertiary,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    // 段落
    paragraph: {
      ...typography.body,
      color: colors.text,
      lineHeight: 25,
      marginTop: 0,
      marginBottom: spacing.sm,
    },
    // 粗体 / 斜体
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" as const },
    s: { textDecorationLine: "line-through" as const },
    // 行内代码保持在原生 Text 流中：颜色可在设置中单独配置，但不设胶囊背景。
    code_inline: {
      fontFamily: monoFontFamily,
      fontSize: 13,
      color: colors.textCode,
      // mergeStyle=true 会合并库自带的背景、边框、padding 和圆角，必须清零。
      backgroundColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      padding: 0,
    },
    // 代码块视觉容器（外层 View）— 背景 / 圆角 / margin。
    fence: {
      backgroundColor: "transparent",
      position: "relative",
      borderRadius: radius.sm,
      marginVertical: spacing.xs,
      overflow: "hidden",
      // markdown-display 的 mergeStyle 默认为 true，会把库默认 fence
      // 样式（borderWidth/padding/borderRadius）合并进来，必须显式清零。
      borderWidth: 0,
      padding: 0,
    },
    fenceContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      minWidth: "100%",
      alignSelf: "flex-start" as const,
    },
    fenceScroll: {
      width: "100%",
    },
    codeHeader: {
      flexDirection: "row" as const,
      justifyContent: "flex-end" as const,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      paddingBottom: 2,
    },
    codeCopyBtn: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    codeCopyText: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "600" as const,
    },
    code_block: {
      fontFamily: monoFontFamily,
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
      flexShrink: 0,
      alignSelf: "flex-start" as const,
      // 清零库默认 code_block 给 Text 加的容器样式。
      backgroundColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      padding: 0,
    },
    // 引用块
    blockquote: {
      backgroundColor: colors.reasoningBackground,
      borderLeftWidth: 2,
      borderLeftColor: colors.reasoningBorder,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginVertical: spacing.xs,
      borderRadius: radius.xs,
    },
    // 列表
    bullet_list: { marginBottom: spacing.xs },
    ordered_list: { marginBottom: spacing.xs },
    list_item: {
      flexDirection: "row" as const,
      marginBottom: 4,
    },
    bullet_list_icon: {
      ...typography.body,
      color: colors.textTertiary,
      lineHeight: 25,
      marginRight: spacing.sm,
    },
    ordered_list_icon: {
      ...typography.body,
      color: colors.textTertiary,
      lineHeight: 25,
      marginRight: spacing.sm,
    },
    bullet_list_content: { flex: 1 },
    ordered_list_content: { flex: 1 },
    // 分隔线
    hr: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginVertical: spacing.md,
    },
    // 链接
    link: {
      color: colors.accent,
      textDecorationLine: "underline" as const,
    },
    // 表格
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.sm,
      marginVertical: spacing.xs,
      overflow: "hidden" as const,
    },
    thead: { backgroundColor: colors.groupedBackground },
    th: {
      padding: spacing.sm,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.separator,
      fontWeight: "700" as const,
      color: colors.text,
      fontSize: 13,
    },
    td: {
      padding: spacing.sm,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.separator,
      color: colors.textSecondary,
      fontSize: 13,
    },
    tr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      flexDirection: "row" as const,
    },
    image: {
      marginVertical: spacing.xs,
    },
  });
}

// ── 类型 ──────────────────────────────────────────────────

export type MarkdownStyles = ReturnType<typeof makeMarkdownStyles>;

type MdNode = { key: string; content: string };
type MdImageNode = { key: string; attributes: { src?: string; alt?: string } };
type MdStylesParam = Record<string, object>;

// ── 自定义渲染规则 ────────────────────────────────────────
//
// copyable=true 时 fence/code_block 渲染为带复制按钮的 CodeBlock（与 PartView 原实现一致）。
// copyable=false 时渲染为纯水平滚动代码块，无复制按钮——用于文件预览。
//
// image 规则在两种模式下相同，由调用方传入图片渲染回调（聊天和文件预览
// 的图片渲染逻辑不同，不在此模块硬编码）。

export function makeMarkdownRules(
  theme: Theme,
  options?: {
    /** 代码块是否带复制按钮（默认 true） */
    copyable?: boolean;
    /** 是否用 RNGH 接管横向拖动，避免聊天消息外层手势抢占（默认 false） */
    gestureScroll?: boolean;
    /** 代码块底色不透明度；只影响底层，不降低代码文字与复制按钮清晰度（默认 1） */
    codeBlockBackgroundOpacity?: number;
    /** 自定义 image 渲染器；不传则用默认 Markdown image 渲染 */
    renderImage?: (uri: string, alt: string | undefined, key: string) => null | React.ReactElement;
  },
) {
  const copyable = options?.copyable ?? true;
  const gestureScroll = options?.gestureScroll ?? false;
  const codeBlockBackgroundOpacity = Math.min(
    1,
    Math.max(0, options?.codeBlockBackgroundOpacity ?? 1),
  );
  const renderImage = options?.renderImage;

  return {
    fence: (node: MdNode, _children: unknown, _parent: unknown, styles: MdStylesParam) => {
      let content = node.content;
      if (content.endsWith("\n")) content = content.slice(0, -1);
      return (
        <SimpleCodeBlock
          key={node.key}
          content={content}
          styles={styles}
          theme={theme}
          copyable={copyable}
          gestureScroll={gestureScroll}
          backgroundOpacity={codeBlockBackgroundOpacity}
        />
      );
    },
    code_block: (node: MdNode, _children: unknown, _parent: unknown, styles: MdStylesParam) => {
      let content = node.content;
      if (content.endsWith("\n")) content = content.slice(0, -1);
      return (
        <SimpleCodeBlock
          key={node.key}
          content={content}
          styles={styles}
          theme={theme}
          copyable={copyable}
          gestureScroll={gestureScroll}
          backgroundOpacity={codeBlockBackgroundOpacity}
        />
      );
    },
    image: (
      node: MdImageNode,
      _children: unknown,
      _parent: unknown,
      _styles: unknown,
      allowedImageHandlers: string[],
      defaultImageHandler: string | null,
    ) => {
      if (!renderImage) return null;
      const { src, alt } = node.attributes ?? {};
      if (!src) return null;
      const show = allowedImageHandlers.some((v) => src.toLowerCase().startsWith(v.toLowerCase()));
      if (!show && defaultImageHandler === null) return null;
      const uri = show ? src : `${defaultImageHandler}${src}`;
      return renderImage(uri, alt, node.key);
    },
  };
}

// ── 代码块组件 ────────────────────────────────────────────
//
// 从 PartView 的 CodeBlock 简化而来。copyable=true 时渲染复制按钮（需要
// expo-clipboard 和 haptics）。copyable=false 时仅渲染水平滚动的 Text。

function SimpleCodeBlock({
  content,
  styles,
  theme,
  copyable,
  gestureScroll,
  backgroundOpacity,
}: {
  content: string;
  styles: MdStylesParam;
  theme: Theme;
  copyable: boolean;
  gestureScroll: boolean;
  backgroundOpacity: number;
}) {
  const [copied, setCopied] = useState(false);
  const HorizontalScrollView = gestureScroll ? GestureScrollView : CoreScrollView;

  const onCopy = async () => {
    if (!content) return;
    await Clipboard.setStringAsync(content);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <View style={styles.fence}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme.colors.codeBackground,
            opacity: backgroundOpacity,
          },
        ]}
      />
      {copyable ? (
        <View style={styles.codeHeader}>
          <TouchableOpacity
            onPress={onCopy}
            hitSlop={theme.hitSlop}
            style={styles.codeCopyBtn}
            activeOpacity={0.7}
          >
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={12}
              color={copied ? theme.colors.success : theme.colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      ) : null}
      <HorizontalScrollView
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        style={styles.fenceScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.fenceContent}
      >
        <Text style={styles.code_block}>{content}</Text>
      </HorizontalScrollView>
    </View>
  );
}
