/**
 * [INPUT]: 依赖 @opencode-ai/sdk/v2 的 Part 类型、react-native-markdown-display 的 Markdown 渲染、react-i18next 的工具摘要本地化、utils/markdown-styles 与 utils/image-layout 的主题化/图片布局能力、ChatScreen 注入的代码块底色不透明度、ToolDetailModal 的工具详情展示
 * [OUTPUT]: 对外提供 PartView 组件，支持 text/reasoning/tool/file 等消息 part 的渲染、普通回答 Markdown 代码块稳定横滑/透明底色/复制；reasoning 流式期自动展开、完成后可点击显隐并使用局部淡入淡出动画；图片统一走 120×120 缩略图，点击后等比全屏并支持双指缩放/拖动
 * [POS]: src/components 的消息 part 渲染器，被同目录 ChatScreen.tsx 内的 MessageBubble 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// PartView — 精心打磨的消息 Part 渲染器
// 设计原则：
//   · text：干净，尊重气泡背景颜色
//   · reasoning：带左边框的灰色卡片，流式期展开、结束后折叠
//   · tool：精密的状态指示，点击弹出详情弹窗
//   · file：图片用 ChatImageThumbnail 渲染为 120×120 缩略图，点击放大；
//          其他文件用紧凑的文件名药丸

import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Image as RNImage,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Markdown, { MarkdownIt } from "react-native-markdown-display";
import type { Part, ToolPart } from "@opencode-ai/sdk/v2";
import { useTheme, type Theme } from "../theme";
import { ToolDetailModal, getToolMeta } from "./ToolDetailModal";
import { trackEvent, AnalyticsEvents as Ev } from "../services/analytics";
import { haptic } from "../utils/haptics";
import { makeMarkdownStyles, makeMarkdownRules } from "../utils/markdown-styles";
import { useTranslation } from "react-i18next";
import { fitImageWithinViewport, type ImageViewportSize } from "../utils/image-layout";

type Role = "user" | "assistant";

// react-native-markdown-display 的默认参数会在每次流式文本 render 时新建
// MarkdownIt、图片 handler 数组和省略节点，导致其内部 renderer memo 失效。
// 这些配置与消息无关，模块级复用后每次 delta 只处理真正变化的 Markdown 文本。
const MARKDOWN_STABLE_PROPS = {
  markdownit: new MarkdownIt({ typographer: true }),
  topLevelMaxExceededItem: <Text key="dotdotdot">...</Text>,
  allowedImageHandlers: [
    "data:image/png;base64",
    "data:image/gif;base64",
    "data:image/jpeg;base64",
    "https://",
    "http://",
  ],
};

interface Props {
  part: Part;
  role: Role;
  /** 仅用于普通 AI 回答的 Markdown 代码块底色，文字与思考过程不受影响。 */
  codeBlockBackgroundOpacity?: number;
}

