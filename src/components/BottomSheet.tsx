/**
 * [INPUT]: 依赖手势/动画、键盘与安全区事件、useResponsive 视口以及 bottom-sheet-layout 高度计算器
 * [OUTPUT]: 对外提供按内容精确自适应、超过统一上限才滚动的 BottomSheet 组件
 * [POS]: components/ 的项目级 Sheet 唯一容器，被选择器、详情、菜单和设置弹层复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// BottomSheet — 共享的底部弹窗容器
//
// 用 react-native-gesture-handler + reanimated 实现：手势与动画全部跑在
// UI 线程，和内部 ScrollView 通过 simultaneousWithExternalGesture 协同，
// 因此「任意位置下拉关闭」与「内容滚动」无缝共存；静态内容也可关闭滚动，无 JS 线程竞争，丝滑不卡。
//
// 交互规则（对齐 iOS 原生 sheet）：
//   · 内容在顶部时下拉 —— 直接带动 sheet 跟手下移，过阈值即关闭；
//   · 内容已滚动时下拉 —— 本次手势完全交给 ScrollView 滚动，
//     即使滚到顶也不会顺势带动 sheet；需要松手后再次下拉才拖 sheet；
//   · 背景遮罩透明度随拖拽实时联动；松手未过阈值平滑弹回。

import { useCallback, useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, type Theme } from "../theme";
import { useResponsive } from "../hooks/useResponsive";
import { calculateBottomSheetLayout } from "../utils/bottom-sheet-layout";

// 关闭阈值：拖动距离或速度任一达标即关闭
const CLOSE_DISTANCE = 90;
const CLOSE_VELOCITY = 550;
// 未测得高度前的兜底飞出距离
const FALLBACK_HEIGHT = 1000;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 固定在顶部（不随内容滚动）的区域，例如标题栏 */
  header?: React.ReactNode;
  /** 主体内容 */
  children: React.ReactNode;
  /** 主体语义切换时重挂 ScrollView，从顶部重新展示新内容 */
  contentKey?: React.Key;
  /** ScrollView contentContainerStyle 透传 */
  contentContainerStyle?: object;
}

