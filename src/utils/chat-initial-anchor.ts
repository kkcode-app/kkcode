/**
 * [INPUT]: 接收当前时间、首屏定位起止时间、最近一次 contentSize 变化时间与原生贴底状态
 * [OUTPUT]: 对外提供聊天首屏贴底、稳定/超时/故障判定与相关常量
 * [POS]: utils/ 的聊天首屏定位纯函数，被 ChatScreen 与单元测试复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// contentSize 连续这段时间没变化，即可认为首屏布局已稳定。
export const INITIAL_ANCHOR_STABLE_MS = 120;
// 只是最长遮罩时间，不是最短等待时间。持续流式变化时也必须按时展示列表。
export const INITIAL_ANCHOR_MAX_WAIT_MS = 600;
// 真实贴底是展示前的硬条件，但原生滚动异常时不能永久显示 spinner。
// 超过此时间进入可重试故障态，仍不暴露尚未定位好的列表。
export const INITIAL_ANCHOR_FAILURE_MS = 5_000;
export const INITIAL_ANCHOR_BOTTOM_EPS = 24;

export function isInitialChatViewportAtBottom(
  nativeAtBottom: boolean,
  contentHeight: number,
  viewportHeight: number,
): boolean {
  if (nativeAtBottom) return true;
  // 不可滚动的短列表可能不产生 onScroll，但内容全部位于视口内
  // 本身就是贴底。viewport=0 表示尚未 layout，不能提前放行。
  return viewportHeight > 0 && contentHeight <= viewportHeight + INITIAL_ANCHOR_BOTTOM_EPS;
}

export function shouldRevealInitialChatList(
  now: number,
  deadlineAt: number,
  lastContentSizeChangeAt: number,
  atBottom: boolean,
): boolean {
  // 不能以“最后一条数据可见”为条件：会话可能以零高度的
  // step / metadata / 空 assistant 结尾，它们永远不会进入 viewability。
  if (!atBottom) return false;
  const deadlineReached = deadlineAt > 0 && now >= deadlineAt;
  // 必须真正收到过 contentSize 回调，不能把“还没开始 layout”
  // 误判为“已经稳定”。
  const stable =
    lastContentSizeChangeAt > 0 && now - lastContentSizeChangeAt >= INITIAL_ANCHOR_STABLE_MS;
  return stable || deadlineReached;
}

export function hasInitialChatAnchorFailed(now: number, startedAt: number): boolean {
  return startedAt > 0 && now - startedAt >= INITIAL_ANCHOR_FAILURE_MS;
}
