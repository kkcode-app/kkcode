/**
 * [INPUT]: 依赖 react-native 的 Platform/useWindowDimensions，依赖 theme/breakpoints 的 breakpoints
 * [OUTPUT]: 对外提供 useResponsive() hook，返回 splitView / isTablet / contentMaxWidth 等响应式判断
 * [POS]: hooks/ 的响应式布局单一来源，被 sessions 容器与各页面限宽逻辑消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Platform, useWindowDimensions } from "react-native";

import { breakpoints } from "../theme/breakpoints";

export type Responsive = {
  width: number;
  height: number;
  isLandscape: boolean;
  /** 是否为 iPad（iOS 专有判断） */
  isTablet: boolean;
  /** 是否启用 Split View 双栏（仅 iPad 且宽度达标） */
  splitView: boolean;
  /** 单栏内容限宽 */
  contentMaxWidth: number;
  /** 表单类内容限宽 */
  formMaxWidth: number;
  /** 双栏左侧列表宽度 */
  sidebarWidth: number;
  /** BottomSheet 宽屏限宽 */
  sheetMaxWidth: number;
  /** 宽屏（宽度 >= twoColumn），用于限宽兜底，不区分平台 */
  isWide: boolean;
};

/**
 * 响应式布局判断的唯一来源。
 * - splitView：只有 iPad（Platform.isPad）且宽度 >= twoColumn 才为 true，iPhone 永远 false。
 * - isWide：纯按宽度判断（含 Android 平板/横屏），用于限宽居中兜底。
 * 依赖 useWindowDimensions，旋转 / 分屏拖动会实时响应。
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isTablet = Platform.OS === "ios" && Platform.isPad === true;
  const isWide = width >= breakpoints.twoColumn;
  return {
    width,
    height,
    isLandscape,
    isTablet,
    splitView: isTablet && isWide,
    isWide,
    contentMaxWidth: breakpoints.contentMaxWidth,
    formMaxWidth: breakpoints.formMaxWidth,
    sidebarWidth: breakpoints.sidebarWidth,
    sheetMaxWidth: breakpoints.sheetMaxWidth,
  };
}
