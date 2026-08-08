/**
 * [INPUT]: 依赖 react-native 的 View/StyleSheet/ViewStyle，依赖 hooks/useResponsive
 * [OUTPUT]: 对外提供 ResponsiveContainer 组件，将子内容限宽并水平居中
 * [POS]: components/ 的布局工具，被 settings/servers/about 等单列页用于宽屏限宽兜底
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useResponsive } from "../hooks/useResponsive";

type Props = {
  children: ReactNode;
  /** 自定义最大宽度，默认取 contentMaxWidth */
  maxWidth?: number;
  /** 使用表单更窄的宽度（formMaxWidth） */
  form?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * 把子内容限制在最大宽度并水平居中。
 * 窄屏（手机）下 width:100% 等同无变化，宽屏下两侧自动留白。
 */
export function ResponsiveContainer({ children, maxWidth, form, style }: Props) {
  const { contentMaxWidth, formMaxWidth } = useResponsive();
  const max = maxWidth ?? (form ? formMaxWidth : contentMaxWidth);
  return (
    <View style={[{ width: "100%", maxWidth: max, alignSelf: "center" }, style]}>{children}</View>
  );
}
