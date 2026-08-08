/**
 * [INPUT]: 依赖 react-native-reanimated 4 的 useSharedValue/useAnimatedStyle/withRepeat/withTiming，
 *          依赖 src/theme 的 useTheme（获取占位色）
 * [OUTPUT]: 对外提供 Skeleton 组件（矩形占位块，带 shimmer 动画）与 SkeletonList 组件（行级骨架列表）
 * [POS]: src/components 的加载占位基础组件，被 sessions/servers/select-directory 的 loading 态消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useTheme, type Theme } from "../theme";

type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * 通用矩形骨架占位块。带左右扫过的浅色高光（shimmer）动画。
 *
 * 用法：
 *   <Skeleton width={120} height={16} />
 *   <Skeleton width="100%" height={48} radius={12} />
 */
export function Skeleton({ width = "100%", height = 16, radius = 6, style }: SkeletonProps) {
  const theme = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + progress.value * 0.5,
    transform: [{ translateX: -100 + progress.value * 200 }],
  }));

  const baseColor = theme.colors.skeleton;
  const highlightColor = theme.colors.surfaceHover;

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: baseColor,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: highlightColor, opacity: 0.6 },
          animatedStyle,
        ]}
      />
    </View>
  );
}

type SkeletonRowProps = {
  /** 行数，默认 6 */
  count?: number;
  /** 单行高度，默认 64 */
  rowHeight?: number;
  /** 行间距，默认 12 */
  gap?: number;
  /** 是否包含头像圆块（左侧） */
  hasAvatar?: boolean;
};

/**
 * 列表骨架：渲染 N 行假行，每行包含一个头像圆块 + 两行文字条。
 * 替代 `<ActivityIndicator />` 的空白等待，提供更好的空间感知。
 */
export function SkeletonList({
  count = 6,
  rowHeight = 64,
  gap = 12,
  hasAvatar = true,
}: SkeletonRowProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const rows = Array.from({ length: count }, (_, i) => i);
  return (
    <View style={styles.wrap}>
      {rows.map((i) => (
        <View key={i} style={[styles.row, { height: rowHeight, marginBottom: gap }]}>
          {hasAvatar ? <Skeleton width={40} height={40} radius={20} /> : null}
          <View style={styles.lines}>
            <Skeleton width="65%" height={14} radius={4} />
            <Skeleton width="40%" height={11} radius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    wrap: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
    },
    lines: {
      flex: 1,
      gap: theme.spacing.sm,
    },
  });
}