export const PartView = memo(function PartView({
  part,
  role,
  codeBlockBackgroundOpacity = 1,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const isUser = role === "user";

  switch (part.type) {
    case "text":
      if (isUser) {
        return <Text style={[styles.text, styles.textOut]}>{part.text}</Text>;
      }
      return (
        <View style={{ marginBottom: 2 }}>
          <MarkdownText
            text={part.text}
            theme={theme}
            styles={styles}
            codeBlockBackgroundOpacity={codeBlockBackgroundOpacity}
          />
        </View>
      );

    case "reasoning":
      return (
        <View style={{ marginBottom: 4 }}>
          <ReasoningPart
            text={part.text}
            isThinking={part.time?.end == null}
            theme={theme}
            styles={styles}
          />
        </View>
      );

    case "tool":
      return <ToolPartView part={part} theme={theme} styles={styles} />;

    case "file":
      // 图片以 file part 承载（mime 为 image/*，url 为 data:...;base64,...）。
      // 服务端 image.normalize 已缩放过，这里直接渲染。
      if (part.mime.startsWith("image/")) {
        return <ImagePartView part={part} styles={styles} />;
      }
      return (
        <View style={styles.fileChip}>
          <Ionicons name="document-text-outline" size={13} color={theme.colors.textTertiary} />
          <Text style={styles.fileText} numberOfLines={1}>
            {part.filename ?? part.mime ?? "file"}
          </Text>
        </View>
      );

    case "step-start":
    case "step-finish":
      return null;

    // 系统/元数据 part：opencode v2 在工具调用之间会插入这些用于
    // 快照、补丁、子智能体切换、重试、上下文压缩等会话记账，不该
    // 出现在聊天 UI 里。如果不显式拦下，会被 default 分支渲染成
    // 一个写着 "patch" / "snapshot" 之类的小 chip，造成视觉噪音。
    case "patch":
    case "snapshot":
    case "agent":
    case "retry":
    case "compaction":
      return null;

    default: {
      const t = (part as { type?: string }).type ?? "unknown";
      return (
        <View style={styles.unknownChip}>
          <Text style={styles.unknownText}>{t}</Text>
        </View>
      );
    }
  }
});

// ── Markdown（AI 回复） ──────────────────────────────────

function MarkdownText({
  text,
  theme,
  styles,
  codeBlockBackgroundOpacity,
}: {
  text: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  codeBlockBackgroundOpacity: number;
}) {
  const mdStyles = useMemo(() => makeMarkdownStyles(theme), [theme]);

  const mdRules = useMemo(
    () =>
      makeMarkdownRules(theme, {
        copyable: true,
        // AI 普通回答嵌在消息长按与纵向列表中，需由 RNGH 稳定取得横向拖动。
        gestureScroll: true,
        codeBlockBackgroundOpacity,
        renderImage: (uri, alt, key) => (
          <MdImage key={key} uri={uri} alt={alt} borderRadius={theme.radius.sm} />
        ),
      }),
    [codeBlockBackgroundOpacity, theme],
  );

  return (
    <Markdown {...MARKDOWN_STABLE_PROPS} style={mdStyles} rules={mdRules}>
      {text}
    </Markdown>
  );
}

// 自定义 fence / code_block / image 渲染规则已提取到 src/utils/markdown-styles.tsx。
// 此处仅保留 MdImage——它依赖 PartView 内部的 ChatImageThumbnail 组件。

function MdImage({ uri, alt, borderRadius }: { uri: string; alt?: string; borderRadius: number }) {
  return <ChatImageThumbnail uri={uri} accessibilityLabel={alt} borderRadius={borderRadius} />;
}

// ── 图片 FilePart ────────────────────────────────────────
// 图片以 file part 承载（mime 为 image/*，url 为 data:...;base64,...）。
// 气泡内显示 120×120 缩略图（cover 模式填满方形），右下角带"放大"角标提示
// 可点击；点击后弹全屏 Modal，按 Image.getSize 取到的原始宽高比适配视口，
// 并用原生手势支持双指缩放/拖动。data URL 同样可被 getSize 解析。

function ImagePartView({
  part,
  styles,
}: {
  part: Extract<Part, { type: "file" }>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return <ChatImageThumbnail uri={part.url} accessibilityLabel={part.filename ?? "image"} />;
}

// ── 共享图片缩略图 + 全屏查看 ─────────────────────────────
// 聊天里出现的所有图片（file part、markdown 内联图）都走这条路径：
//   · 缩略图固定 120×120，cover 模式铺满方形，避免原图尺寸把气泡撑爆；
//   · 右下角叠一个半透明圆形"放大"角标，提示用户可点击；
//   · 点击后弹全屏 Modal，按图片原始宽高比（Image.getSize）适配视口，
//     iOS / Android 均支持双指缩放与拖动。
// Markdown 场景会传入 borderRadius 继承所在 token 圆角，file part 走默认。

function clampZoom(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

function ZoomableImage({
  uri,
  size,
  viewportWidth,
  viewportHeight,
}: {
  uri: string;
  size: ImageViewportSize;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [
    uri,
    size.width,
    size.height,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
  ]);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((event) => {
          scale.value = clampZoom(savedScale.value * event.scale, 1, 4);
        })
        .onEnd(() => {
          const nextScale = clampZoom(scale.value, 1, 4);
          const maxX = Math.max(0, (size.width * nextScale - viewportWidth) / 2);
          const maxY = Math.max(0, (size.height * nextScale - viewportHeight) / 2);
          const nextX = clampZoom(translateX.value, -maxX, maxX);
          const nextY = clampZoom(translateY.value, -maxY, maxY);
          savedScale.value = nextScale;
          savedTranslateX.value = nextX;
          savedTranslateY.value = nextY;
          scale.value = withSpring(nextScale);
          translateX.value = withSpring(nextX);
          translateY.value = withSpring(nextY);
        }),
    [
      savedScale,
      scale,
      size.height,
      size.width,
      translateX,
      translateY,
      viewportHeight,
      viewportWidth,
      savedTranslateX,
      savedTranslateY,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(1)
        .onUpdate((event) => {
          if (scale.value <= 1) return;
          const maxX = Math.max(0, (size.width * scale.value - viewportWidth) / 2);
          const maxY = Math.max(0, (size.height * scale.value - viewportHeight) / 2);
          translateX.value = clampZoom(savedTranslateX.value + event.translationX, -maxX, maxX);
          translateY.value = clampZoom(savedTranslateY.value + event.translationY, -maxY, maxY);
        })
        .onEnd(() => {
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        }),
    [
      savedTranslateX,
      savedTranslateY,
      scale,
      size.height,
      size.width,
      translateX,
      translateY,
      viewportHeight,
      viewportWidth,
    ],
  );

  const gesture = useMemo(() => Gesture.Simultaneous(pinch, pan), [pan, pinch]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animatedStyle}>
        <Image
          source={{ uri }}
          style={{ width: size.width, height: size.height }}
          contentFit="contain"
          transition={200}
          cachePolicy="memory-disk"
        />
      </Animated.View>
    </GestureDetector>
  );
}

function ChatImageThumbnail({
  uri,
  accessibilityLabel,
  borderRadius,
}: {
  uri: string;
  accessibilityLabel?: string;
  borderRadius?: number;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [fullSize, setFullSize] = useState<{ width: number; height: number } | null>(null);
  const [fullVisible, setFullVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    RNImage.getSize(
      uri,
      (w, h) => {
        if (cancelled) return;
        setFullSize(fitImageWithinViewport(w, h, screenWidth, screenHeight));
      },
      () => {
        if (cancelled) return;
        setFullSize(fitImageWithinViewport(0, 0, screenWidth, screenHeight));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri, screenWidth, screenHeight]);

  const radius = borderRadius ?? theme.radius.sm;
  const a11y = accessibilityLabel ?? "image";

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          haptic.selection();
          setFullVisible(true);
          trackEvent(Ev.ImageViewFull, {
            source: borderRadius !== undefined ? "markdown_inline" : "file_part",
          });
        }}
        style={[styles.thumbWrap, borderRadius !== undefined ? { borderRadius: radius } : null]}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        <Image
          source={{ uri }}
          style={[styles.thumb, { borderRadius: radius }]}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
        />
        <View style={styles.thumbBadge} pointerEvents="none">
          <Ionicons name="expand-outline" size={11} color="#fff" />
        </View>
      </TouchableOpacity>

      <Modal
        visible={fullVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setFullVisible(false)}
      >
        <GestureHandlerRootView style={styles.imageFullBackdrop} accessibilityViewIsModal>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setFullVisible(false)}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          {fullSize ? (
            <View style={styles.imageFullContent}>
              <ZoomableImage
                uri={uri}
                size={fullSize}
                viewportWidth={screenWidth}
                viewportHeight={screenHeight}
              />
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.imageFullClose}
            onPress={() => setFullVisible(false)}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

// ── Reasoning（思考过程） ────────────────────────────────

const REASONING_TOGGLE_DURATION_MS = 220;

function ReasoningPart({
  text,
  isThinking,
  theme,
  styles,
}: {
  text: string;
  isThinking: boolean;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(isThinking);
  const userToggled = useRef(false);
  const reduceMotion = useReducedMotion();
  const entering = reduceMotion ? undefined : FadeIn.duration(REASONING_TOGGLE_DURATION_MS);
  const exiting = reduceMotion ? undefined : FadeOut.duration(REASONING_TOGGLE_DURATION_MS);

  useEffect(() => {
    if (userToggled.current) return;
    setExpanded(isThinking);
  }, [isThinking]);

  return (
    <TouchableOpacity
      style={styles.reasoningCard}
      onPress={() => {
        userToggled.current = true;
        setExpanded((current) => {
          const next = !current;
          trackEvent(Ev.ReasoningExpand, { expanded: next ? "1" : "0" });
          return next;
        });
      }}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
    >
      <View style={styles.reasoningHeader}>
        <Ionicons name="sparkles-outline" size={10} color={theme.colors.textTertiary} />
        <Text style={styles.reasoningLabel}>{t("part.thinking")}</Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={12}
          color={theme.colors.textTertiary}
          style={{ marginLeft: "auto" as unknown as number }}
        />
      </View>
      {expanded && text ? (
        <Animated.View entering={entering} exiting={exiting}>
          <Text style={styles.reasoningText}>{text}</Text>
        </Animated.View>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Tool（工具调用） ──────────────────────────────────────

function ToolPartView({
  part,
  theme,
  styles,
}: {
  part: ToolPart;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const state = part.state;
  const status = state?.status ?? "pending";
  const toolName = part.tool ?? "tool";
  const meta = getToolMeta(toolName);

  const isRunning = status === "running" || status === "pending";
  const stateAny = state as
    | {
        input?: Record<string, unknown>;
        title?: string;
        metadata?: {
          title?: string;
          filediff?: { additions?: number; deletions?: number };
        };
      }
    | undefined;

  // 聊天里只展示一句"人话"摘要——这是用户真正关心的，
  // 命令/正则/路径等技术细节进详情弹窗
  const summary =
    pickSummary(toolName, stateAny?.input ?? {}, stateAny?.title, stateAny?.metadata?.title, t) ||
    (meta.label !== toolName ? t(meta.label) : toolName);

  // edit/write/apply_patch 完成后，从 metadata.filediff 抽出新增/删除行数
  const fileDiff =
    status === "completed" &&
    (toolName === "edit" || toolName === "write" || toolName === "apply_patch")
      ? stateAny?.metadata?.filediff
      : undefined;

  // todowrite 在聊天里直接展开整个清单（不走单行摘要）
  if (toolName === "todowrite") {
    const todos = Array.isArray(stateAny?.input?.todos)
      ? (stateAny!.input!.todos as unknown[])
      : [];
    return (
      <>
        <TouchableOpacity
          style={[styles.toolRow, styles.todoListRow, { borderLeftColor: meta.color }]}
          onPress={() => {
            setModalVisible(true);
            trackEvent(Ev.ToolDetailOpen, {
              tool: toolName,
              status,
              kind: "todowrite",
            });
          }}
          activeOpacity={0.6}
        >
          <View style={styles.todoListHeader}>
            <Ionicons name={meta.icon} size={11} color={meta.color} style={styles.toolRowIcon} />
            <Text style={styles.todoListTitle}>
              {todos.length > 0
                ? t("part.summaryTodos", { count: todos.length })
                : t("part.summaryTodosEmpty")}
            </Text>
            <ToolStatusGlyph
              status={status}
              isRunning={isRunning}
              color={meta.color}
              theme={theme}
              styles={styles}
            />
          </View>
          {todos.length > 0 ? (
            <View style={styles.todoList}>
              {todos.map((td, i) => (
                <TodoLine key={i} todo={td} theme={theme} styles={styles} />
              ))}
            </View>
          ) : null}
        </TouchableOpacity>

        <ToolDetailModal
          visible={modalVisible}
          part={part}
          onClose={() => setModalVisible(false)}
          onNavigateToSession={(sessionId) => {
            setModalVisible(false);
            trackEvent(Ev.ToolDetailNavigateSubSession, {
              tool: toolName,
              session_id: sessionId,
            });
            router.push(`/chat/${sessionId}`);
          }}
        />
      </>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.toolRow, { borderLeftColor: meta.color }]}
        onPress={() => {
          setModalVisible(true);
          trackEvent(Ev.ToolDetailOpen, {
            tool: toolName,
            status,
          });
        }}
        activeOpacity={0.6}
      >
        <Ionicons name={meta.icon} size={11} color={meta.color} style={styles.toolRowIcon} />
        <Text style={styles.toolRowText} numberOfLines={1}>
          {summary}
        </Text>
        {fileDiff && (fileDiff.additions != null || fileDiff.deletions != null) ? (
          <View style={styles.diffBadges}>
            {fileDiff.additions != null && fileDiff.additions > 0 ? (
              <Text style={[styles.diffBadge, { color: theme.colors.success }]}>
                +{fileDiff.additions}
              </Text>
            ) : null}
            {fileDiff.deletions != null && fileDiff.deletions > 0 ? (
              <Text style={[styles.diffBadge, { color: theme.colors.destructive }]}>
                −{fileDiff.deletions}
              </Text>
            ) : null}
          </View>
        ) : null}
        <ToolStatusGlyph
          status={status}
          isRunning={isRunning}
          color={meta.color}
          theme={theme}
          styles={styles}
        />
      </TouchableOpacity>

      <ToolDetailModal
        visible={modalVisible}
        part={part}
        onClose={() => setModalVisible(false)}
        onNavigateToSession={(sessionId) => {
          setModalVisible(false);
          trackEvent(Ev.ToolDetailNavigateSubSession, {
            tool: toolName,
            session_id: sessionId,
          });
          router.push(`/chat/${sessionId}`);
        }}
      />
    </>
  );
}

// ── 内联 Todo 列表 ────────────────────────────────────────

function TodoLine({
  todo,
  theme,
  styles,
}: {
  todo: unknown;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const td = todo as { content?: string; status?: string; priority?: string };
  const status = td.status ?? "pending";
  const content = td.content ?? "";

  // 颜色与图标按状态选取
  const visual = (() => {
    switch (status) {
      case "completed":
        return { icon: "checkmark-circle" as const, color: theme.colors.success };
      case "in_progress":
        return { icon: "ellipse" as const, color: theme.colors.warning };
      case "cancelled":
        return { icon: "close-circle" as const, color: theme.colors.textTertiary };
      default:
        return { icon: "ellipse-outline" as const, color: theme.colors.textTertiary };
    }
  })();

  const isCompleted = status === "completed";
  const isCancelled = status === "cancelled";
  const isInProgress = status === "in_progress";

  return (
    <View style={styles.todoLine}>
      <Ionicons name={visual.icon} size={12} color={visual.color} style={styles.todoLineIcon} />
      <Text
        style={[
          styles.todoLineText,
          isCompleted && { textDecorationLine: "line-through", color: theme.colors.textTertiary },
          isCancelled && {
            textDecorationLine: "line-through",
            color: theme.colors.textTertiary,
            opacity: 0.6,
          },
          isInProgress && { color: theme.colors.text, fontWeight: "600" },
        ]}
        numberOfLines={2}
      >
        {content}
      </Text>
    </View>
  );
}

function ToolStatusGlyph({
  status,
  isRunning,
  color,
  theme,
  styles,
}: {
  status: string;
  isRunning: boolean;
  color: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (isRunning) {
    return (
      <View style={styles.toolPulseWrap}>
        <View style={[styles.toolPulseDot, { backgroundColor: color }]} />
        <View style={[styles.toolPulseRing, { borderColor: color }]} />
      </View>
    );
  }
  if (status === "completed") {
    return (
      <Ionicons
        name="checkmark"
        size={10}
        color={theme.colors.success}
        style={styles.toolStatusGlyph}
      />
    );
  }
  if (status === "error") {
    return (
      <Ionicons
        name="close"
        size={10}
        color={theme.colors.destructive}
        style={styles.toolStatusGlyph}
      />
    );
  }
  return null;
}

// ── 摘要提取：每种工具挑出最适合在聊天里"说人话"的字段 ──

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function pickSummary(
  tool: string,
  input: Record<string, unknown>,
  stateTitle: string | undefined,
  metaTitle: string | undefined,
  t: TFunc,
): string {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  switch (tool) {
    case "bash": {
      // 优先用 description（人话），其次截短的 command
      const desc = str(input.description);
      if (desc) return desc;
      const cmd = str(input.command).split("\n")[0] || "";
      return clip(cmd, 80);
    }
    case "task":
      return str(input.description) || str(input.prompt).split("\n")[0] || "";
    case "read": {
      const name = basename(str(input.filePath));
      return name ? t("part.summaryRead", { name }) : "";
    }
    case "edit": {
      const name = basename(str(input.filePath));
      return name ? t("part.summaryEdit", { name }) : "";
    }
    case "write": {
      const name = basename(str(input.filePath));
      return name ? t("part.summaryWrite", { name }) : "";
    }
    case "glob": {
      const pattern = str(input.pattern);
      return pattern ? t("part.summaryGlob", { pattern }) : "";
    }
    case "grep": {
      const pattern = str(input.pattern);
      return pattern ? t("part.summaryGrep", { pattern }) : "";
    }
    case "webfetch": {
      const url = prettyUrl(str(input.url));
      return url ? t("part.summaryFetch", { url }) : "";
    }
    case "websearch": {
      const query = str(input.query);
      return query ? t("part.summarySearch", { query }) : "";
    }
    case "todowrite": {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return todos.length > 0
        ? t("part.summaryTodos", { count: todos.length })
        : t("part.summaryTodosEmpty");
    }
    case "skill": {
      const name = str(input.name);
      return name ? t("part.summarySkill", { name }) : "";
    }
    case "lsp": {
      const op = str(input.operation);
      const file = basename(str(input.filePath));
      if (!op && !file) return "";
      if (op && file) return t("part.summaryLspOp", { op, file });
      if (file) return t("part.summaryLspFile", { file });
      return op;
    }
    case "apply_patch":
      return t("part.summaryApplyPatch");
    case "plan_exit":
      return t("part.summaryPlanExit");
    case "question": {
      // 服务端 question tool 的 result.title 是 hardcode 英文
      // ("Asked N question(s)" from packages/opencode/src/tool/question.ts),
      // 直接透传会污染中文 UI。这里按 input.questions.length 自己生成
      // 本地化文案;不依赖服务端 title 文案格式,以后服务端改字串也不会
      // 出问题。questions 还在流式组装时 (length === 0) 让 default
      // 兜底 —— 走 state.title,虽然仍是英文但只是过渡态。
      //
      // i18next 根据 count 和当前 locale 的 CLDR 规则选择
      // summaryQuestion_one/few/many/other 等变体；不再手工二分，
      // 避免俄语、乌克兰语、波兰语和阿拉伯语显示错误词形。
      const qs = Array.isArray(input.questions) ? input.questions : [];
      if (qs.length === 0) return "";
      return t("part.summaryQuestion", { count: qs.length });
    }
    default: {
      // 兜底：metadata.title > state.title > input 第一个字符串
      const ttl = metaTitle || stateTitle;
      if (ttl) return clip(ttl, 80);
      for (const v of Object.values(input)) {
        if (typeof v === "string" && v.length > 0) return clip(v, 80);
      }
      return "";
    }
  }
}

function basename(p: string): string {
  if (!p) return "";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function prettyUrl(u: string): string {
  if (!u) return "";
  return u.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    // text
    text: {
      ...typography.body,
      lineHeight: 24,
    },
    textOut: { color: "rgba(255,255,255,0.95)" },
    textIn: { color: colors.text },

    // reasoning — 弱化：去掉卡片背景/圆角，改为细左边框 + 小字
    reasoningCard: {
      borderRadius: 0,
      backgroundColor: "transparent",
      borderLeftWidth: 1,
      borderLeftColor: colors.reasoningBorder,
      paddingLeft: spacing.sm,
      paddingRight: 0,
      paddingVertical: 2,
    },
    reasoningHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    reasoningLabel: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "500",
      textTransform: "uppercase" as const,
      letterSpacing: 0.3,
    },
    reasoningText: {
      ...typography.caption1,
      color: colors.textTertiary,
      lineHeight: 16,
      fontStyle: "italic" as const,
    },

    // tool row — 弱化：降低行高、缩小字体、图标缩小，左侧色块先注释
    // 设计目标：让工具调用更像脚注，不抢戏；点击进详情。
    toolRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: 16,
      paddingLeft: spacing.sm,
      paddingRight: 0,
      marginTop: 0,
      borderLeftWidth: 1,
      // borderLeftColor 由内联 style 注入工具色
    },
    toolRowIcon: {
      flexShrink: 0,
      opacity: 0.6,
    },
    toolRowText: {
      ...typography.caption2,
      color: colors.textTertiary,
      flex: 1,
      minWidth: 0,
    },
    toolStatusGlyph: {
      flexShrink: 0,
      marginLeft: 2,
      marginRight: 2,
    },
    // 运行中：脉动小色点 + 同心环
    toolPulseWrap: {
      width: 10,
      height: 10,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      marginLeft: 2,
      marginRight: 0,
    },
    toolPulseDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
    },
    toolPulseRing: {
      position: "absolute",
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1,
      opacity: 0.35,
    },

    // edit/write 完成后行尾的 +N -M 徽章
    diffBadges: {
      flexDirection: "row",
      gap: 4,
      flexShrink: 0,
      marginLeft: 4,
    },
    diffBadge: {
      ...typography.monoSm,
      fontSize: 11,
    },

    // todowrite 内联展开式 — 覆盖 toolRow 的固定高度和负 margin
    todoListRow: {
      height: undefined,
      marginTop: 0,
      flexDirection: "column",
      alignItems: "stretch",
      gap: 4,
      paddingVertical: spacing.xs,
    },
    todoListHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    todoListTitle: {
      ...typography.footnote,
      color: colors.textSecondary,
      flex: 1,
      fontWeight: "600",
    },
    todoList: {
      gap: 3,
      paddingLeft: 18, // 与 header 图标右侧大致对齐
    },
    todoLine: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
    },
    todoLineIcon: {
      marginTop: 3,
      flexShrink: 0,
    },
    todoLineText: {
      ...typography.footnote,
      color: colors.textSecondary,
      flex: 1,
      lineHeight: 18,
    },

    // file chip
    fileChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    fileText: {
      ...typography.caption1,
      color: colors.textSecondary,
      maxWidth: 200,
    },

    // unknown chip
    unknownChip: {
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    unknownText: {
      ...typography.monoSm,
      color: colors.textTertiary,
    },

    // 图片大图查看 Modal
    imageFullBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.92)",
    },
    imageFullContent: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    imageFullClose: {
      position: "absolute",
      top: 50,
      right: 20,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },
    // 缩略图外层：固定 120×120 方形缩略图，避免原图把气泡/消息列表撑爆
    // 也不让多张图片横向挤占屏幕。alignSelf: flex-start 让缩略图靠气泡左边
    // 排布，与文件 chip / tool row 等左对齐元素视觉一致。
    thumbWrap: {
      alignSelf: "flex-start",
      position: "relative",
      marginVertical: 4,
    },
    thumb: {
      width: 120,
      height: 120,
      // 加载完成前用 surface 兜底，避免透明图/加载中时穿透看到气泡颜色
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    // 缩略图右下角的"放大"角标，半透明深色底保证在浅色/深色图上都可见
    thumbBadge: {
      position: "absolute",
      right: 6,
      bottom: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
