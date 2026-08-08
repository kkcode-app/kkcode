/**
 * [INPUT]: 依赖 react-i18next 的 t 函数（由调用方注入，避免本工具直接耦合 i18n 实例）
 * [OUTPUT]: 对外提供 TIME_SEPARATOR_THRESHOLD_MS 常量、shouldShowTimeSeparator 判定、formatTimeSeparator 格式化
 * [POS]: utils/ 的时间格式化工具，被 src/components/ChatScreen 的消息列表分隔符逻辑消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 相邻两条消息时间间隔 ≥ 5 分钟时插入分隔符。
// 阈值参考 iMessage / 飞书：短间隔合并，长间隔切分。
export const TIME_SEPARATOR_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * 判断是否应在 prev 与 current 之间插入时间分隔符。
 *
 * 触发条件（满足任一）：
 *   1. prevCreated 缺失（列表首条）—— 始终显示，作为时间锚点
 *   2. 间隔 ≥ thresholdMs（默认 5 分钟）
 *   3. 跨日期（即使间隔只有 1 分钟，跨了 0 点也要显示，这是聊天 App 惯例）
 *
 * 注意：只看 created，不看 completed。流式输出期间 created 不变，
 * 不会触发分隔符新增/消失，避免抖动。
 */
export function shouldShowTimeSeparator(
  prevCreated: number | undefined,
  currentCreated: number,
  thresholdMs: number = TIME_SEPARATOR_THRESHOLD_MS,
): boolean {
  if (prevCreated == null) return true;
  if (currentCreated - prevCreated >= thresholdMs) return true;
  // 跨日期判定：用 toDateString() 比较年月日，忽略时分秒
  return new Date(prevCreated).toDateString() !== new Date(currentCreated).toDateString();
}

/**
 * 格式化时间分隔符文案。
 *
 * - 今天 → "14:23"
 * - 昨天 → "昨天 14:23"（"昨天"文案由调用方通过 t("chat.timeYesterday") 注入）
 * - 更早 → "7月3日 14:23"（用系统 locale 的 toLocaleDateString 短日期）
 *
 * 时间部分用 toLocaleTimeString 跟随系统 locale，与 SessionInfoModal 风格一致。
 */
export function formatTimeSeparator(ts: number, yesterdayLabel: string): string {
  const now = new Date();
  const date = new Date(ts);
  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const todayKey = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toDateString();

  if (date.toDateString() === todayKey) {
    return timeStr;
  }
  if (date.toDateString() === yesterdayKey) {
    return `${yesterdayLabel} ${timeStr}`;
  }
  // 更早：用系统 locale 短日期 + 时间
  const dateStr = date.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
  });
  return `${dateStr} ${timeStr}`;
}
