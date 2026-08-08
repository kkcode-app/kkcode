/**
 * [INPUT]: 接收屏幕、键盘、安全区、Sheet 固定区与完整内容的实测高度
 * [OUTPUT]: 对外提供统一的 BottomSheet 最大高度、目标高度、body viewport 与溢出判定
 * [POS]: utils/ 的纯布局计算器，被 BottomSheet 和回归测试共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export const BOTTOM_SHEET_MAX_HEIGHT_RATIO = 0.9;
export const BOTTOM_SHEET_OVERFLOW_EPSILON = 1;

export type BottomSheetLayoutInput = {
  viewportHeight: number;
  keyboardHeight: number;
  safeAreaTop: number;
  topGap: number;
  chromeHeight: number;
  contentHeight: number;
  bottomPadding: number;
};

export type BottomSheetLayout = {
  maxSheetHeight: number;
  sheetHeight: number;
  bodyViewportHeight: number;
  isOverflowing: boolean;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateBottomSheetLayout(input: BottomSheetLayoutInput): BottomSheetLayout {
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const keyboardHeight = finiteNonNegative(input.keyboardHeight);
  const safeAreaTop = finiteNonNegative(input.safeAreaTop);
  const topGap = finiteNonNegative(input.topGap);
  const chromeHeight = finiteNonNegative(input.chromeHeight);
  const contentHeight = finiteNonNegative(input.contentHeight);
  const bottomPadding = finiteNonNegative(input.bottomPadding);

  const maxSheetHeight = Math.max(
    0,
    Math.min(
      viewportHeight * BOTTOM_SHEET_MAX_HEIGHT_RATIO,
      viewportHeight - keyboardHeight - safeAreaTop - topGap,
    ),
  );
  const bodyViewportHeight = Math.max(
    0,
    Math.min(contentHeight, maxSheetHeight - chromeHeight - bottomPadding),
  );
  const sheetHeight = Math.min(maxSheetHeight, chromeHeight + bodyViewportHeight + bottomPadding);

  return {
    maxSheetHeight,
    sheetHeight,
    bodyViewportHeight,
    isOverflowing: contentHeight - bodyViewportHeight > BOTTOM_SHEET_OVERFLOW_EPSILON,
  };
}