export function BottomSheet({
  visible,
  onClose,
  header,
  children,
  contentKey,
  contentContainerStyle,
}: BottomSheetProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  // 宽屏（iPad/横屏）下 sheet 限宽居中，避免横跨整屏
  const { height: viewportHeight, isWide, sheetMaxWidth } = useResponsive();

  // 内部挂载状态：让退出动画播放完再卸载 Modal
  const [mounted, setMounted] = useState(visible);

  // Modal 不会稳定继承页面的可用高度，显式记录键盘高度用于计算 Sheet 上限；
  // Android 仍需把同一高度作为 paddingBottom 手动抬升，iOS 交给 KAV。
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const onShow = (e: { endCoordinates: { height: number } }) => {
      setKeyboardHeight(e.endCoordinates.height);
    };
    const onHide = () => setKeyboardHeight(0);
    const sub1 = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      onShow,
    );
    const sub2 = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      onHide,
    );
    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, []);

  const [chromeHeight, setChromeHeight] = useState<number | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const bottomPadding = Math.max(insets.bottom, theme.spacing.xxl);
  const layout = calculateBottomSheetLayout({
    viewportHeight,
    keyboardHeight,
    safeAreaTop: insets.top,
    topGap: theme.spacing.md,
    chromeHeight: chromeHeight ?? 0,
    contentHeight: contentHeight ?? 0,
    bottomPadding,
  });
  const hasMeasuredContent = chromeHeight !== null && contentHeight !== null;

  const translateY = useSharedValue(FALLBACK_HEIGHT);
  const sheetHeight = useSharedValue(FALLBACK_HEIGHT);
  const scrollOffset = useSharedValue(0);
  // 拖动 sheet 的起始基准：内容滚回顶部、开始拖 sheet 那一刻的 translationY。
  // null 表示尚未进入「拖 sheet」阶段。
  const dragAnchor = useSharedValue<number | null>(null);
  // 本次手势是否允许拖动 sheet：
  // 仅当手势开始时内容已在顶部，才允许在本次手势中拖动 sheet；
  // 否则本次手势完全交给 ScrollView，避免「内容滚到顶的瞬间 sheet 立刻被带动」。
  const canDragSheet = useSharedValue(false);

  const unmount = useCallback(() => setMounted(false), []);

  // 打开 / 关闭驱动
  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withSpring(0, { damping: 30, stiffness: 320, mass: 0.9 });
    } else if (mounted) {
      translateY.value = withTiming(sheetHeight.value, { duration: 220 }, (finished) => {
        if (finished) runOnJS(unmount)();
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollOffset.value = e.contentOffset.y;
  });

  // ScrollView 的原生手势，用于与拖拽手势同时识别
  const nativeGesture = Gesture.Native();

  const panGesture = Gesture.Pan()
    .simultaneousWithExternalGesture(nativeGesture)
    // 只在垂直方向位移超过 10px 时才激活 sheet 拖拽，
    // 横向滑动 / 失败距离不触发，让内部水平 ScrollView 优先处理。
    .activeOffsetY([-15, 15])
    .failOffsetX([-15, 15])
    .onBegin(() => {
      dragAnchor.value = null;
      // 手势起始时，内容必须已在顶部才允许拖 sheet；
      // 否则本次手势内即便内容滚到顶，也只让 ScrollView 接管，不带动 sheet。
      canDragSheet.value = scrollOffset.value <= 0;
    })
    .onUpdate((e) => {
      // 仅在「本次手势允许拖 sheet + 内容仍在顶部 + 继续向下拖」时才拖动 sheet。
      // 用首次满足条件那一刻的 translationY 作为基准，sheet 位移从 0 平滑开始，
      // 避免从滚动中途切换到拖 sheet 时位置跳变（误触发关闭）。
      if (canDragSheet.value && scrollOffset.value <= 0 && e.translationY > 0) {
        if (dragAnchor.value === null) dragAnchor.value = e.translationY;
        translateY.value = Math.max(0, e.translationY - dragAnchor.value);
      } else {
        // 回到滚动态：复位基准与 sheet 位移
        dragAnchor.value = null;
        if (translateY.value !== 0) translateY.value = 0;
      }
    })
    .onEnd((e) => {
      const dragged = dragAnchor.value !== null;
      const shouldClose =
        translateY.value > CLOSE_DISTANCE || (dragged && e.velocityY > CLOSE_VELOCITY);
      dragAnchor.value = null;
      canDragSheet.value = false;
      if (shouldClose) {
        translateY.value = withTiming(sheetHeight.value, { duration: 200 }, () =>
          runOnJS(onClose)(),
        );
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 320 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight.value], [1, 0], "clamp"),
  }));

  if (!mounted) return null;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.overlay}>
        {/* 背景遮罩：点击关闭，透明度随拖拽联动 */}
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <View
            style={styles.fill}
            onStartShouldSetResponder={() => true}
            onResponderRelease={onClose}
          />
        </Animated.View>

        {/* KAV 例外(Modal 内,iOS KAV padding 把 sheet 上推,Android KAV 无效用自管理 keyboardHeight):
            - iOS: behavior="padding"(配合下方 ScrollView 的 automaticallyAdjustKeyboardInsets)
            - Android: behavior=undefined(KAV 在 Modal 内无效,改用自管 keyboardHeight)
            见 AGENTS.md "Android 键盘适配" 例外表 */}
        <KeyboardAvoidingView
          style={[styles.kbWrap, Platform.OS === "android" && { paddingBottom: keyboardHeight }]}
          pointerEvents="box-none"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <GestureDetector gesture={panGesture}>
            <Animated.View
              style={[
                styles.sheet,
                {
                  maxHeight: layout.maxSheetHeight,
                  paddingBottom: bottomPadding,
                },
                hasMeasuredContent && { height: layout.sheetHeight },
                isWide && { maxWidth: sheetMaxWidth, alignSelf: "center", width: "100%" },
                sheetStyle,
              ]}
              onLayout={(e) => {
                // 记录真实高度，用于精确飞出
                sheetHeight.value = e.nativeEvent.layout.height;
              }}
            >
              <View
                onLayout={(e) => {
                  setChromeHeight(e.nativeEvent.layout.height);
                }}
              >
                {/* 拖拽把手 */}
                <View style={styles.handleArea}>
                  <View style={styles.handle} />
                </View>

                {header}
              </View>

              <GestureDetector gesture={nativeGesture}>
                <Animated.ScrollView
                  key={contentKey}
                  style={[
                    styles.scroll,
                    hasMeasuredContent && { height: layout.bodyViewportHeight },
                  ]}
                  contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
                  showsVerticalScrollIndicator={layout.isOverflowing}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  automaticallyAdjustKeyboardInsets={hasMeasuredContent && layout.isOverflowing}
                  scrollEnabled={hasMeasuredContent && layout.isOverflowing}
                  scrollEventThrottle={16}
                  onScroll={scrollHandler}
                  onContentSizeChange={(_width, height) => {
                    setContentHeight(height);
                  }}
                  // 禁止 overscroll（iOS rubber band / Android glow）：
                  // sheet 下拉时 pan 手势移动整个 sheet，同时 ScrollView 的
                  // overscroll 偏移也在叠加，导致内容比 header 多移一段距离，
                  // 视觉上间距越来越大。bottom sheet 的弹性感应由 sheet 自身
                  // 的 spring 动画提供，ScrollView 不需要 overscroll。
                  bounces={false}
                  overScrollMode="never"
                >
                  {children}
                </Animated.ScrollView>
              </GestureDetector>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius } = theme;

  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end" },
    kbWrap: { width: "100%", justifyContent: "flex-end" },
    fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.overlay,
    },

    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      shadowColor: colors.shadowElevated,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 1,
      shadowRadius: 20,
      elevation: 24,
    },

    handleArea: { alignItems: "center", paddingTop: spacing.sm, paddingBottom: spacing.xs },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.separator,
      alignSelf: "center",
      marginBottom: spacing.md,
    },

    scroll: { flexGrow: 0 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },
  });
}
