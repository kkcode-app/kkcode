// 间距、圆角、触摸区域 — 4pt 基础网格
// 所有数值均为 4 的整数倍，确保像素完美对齐

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 48,
} as const;

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999, // 药丸形/圆形
  // 语义化别名
  pill: 9999,
  card: 12,
  input: 12,
  bubble: 20,
} as const;

// 确保所有可点击元素至少 44×44pt 触摸区域（Apple HIG 要求）
export const hitSlop = {
  top: 8,
  bottom: 8,
  left: 8,
  right: 8,
} as const;
