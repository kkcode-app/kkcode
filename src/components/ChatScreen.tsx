/**
 * [INPUT]: 依赖会话/消息/模型/外观 stores、client 的会话元数据与消息 API、聊天子组件、滚动/附件/i18n 工具及 React Native 平台能力
 * [OUTPUT]: 对外提供 ChatScreen 组件，按需补齐未缓存会话元数据，并提供消息加载、流式交互、模型选择、工作区入口与聊天操作
 * [POS]: components/ 的会话详情组件，被 app/chat/[id] 路由壳（单栏）与 app/sessions 双栏右侧栏共用，是移动端聊天交互核心
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  铁律 (Scroll Sovereignty) — 不可破坏                              ║
 * ║                                                                   ║
 * ║  流式输出过程中，用户一旦做出"非贴底"滚动动作，视口必须钉在用户   ║
 * ║  当前位置，任何代码都不得把它拽走。这是产品的核心竞争力。         ║
 * ║                                                                   ║
 * ║  规则：                                                           ║
 * ║   1. 所有"想滚一下"的代码必须经 useStickToBottom 暴露的方法走，   ║
 * ║      不得直接调用 listRef.scrollTo* / scrollToEnd / scrollToIndex。║
 * ║   2. 自动跟随仅允许在 stick.shouldFollow() === true 时进行，hook   ║
 * ║      内部以 pinned/touch 守门，并用前沿节流 + 尾沿补偿平滑贴底。  ║
 * ║   3. 主动滚到最新仅在以下两种语义下出现：                         ║
 * ║        a) 用户点击「回到底部」浮层按钮                            ║
 * ║        b) 用户点击发送按钮（= 显式表达"我要看最新"）              ║
 * ║   4. VirtualizedList 使用「正序」+ maintainVisibleContentPosition：║
 * ║       { minIndexForVisible: 1 } —— 锚的是用户当前阅读的非头部内容，║
 * ║       新消息追加 / 流式生长时 RN 会自动补正 contentOffset.y。      ║
 * ║      不要使用 inverted list——RN 在 Android 上 inverted +           ║
 * ║      maintainVisibleContentPosition 不可靠（data 重排会抖动）。    ║
 * ║   5. SSE delta 必须节流（见 src/api/dispatch.ts 的 enqueueDelta）。║
 * ║                                                                   ║
 * ║  以后任何会话功能迭代都不能违反铁律。                             ║
 * ║  See: src/hooks/useStickToBottom.ts                                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
import { Ionicons } from "@expo/vector-icons";
import { ModelIcon, ProviderIcon } from "@lobehub/icons-rn";
import * as Clipboard from "expo-clipboard";
import { Image as ExpoImage } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Animated,
  ActivityIndicator,
  Image,
  Keyboard,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  VirtualizedList,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type ListRenderItem,
  type StyleProp,
  type ViewToken,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Message, Part } from "@opencode-ai/sdk/v2";

import {
  abortSession,
  executeCommand,
  getSession,
  getSessionMessagesPage,
  sendPrompt,
  listAgents,
  listProviders,
  getConfig,
  type Agent,
  type CommandV2Info,
} from "../api/client";
import { refetchQuestions } from "../api/events";
import { BottomSheet } from "./BottomSheet";
import { CommandAutocomplete } from "./CommandPicker";
import { PermissionBanner } from "./PermissionBanner";
import { QuestionPrompt, useHasPendingQuestion } from "./QuestionPrompt";
import { PartView } from "./PartView";
import { SessionInfoModal } from "./SessionInfoModal";
import { TimeSeparator } from "./TimeSeparator";
import { trackEvent, AnalyticsEvents as Ev } from "../services/analytics";
import { recordError } from "../services/crashlytics";
import { commandScopeKey, useCommandStore } from "../store/commands";
import { useConnectionStore, toClientConfig } from "../store/connection";
import { useMessagesStore, type MessageWithParts } from "../store/messages";
import {
  normalizeModelSelection,
  resolveInitialModel,
  resolveMessageModel,
  useModelStore,
  type ModelSelection,
} from "../store/model";
import { useSessionsStore } from "../store/sessions";
import { useStatusStore } from "../store/status";
import { useDraftStore } from "../store/draft";
import { haptic } from "../utils/haptics";
import {
  pickImages,
  takePhoto,
  toFilePartInput,
  type ImageAttachment,
} from "../utils/image-attach";
import { getSlashCommandQuery, parseSlashCommandText } from "../utils/slash-parse";
import { getMessagePlainText } from "../utils/message-text";
import { stripMarkdown } from "../utils/markdown-strip";
import {
  hasInitialChatAnchorFailed,
  INITIAL_ANCHOR_MAX_WAIT_MS,
  isInitialChatViewportAtBottom,
  shouldRevealInitialChatList,
} from "../utils/chat-initial-anchor";
import { isSessionStreaming } from "../utils/session-status";
import { useStickToBottom } from "../hooks/useStickToBottom";
import { useTheme, type Theme } from "../theme";
import { breakpoints } from "../theme/breakpoints";
import { shouldShowTimeSeparator } from "../utils/time";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 30;
const EMPTY_MESSAGES: MessageWithParts[] = [];
const CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 1 };
type ChatMessageRow = {
  entry: MessageWithParts;
  prevRole: Message["role"] | null;
  created: number | undefined;
  showTimeSeparator: boolean;
  isLastAssistant: boolean;
};
type ChatMessageRowLayout = Pick<ChatMessageRow, "prevRole" | "created" | "showTimeSeparator"> & {
  previous: Message | null;
};
const messageRowLayoutCache = new WeakMap<Message, ChatMessageRowLayout>();
const messageRowCache = new WeakMap<
  MessageWithParts,
  { layout: ChatMessageRowLayout; isLastAssistant: boolean; row: ChatMessageRow }
>();
const messageKeyExtractor = (row: ChatMessageRow) => row.entry.message.id;

function getMessageRowLayout(
  entry: MessageWithParts,
  prev: MessageWithParts | null,
): ChatMessageRowLayout {
  const previous = prev?.message ?? null;
  const cached = messageRowLayoutCache.get(entry.message);
  if (cached?.previous === previous) return cached;

  const created = entry.message.time?.created;
  const layout = {
    previous,
    prevRole: previous?.role ?? null,
    created,
    showTimeSeparator: created != null && shouldShowTimeSeparator(previous?.time?.created, created),
  };
  messageRowLayoutCache.set(entry.message, layout);
  return layout;
}

function getMessageRow(
  entry: MessageWithParts,
  prev: MessageWithParts | null,
  isLast: boolean,
): ChatMessageRow {
  const layout = getMessageRowLayout(entry, prev);
  const isLastAssistant = entry.message.role === "assistant" && isLast;
  const cached = messageRowCache.get(entry);
  if (cached?.layout === layout && cached.isLastAssistant === isLastAssistant) return cached.row;

  const row = { entry, ...layout, isLastAssistant };
  messageRowCache.set(entry, { layout, isLastAssistant, row });
  return row;
}

function getMessageRowAt(data: MessageWithParts[], index: number): ChatMessageRow {
  return getMessageRow(data[index], data[index - 1] ?? null, index === data.length - 1);
}

const getMessageRowCount = (data: MessageWithParts[]) => data.length;
const THINKING_EFFORT_LABEL_KEYS: Record<string, string> = {
  none: "chat.thinkingEffort.none",
  minimal: "chat.thinkingEffort.minimal",
  low: "chat.thinkingEffort.low",
  medium: "chat.thinkingEffort.medium",
  high: "chat.thinkingEffort.high",
  xhigh: "chat.thinkingEffort.xhigh",
  max: "chat.thinkingEffort.max",
  thinking: "chat.thinkingEffort.thinking",
};

function humanizeVariant(variant: string): string {
  return variant.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveProviderLogoKey(providerID: string, providerName: string): string {
  const compactID = providerID.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const searchable = `${providerID} ${providerName}`.toLocaleLowerCase();
  const aliases: [RegExp, string][] = [
    [/amazon.*bedrock|bedrock/, "bedrock"],
    [/github.*copilot/, "githubcopilot"],
    [/google.*vertex|vertex/, "vertexai"],
    [/cloudflare/, "cloudflare"],
    [/azure/, "azure"],
    [/anthropic|claude/, "anthropic"],
    [/openrouter/, "openrouter"],
    [/openai|chatgpt/, "openai"],
    [/deepseek/, "deepseek"],
    [/moonshot|kimi/, "moonshot"],
    [/minimax/, "minimax"],
    [/zhipu|chatglm|\bglm\b/, "zhipu"],
    [/alibaba|qwen/, "qwen"],
    [/xai|grok/, "xai"],
  ];
  return aliases.find(([pattern]) => pattern.test(searchable))?.[1] ?? compactID;
}

function resolveModelLogoKey(modelID: string, modelName: string): string | null {
  const searchable = `${modelID} ${modelName}`.toLocaleLowerCase();
  const knownModelBrands = [
    /\b(?:gpt-[345]|gpt-oss|o[134](?:-|\b))\b/,
    /\b(?:claude|gemini|gemma|llama|deepseek|kimi|moonshot)\b/,
    /\b(?:qwen|qwq|qvq|tongyi|minimax|abab|mistral|mixtral|codestral)\b/,
    /\b(?:glm|chatglm|grok|command-r|cohere|doubao|hunyuan|ernie|baichuan)\b/,
    /\b(?:phi-|yi-|internlm|internvl|nemotron|sonar|perplexity|nova-)\b/,
  ];
  return knownModelBrands.some((pattern) => pattern.test(searchable)) ? searchable : null;
}

function ModelBrandIcon({
  modelID,
  modelName,
  providerID,
  providerName,
  size,
  color,
}: {
  modelID: string;
  modelName: string;
  providerID: string;
  providerName: string;
  size: number;
  color: string;
}) {
  const modelLogoKey = resolveModelLogoKey(modelID, modelName);
  if (modelLogoKey) {
    return <ModelIcon model={modelLogoKey} type="color" size={size} color={color} />;
  }
  return (
    <ProviderIcon
      provider={resolveProviderLogoKey(providerID, providerName)}
      type="color"
      size={size}
      color={color}
    />
  );
}

type ChatKeyboardAvoidingViewProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Android-only equivalent of KeyboardAvoidingView behavior="height".
 * RN 0.85 routes keyboardDidHide through its change handler, so a stale
 * endCoordinates value can leave a positive bottom and a permanently reduced
 * fixed height. Here hide is authoritative and always restores bottom to zero.
 */
function AndroidHeightKeyboardAvoidingView({ children, style }: ChatKeyboardAvoidingViewProps) {
  const { width: windowWidth } = useWindowDimensions();
  const frameRef = useRef<{ y: number; height: number } | null>(null);
  const initialFrameHeightRef = useRef(0);
  const lastWindowWidthRef = useRef(windowWidth);
  const baselineRefreshPendingRef = useRef(false);
  const keyboardEventRef = useRef<KeyboardEvent | null>(null);
  const bottomRef = useRef(0);
  const [bottom, setBottom] = useState(0);

  if (lastWindowWidthRef.current !== windowWidth) {
    lastWindowWidthRef.current = windowWidth;
    baselineRefreshPendingRef.current = true;
  }

  const applyBottom = useCallback((next: number) => {
    bottomRef.current = next;
    setBottom((current) => (current === next ? current : next));
  }, []);

  const updateForKeyboard = useCallback(
    (event: KeyboardEvent) => {
      const frame = frameRef.current;
      if (!frame) return;
      const next = Math.max(
        bottomRef.current + frame.y + frame.height - event.endCoordinates.screenY,
        0,
      );
      if (bottomRef.current === next) return;
      Keyboard.scheduleLayoutAnimation(event);
      applyBottom(next);
    },
    [applyBottom],
  );

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardEventRef.current = event;
      updateForKeyboard(event);
    });
    const hide = Keyboard.addListener("keyboardDidHide", (event) => {
      keyboardEventRef.current = null;
      // hide 与恢复后的 onLayout 顺序在不同 Android 版本上不固定。
      // 先用当前 frame 更新一次，再让下一次 layout 最终校准。
      if (frameRef.current) {
        initialFrameHeightRef.current = frameRef.current.height;
      }
      baselineRefreshPendingRef.current = true;
      Keyboard.scheduleLayoutAnimation(event);
      applyBottom(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [applyBottom, updateForKeyboard]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const frame = event.nativeEvent.layout;
      const oldFrame = frameRef.current;
      frameRef.current = frame;
      const keyboardEvent = keyboardEventRef.current;
      // 首次布局，或横竖屏/分屏后的键盘收起布局，才是可信基线。
      // 不能在每次“尚未收到 didShow”的 layout 都覆盖：adjustResize 可能
      // 先把页面压矮、后发 didShow，那会把键盘后的高度误当成全高。
      if (
        initialFrameHeightRef.current === 0 ||
        (baselineRefreshPendingRef.current && !keyboardEvent)
      ) {
        initialFrameHeightRef.current = frame.height;
        baselineRefreshPendingRef.current = false;
      } else if (baselineRefreshPendingRef.current && keyboardEvent) {
        // 带键盘旋转时先信任系统 adjustResize 的当前可用高度，避免沿用
        // 旧方向基线造成整页跳变；保持 pending，收起后再记录完整高度。
        initialFrameHeightRef.current = frame.height;
        applyBottom(0);
        return;
      }
      if (!oldFrame || oldFrame.height !== frame.height) {
        if (keyboardEvent) updateForKeyboard(keyboardEvent);
      }
    },
    [applyBottom, updateForKeyboard],
  );

  const heightStyle =
    bottom > 0
      ? {
          height: Math.max(0, initialFrameHeightRef.current - bottom),
          flex: 0,
        }
      : undefined;

  return (
    <View style={[style, heightStyle]} onLayout={onLayout}>
      {children}
    </View>
  );
}

function ChatKeyboardAvoidingView({ children, style }: ChatKeyboardAvoidingViewProps) {
  if (Platform.OS === "android") {
    return (
      <AndroidHeightKeyboardAvoidingView style={style}>
        {children}
      </AndroidHeightKeyboardAvoidingView>
    );
  }
  return <View style={style}>{children}</View>;
}

type OlderPageLoadResult = {
  loaded: number;
  nextCursor: string | null;
};

function findPreviousUserMessageID(
  messages: readonly MessageWithParts[],
  anchorID: string,
): string | null {
  const anchorIndex = messages.findIndex((item) => item.message.id === anchorID);
  if (anchorIndex < 0) return null;
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.message.role === "user") return item.message.id;
  }
  return null;
}

