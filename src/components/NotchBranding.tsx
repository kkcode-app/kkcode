/**
 * [INPUT]: 依赖 react-native-safe-area-context 的 useSafeAreaInsets，依赖 expo-constants 的 appName，依赖 expo-image 的 Image，依赖 react-native 的 Platform/StyleSheet/Text/View
 * [OUTPUT]: 对外提供 NotchBranding 组件（当前全局禁用，始终返回 null；原始实现为仅 iOS 渲染的 absolute overlay，在刘海/灵动岛区域显示 App Logo + 名称，Android 无灵动岛返回 null）
 * [POS]: components/ 的全局 overlay 组件，被 app/_layout.tsx 挂载在 Stack 之上；当前已临时关闭 UI 渲染，挂载点保留以便日后开关恢复
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import Constants from "expo-constants";
import { Image } from "expo-image";
import { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme";

// 全局开关：false 时组件恒返回 null，整个刘海品牌水印链路停用。
const NOTCH_BRANDING_ENABLED = false;

function NotchBrandingImpl() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const appName = Constants.expoConfig?.name ?? "KKCode";
  const safeTop = Math.max(insets.top, 0);

  const styles = useMemo(() => makeStyles(theme, safeTop), [theme, safeTop]);

  if (!NOTCH_BRANDING_ENABLED) {
    return null;
  }

  if (Platform.OS !== "ios") {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <Image
        source={require("../../assets/icon.png")}
        style={styles.logo}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
      <Text style={styles.name} numberOfLines={1}>
        {appName}
      </Text>
    </View>
  );
}

export const NotchBranding = memo(NotchBrandingImpl);

function makeStyles(theme: ReturnType<typeof useTheme>, safeTop: number) {
  const logoSize = 14;
  const containerHeight = Math.max(safeTop, 0);

  return StyleSheet.create({
    container: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: containerHeight,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      zIndex: 9999,
      elevation: 9999,
    },
    logo: {
      width: logoSize,
      height: logoSize,
      borderRadius: 3,
    },
    name: {
      ...theme.typography.caption2,
      color: theme.isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)",
      fontSize: 10,
      letterSpacing: 0.5,
    },
  });
}
