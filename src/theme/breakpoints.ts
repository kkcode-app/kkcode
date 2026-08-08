/**
 * [INPUT]: 无外部依赖，纯常量定义
 * [OUTPUT]: 对外提供 breakpoints 响应式断点 token
 * [POS]: theme/ 的响应式尺寸维度，被 hooks/useResponsive 与各页面限宽逻辑消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 响应式断点 — iPad / 大屏适配
// 依据：iPad mini 竖屏 768pt，iPad 横屏 1024/1133/1366pt。
// twoColumn=900 让 iPad 竖屏走单栏（更舒展），横握才进双栏。
export const breakpoints = {
  /** ≥ 此宽度（且为 iPad）启用 Split View 双栏 */
  twoColumn: 900,
  /** 单栏内容最大宽度，超出后两侧留白居中 */
  contentMaxWidth: 720,
  /** 表单类页面更窄的内容宽度（输入更聚焦） */
  formMaxWidth: 560,
  /** 双栏时左侧会话列表固定宽度 */
  sidebarWidth: 340,
  /** 宽屏下 BottomSheet 限宽 */
  sheetMaxWidth: 480,
} as const;