const NON_RENDERING_PART_TYPES = new Set([
  "step-start",
  "step-finish",
  "patch",
  "snapshot",
  "agent",
  "retry",
  "compaction",
]);

function isRenderableMessagePart(part: Part): boolean {
  if (part.type === "text") return Boolean(part.text?.trim());
  return !NON_RENDERING_PART_TYPES.has(part.type);
}

function findLastRenderableMessageID(messages: readonly MessageWithParts[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (!item) continue;
    const completed = (item.message.time as { completed?: number } | undefined)?.completed;
    if (item.message.role === "assistant" && completed == null) return item.message.id;

    const hasVisiblePart = item.partOrder.some((id) => {
      const part = item.partsById[id];
      return part ? isRenderableMessagePart(part) : false;
    });
    if (hasVisiblePart) return item.message.id;
  }
  return null;
}

export type ChatScreenProps = {
  /** 会话 ID（单栏由路由壳传入，双栏由 sessions 容器传入） */
  sessionID: string;
  /** 双栏内嵌模式：隐藏返回按钮（左侧列表常驻，无需返回） */
  embedded?: boolean;
};

export function ChatScreen({ sessionID, embedded = false }: ChatScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // ── 键盘避让(自管理) ──
  // 不用 KeyboardAvoidingView behavior="padding"：第三方语音输入法(讯飞/搜狗等)
  // 的语音面板是接近全屏的浮层,iOS 会把它当成一个"接近全屏高度的键盘"上报,
  // KAV 会据此加上接近整屏的 paddingBottom,把输入框顶到屏幕顶部(就是用户
  // 看到的"输入框飞到顶部"的根因)。这里改成手动监听键盘 frame,对异常高度
  // (超过屏高 55% 视为非普通键盘,如语音面板/输入法切换浮层)直接忽略,
  // 只对正常键盘做避让,从而彻底规避语音面板导致的跳顶。
  // - kbHeight: iOS 上把整个聊天区上推的高度(过滤后的真实键盘高度)。
  // - keyboardUp: 键盘是否弹起,用来决定输入框下方是否补 home indicator 间距。
  const [kbHeight, setKbHeight] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    if (Platform.OS === "ios") {
      // 缓存上一次非空 willChangeFrame 的 startH（来源方高度），用于还原语音面板遮挡高度。
      // 场景：普通键盘→语音面板切换时，iOS 先发一条 willChangeFrame(start=kbH, end=voiceH)，
      // 随后语音面板激活时只发 nullEvent(endH=0, endY=0)，真实遮挡高度需从 startH 读取。
      let lastStartH = 0;

      const apply = (h: number, duration: number) => {
        // 语音面板/输入法切换浮层会上报接近全屏的高度，超过屏高 55% 一律视为
        // 非普通键盘，忽略该高度（不上推），避免输入框被顶到屏幕顶部。
        const filtered = h > windowHeight * 0.55 ? 0 : h;
        LayoutAnimation.configureNext({
          duration: duration > 0 ? duration : 250,
          update: { type: LayoutAnimation.Types.keyboard },
        });
        setKbHeight(filtered);
        setKeyboardUp(filtered > 0);
      };

      const onWillChange = (e: {
        endCoordinates: { height: number; screenY: number };
        startCoordinates?: { height: number; screenY: number };
        duration?: number;
      }) => {
        const { height, screenY } = e.endCoordinates;
        const startH = e.startCoordinates?.height ?? 0;

        // 记录每次非空 start 高度，以便 nullEvent 时还原
        if (startH > 0) lastStartH = startH;

        // "空事件"：endH=0 且 endY=0，iOS 在语音面板出现/输入法切换浮层时触发。
        // 不是键盘收起事件，要用 lastStartH 作为当前遮挡高度（语音面板真实高度）。
        if (height === 0 && screenY === 0) {
          if (lastStartH > 0) apply(lastStartH, e.duration ?? 250);
          return;
        }

        const hidden = screenY >= windowHeight;
        apply(hidden ? 0 : height, e.duration ?? 250);
      };

      const onDidShow = (e: { endCoordinates: { height: number; screenY: number } }) => {
        if (e.endCoordinates.height === 0) return;
        apply(e.endCoordinates.height, 200);
      };

      const onWillHide = (e: { duration?: number }) => {
        lastStartH = 0;
        apply(0, e.duration ?? 250);
      };

      const s1 = Keyboard.addListener("keyboardWillChangeFrame", onWillChange);
      const s2 = Keyboard.addListener("keyboardDidShow", onDidShow);
      const s3 = Keyboard.addListener("keyboardWillHide", onWillHide);
      // 尺寸变化会重新订阅。若旋转/分屏发生时键盘仍开着，原生端不一定
      // 再发 show 事件，用当前 metrics 立即按新窗口高度重算。
      const metrics = Keyboard.metrics();
      if (metrics?.height) onDidShow({ endCoordinates: metrics });
      return () => {
        s1.remove();
        s2.remove();
        s3.remove();
      };
    }
    // Android: AndroidHeightKeyboardAvoidingView 负责压缩聊天内容，并在 hide
    // 时强制恢复原高度；这里仅记录显隐，用于切换输入框下方的导航栏安全区。
    const onShow = () => setKeyboardUp(true);
    const onHide = () => setKeyboardUp(false);
    const s1 = Keyboard.addListener("keyboardDidShow", onShow);
    const s2 = Keyboard.addListener("keyboardDidHide", onHide);
    return () => {
      s1.remove();
      s2.remove();
    };
  }, [windowHeight]);

  const active = useConnectionStore((s) => s.active);
  // 只订阅当前会话。其他并发会话的 SSE delta 会更新 bySession 的外层对象，
  // 但不应让正在阅读历史消息的本页重新渲染。
  const messages = useMessagesStore((s) => s.bySession[sessionID ?? ""] ?? EMPTY_MESSAGES);
  // 索引定位的重试必须读最新列表，不能闭包住分页前的旧数组。
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const loading = useMessagesStore((s) => s.loading[sessionID ?? ""]);
  const mergeMessages = useMessagesStore((s) => s.mergeMessages);
  const prependMessages = useMessagesStore((s) => s.prependMessages);
  const setLoading = useMessagesStore((s) => s.setLoading);

  // SSE 连接状态：指示灯 + 断线重连后自动补齐消息
  const connStatus = useStatusStore((s) => s.status);
  const openCount = useStatusStore((s) => s.openCount);

  const agents = useModelStore((s) => s.agents);
  const providers = useModelStore((s) => s.providers);
  const providerDefault = useModelStore((s) => s.providerDefault);
  const configModel = useModelStore((s) => s.configModel);
  const recent = useModelStore((s) => s.recent);
  const recentHydrated = useModelStore((s) => s.recentHydrated);
  const selectedAgent = useModelStore((s) => s.selectedAgent);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const setAgents = useModelStore((s) => s.setAgents);
  const setProviders = useModelStore((s) => s.setProviders);
  const setProviderDefault = useModelStore((s) => s.setProviderDefault);
  const setConfigModel = useModelStore((s) => s.setConfigModel);
  const setSelectedAgent = useModelStore((s) => s.setSelectedAgent);
  const setSelectedModel = useModelStore((s) => s.setSelectedModel);
  const setSessionSelection = useModelStore((s) => s.setSessionSelection);
  const addRecent = useModelStore((s) => s.addRecent);
  const [messageHistoryReadyFor, setMessageHistoryReadyFor] = useState<string | null>(null);
  const [modelDefaultsReadyFor, setModelDefaultsReadyFor] = useState<string | null>(null);
  const initializedModelSessionIDRef = useRef<string | null>(null);

  const session = useSessionsStore((s) => s.sessions.find((ses) => ses.id === sessionID));
  const upsertSession = useSessionsStore((s) => s.upsertSession);
  // Mark this session as "currently displayed" so SSE reconnect resyncs
  // only its pending questions (instead of fanning out to every session
  // in the list). Cleared on blur in the cleanup below.
  const setCurrentSession = useSessionsStore((s) => s.setCurrentSession);
  const sessionTitle =
    (session as unknown as { title?: string; slug?: string })?.title?.trim() ||
    (session as unknown as { title?: string; slug?: string })?.slug ||
    t("chat.defaultTitle");

  // 工作目录跟随会话走：所有跟该会话相关的请求都带上它。
  // 早期会话（没有 directory 字段的）会回退成不带目录的请求，server 用
  // process.cwd() 兜底，老数据不会丢。
  const sessionDirectory = session?.directory;

  useEffect(() => {
    if (!active || !sessionID || session) return;
    let cancelled = false;
    void getSession(toClientConfig(active), sessionID)
      .then((info) => {
        if (cancelled || useConnectionStore.getState().active?.id !== active.id) return;
        upsertSession(info, active.id);
      })
      .catch((err) => console.warn("[chat] getSession failed", err));
    return () => {
      cancelled = true;
    };
  }, [active, session, sessionID, upsertSession]);

  const getDraft = useDraftStore((s) => s.getDraft);
  const setDraftText = useDraftStore((s) => s.setDraftText);
  const setDraftImages = useDraftStore((s) => s.setDraftImages);
  const clearDraft = useDraftStore((s) => s.clearDraft);

  const [input, setInput] = useState(() => (sessionID ? getDraft(sessionID).text : ""));
  const [images, setImages] = useState<ImageAttachment[]>(() =>
    sessionID ? getDraft(sessionID).images : [],
  );
  // 发送请求可能比会话切换更晚结束。失败恢复时只更新原会话的草稿，
  // 禁止把旧请求的文本写进用户已经打开的新会话输入框。
  const currentSessionIDRef = useRef(sessionID);
  currentSessionIDRef.current = sessionID;

  useEffect(() => {
    initializedModelSessionIDRef.current = null;
    setMessageHistoryReadyFor(null);
    setModelDefaultsReadyFor(null);
    setSelectedModel(null);
  }, [sessionID, setSelectedModel]);

  /** 同步输入框变化到草稿 store */
  const handleInputChange = useCallback(
    (text: string) => {
      setInput(text);
      if (sessionID) setDraftText(sessionID, text);
    },
    [sessionID, setDraftText],
  );

  /**
   * Pick a slash autocomplete result and insert "/<name> " so the user can
   * keep typing arguments before sending. The trailing space also closes the
   * autocomplete under getSlashCommandQuery's token-only rule.
   */
  const handleCommandSelect = useCallback(
    (cmd: CommandV2Info) => {
      handleInputChange("/" + cmd.name + " ");
      trackEvent(Ev.SlashPickerPick, { name: cmd.name });
    },
    [handleInputChange],
  );

  /** 同步图片附件变化到草稿 store */
  const syncImages = useCallback(
    (next: ImageAttachment[]) => {
      setImages(next);
      if (sessionID) setDraftImages(sessionID, next);
    },
    [sessionID, setDraftImages],
  );

  const handlePickImage = useCallback(async () => {
    let picked: ImageAttachment[] | null;
    try {
      picked = await pickImages();
    } catch (err) {
      haptic.error();
      await recordError(err, { source: "chat.pickImage", sessionID });
      trackEvent(Ev.ImagePickFail, {
        error: err instanceof Error ? err.message : String(err),
      });
      Alert.alert(t("chat.imagePickerError"), err instanceof Error ? err.message : String(err));
      return;
    }
    if (!picked || picked.length === 0) return;
    haptic.success();
    trackEvent(Ev.ImageAttach, { count: picked.length });
    // 暂仅支持单张：已有图片时替换，不追加
    syncImages(picked);
  }, [syncImages, t, sessionID]);

  const handleTakePhoto = useCallback(async () => {
    haptic.impactHeavy();
    let photo: ImageAttachment[] | null;
    try {
      photo = await takePhoto();
    } catch (err) {
      haptic.error();
      await recordError(err, { source: "chat.takePhoto", sessionID });
      trackEvent(Ev.ImagePickFail, {
        error: err instanceof Error ? err.message : String(err),
      });
      Alert.alert(t("chat.imagePickerError"), err instanceof Error ? err.message : String(err));
      return;
    }
    if (!photo || photo.length === 0) return;
    haptic.success();
    trackEvent(Ev.ImageAttach, { count: photo.length, source: "camera" });
    syncImages(photo);
  }, [syncImages, t, sessionID]);

  const handleRemoveImage = useCallback(
    (id: string) => {
      haptic.impact();
      syncImages(images.filter((img) => img.id !== id));
    },
    [images, syncImages],
  );
  const [sending, setSending] = useState(false);
  const waitingFirstAIMsg = useRef(false);
  const [awaitingAssistant, setAwaitingAssistant] = useState(false);
  const sendAttemptTokenRef = useRef(0);
  const stopAttemptTokenRef = useRef(0);
  // 用户点击 send 的 wall-clock；首条 assistant 到达时计算首字延迟并上报。
  const sendStartedAtRef = useRef<number | null>(null);
  // 停止请求飞行中：从点 stop 到收到 message.updated(time.completed) 这段
  // 过渡期。期间按钮显示 spinner,避免重复点。
  const [stopping, setStopping] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const olderCursorRef = useRef<string | null | undefined>(undefined);
  olderCursorRef.current = olderCursor;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // loadingMore state 要等 React 提交后才会更新；滚动事件在此之前可能连续到达。
  // 用同步 Promise Map 按 (session, cursor) 去重；上箭头触发时还能等待已经由
  // onScroll 发起的同一页请求，避免加载中点击无反应。
  const loadingOlderRequestsRef = useRef(new Map<string, Promise<OlderPageLoadResult>>());
  const refreshingLatestRequestsRef = useRef(new Map<string, Promise<void>>());
  const [infoVisible, setInfoVisible] = useState(false);
  const [agentSheetVisible, setAgentSheetVisible] = useState(false);
  const [modelSheetVisible, setModelSheetVisible] = useState(false);
  // Slash autocomplete is absolutely overlaid above the composer so showing
  // suggestions never resizes the message viewport. InputBar reports the
  // composer's top edge as a distance from its own bottom.
  const [commandAutocompleteAnchor, setCommandAutocompleteAnchor] = useState(0);
  // 长按消息弹出菜单：记录当前目标消息
  const [menuItem, setMenuItem] = useState<MessageWithParts | null>(null);
  // Android 用 BottomSheet 承载菜单项
  const [menuSheetVisible, setMenuSheetVisible] = useState(false);
  // 复制成功后在哪条消息上显示 toast（1.4s 后自动清）
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const listRef = useRef<VirtualizedList<ChatMessageRow>>(null);
  const hasPendingQuestion = useHasPendingQuestion(sessionID ?? "");
  const slashCommandQuery = useMemo(() => getSlashCommandQuery(input), [input]);
  const slashAutocompleteVisible =
    slashCommandQuery !== null && !sending && !hasPendingQuestion && commandAutocompleteAnchor > 0;
  const slashAutocompleteWasVisibleRef = useRef(false);

  useEffect(() => {
    if (slashAutocompleteVisible && !slashAutocompleteWasVisibleRef.current) {
      trackEvent(Ev.SlashPickerOpen);
    }
    slashAutocompleteWasVisibleRef.current = slashAutocompleteVisible;
  }, [slashAutocompleteVisible]);

  const handleCommandAutocompleteAnchorChange = useCallback((next: number) => {
    setCommandAutocompleteAnchor((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    sendAttemptTokenRef.current += 1;
    stopAttemptTokenRef.current += 1;
    waitingFirstAIMsg.current = false;
    setSending(false);
    setAwaitingAssistant(false);
    setStopping(false);
    setLoadingMore(false);
    olderCursorRef.current = undefined;
    setOlderCursor(undefined);
    setLoadError(null);
    setLoadMoreError(null);
  }, [sessionID]);

  // ── 铁律守门员：所有滚动行为的唯一入口 ──
  const stick = useStickToBottom(listRef);
  const isUserPinned = stick.isUserPinned;
  const isAtBottom = stick.isAtBottom;
  const latestRenderableMessageIDRef = useRef<string | null>(null);
  const listEndVisibleRef = useRef(false);
  const nextRenderableEndID = findLastRenderableMessageID(messages);
  if (latestRenderableMessageIDRef.current !== nextRenderableEndID) {
    latestRenderableMessageIDRef.current = nextRenderableEndID;
    listEndVisibleRef.current = false;
  }
  const isListEndVisible = useCallback(() => listEndVisibleRef.current, []);

  // 复制成功后在目标消息上显示 toast（1.4s 自动清）
  const flashCopiedToast = useCallback((messageId: string) => {
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 1400);
  }, []);

  // 构造菜单项的 label 与 action（iOS ActionSheet / Android BottomSheet 共用）
  const buildMenuOptions = useCallback(
    (item: MessageWithParts): { labels: string[]; actions: (() => void)[] } => {
      const isUser = item.message.role === "user";
      const raw = getMessagePlainText(item);
      if (!raw) return { labels: [], actions: [] };
      const plain = isUser ? raw : stripMarkdown(raw);

      const labels: string[] = [];
      const actions: (() => void)[] = [];

      // 复制（user 复制原文；AI 复制剥离 markdown 后的纯文本）
      labels.push(t("common.copy"));
      actions.push(async () => {
        await Clipboard.setStringAsync(plain || raw);
        haptic.success();
        flashCopiedToast(item.message.id);
        trackEvent(Ev.MessageCopy, {
          role: isUser ? "user" : "assistant",
          variant: "plain",
        });
      });

      // AI markdown 消息多一项「复制原文」
      if (!isUser && plain !== raw) {
        labels.push(t("chat.copyRaw"));
        actions.push(async () => {
          await Clipboard.setStringAsync(raw);
          haptic.success();
          flashCopiedToast(item.message.id);
          trackEvent(Ev.MessageCopy, {
            role: "assistant",
            variant: "raw",
          });
        });
      }

      // 选择文本：进子页面用系统原生选择
      labels.push(t("chat.selectText"));
      actions.push(() => {
        trackEvent(Ev.MessageOpenSelectText, {
          role: isUser ? "user" : "assistant",
        });
        router.push({
          pathname: "/message-text",
          params: { sessionID: sessionID ?? "", messageID: item.message.id },
        });
      });

      return { labels, actions };
    },
    [t, sessionID, router, flashCopiedToast],
  );

  // 长按消息：iOS 弹系统级 ActionSheet，Android 弹 BottomSheet
  const handleLongPressItem = useCallback(
    (item: MessageWithParts) => {
      const { labels, actions } = buildMenuOptions(item);
      if (labels.length === 0) return;

      haptic.impact();

      if (Platform.OS === "ios") {
        // iOS 系统级 ActionSheet：原生毛玻璃 + Cancel 按钮，体验最佳
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: t("chat.messageMenuTitle"),
            options: [...labels, t("common.cancel")],
            cancelButtonIndex: labels.length,
          },
          (idx) => {
            if (idx === undefined || idx >= actions.length) return;
            const action = actions[idx];
            if (action) void action();
          },
        );
      } else {
        // Android 用 BottomSheet 承载菜单项
        setMenuItem(item);
        setMenuSheetVisible(true);
      }
    },
    [buildMenuOptions, t],
  );

  // 用户在 pinned 状态下"下方累积了几条新消息"。0 表示无未读。
  const [unreadBelow, setUnreadBelow] = useState(0);
  const lastTopMessageIdRef = useRef<string | null>(null);

  // 浮层按钮显隐（用 hook 暴露的 showJumpToLatest，再做个透明度过渡）
  const scrollBtnOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(scrollBtnOpacity, {
      toValue: stick.showJumpToLatest ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
    // 用户回到底部 → 未读清零
    if (!stick.showJumpToLatest && unreadBelow !== 0) setUnreadBelow(0);
  }, [stick.showJumpToLatest, scrollBtnOpacity, unreadBelow]);

  const loadFirstPage = useCallback(async () => {
    if (!active || !sessionID || !session) return;
    const requestedSessionID = sessionID;
    setLoading(requestedSessionID, true);
    if (currentSessionIDRef.current === requestedSessionID) setLoadError(null);
    try {
      const page = await getSessionMessagesPage(
        toClientConfig(active, sessionDirectory),
        requestedSessionID,
        { limit: PAGE_SIZE },
      );
      const messages: Message[] = [];
      const partsByMessage: Record<string, Part[]> = {};
      for (const entry of page.items) {
        messages.push(entry.info);
        partsByMessage[entry.info.id] = entry.parts;
      }
      // 初始请求期间 SSE 也可能已经写入首条新消息；即使此处是首次加载，
      // 仍使用无损合并，避免较慢的 HTTP 响应把实时消息覆盖掉。
      mergeMessages(requestedSessionID, messages, partsByMessage);
      const nextCursor = page.nextCursor ?? null;
      if (currentSessionIDRef.current === requestedSessionID) {
        olderCursorRef.current = nextCursor;
        setOlderCursor(nextCursor);
      }
    } catch (err) {
      console.warn("[chat] loadFirstPage failed", err);
      if (currentSessionIDRef.current === requestedSessionID) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      trackEvent(Ev.ChatHistoryLoadFail, {
        source: "first",
        session_id: requestedSessionID,
        error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
      });
    } finally {
      setLoading(requestedSessionID, false);
    }
  }, [active, session, sessionID, sessionDirectory, mergeMessages, setLoading]);

  const refreshLatestPage = useCallback((): Promise<void> => {
    if (!active || !sessionID || !session) return Promise.resolve();
    const requestedSessionID = sessionID;
    const requestKey = `${active.id}\u0000${requestedSessionID}`;
    const inFlight = refreshingLatestRequestsRef.current.get(requestKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const page = await getSessionMessagesPage(
          toClientConfig(active, sessionDirectory),
          requestedSessionID,
          { limit: PAGE_SIZE },
        );
        const latestMessages: Message[] = [];
        const partsByMessage: Record<string, Part[]> = {};
        for (const entry of page.items) {
          latestMessages.push(entry.info);
          partsByMessage[entry.info.id] = entry.parts;
        }
        mergeMessages(requestedSessionID, latestMessages, partsByMessage);

        // 已经分页过时必须保留更老的 cursor；重连刷新不能把它倒退回
        // 最新 30 条的边界。组件新挂载、cursor 尚未知时才初始化。
        if (
          currentSessionIDRef.current === requestedSessionID &&
          olderCursorRef.current === undefined
        ) {
          const nextCursor = page.nextCursor ?? null;
          olderCursorRef.current = nextCursor;
          setOlderCursor(nextCursor);
        }
      } catch (err) {
        console.warn("[chat] refreshLatestPage failed", err);
        trackEvent(Ev.ChatHistoryLoadFail, {
          source: "refresh",
          session_id: requestedSessionID,
          error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        });
      } finally {
        refreshingLatestRequestsRef.current.delete(requestKey);
      }
    })();
    refreshingLatestRequestsRef.current.set(requestKey, request);
    return request;
  }, [active, session, sessionID, sessionDirectory, mergeMessages]);

  const loadOlder = useCallback((): Promise<OlderPageLoadResult> => {
    const cursor = olderCursorRef.current;
    if (!active || !sessionID || !session || !cursor) {
      return Promise.resolve({ loaded: 0, nextCursor: null });
    }
    const requestKey = `${sessionID}\u0000${cursor}`;
    const inFlight = loadingOlderRequestsRef.current.get(requestKey);
    if (inFlight) return inFlight;

    setLoadingMore(true);
    setLoadMoreError(null);
    const request = (async () => {
      try {
        const page = await getSessionMessagesPage(
          toClientConfig(active, sessionDirectory),
          sessionID,
          { limit: PAGE_SIZE, before: cursor },
        );
        const messages: Message[] = [];
        const partsByMessage: Record<string, Part[]> = {};
        for (const entry of page.items) {
          messages.push(entry.info);
          partsByMessage[entry.info.id] = entry.parts;
        }
        prependMessages(sessionID, messages, partsByMessage);
        const nextCursor = page.nextCursor ?? null;
        olderCursorRef.current = nextCursor;
        setOlderCursor(nextCursor);
        return { loaded: messages.length, nextCursor };
      } catch (err) {
        console.warn("[chat] loadOlder failed", err);
        if (currentSessionIDRef.current === sessionID) {
          setLoadMoreError(err instanceof Error ? err.message : String(err));
        }
        trackEvent(Ev.ChatHistoryLoadFail, {
          source: "older",
          session_id: sessionID,
          error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
        });
        return { loaded: 0, nextCursor: cursor };
      } finally {
        loadingOlderRequestsRef.current.delete(requestKey);
        if (loadingOlderRequestsRef.current.size === 0) setLoadingMore(false);
      }
    })();
    loadingOlderRequestsRef.current.set(requestKey, request);
    return request;
  }, [active, session, sessionID, sessionDirectory, prependMessages]);

  // Mark / unmark this session as the one currently displayed so SSE
  // reconnect resyncs only its pending questions. Cleanup runs when the
  // screen blurs (navigate to sessions list, switch chat, etc.) — at
  // that point the chat-screen focus effect will also refetch on the
  // next focus, so leaving it cleared is correct.
  useFocusEffect(
    useCallback(() => {
      if (sessionID) setCurrentSession(sessionID);
      return () => {
        setCurrentSession(null);
      };
    }, [sessionID, setCurrentSession]),
  );

  useFocusEffect(
    useCallback(() => {
      trackEvent(Ev.ChatScreenOpen, {
        backend: active?.backend ?? "none",
        session_id: sessionID ?? "",
      });
      if (!session) return;
      // 仅在还没有当前会话消息时重新加载，避免重复 setMessages 刷新
      // 数组引用导致虚拟列表滚动位置重置（输入法语音识别/权限页等外部跳转返回场景）。
      // 有缓存消息时跳过全量加载，但必须刷新 olderCursor——组件重挂载后 cursor 变回
      // undefined，若不刷新则上滑加载会因 !olderCursor 而 early-return，
      // 导致永远看不到更早的消息。
      const existing = useMessagesStore.getState().bySession[sessionID ?? ""];
      if (!existing || existing.length === 0) {
        void loadFirstPage().finally(() => {
          if (currentSessionIDRef.current === sessionID) setMessageHistoryReadyFor(sessionID);
        });
      } else if (active) {
        setMessageHistoryReadyFor(sessionID ?? null);
        // 缓存命中也增量补齐离开页面期间漏掉的消息。mergeMessages 保留
        // 已加载历史，并防止较慢的 REST 快照覆盖更晚到达的 SSE delta。
        void refreshLatestPage();
      }
      // SSE 不重放事件：用户在会话列表页期间发生的 question.v2.asked 可能
      // 已经丢了，回到 chat 页时主动从服务端拉一次 pending 列表来兜底。
      // refetchQuestions 内部幂等（按 id 去重），重复触发没坏处。
      if (sessionID) void refetchQuestions(sessionID);
      if (!active) return;
      const cfg = toClientConfig(active, sessionDirectory);

      // 0) Agent 仍按会话恢复；Model 必须等聊天记录与 Server 配置均返回后，
      //    再按“会话模型 > 全局最近选择 > Server 配置”初始化。
      const remembered = useModelStore.getState().sessionSelections[sessionID ?? ""];
      if (remembered) {
        if (remembered.agent !== undefined) setSelectedAgent(remembered.agent);
      }

      // 1) 先取本地缓存：useModelStore 里始终保留着上次拉到的
      //    agents/providers 快照，UI 一直基于它渲染。这里显式 set 一次
      //    让"先展示旧值再异步刷新"的顺序在代码上一目了然；zustand 用
      //    Object.is 比对，相同引用是 noop，不会引发额外重渲染。
      setAgents(useModelStore.getState().agents);
      setProviders(useModelStore.getState().providers);

      // 2) 异步拉服务端最新数据，拉到后用新值覆盖 store，UI 自动
      //    重渲染。失败时静默保留旧值，避免网络抖动把用户已经选好
      //    的 agent/model 清空。
      listAgents(cfg)
        .then((list) => {
          const filtered = list.filter((a) => a.mode !== "subagent" && !a.hidden);
          setAgents(filtered);
        })
        .catch((e) => console.warn("[chat] listAgents failed", e));
      void Promise.allSettled([listProviders(cfg), getConfig(cfg)]).then(
        ([providersResult, configResult]) => {
          if (currentSessionIDRef.current !== sessionID) return;
          if (providersResult.status === "fulfilled") {
            setProviders(providersResult.value.providers);
            setProviderDefault(providersResult.value.default ?? {});
          } else {
            console.warn("[chat] listProviders failed", providersResult.reason);
          }
          if (configResult.status === "fulfilled") {
            setConfigModel(
              typeof configResult.value.model === "string" ? configResult.value.model : null,
            );
          } else {
            console.warn("[chat] getConfig failed", configResult.reason);
          }
          setModelDefaultsReadyFor(sessionID ?? null);
        },
      );

      // 预加载 slash 命令列表：用户开始输入斜杠时 autocomplete 直接命中
      // 缓存。store.load 内部按 scopeKey 隔离 workspace。
      const cmdStore = useCommandStore.getState();
      if (cmdStore.scopeKey !== commandScopeKey(cfg) || cmdStore.loading === "idle") {
        void cmdStore.load(cfg);
      }
    }, [
      loadFirstPage,
      refreshLatestPage,
      active,
      session,
      sessionID,
      sessionDirectory,
      setAgents,
      setProviders,
      setProviderDefault,
      setConfigModel,
      setSelectedAgent,
      setSelectedModel,
    ]),
  );

  // agents 加载完后：当前选中的如果还在新列表里就保留，不在则回退到第一个
  // 并把"当前选择"持久化到 sessionSelections，让用户切到别的会话再回来时
  // 也能恢复成同一个 agent（影响 LLM 侧 prompt cache 命中率）。
  useEffect(() => {
    if (agents.length === 0 || !sessionID) return;
    if (selectedAgent && agents.some((a) => a.name === selectedAgent)) {
      // 当前选择仍合法。首次进 chat 页时这里是"刚自动选的第一个"，同样
      // 持久化下去作为本 session 的偏好。
      setSessionSelection(sessionID, {
        agent: selectedAgent,
        model: selectedModel ?? undefined,
      });
      return;
    }
    const fallback = agents[0].name;
    setSelectedAgent(fallback);
    setSessionSelection(sessionID, {
      agent: fallback,
      model: selectedModel ?? undefined,
    });
  }, [agents, selectedAgent, selectedModel, sessionID, setSelectedAgent, setSessionSelection]);

  const hasMessages = messages.length > 0;
  const latestMessageInfo = messages[messages.length - 1]?.message;
  const currentSessionModel = useMemo<ModelSelection | null>(() => {
    return resolveMessageModel(latestMessageInfo);
  }, [latestMessageInfo]);

  // 模型初始化铁律见 ../store/MODEL_SELECTION.md。每个会话仅初始化一次，防止
  // 后续 SSE 消息或 recent 写盘覆盖用户刚在下拉框主动选择的值。等待历史与
  // Server 配置都完成，避免把“尚未加载”误判为新会话。
  useEffect(() => {
    if (!sessionID || providers.length === 0 || !recentHydrated) return;
    if (messageHistoryReadyFor !== sessionID || modelDefaultsReadyFor !== sessionID) return;
    if (initializedModelSessionIDRef.current === sessionID) return;

    const picked = resolveInitialModel({
      providers,
      hasMessages,
      sessionModel: currentSessionModel,
      recent,
      configModel,
      providerDefault,
    });
    initializedModelSessionIDRef.current = sessionID;
    setSelectedModel(picked);
    setSessionSelection(sessionID, {
      agent: selectedAgent ?? undefined,
      model: picked ?? undefined,
    });
  }, [
    providers,
    providerDefault,
    configModel,
    recent,
    recentHydrated,
    selectedAgent,
    sessionID,
    currentSessionModel,
    hasMessages,
    messageHistoryReadyFor,
    modelDefaultsReadyFor,
    setSelectedModel,
    setSessionSelection,
  ]);

  // 每次 SSE 重连成功（openCount 递增），重新拉一页消息补齐断线期间的内容。
  // openCount 初始值为 0，skip 第一次（页面 focus 时 useFocusEffect 已加载）。
  const prevOpenCountRef = useRef(0);
  useEffect(() => {
    if (openCount === 0) return;
    if (openCount === prevOpenCountRef.current) return;
    prevOpenCountRef.current = openCount;
    // 断线重连后补齐消息（只在 chat 页面活跃时）
    void refreshLatestPage();
    if (sessionID) void refetchQuestions(sessionID);
  }, [openCount, refreshLatestPage, sessionID]);

  const onSend = async () => {
    const text = input.trim();
    // 纯图片也允许发送：有图片或有文字任一即可
    if (
      (!text && images.length === 0) ||
      !active ||
      !sessionID ||
      sending ||
      isStreaming ||
      waitingFirstAIMsg.current
    ) {
      return;
    }

    const submittedSessionID = sessionID;
    const sendAttemptToken = ++sendAttemptTokenRef.current;
    const isCurrentSendAttempt = () =>
      currentSessionIDRef.current === submittedSessionID &&
      sendAttemptTokenRef.current === sendAttemptToken;
    const submittedInput = input;
    const submittedImages = images;
    const clearSubmittedComposer = () => {
      setInput("");
      setImages([]);
      clearDraft(submittedSessionID);
    };
    const restoreSubmittedComposer = () => {
      // 理论上 sending 期间输入框不可编辑；仍做防御：若用户已经产生了
      // 新草稿，不用失败的旧提交覆盖它。
      const currentDraft = useDraftStore.getState().getDraft(submittedSessionID);
      if (currentDraft.text || currentDraft.images.length > 0) return;
      setDraftText(submittedSessionID, submittedInput);
      setDraftImages(submittedSessionID, submittedImages);
      if (currentSessionIDRef.current === submittedSessionID) {
        setInput(submittedInput);
        setImages(submittedImages);
      }
    };
    const outgoingSelection = normalizeModelSelection(providers, selectedModel);

    // ── Slash command 分流 ──
    // 只看首行匹配 `/<cmd> <args...>`,多行 content 全部塞进 arguments。
    // server 端会替换模板里的 $1 / $2 / $ARGUMENTS 占位符。
    // 若 server 没注册该命令,静默回退到 sendPrompt(用户可能是打字错误)。
    const parsed = parseSlashCommandText(text);
    if (parsed) {
      // 本地先查 byName,未命中直接走 sendPrompt 兜底 —— 不弹错误,保持
      // 「任何文本都能发送」的兼容语义,旧用户敲 /foo 不会被卡死。
      const config = toClientConfig(active, sessionDirectory);
      const commandState = useCommandStore.getState();
      const cmd =
        commandState.scopeKey === commandScopeKey(config)
          ? commandState.byName[parsed.name]
          : undefined;
      if (cmd) {
        const selectedModelRef = outgoingSelection
          ? `${outgoingSelection.providerID}/${outgoingSelection.modelID}`
          : undefined;
        const commandAgent = cmd.agent
          ? agents.find((agent) => agent.name === cmd.agent)
          : undefined;
        let commandVariant = outgoingSelection?.variant;
        if (
          cmd.model &&
          (cmd.model.variant || `${cmd.model.providerID}/${cmd.model.id}` !== selectedModelRef)
        ) {
          commandVariant = undefined;
        } else if (cmd.agent) {
          if (!commandAgent) {
            commandVariant = undefined;
          } else if (
            commandAgent.model &&
            `${commandAgent.model.providerID}/${commandAgent.model.modelID}` !== selectedModelRef
          ) {
            commandVariant = undefined;
          }
        }
        setSending(true);
        waitingFirstAIMsg.current = true;
        setAwaitingAssistant(true);
        stick.jumpToLatest(isListEndVisible);
        // legacy command 请求会等生成流程返回，不能把输入框清空绑在 await 后。
        // 先按“已提交”清空；若请求最终失败，再从本次快照恢复。
        clearSubmittedComposer();
        try {
          await executeCommand(config, sessionID, {
            command: parsed.name,
            arguments: parsed.arguments,
            agent: selectedAgent ?? undefined,
            model: selectedModelRef,
            variant: commandVariant,
            parts: images.length > 0 ? images.map((img) => toFilePartInput(img)) : undefined,
          });
          trackEvent(Ev.CommandExecuted, {
            command: parsed.name,
            agent: selectedAgent ?? "default",
            has_image: images.length > 0 ? "1" : "0",
          });
        } catch (err) {
          // 若 AI 已经通过 SSE 开始回复，说明服务端实际已接收，不能因
          // 同步响应尾部异常又恢复输入，造成用户误以为需要重复发送。
          const failedBeforeAIStarted = isCurrentSendAttempt() && waitingFirstAIMsg.current;
          if (isCurrentSendAttempt()) {
            waitingFirstAIMsg.current = false;
            setAwaitingAssistant(false);
          }
          if (failedBeforeAIStarted) restoreSubmittedComposer();
          await recordError(err, {
            source: "chat.command",
            sessionID,
            command: parsed.name,
          });
          if (failedBeforeAIStarted) {
            haptic.error();
            Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (isCurrentSendAttempt()) setSending(false);
        }
        return;
      }
    }

    setSending(true);
    waitingFirstAIMsg.current = true;
    setAwaitingAssistant(true);
    sendStartedAtRef.current = Date.now();
    // 铁律例外：用户点击发送 = 显式表达"我要看最新",主动解除 pinned。
    stick.jumpToLatest(isListEndVisible);
    // POST /message 的响应会跟随整个生成流程;输入框只关心消息已提交,
    // 因此立即清空,并在真正失败时回滚本次提交快照。
    clearSubmittedComposer();
    try {
      const parts: ({ type: "text"; text: string } | ReturnType<typeof toFilePartInput>)[] = [];
      if (text) parts.push({ type: "text", text });
      for (const img of images) parts.push(toFilePartInput(img));
      await sendPrompt(toClientConfig(active, sessionDirectory), sessionID, {
        parts,
        agent: selectedAgent ?? undefined,
        model: outgoingSelection
          ? {
              providerID: outgoingSelection.providerID,
              modelID: outgoingSelection.modelID,
            }
          : undefined,
        variant: outgoingSelection?.variant,
      });
      trackEvent(Ev.MessageSend, {
        agent: selectedAgent ?? "default",
        has_model: selectedModel ? "1" : "0",
        model: outgoingSelection
          ? `${outgoingSelection.providerID}/${outgoingSelection.modelID}`
          : "default",
        has_image: images.length > 0 ? "1" : "0",
        image_count: images.length > 0 ? String(images.length) : "0",
        length_chars: text.length,
      });
    } catch (err) {
      const failedBeforeAIStarted = isCurrentSendAttempt() && waitingFirstAIMsg.current;
      if (isCurrentSendAttempt()) {
        waitingFirstAIMsg.current = false;
        setAwaitingAssistant(false);
        sendStartedAtRef.current = null;
      }
      if (failedBeforeAIStarted) restoreSubmittedComposer();
      await recordError(err, { source: "chat.send", sessionID });
      if (failedBeforeAIStarted) {
        haptic.error();
        Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (isCurrentSendAttempt()) setSending(false);
    }
  };

  // 中止当前正在生成的消息。服务端会通过 SSE 发一个最终的 message.updated
  // 带 time.completed,isSessionStreaming 派生会自动翻成 false —— 不需要
  // 任何乐观状态。
  const onStopSession = async () => {
    if (!active || !sessionID || stopping) return;
    const submittedSessionID = sessionID;
    const stopAttemptToken = ++stopAttemptTokenRef.current;
    const isCurrentStopAttempt = () =>
      currentSessionIDRef.current === submittedSessionID &&
      stopAttemptTokenRef.current === stopAttemptToken;
    setStopping(true);
    haptic.warning();
    trackEvent(Ev.MessageAbortAttempt, { session_id: sessionID });
    try {
      await abortSession(toClientConfig(active, sessionDirectory), sessionID);
      trackEvent(Ev.SessionAbort, { session_id: sessionID });
    } catch (err) {
      await recordError(err, { source: "chat.stop", sessionID });
      if (isCurrentStopAttempt()) {
        haptic.error();
        Alert.alert(t("chat.stopFailed"), err instanceof Error ? err.message : String(err));
        // 请求失败才允许立刻重试；成功后的“停止中”要等 SSE 的最终状态确认。
        setStopping(false);
      }
    }
  };

  // InputBar 是与消息列表无关的高成本子树。用 latest-ref 保持事件 prop
  // 稳定，同时始终执行本次 render 的最新发送/停止逻辑。
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onStopSessionRef = useRef(onStopSession);
  onStopSessionRef.current = onStopSession;
  const handleSend = useCallback(() => {
    void onSendRef.current();
  }, []);
  const handleStopSession = useCallback(() => {
    void onStopSessionRef.current();
  }, []);

  // ── 显式跟随：仅当 stick.shouldFollow() === true 时才贴底 ──
  // 列表是正序的（最新消息在数组末尾、视觉底部）。
  // 末尾 entry 采用不可变更新，因此同一个 effect 同时覆盖新消息和 part/text 流式增长。
  const lastMessage = messages[messages.length - 1];
  const lastMessageId = lastMessage?.message.id ?? null;
  // 上箭头以当前视口最上方的可见消息作为锚点，只在 user 消息之间向前定位。
  // 回调与配置必须保持稳定，避免虚拟列表因函数身份变化重置 viewability 状态。
  const topVisibleMessageIdRef = useRef<string | null>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ChatMessageRow>[] }) => {
      let topToken: ViewToken<ChatMessageRow> | null = null;
      let endVisible = false;
      const endMessageID = latestRenderableMessageIDRef.current;
      for (const token of viewableItems) {
        if (!token.isViewable || token.index == null) continue;
        if (topToken?.index == null || token.index < topToken.index) topToken = token;
        if (endMessageID && token.item?.entry.message.id === endMessageID) endVisible = true;
      }
      listEndVisibleRef.current = endVisible;
      const id = topToken?.item?.entry.message.id;
      if (id) topVisibleMessageIdRef.current = id;
    },
  ).current;
  const previousNavigationPendingRef = useRef(false);
  const [previousNavigationPending, setPreviousNavigationPending] = useState(false);

  const jumpToPreviousUserMessage = useCallback(async () => {
    if (previousNavigationPendingRef.current) return;
    haptic.selection();
    const current = messagesRef.current;
    const anchorID =
      topVisibleMessageIdRef.current ?? current[current.length - 1]?.message.id ?? null;
    if (!anchorID) return;

    const navigateToID = (targetID: string) => {
      // 乐观推进锚点：连续点击时即便上一段动画尚未触发 viewability 回调，
      // 下一次也会继续向前，而不是重复定位同一条消息。
      topVisibleMessageIdRef.current = targetID;
      stick.jumpToMessageStart(() => {
        const latest = useMessagesStore.getState().bySession[sessionID] ?? messagesRef.current;
        const index = latest.findIndex((item) => item.message.id === targetID);
        return index >= 0 ? index : null;
      });
    };

    const localTargetID = findPreviousUserMessageID(current, anchorID);
    if (localTargetID) {
      navigateToID(localTargetID);
      return;
    }

    // 本地范围没有更早的 user 消息：等待（或复用）历史请求，必要时继续
    // 翻页，直到找到 user 消息或确认没有更多历史。每页 prepend 后都按 ID
    // 重新找锚点，避免新数据插到头部导致旧数字索引失效。
    if (!current.some((item) => item.message.id === anchorID) || !olderCursorRef.current) return;
    previousNavigationPendingRef.current = true;
    setPreviousNavigationPending(true);
    try {
      const visitedCursors = new Set<string>();
      while (olderCursorRef.current && !visitedCursors.has(olderCursorRef.current)) {
        visitedCursors.add(olderCursorRef.current);
        const result = await loadOlder();
        if (result.loaded <= 0) return;
        const latest = useMessagesStore.getState().bySession[sessionID] ?? [];
        const targetID = findPreviousUserMessageID(latest, anchorID);
        if (targetID) {
          navigateToID(targetID);
          return;
        }
      }
    } finally {
      previousNavigationPendingRef.current = false;
      setPreviousNavigationPending(false);
    }
  }, [loadOlder, sessionID, stick]);
  useEffect(() => {
    if (!lastMessageId) {
      lastTopMessageIdRef.current = null;
      return;
    }
    const prevId = lastTopMessageIdRef.current;
    const isNewMessage = prevId !== null && prevId !== lastMessageId;
    lastTopMessageIdRef.current = lastMessageId;

    if (isNewMessage && waitingFirstAIMsg.current) {
      if (lastMessage?.message.role === "assistant") {
        waitingFirstAIMsg.current = false;
        setAwaitingAssistant(false);
        haptic.success();
        const startedAt = sendStartedAtRef.current;
        if (startedAt !== null) {
          const elapsedMs = Date.now() - startedAt;
          sendStartedAtRef.current = null;
          trackEvent(Ev.ChatFirstToken, {
            session_id: sessionID ?? "",
            elapsed_ms: String(elapsedMs),
          });
        }
      }
    }

    if (stick.shouldFollow()) {
      // 未干预：跟随到最新
      stick.followIfAllowed();
    } else if (isNewMessage) {
      // 用户已 pinned + 来了一条全新消息（不是当前流式行的内部更新）
      // → 累计未读，UI 用徽章提示，不动视口
      setUnreadBelow((n) => n + 1);
    }
  }, [lastMessage, lastMessageId, sessionID, stick]);

  // 首次进入会话后必须主动滚到底部（正序列表默认在最顶部 = 最旧消息）。
  //
  // 难点：消息里的图片 / 代码块 / Markdown / Tool 折叠面板都是异步增高的，
  // 第一次 onContentSizeChange 触发时的 contentSize 只是占位高度，等异步
  // 内容渲染完高度还会增加。如果只 scrollToEnd 一次，最终视觉上会停在
  // 倒数第几条而不是最底部 —— 这就是"有些会话点进去不停留在最尾部"的根因。
  //
  // 解法：首批消息到达后隐藏列表，contentSize 变化时无动画校准。
  // 原生滚动距离已到底，且高度连续 120ms 稳定就立即淡入；
  // 600ms 是持续变化时的稳定等待上限，但不能越过“真实贴底”硬条件。
  // 这样用户第一眼看到的就是稳稳钉在底部的列表，无任何抖动。
  const initialAnchorDeadlineRef = useRef(0);
  const initialAnchorStartedAtRef = useRef(0);
  const lastContentSizeChangeAtRef = useRef(0);
  const initialContentHeightRef = useRef(0);
  const initialViewportHeightRef = useRef(0);
  const initialAnchorSessionRef = useRef<string | null>(null);
  const [listVisible, setListVisible] = useState(false);
  const [initialAnchorStalled, setInitialAnchorStalled] = useState(false);
  const listOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 进入 / 切换会话时先隐藏列表。此时不开始计时：慢网下
    // 首批消息可能 600ms 后才到，如果从页面 mount 起算，消息开始
    // layout 时定位窗已经过期，异步增高就会把最后一条推出屏幕。
    initialAnchorSessionRef.current = null;
    initialAnchorStartedAtRef.current = 0;
    initialAnchorDeadlineRef.current = 0;
    lastContentSizeChangeAtRef.current = 0;
    initialContentHeightRef.current = 0;
    initialViewportHeightRef.current = 0;
    setListVisible(false);
    setInitialAnchorStalled(false);
    listOpacity.setValue(0);
  }, [sessionID, listOpacity]);

  useEffect(() => {
    if (!sessionID || messages.length === 0) return;
    if (initialAnchorSessionRef.current === sessionID) return;

    // 定位窗从“当前会话首批消息真正到达”起算，而不是从
    // 页面 mount 起算。先写 ref，保证同一次 commit 后的稳定检查
    // 看到新的截止时间。
    initialAnchorSessionRef.current = sessionID;
    const now = Date.now();
    initialAnchorStartedAtRef.current = now;
    initialAnchorDeadlineRef.current = now + INITIAL_ANCHOR_MAX_WAIT_MS;
    // 等待真正的 onContentSizeChange，避免把“尚未 layout”误判为稳定。
    lastContentSizeChangeAtRef.current = 0;
    setListVisible(false);
    setInitialAnchorStalled(false);
    listOpacity.setValue(0);
  }, [sessionID, messages.length, listOpacity, isUserPinned]);

  const isInitialViewportAtBottom = useCallback(() => {
    // 短列表根本不可滚动，scrollToEnd 是 no-op，原生端可能永远
    // 不发 onScroll。内容已完全装进视口时本身就等价于贴底。
    return isInitialChatViewportAtBottom(
      isAtBottom(),
      initialContentHeightRef.current,
      initialViewportHeightRef.current,
    );
  }, [isAtBottom]);

  const retryInitialAnchor = useCallback(() => {
    const now = Date.now();
    initialAnchorStartedAtRef.current = now;
    initialAnchorDeadlineRef.current = now + INITIAL_ANCHOR_MAX_WAIT_MS;
    lastContentSizeChangeAtRef.current = 0;
    setInitialAnchorStalled(false);
    if (!isUserPinned()) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }, [isUserPinned]);

  // 列表淡入动画
  useEffect(() => {
    if (!listVisible) return;
    Animated.timing(listOpacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [listVisible, listOpacity]);

  // 守门员：定位窗结束 + 高度已稳定（连续一段时间无变化）才显示列表
  useEffect(() => {
    if (listVisible) return;
    if (initialAnchorStalled) return;
    if (messages.length === 0) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      // 长会话的 scrollToEnd 可能先落到虚拟化的估算末尾。在遮罩下
      // 持续无动画推进，直到原生 offset/contentSize 确认真实贴底。
      if (!isInitialViewportAtBottom() && !isUserPinned()) {
        listRef.current?.scrollToEnd({ animated: false });
      }
      if (
        shouldRevealInitialChatList(
          now,
          initialAnchorDeadlineRef.current,
          lastContentSizeChangeAtRef.current,
          isInitialViewportAtBottom(),
        )
      ) {
        // 最后再 anchor 一次，确保用户看到的第一帧就在底部
        if (!isUserPinned()) listRef.current?.scrollToEnd({ animated: false });
        // 给 RN 一帧时间应用 scrollToEnd，再淡入
        requestAnimationFrame(() => {
          if (!cancelled) setListVisible(true);
        });
        return;
      }
      if (hasInitialChatAnchorFailed(now, initialAnchorStartedAtRef.current)) {
        setInitialAnchorStalled(true);
        return;
      }
      // 还没满足条件，继续轮询
      setTimeout(tick, 60);
    };
    const t = setTimeout(tick, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    listVisible,
    initialAnchorStalled,
    messages.length,
    sessionID,
    isInitialViewportAtBottom,
    isUserPinned,
  ]);

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (messages.length === 0) return;
      initialContentHeightRef.current = height;
      lastContentSizeChangeAtRef.current = Date.now();
      if (!listVisible) {
        // 遮罩期内的校准对用户不可见，不需要动画。
        if (!isUserPinned()) listRef.current?.scrollToEnd({ animated: false });
        return;
      }

      // 列表已显示后禁止由 contentSize 反向驱动滚动。长会话滚动时
      // 虚拟列表会持续挂载/重测变高 item；若此处再调 animated
      // scrollToEnd，会形成 contentSizeChange → scroll → contentSizeChange 死循环。
      // 展示后的自动跟随只由新消息 / 末尾内容增长等数据变化驱动。
    },
    [listVisible, messages.length, isUserPinned],
  );

  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    initialViewportHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // 1) 先让铁律 hook 处理 pinned 状态机和"回到底部"按钮显隐
      stick.onScroll(e);

      // 2) 上拉加载更多：正序列表，offsetY < 300 表示靠近顶部（旧消息端）
      const { contentOffset } = e.nativeEvent;
      // 首屏遮罩期虚拟列表默认会先在 offset=0 挂载，这是程序布局，
      // 不是用户上拉。若此时触发分页，长会话会在定位期间不断 prepend
      // 旧消息，让真实底部继续移动。
      if (listVisible && contentOffset.y < 300 && olderCursor && !loadingMore && !loadMoreError) {
        void loadOlder();
      }
    },
    [stick, listVisible, olderCursor, loadingMore, loadMoreError, loadOlder],
  );

  // 派生：AI 是否正在流式输出。只读,从 messages store 实时算 —— 即使
  // ChatScreen 被 unmount 又 remount,这个判断依然准确(remount 时立刻从
  // store 读到 running 状态,输入框直接显示 stop 按钮)。
  const isStreaming = isSessionStreaming(messages);

  // abort 接口成功并不代表流已经结束。只有服务端经 SSE 标记完成后才撤掉
  // “停止中”，避免用户在过渡窗口重复发送 abort 请求。
  useEffect(() => {
    if (stopping && !isStreaming) setStopping(false);
  }, [stopping, isStreaming]);

  // 禁止并发：AI 还在生成时,用户不能发新消息,避免消息竞态和服务端排队
  // 不可控。点 send 必须先 stop。有文字或图片任一即可发送。
  const canSend =
    (!!input.trim() || images.length > 0) && !sending && !awaitingAssistant && !isStreaming;
  const keyboardBottomPadding =
    Platform.OS === "ios"
      ? kbHeight > 0
        ? kbHeight
        : insets.bottom
      : keyboardUp
        ? 0
        : insets.bottom;

  const handleCloseInfo = useCallback(() => setInfoVisible(false), []);
  const handleOpenAgentSheet = useCallback(() => {
    setAgentSheetVisible(true);
    trackEvent(Ev.AgentSheetOpen);
  }, []);
  const handleCloseAgentSheet = useCallback(() => setAgentSheetVisible(false), []);
  const handleOpenModelSheet = useCallback(() => {
    setModelSheetVisible(true);
    trackEvent(Ev.ModelSheetOpen);
  }, []);
  const handleCloseModelSheet = useCallback(() => setModelSheetVisible(false), []);
  const handleAgentSelect = useCallback(
    (name: string) => {
      if (!sessionID) return;
      setSelectedAgent(name);
      setSessionSelection(sessionID, { agent: name, model: selectedModel ?? undefined });
      setAgentSheetVisible(false);
      trackEvent(Ev.AgentSelect, {
        agent: name,
        changed: name !== selectedAgent ? "1" : "0",
      });
    },
    [sessionID, selectedAgent, selectedModel, setSelectedAgent, setSessionSelection],
  );
  const handleModelSelect = useCallback(
    (model: ModelSelection) => {
      if (!sessionID) return;
      initializedModelSessionIDRef.current = sessionID;
      setSelectedModel(model);
      setSessionSelection(sessionID, { agent: selectedAgent ?? undefined, model });
      // 主动确认即写入持久化 recent，供后续空会话选择默认模型。
      addRecent(model);
      setModelSheetVisible(false);
      trackEvent(Ev.ModelSelect, {
        provider_id: model.providerID,
        model_id: model.modelID,
        changed:
          selectedModel &&
          selectedModel.providerID === model.providerID &&
          selectedModel.modelID === model.modelID
            ? "0"
            : "1",
      });
    },
    [addRecent, selectedAgent, selectedModel, sessionID, setSelectedModel, setSessionSelection],
  );
  const handleOpenFiles = useCallback(() => {
    if (!sessionDirectory) return;
    router.push({
      pathname: "/file-browser",
      params: { directory: sessionDirectory },
    });
  }, [router, sessionDirectory]);
  const handleOpenWorkspaceDiff = useCallback(() => {
    if (!sessionDirectory) return;
    router.push({
      pathname: "/workspace-diff",
      params: { directory: sessionDirectory },
    });
  }, [router, sessionDirectory]);

  // VirtualizedList 只为当前渲染窗口调用 getItem；行对象按 entry + 相邻布局
  // 元数据缓存，普通 delta 不再扫描全部历史，未变化 cell 仍在 PureComponent 退出。
  const renderMessage = useCallback<ListRenderItem<ChatMessageRow>>(
    ({ item: row }) => {
      return (
        <View>
          {row.showTimeSeparator && row.created != null ? (
            <TimeSeparator ts={row.created} theme={theme} />
          ) : null}
          <MessageBubble
            theme={theme}
            styles={styles}
            item={row.entry}
            prevRole={row.prevRole}
            onLongPressItem={handleLongPressItem}
            copied={copiedMessageId === row.entry.message.id}
            isLastAssistant={row.isLastAssistant}
          />
        </View>
      );
    },
    [copiedMessageId, handleLongPressItem, styles, theme],
  );

  if (!active) return null;

  return (
    <SafeAreaView style={styles.safe} edges={embedded ? [] : ["top"]}>
      {/* ── 自定义顶部导航栏 ── */}
      <View
        style={[
          styles.header,
          {
            paddingLeft: theme.spacing.sm + insets.left,
            paddingRight: theme.spacing.sm + insets.right,
          },
        ]}
      >
        {embedded ? (
          <View style={styles.headerBack} />
        ) : (
          <TouchableOpacity
            style={styles.headerBack}
            onPress={() => router.back()}
            hitSlop={theme.hitSlop}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <Ionicons name="chevron-back" size={22} color={theme.colors.accent} />
          </TouchableOpacity>
        )}

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {sessionTitle}
          </Text>
          {/* SSE 连接状态指示灯：正常(open/idle)时隐藏 */}
          {connStatus === "connecting" || connStatus === "error" || connStatus === "fatal" ? (
            <ConnectionDot status={connStatus} theme={theme} />
          ) : null}
        </View>

        {/* 会话详情入口 */}
        <TouchableOpacity
          style={styles.headerBack}
          onPress={() => setInfoVisible(true)}
          hitSlop={theme.hitSlop}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t("chat.sessionInfo")}
        >
          <Ionicons name="information-circle-outline" size={22} color={theme.colors.accent} />
        </TouchableOpacity>
      </View>

      {/* iOS：普通 View + 手动键盘 frame 避让，继续过滤语音面板异常高度。
          Android：自管 height 避让与 manifest adjustResize 协同；keyboardDidHide
          无条件恢复原高度，绕开 RN KAV 在透明系统栏下留下非零 bottom 的问题。
          两端统一:键盘弹起时下方不补 home indicator/导航栏间距(键盘已盖住),
          收起时补 insets.bottom,避免输入框被底部安全区遮挡。
          iOS 还要把整体上推过滤后的键盘高度 kbHeight。 */}
      <ChatKeyboardAvoidingView style={[styles.flex, { paddingBottom: keyboardBottomPadding }]}>
        {/* 权限横幅 */}
        <PermissionBanner sessionID={sessionID ?? ""} />

        {/* 消息列表 + 回到底部按钮的容器 */}
        <View style={styles.flex}>
          <View style={styles.flex}>
            <Animated.View
              style={[styles.flex, { opacity: listOpacity }]}
              pointerEvents={listVisible ? "auto" : "none"}
            >
              <VirtualizedList<ChatMessageRow>
                ref={listRef}
                data={messages}
                getItem={getMessageRowAt}
                getItemCount={getMessageRowCount}
                keyExtractor={messageKeyExtractor}
                contentContainerStyle={styles.listContent}
                // 首页最多 30 条，初始全部参与测量。否则变高消息较多时，
                // scrollToEnd 可能只到达未渲染 item 的估算末尾。
                initialNumToRender={PAGE_SIZE}
                // 铁律 handlers：必须全部挂上，缺一不可。
                // - onTouchStart：手指刚按下就暂停跟随并终止原生滚动动画，不改变 pinned
                // - onTouchEnd：普通抬手恢复跟随资格；onTouchCancel：等待 Android 原生滚动接管
                // - onScrollBeginDrag：开始拖动锁
                // - onScrollEndDrag：手势结束（含 iOS 慢拖到底无惯性的情况）判定是否解锁
                // - onMomentumScrollEnd：仅用户拖动产生的惯性结束可判定是否解锁
                // - onScroll：更新距离底部 + 浮层按钮显隐，不解锁
                // - onScrollToIndexFailed：消息开头尚未测量时近似定位并做有界重试
                onTouchStart={stick.onTouchStart}
                onTouchEnd={stick.onTouchEnd}
                onTouchCancel={stick.onTouchCancel}
                onScrollBeginDrag={stick.onScrollBeginDrag}
                onScrollEndDrag={stick.onScrollEndDrag}
                onMomentumScrollEnd={stick.onMomentumScrollEnd}
                onScroll={onScroll}
                onScrollToIndexFailed={stick.onScrollToIndexFailed}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                onLayout={onListLayout}
                onContentSizeChange={onContentSizeChange}
                scrollEventThrottle={16}
                keyboardShouldPersistTaps="handled"
                // ★★ 锚定铁律 ★★
                // 正序列表，minIndexForVisible: 1 锚的是"用户当前可视的、且不是首项"的内容。
                // 当列表头部插入旧消息（loadOlder）或尾部增长（流式输出）时，
                // RN 会调整 contentOffset.y 让正在屏幕上的非头部内容保持原位。
                // 这是真正阻止"流式输出把视口往上挤"的关键。
                maintainVisibleContentPosition={CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION}
                // 顶部加载更多 spinner（正序：旧消息在顶部）
                ListHeaderComponent={
                  loadingMore ? (
                    <View style={styles.loadMoreRow}>
                      <ActivityIndicator size="small" color={theme.colors.textTertiary} />
                    </View>
                  ) : loadMoreError ? (
                    <TouchableOpacity
                      style={styles.loadMoreErrorRow}
                      onPress={() => void loadOlder()}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("chat.loadError")}. ${t("common.retry")}`}
                    >
                      <Ionicons name="warning-outline" size={17} color={theme.colors.destructive} />
                      <Text style={styles.loadMoreErrorText}>{t("common.retry")}</Text>
                    </TouchableOpacity>
                  ) : null
                }
                renderItem={renderMessage}
              />
            </Animated.View>

            {/* 首次请求和列表定位共用唯一透明遮罩。setMessages 会比
              setLoading(false) 早一次 render，如果分开渲染两个 spinner，
              慢网下会看到 loading 在两个不同中心点间跳动。列表本身在
              校准期保持 opacity=0，因此只会露出根层壁纸，不会暴露跳动。 */}
            {(loading && messages.length === 0) || (!listVisible && messages.length > 0) ? (
              <View
                style={styles.listInitOverlay}
                pointerEvents={initialAnchorStalled ? "auto" : "none"}
              >
                {initialAnchorStalled ? (
                  <View style={styles.loadErrorWrap}>
                    <Ionicons name="warning-outline" size={24} color={theme.colors.destructive} />
                    <Text style={[styles.emptyTitle, { color: theme.colors.destructive }]}>
                      {t("chat.loadError")}
                    </Text>
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={retryInitialAnchor}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.retry")}
                    >
                      <Text style={styles.retryBtnText}>{t("common.retry")}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ActivityIndicator size="small" color={theme.colors.textTertiary} />
                )}
              </View>
            ) : null}

            {!loading && messages.length === 0 ? (
              <View style={styles.emptyOverlay}>
                {loadError ? (
                  <View style={styles.loadErrorWrap}>
                    <Ionicons name="warning-outline" size={24} color={theme.colors.destructive} />
                    <Text style={[styles.emptyTitle, { color: theme.colors.destructive }]}>
                      {t("chat.loadError")}
                    </Text>
                    <Text style={styles.emptyDesc} numberOfLines={3}>
                      {loadError}
                    </Text>
                    <TouchableOpacity
                      style={styles.retryBtn}
                      onPress={() => {
                        trackEvent(Ev.ChatLoadFailRetry, {
                          error: (loadError ?? "").slice(0, 120),
                        });
                        void loadFirstPage();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t("common.retry")}
                    >
                      <Text style={styles.retryBtnText}>{t("common.retry")}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <EmptyState theme={theme} styles={styles} />
                )}
              </View>
            ) : null}

            {/* pinned 后的消息导航组：↑ 定位视口上方的上一条用户消息（必要时
              自动加载历史），↓ 恢复自动跟随。 */}
            <Animated.View
              style={[styles.messageNavWrap, { opacity: scrollBtnOpacity }]}
              pointerEvents={stick.showJumpToLatest ? "auto" : "none"}
            >
              <View style={styles.messageNavGroup}>
                {messages.some((item) => item.message.role === "user") || olderCursor ? (
                  <TouchableOpacity
                    style={styles.messageNavBtn}
                    onPress={() => void jumpToPreviousUserMessage()}
                    disabled={previousNavigationPending}
                    activeOpacity={0.75}
                    hitSlop={theme.hitSlop}
                    accessibilityRole="button"
                    accessibilityLabel={t("chat.jumpToPreviousUser")}
                  >
                    {previousNavigationPending ? (
                      <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : (
                      <Ionicons name="chevron-up" size={18} color={theme.colors.text} />
                    )}
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.messageNavBtn}
                  onPress={() => {
                    trackEvent(Ev.ScrollToLatestTap, {
                      unread_below: unreadBelow,
                    });
                    stick.jumpToLatest(isListEndVisible);
                  }}
                  activeOpacity={0.75}
                  hitSlop={theme.hitSlop}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.jumpToLatest")}
                >
                  <Ionicons name="chevron-down" size={18} color={theme.colors.text} />
                  {unreadBelow > 0 ? (
                    <View style={styles.unreadBadge} pointerEvents="none">
                      <Text style={styles.unreadBadgeText} numberOfLines={1}>
                        {unreadBelow > 99 ? "99+" : String(unreadBelow)}
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </View>

        {/* ── 底部区域：有 pending question 时替换 InputBar ── */}
        {hasPendingQuestion ? (
          <QuestionPrompt sessionID={sessionID ?? ""} />
        ) : (
          <InputBar
            theme={theme}
            styles={styles}
            input={input}
            setInput={handleInputChange}
            sending={sending}
            awaitingAssistant={awaitingAssistant}
            stopping={stopping}
            isStreaming={isStreaming}
            canSend={canSend}
            onSend={handleSend}
            onStop={handleStopSession}
            agents={agents}
            selectedAgent={selectedAgent}
            selectedModel={selectedModel}
            providers={providers}
            onOpenAgentSheet={handleOpenAgentSheet}
            onOpenModelSheet={handleOpenModelSheet}
            onOpenFiles={sessionDirectory ? handleOpenFiles : undefined}
            onOpenWorkspaceDiff={sessionDirectory ? handleOpenWorkspaceDiff : undefined}
            onCommandAutocompleteAnchorChange={handleCommandAutocompleteAnchorChange}
            images={images}
            onPickImage={handlePickImage}
            onTakePhoto={handleTakePhoto}
            onRemoveImage={handleRemoveImage}
          />
        )}

        {/* 输入 `/` 后出现的命令联想浮层。绝对定位避免改变虚拟列表高度；
            不使用 Modal/BottomSheet，保证键盘焦点与首击选择都留在输入流中。 */}
        {slashAutocompleteVisible ? (
          <View
            style={[
              styles.commandAutocompleteLayer,
              {
                bottom: keyboardBottomPadding + commandAutocompleteAnchor + theme.spacing.xs,
                paddingLeft: theme.spacing.md + insets.left,
                paddingRight: theme.spacing.md + insets.right,
              },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.commandAutocompleteWidth} pointerEvents="box-none">
              <CommandAutocomplete
                visible
                query={slashCommandQuery}
                onSelect={handleCommandSelect}
                directory={sessionDirectory}
              />
            </View>
          </View>
        ) : null}
      </ChatKeyboardAvoidingView>

      {session ? (
        <SessionInfoModal
          visible={infoVisible}
          session={session as import("@opencode-ai/sdk/v2").Session}
          onClose={handleCloseInfo}
        />
      ) : null}

      {/* Agent 选择 BottomSheet */}
      <AgentSheet
        visible={agentSheetVisible}
        agents={agents}
        selected={selectedAgent}
        onSelect={handleAgentSelect}
        onClose={handleCloseAgentSheet}
        theme={theme}
      />

      {/* Model 选择 BottomSheet */}
      <ModelSheet
        visible={modelSheetVisible}
        providers={providers}
        selected={selectedModel}
        onSelect={handleModelSelect}
        onClose={handleCloseModelSheet}
        theme={theme}
      />

      {/* Android 长按消息菜单（BottomSheet；iOS 走系统 ActionSheet 无需此处） */}
      {Platform.OS === "android" ? (
        <BottomSheet
          visible={menuSheetVisible}
          onClose={() => setMenuSheetVisible(false)}
          contentContainerStyle={styles.menuSheetContent}
          header={
            <View style={[styles.menuSheetHeader, { borderBottomColor: theme.colors.separator }]}>
              <Text style={[styles.menuSheetTitle, { color: theme.colors.text }]}>
                {t("chat.messageMenuTitle")}
              </Text>
            </View>
          }
        >
          {menuItem
            ? (() => {
                const { labels, actions } = buildMenuOptions(menuItem);
                return labels.map((label, idx) => (
                  <TouchableOpacity
                    key={label}
                    style={[styles.menuSheetRow, { borderBottomColor: theme.colors.separator }]}
                    onPress={() => {
                      setMenuSheetVisible(false);
                      const action = actions[idx];
                      if (action) void action();
                    }}
                    activeOpacity={0.6}
                  >
                    <Text style={[styles.menuSheetLabel, { color: theme.colors.text }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ));
              })()
            : null}
        </BottomSheet>
      ) : null}
    </SafeAreaView>
  );
}

// ── SSE 连接状态指示灯 ────────────────────────────────────

function ConnectionDot({
  status,
  theme,
}: {
  status: "connecting" | "error" | "fatal";
  theme: Theme;
}) {
  const { t } = useTranslation();
  const label =
    status === "connecting"
      ? t("sessions.statusConnecting")
      : status === "fatal"
        ? t("sessions.statusOffline")
        : t("sessions.statusError");
  const isConnecting = status === "connecting";
  const color = isConnecting ? theme.colors.warning : theme.colors.destructive;

  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}
      accessible
      accessibilityRole={isConnecting ? "progressbar" : "text"}
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      {isConnecting ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
      )}
      <Text style={{ fontSize: 12, color, fontWeight: "500" }}>{label}</Text>
    </View>
  );
}

// ── 消息气泡 ─────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  theme,
  styles,
  item,
  prevRole,
  onLongPressItem,
  copied,
  isLastAssistant,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  item: MessageWithParts;
  prevRole: Message["role"] | null;
  onLongPressItem: (item: MessageWithParts) => void;
  copied: boolean;
  isLastAssistant: boolean;
}) {
  const { t } = useTranslation();
  const isUser = item.message.role === "user";
  const time = item.message.time;
  const completed =
    time && typeof time === "object" && "completed" in time
      ? (time as { completed?: number }).completed
      : undefined;
  const isStreaming = !isUser && completed == null;
  const prevSameRole = prevRole === item.message.role;

  const parts = item.partOrder
    .map((id) => item.partsById[id])
    .filter((part): part is Part => Boolean(part));
  // 与“跳到底部”的末尾哨兵共用同一判定。新增 part 类型时只改一处，
  // 避免列表把某条消息视为可见、实际 PartView 却渲染为零高度。
  const visibleParts = parts.filter(isRenderableMessagePart);

  if (visibleParts.length === 0 && !isStreaming) return null;

  // 流式全文每个 delta 都增长；此时拼接完整 copyText 并把它作为原生
  // accessibilityLabel 会额外复制整段字符串。只做 O(parts) 可复制性判定，
  // 真正长按时由父级菜单按需提取；完成后仍保留完整无障碍文本。
  const copyText = isStreaming ? "" : getMessagePlainText(item);
  const hasCopyableContent = isStreaming
    ? visibleParts.some((part) => {
        if (part.type === "text" || part.type === "reasoning") return part.text.length > 0;
        if (part.type === "file") return Boolean(part.filename ?? part.mime);
        return false;
      })
    : Boolean(copyText);

  // 长按：交由父组件 ChatScreen 弹菜单（iOS ActionSheet / Android BottomSheet）
  const handleLongPress = () => {
    if (!hasCopyableContent) return;
    onLongPressItem(item);
  };

  if (isUser) {
    // 前一条是 AI 时多留间距（角色切换呼吸感）
    const prevIsAi = prevRole === "assistant";
    return (
      <TouchableOpacity
        style={[styles.bubbleRowUser, prevIsAi && { marginTop: theme.spacing.sm }]}
        onLongPress={handleLongPress}
        disabled={!hasCopyableContent}
        delayLongPress={300}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel={copyText}
        accessibilityHint={t("chat.messageMenuTitle")}
        accessibilityActions={[{ name: "activate", label: t("chat.messageMenuTitle") }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "activate") handleLongPress();
        }}
      >
        <View style={[styles.bubbleUser, prevSameRole && styles.bubbleUserGroupTop]}>
          {visibleParts.map((part) => (
            <PartView key={part.id} part={part} role="user" />
          ))}
        </View>
        {copied ? (
          <View style={styles.copyToast} pointerEvents="none">
            <Ionicons name="checkmark" size={12} color={theme.colors.success} />
            <Text style={styles.copyToastText}>{t("common.copied")}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }

  // 前一条是 user 时多留间距（角色切换呼吸感）
  const prevIsUser = prevRole === "user";
  return (
    <TouchableOpacity
      style={[styles.aiRow, prevIsUser && { marginTop: theme.spacing.sm }]}
      onLongPress={handleLongPress}
      disabled={!hasCopyableContent}
      delayLongPress={300}
      activeOpacity={0.92}
      testID={isLastAssistant ? "last-assistant-message" : undefined}
      // 流式期不把整条消息聚合成一个不断变大的无障碍元素，让内部 Markdown
      // Text 节点保持可读；完成后恢复按钮语义与完整复制菜单。
      accessible={!isStreaming}
      accessibilityRole="button"
      accessibilityLabel={isStreaming ? undefined : copyText}
      accessibilityHint={hasCopyableContent ? t("chat.messageMenuTitle") : undefined}
      accessibilityActions={
        hasCopyableContent ? [{ name: "activate", label: t("chat.messageMenuTitle") }] : undefined
      }
      onAccessibilityAction={
        hasCopyableContent
          ? (event) => {
              if (event.nativeEvent.actionName === "activate") handleLongPress();
            }
          : undefined
      }
    >
      {isStreaming && visibleParts.length === 0 ? (
        <View
          style={styles.streamingDots}
          testID={isLastAssistant ? "streaming-indicator" : undefined}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("chat.statusStreaming")}
          accessibilityLiveRegion="polite"
        >
          <View style={[styles.dot, styles.dot1]} />
          <View style={[styles.dot, styles.dot2]} />
          <View style={[styles.dot, styles.dot3]} />
        </View>
      ) : null}
      <View style={styles.partsWrap}>
        {visibleParts.map((part) => (
          <PartView key={part.id} part={part} role="assistant" />
        ))}
      </View>
      {copied ? (
        <View style={styles.copyToast} pointerEvents="none">
          <Ionicons name="checkmark" size={12} color={theme.colors.success} />
          <Text style={styles.copyToastText}>{t("common.copied")}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

// ── 输入栏 ────────────────────────────────────────────────

const InputBar = memo(function InputBar({
  theme,
  styles,
  input,
  setInput,
  sending,
  awaitingAssistant,
  stopping,
  isStreaming,
  canSend,
  onSend,
  onStop,
  agents,
  selectedAgent,
  selectedModel,
  providers,
  onOpenAgentSheet,
  onOpenModelSheet,
  onOpenFiles,
  onOpenWorkspaceDiff,
  onCommandAutocompleteAnchorChange,
  images,
  onPickImage,
  onTakePhoto,
  onRemoveImage,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  awaitingAssistant: boolean;
  stopping: boolean;
  isStreaming: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  agents: Agent[];
  selectedAgent: string | null;
  selectedModel: ModelSelection | null;
  providers: import("../api/client").ProviderInfo[];
  onOpenAgentSheet: () => void;
  onOpenModelSheet: () => void;
  onOpenFiles?: () => void;
  onOpenWorkspaceDiff?: () => void;
  onCommandAutocompleteAnchorChange: (bottom: number) => void;
  images: ImageAttachment[];
  onPickImage: () => void;
  onTakePhoto: () => void;
  onRemoveImage: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { spacing } = theme;
  const insets = useSafeAreaInsets();
  const inputBarHeightRef = useRef<number | null>(null);
  const inputBarInnerYRef = useRef<number | null>(null);
  const inputComposeYRef = useRef<number | null>(null);

  const reportCommandAutocompleteAnchor = useCallback(() => {
    const height = inputBarHeightRef.current;
    const innerY = inputBarInnerYRef.current;
    const composeY = inputComposeYRef.current;
    if (height === null || innerY === null || composeY === null) return;
    onCommandAutocompleteAnchorChange(Math.max(0, height - innerY - composeY));
  }, [onCommandAutocompleteAnchorChange]);

  const handleInputBarLayout = useCallback(
    (event: LayoutChangeEvent) => {
      inputBarHeightRef.current = event.nativeEvent.layout.height;
      reportCommandAutocompleteAnchor();
    },
    [reportCommandAutocompleteAnchor],
  );

  const handleInputBarInnerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      inputBarInnerYRef.current = event.nativeEvent.layout.y;
      reportCommandAutocompleteAnchor();
    },
    [reportCommandAutocompleteAnchor],
  );

  const handleInputComposeLayout = useCallback(
    (event: LayoutChangeEvent) => {
      inputComposeYRef.current = event.nativeEvent.layout.y;
      reportCommandAutocompleteAnchor();
    },
    [reportCommandAutocompleteAnchor],
  );

  const agentLabel = selectedAgent ?? agents[0]?.name ?? "Agent";

  const activeModelLogo = useMemo(() => {
    const fallback = (() => {
      for (const provider of providers) {
        const modelID = Object.keys(provider.models)[0];
        if (modelID) return { providerID: provider.id, modelID };
      }
      return null;
    })();
    const selection = selectedModel ?? fallback;
    if (!selection) return null;
    const provider = providers.find((item) => item.id === selection.providerID);
    if (!provider) return null;
    const model = provider.models[selection.modelID];
    return {
      modelID: selection.modelID,
      modelName: model?.name ?? selection.modelID,
      providerID: provider.id,
      providerName: provider.name,
    };
  }, [selectedModel, providers]);

  const modelLabel = useMemo(() => {
    // 默认值:已选模型 → 第一个有 model 的 provider 的首个 model。
    // providers[0].models 可能是空对象(服务端配置异常),要先判断非空再取 [0],
    // 否则 modelID 会是 undefined,后续 provider.models[undefined] 也是 undefined,
    // UI 上长期显示 "Model" 占位字样。
    const fallback = (() => {
      for (const p of providers) {
        const ids = Object.keys(p.models);
        if (ids.length > 0) return { providerID: p.id, modelID: ids[0] };
      }
      return null;
    })();
    const model = selectedModel ?? fallback;
    if (!model) return "Model";
    const provider = providers.find((p) => p.id === model.providerID);
    const name = provider?.models[model.modelID]?.name ?? model.modelID ?? "Model";
    if (!selectedModel?.variant) return name;
    const labelKey = THINKING_EFFORT_LABEL_KEYS[selectedModel.variant];
    const variantLabel = labelKey ? t(labelKey) : humanizeVariant(selectedModel.variant);
    return `${name} · ${variantLabel}`;
  }, [selectedModel, providers, t]);

  // 当前选中模型是否支持图片附件。
  // /config/providers 返回的能力在 capabilities.input.image（兜底 capabilities.attachment）。
  const modelSupportsImage = useMemo(() => {
    const fallback = (() => {
      for (const p of providers) {
        const ids = Object.keys(p.models);
        if (ids.length > 0) return { providerID: p.id, modelID: ids[0] };
      }
      return null;
    })();
    const model = selectedModel ?? fallback;
    if (!model) return false;
    const provider = providers.find((p) => p.id === model.providerID);
    const m = provider?.models[model.modelID];
    if (!m) return false;
    const cap = m.capabilities;
    if (cap?.input?.image !== undefined) return cap.input.image === true;
    return cap?.attachment === true;
  }, [selectedModel, providers]);

  return (
    <View
      style={[
        styles.inputBar,
        { paddingLeft: spacing.md + insets.left, paddingRight: spacing.md + insets.right },
      ]}
      onLayout={handleInputBarLayout}
    >
      <View style={styles.inputBarInner} onLayout={handleInputBarInnerLayout}>
        {/* Agent / Model 选择行 */}
        <View style={styles.inputMeta}>
          <TouchableOpacity
            style={[styles.metaPill, styles.metaAgentPill]}
            onPress={onOpenAgentSheet}
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityLabel={t("chat.selectAgent")}
          >
            <Ionicons name="person-outline" size={12} color={theme.colors.textSecondary} />
            <Text style={styles.metaPillText} numberOfLines={1}>
              {agentLabel}
            </Text>
            <Ionicons name="chevron-down" size={11} color={theme.colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.metaPill, styles.metaModelPill]}
            onPress={onOpenModelSheet}
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityLabel={t("chat.selectModel")}
          >
            {activeModelLogo ? (
              <ModelBrandIcon {...activeModelLogo} size={12} color={theme.colors.textSecondary} />
            ) : (
              <Ionicons name="cube-outline" size={12} color={theme.colors.textSecondary} />
            )}
            <Text style={styles.metaPillText} numberOfLines={1}>
              {modelLabel}
            </Text>
            <Ionicons name="chevron-down" size={11} color={theme.colors.textTertiary} />
          </TouchableOpacity>
          {onOpenFiles || onOpenWorkspaceDiff ? (
            <View style={styles.metaActions}>
              {onOpenFiles ? (
                <TouchableOpacity
                  style={styles.metaIconButton}
                  onPress={onOpenFiles}
                  activeOpacity={0.7}
                  hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.files")}
                >
                  <Ionicons name="folder-open-outline" size={16} color={theme.colors.accent} />
                </TouchableOpacity>
              ) : null}
              {onOpenWorkspaceDiff ? (
                <TouchableOpacity
                  style={styles.metaIconButton}
                  onPress={onOpenWorkspaceDiff}
                  activeOpacity={0.7}
                  hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel={t("workspaceDiff.title")}
                >
                  <Ionicons name="git-compare-outline" size={16} color={theme.colors.accent} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* 已选图片始终可见、可移除。切到不支持图片的模型时不能静默
            丢附件；用户可切回原模型，或主动删除后继续。 */}
        {images.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.imageStrip}
            contentContainerStyle={styles.imageStripContent}
          >
            {images.map((img) => (
              <View key={img.id} style={styles.imageThumbWrap}>
                <Image
                  source={{ uri: img.previewUri }}
                  style={styles.imageThumb}
                  resizeMode="cover"
                  accessible
                  accessibilityLabel={t("chat.attachImage")}
                />
                <TouchableOpacity
                  style={styles.imageRemoveBtn}
                  onPress={() => onRemoveImage(img.id)}
                  hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.removeImage")}
                >
                  <Ionicons name="close-circle" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {/* 输入框 + 发送/停止按钮一体 */}
        <View style={styles.inputCompose} onLayout={handleInputComposeLayout}>
          {/* 选图按钮:仅模型支持图片附件时显示。streaming/sending 时禁用。
              排在最左侧 —— 图片是更通用的附件入口,先看到。 */}
          {modelSupportsImage ? (
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={onPickImage}
              onLongPress={onTakePhoto}
              delayLongPress={400}
              disabled={sending || isStreaming}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t("chat.attachImage")}
              accessibilityRole="button"
            >
              <Ionicons
                name="image-outline"
                size={20}
                color={
                  sending || isStreaming ? theme.colors.textTertiary : theme.colors.textSecondary
                }
              />
            </TouchableOpacity>
          ) : null}
          <TextInput
            testID="chat-input"
            style={styles.inputField}
            value={input}
            onChangeText={setInput}
            placeholder={stopping ? t("chat.statusStopping") : t("chat.placeholder")}
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            // 流式期间仍可编辑下一条草稿；发送按钮保持禁用，避免并发请求。
            editable={!sending}
            accessibilityLabel={t("chat.placeholder")}
            accessibilityHint={isStreaming ? t("chat.statusStreaming") : undefined}
            returnKeyType="send"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => {
              if (canSend) onSend();
            }}
            keyboardAppearance={theme.isDark ? "dark" : "light"}
            cursorColor={theme.colors.accent}
            selectionColor={`${theme.colors.accent}44`}
          />
          <Pressable
            // 按钮形态优先级:stop 形态 (isStreaming) > send 形态 (canSend) > idle
            style={({ pressed }) => [
              styles.sendBtn,
              isStreaming ? styles.sendBtnStop : null,
              canSend ? styles.sendBtnActive : null,
              pressed ? styles.sendBtnPressed : null,
            ]}
            onPress={isStreaming ? onStop : canSend ? onSend : undefined}
            disabled={stopping || awaitingAssistant || (!isStreaming && !canSend && !sending)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            testID="send-btn"
            accessibilityLabel={isStreaming ? t("chat.btnStop") : t("chat.placeholder")}
            accessibilityRole="button"
            accessibilityState={{
              disabled: stopping || awaitingAssistant || (!isStreaming && !canSend && !sending),
              busy: sending || stopping || awaitingAssistant,
            }}
            accessibilityActions={
              isStreaming ? [{ name: "activate", label: t("chat.btnStop") }] : undefined
            }
            onAccessibilityAction={
              isStreaming
                ? (event) => {
                    if (event.nativeEvent.actionName === "activate" && !stopping) onStop();
                  }
                : undefined
            }
          >
            {stopping ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : isStreaming ? (
              <Ionicons name="stop" size={11} color="#fff" />
            ) : sending || awaitingAssistant ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Ionicons
                name="arrow-up"
                size={16}
                color={canSend ? "#fff" : theme.colors.textTertiary}
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
});

// ── Agent 选择 Sheet ──────────────────────────────────────

const AgentSheet = memo(function AgentSheet({
  visible,
  agents,
  selected,
  onSelect,
  onClose,
  theme,
}: {
  visible: boolean;
  agents: Agent[];
  selected: string | null;
  onSelect: (name: string) => void;
  onClose: () => void;
  theme: Theme;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      contentContainerStyle={{ gap: 0, paddingBottom: theme.spacing.sm }}
      header={
        <View
          style={{
            paddingHorizontal: 20,
            paddingBottom: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.separator,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.text }}>
            {t("chat.selectAgent")}
          </Text>
        </View>
      }
    >
      {agents.length === 0 ? (
        <Text
          style={{ color: theme.colors.textTertiary, textAlign: "center", paddingVertical: 24 }}
        >
          {t("chat.noAgents")}
        </Text>
      ) : (
        agents.map((agent) => (
          <TouchableOpacity
            key={agent.name}
            onPress={() => onSelect(agent.name)}
            activeOpacity={0.7}
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 6,
              paddingHorizontal: 4,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.separator,
              gap: 10,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: theme.colors.accentMuted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="person" size={16} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: theme.colors.text }}>
                {agent.name}
              </Text>
              {agent.description ? (
                <Text
                  style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {agent.description}
                </Text>
              ) : null}
            </View>
            {selected === agent.name ? (
              <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
            ) : null}
          </TouchableOpacity>
        ))
      )}
    </BottomSheet>
  );
});

// ── Model 选择 Sheet ──────────────────────────────────────

const ModelSheet = memo(function ModelSheet({
  visible,
  providers,
  selected,
  onSelect,
  onClose,
  theme,
}: {
  visible: boolean;
  providers: import("../api/client").ProviderInfo[];
  selected: ModelSelection | null;
  onSelect: (m: ModelSelection) => void;
  onClose: () => void;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [pendingModel, setPendingModel] = useState<ModelSelection | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const modelGroups = useMemo(
    () =>
      providers
        .map((provider) => ({
          provider,
          models: Object.entries(provider.models).filter(([modelID, model]) => {
            if (!normalizedQuery) return true;
            return [provider.name, provider.id, model.name, modelID].some((value) =>
              value?.toLocaleLowerCase().includes(normalizedQuery),
            );
          }),
        }))
        .filter(({ models }) => models.length > 0),
    [normalizedQuery, providers],
  );

  const close = useCallback(() => {
    setQuery("");
    setPendingModel(null);
    onClose();
  }, [onClose]);

  const pendingModelInfo = pendingModel
    ? providers.find((provider) => provider.id === pendingModel.providerID)?.models[
        pendingModel.modelID
      ]
    : undefined;
  const variantKeys = Object.keys(pendingModelInfo?.variants ?? {}).filter(
    (variant) => variant !== "default",
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      contentKey={
        pendingModel ? `variants:${pendingModel.providerID}/${pendingModel.modelID}` : "models"
      }
      contentContainerStyle={{ gap: 0, paddingBottom: theme.spacing.sm }}
      header={
        <View
          style={{
            paddingHorizontal: 20,
            paddingBottom: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.separator,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {pendingModel ? (
              <TouchableOpacity
                onPress={() => setPendingModel(null)}
                accessibilityRole="button"
                accessibilityLabel={t("common.back")}
                style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="chevron-back" size={20} color={theme.colors.text} />
              </TouchableOpacity>
            ) : null}
            <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: theme.colors.text }}>
              {pendingModel ? t("chat.thinkingEffort.title") : t("chat.selectModel")}
            </Text>
          </View>
          {!pendingModel ? (
            <View
              style={{
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: theme.colors.inputBackground,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.inputBorder,
              }}
            >
              <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("dev.search")}
                placeholderTextColor={theme.colors.textTertiary}
                accessibilityLabel={t("dev.search")}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={{ flex: 1, paddingVertical: 0, color: theme.colors.text, fontSize: 15 }}
              />
              {Platform.OS !== "ios" && query ? (
                <TouchableOpacity
                  onPress={() => setQuery("")}
                  accessibilityRole="button"
                  accessibilityLabel={t("dev.clear")}
                  style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }} numberOfLines={1}>
              {pendingModelInfo?.name ?? pendingModel.modelID}
            </Text>
          )}
        </View>
      }
    >
      {pendingModel ? (
        [undefined, ...variantKeys].map((variant) => {
          const isSelected =
            selected?.providerID === pendingModel.providerID &&
            selected?.modelID === pendingModel.modelID &&
            selected.variant === variant;
          const labelKey = variant ? THINKING_EFFORT_LABEL_KEYS[variant] : undefined;
          const label = !variant
            ? t("chat.thinkingEffort.default")
            : labelKey
              ? t(labelKey)
              : humanizeVariant(variant);
          return (
            <TouchableOpacity
              key={variant ?? "default"}
              onPress={() => {
                onSelect(variant ? { ...pendingModel, variant } : pendingModel);
                setPendingModel(null);
              }}
              activeOpacity={0.7}
              style={{
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 4,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.colors.separator,
              }}
            >
              <Text style={{ flex: 1, fontSize: 15, color: theme.colors.text }}>{label}</Text>
              {isSelected ? (
                <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
              ) : null}
            </TouchableOpacity>
          );
        })
      ) : modelGroups.length === 0 ? (
        <Text
          style={{ color: theme.colors.textTertiary, textAlign: "center", paddingVertical: 24 }}
        >
          {t("chat.noModels")}
        </Text>
      ) : (
        modelGroups.map(({ provider, models }) => (
          <View key={provider.id}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: theme.colors.textTertiary,
                textTransform: "uppercase",
                letterSpacing: 0.8,
                paddingTop: 8,
                paddingBottom: 5,
                paddingHorizontal: 4,
              }}
            >
              {provider.name}
            </Text>
            {models.map(([modelID, model]) => {
              const isSelected =
                selected?.providerID === provider.id && selected?.modelID === modelID;
              return (
                <TouchableOpacity
                  key={modelID}
                  onPress={() => {
                    setQuery("");
                    const next = { providerID: provider.id, modelID };
                    if (Object.keys(model.variants ?? {}).length > 0) {
                      setPendingModel(next);
                    } else {
                      onSelect(next);
                    }
                  }}
                  activeOpacity={0.7}
                  style={{
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 6,
                    paddingHorizontal: 4,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.separator,
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      backgroundColor: theme.colors.accentSubtle,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ModelBrandIcon
                      modelID={modelID}
                      modelName={model.name ?? modelID}
                      providerID={provider.id}
                      providerName={provider.name}
                      size={20}
                      color={theme.colors.text}
                    />
                  </View>
                  <Text style={{ flex: 1, fontSize: 15, color: theme.colors.text }}>
                    {model.name ?? modelID}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))
      )}
    </BottomSheet>
  );
});

// ── 空态 ─────────────────────────────────────────────────

function EmptyState({ theme, styles }: { theme: Theme; styles: ReturnType<typeof makeStyles> }) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIcon}>
        <Ionicons name="chatbubble-ellipses-outline" size={28} color={theme.colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>{t("chat.emptyTitle")}</Text>
      <Text style={styles.emptyDesc}>{t("chat.emptyDesc")}</Text>
    </View>
  );
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },

    // ── 自定义顶栏 ──────────────────────────────────────────
    header: {
      flexDirection: "row",
      alignItems: "center",
      height: 52,
      paddingHorizontal: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      backgroundColor: colors.headerBackground,
    },
    headerBack: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    headerCenter: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 1,
    },
    headerTitle: {
      ...typography.headline,
      color: colors.text,
    },
    headerSubtitle: {
      ...typography.monoSm,
      color: colors.textTertiary,
    },

    // ── 消息列表 ────────────────────────────────────────────
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      // Agent / Model 行已参与底部区域布局；这里只保留消息自身的呼吸区。
      // 初次进入和 jumpToLatest 都会落在同一个真实可视边界上。
      paddingBottom: spacing.lg,
      // 宽屏（iPad/横屏）下消息流限宽居中，避免长文一行拉满整屏
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
    },

    // 用户气泡
    bubbleRowUser: {
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingLeft: 56,
      marginBottom: 2,
    },
    bubbleUser: {
      backgroundColor: colors.bubbleOutgoing,
      borderRadius: radius.bubble,
      borderBottomRightRadius: 4,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 4,
      // 防止气泡因超长文本撑满宽度
      flexShrink: 1,
      maxWidth: "100%",
    },
    bubbleUserGroupTop: {
      borderTopRightRadius: 4,
    },

    // AI 回复
    aiRow: {
      paddingVertical: 2,
      gap: 2,
      position: "relative",
    },
    partsWrap: {},
    copyToast: {
      position: "absolute",
      top: spacing.xs,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    copyToastText: {
      ...typography.caption2,
      color: colors.success,
      fontWeight: "600",
    },

    // Android 长按菜单 BottomSheet
    menuSheetHeader: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    menuSheetTitle: {
      fontSize: typography.body.fontSize ?? 17,
      fontWeight: "600",
    },
    menuSheetRow: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      minHeight: 48,
      justifyContent: "center",
    },
    // 覆盖 BottomSheet 默认的 gap：行间分隔完全交给 menuSheetRow 的 borderBottom，
    // 否则默认 gap 会在每行之间撑开间距，导致首行「复制」贴顶、其余行被顶开的行高不一致。
    menuSheetContent: { gap: 0 },
    menuSheetLabel: {
      fontSize: typography.body.fontSize ?? 17,
    },

    // 流式打点
    streamingDots: {
      flexDirection: "row",
      gap: 5,
      paddingVertical: 4,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.textTertiary,
    },
    dot1: { opacity: 0.3 },
    dot2: { opacity: 0.6 },
    dot3: { opacity: 1 },

    // 加载更多
    loadMoreRow: {
      paddingVertical: spacing.lg,
      alignItems: "center",
    },
    loadMoreErrorRow: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      marginVertical: spacing.xs,
    },
    loadMoreErrorText: {
      ...typography.calloutEmphasized,
      color: colors.destructive,
    },

    // Agent / Model 行参与正常布局后，列表底部就是选择行上沿。
    // 导航按钮只需在列表内部再留一档间距，二者不会重叠。
    messageNavWrap: {
      position: "absolute",
      bottom: spacing.md,
      left: 0,
      right: 0,
      alignItems: "center",
      // 不拦截列表滚动事件，只在按钮本身响应点击
      pointerEvents: "box-none",
    },
    messageNavGroup: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    messageNavBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 1,
    },
    unreadBadge: {
      position: "absolute",
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.surfaceElevated,
    },
    unreadBadgeText: {
      color: "#fff",
      fontSize: 11,
      fontWeight: "600",
      lineHeight: 13,
    },

    // ── 空态 ────────────────────────────────────────────────
    emptyOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    // 列表初始定位完成前的透明占位遮罩。列表本身在校准期 opacity=0，
    // 因此这里可以露出根层壁纸，同时继续隐藏多次 scrollToEnd 校准。
    listInitOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    emptyBox: {
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.xxxl,
    },
    emptyIcon: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyTitle: {
      ...typography.headline,
      color: colors.text,
    },
    emptyDesc: {
      ...typography.subheadline,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
    },
    loadErrorWrap: {
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
    },
    retryBtn: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.accent,
      marginTop: spacing.xs,
    },
    retryBtnText: {
      ...typography.calloutEmphasized,
      color: colors.textInverse,
    },

    // ── 输入栏 ──────────────────────────────────────────────
    inputBar: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: Platform.OS === "ios" ? spacing.sm : spacing.md,
      // 外层不铺整块背景：Agent / Model 行只显示两个胶囊，
      // 其余区域透出会话页背景；输入框仍由 inputCompose 自己承载底色。
      backgroundColor: "transparent",
      // 宽屏下内部内容居中
      alignItems: "center",
    },
    // 输入栏内部限宽容器（与消息流同宽，宽屏居中）
    inputBarInner: {
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      position: "relative",
    },
    // Slash 联想覆盖在输入栏上方，不参与布局，避免候选出现/消失时改变
    // 虚拟列表高度。外层 box-none，只有候选面板本身接管触摸。
    commandAutocompleteLayer: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
      zIndex: 50,
      elevation: 20,
    },
    commandAutocompleteWidth: {
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
    },
    // Agent / Model 行参与正常布局，让消息列表的真实底边停在选择行上方。
    // 行本身无背景，除两个胶囊外仍透出会话页背景。
    inputMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    metaPill: {
      flexShrink: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    metaAgentPill: {
      maxWidth: 120,
    },
    metaModelPill: {
      flexShrink: 1,
    },
    metaPillText: {
      ...typography.caption1,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    metaActions: {
      flexDirection: "row",
      flexShrink: 0,
      gap: spacing.xs,
    },
    metaIconButton: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    // 输入框和发送按钮合为一个圆角容器
    inputCompose: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.inputBackground,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.inputBorder,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
      paddingTop: Platform.OS === "ios" ? 10 : 7,
      paddingBottom: Platform.OS === "ios" ? 10 : 7,
      minHeight: 44,
    },
    inputField: {
      ...typography.body,
      color: colors.text,
      flex: 1,
      padding: 0,
      margin: 0,
      // 与左侧选图按钮的间距
      marginLeft: spacing.xs,
      maxHeight: 120,
      // 让文字和按钮垂直对齐
      lineHeight: 22,
    },
    sendBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: spacing.xs,
      flexShrink: 0,
      // 始终底部对齐（多行输入时按钮固定在右下角）
      alignSelf: "flex-end",
      marginBottom: 0,
    },
    sendBtnActive: {
      backgroundColor: colors.accent,
    },
    sendBtnPressed: {
      opacity: 0.8,
    },
    // AI 正在生成时按钮变 destructive 红，单击立即停止。
    sendBtnStop: {
      backgroundColor: colors.destructive,
    },
    // 输入框左侧的选图按钮
    attachBtn: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
    },
    // 已选图片预览条
    imageStrip: {
      // 删除按钮 top:-6 超出缩略图上边缘，需留足空间避免被上方 metaRow 遮挡
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
      // ScrollView 默认 overflow:hidden 会裁掉 top:-6 的删除按钮
      overflow: "visible",
    },
    imageStripContent: {
      gap: spacing.xs,
      paddingRight: spacing.sm,
      // 让删除按钮的负偏移不被 contentContainer 裁掉
      overflow: "visible",
    },
    imageThumbWrap: {
      position: "relative",
      // 提升层级，避免删除按钮被上方 metaRow 的内容压住
      zIndex: 1,
    },
    imageThumb: {
      width: 60,
      height: 60,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    imageRemoveBtn: {
      position: "absolute",
      top: -6,
      right: -6,
      width: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
      // 给关闭图标加个深色描边底，避免浅色图片上看不清
      backgroundColor: "rgba(0,0,0,0.55)",
      borderRadius: 9,
      // 确保删除按钮在最上层
      zIndex: 10,
    },
  });
}
