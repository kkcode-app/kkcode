/**
 * [INPUT]: 依赖 React ref/effect 生命周期与 React Native 虚拟列表的 scrollToEnd/scrollToOffset/scrollToIndex 及原生滚动事件
 * [OUTPUT]: 对外提供引用稳定的 useStickToBottom 滚动状态机、UseStickToBottom 接口及滚动判定常量/纯函数
 * [POS]: hooks/ 的聊天滚动主权实现，被 OpenCode ChatScreen 与 CodexChatScreen 复用并由滚动回归测试覆盖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  铁律 (Scroll Sovereignty) — 不可破坏                              ║
 * ║                                                                   ║
 * ║  会话流式输出过程中，用户一旦做出"非贴底"的滚动动作，             ║
 * ║  视口就必须钉在用户当前位置，禁止任何代码把它拽走。               ║
 * ║                                                                   ║
 * ║  这是产品的核心竞争力，所有迭代都不得绕过此 hook 直接调用         ║
 * ║  listRef.scrollTo* 系列方法。                                     ║
 * ║                                                                   ║
 * ║  解锁路径：                                                       ║
 * ║    a) 用户手势滚动到底部 —— onScrollEndDrag 或 onMomentumScrollEnd ║
 * ║       任一回调触发时，落点在底部容差内即解锁。两个 handler 都判定， ║
 * ║       是因为 iOS 上慢速拖到底松手不会有惯性，只触发 onScrollEndDrag。║
 * ║    b) 用户主动调用 jumpToLatest()（点浮层按钮 / 点发送按钮）      ║
 * ║       立即解锁，并启动 JUMP_PROTECT_MS 保护窗，期间禁用所有"自动  ║
 * ║       重新上锁"的逻辑（避免 scrollToEnd 动画期间的 onScroll/手指   ║
 * ║       残留状态把刚解的锁又锁上）。                                ║
 * ║                                                                   ║
 * ║  本 hook 适配"正序"虚拟列表（最新消息在底部，data: 旧→新）。     ║
 * ║  inverted list + maintainVisibleContentPosition 在 Android 上     ║
 * ║  不可靠（RN 文档明确警告 data reorder 时会抖动），锚点恰是流式    ║
 * ║  生长那条会反向把上文挤跑——不要再用 inverted。                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

// 距底部 EPS 像素以内视为"贴底"。Android 浮点 + 边距，留 24px 容差。
const BOTTOM_EPS = 24;
// jumpToLatest 后保护时长。期间不允许任何回调把 pinned 锁回 true。
// 必须 ≥ scrollToEnd 动画时长（iOS 默认 ~250ms），保险给 600ms。
const JUMP_PROTECT_MS = 600;
// 自动跟随最多每 80ms 发起一次原生滚动；节流窗口末尾会补一次，避免
// 最后一个 chunk 恰好被节流后永久停在距底部几像素的位置。
export const FOLLOW_THROTTLE_MS = 80;
// 主动跳底先保留一次平滑动画，动画后再检查虚拟化列表是否
// 因变高 item 的新测量而产生了更远的真实末尾。
export const JUMP_SETTLE_INITIAL_MS = 300;
export const JUMP_SETTLE_INTERVAL_MS = 80;
const JUMP_SETTLE_MAX_CHECKS = 30;
const JUMP_SETTLE_REQUIRED_BOTTOM_CHECKS = 3;
const INDEX_RETRY_MS = 50;
const MAX_INDEX_RETRIES = 2;

type ScrollToIndexFailure = {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
};

export interface UseStickToBottom {
  shouldFollow: () => boolean;
  isUserPinned: () => boolean;
  /** 是否已收到可靠滚动数据且当前处于底部容差内 */
  isAtBottom: () => boolean;
  showJumpToLatest: boolean;
  /** 必须挂到虚拟列表的 onTouchStart：暂停跟随，等待确认是否为滚动 */
  onTouchStart: () => void;
  /** 必须挂到虚拟列表的 onTouchEnd：普通抬手后恢复跟随资格 */
  onTouchEnd: () => void;
  /** 必须挂到虚拟列表的 onTouchCancel：等待原生滚动接管，不得立即恢复跟随 */
  onTouchCancel: () => void;
  /** 必须挂到虚拟列表的 onScrollBeginDrag：确认用户滚动后上锁 */
  onScrollBeginDrag: () => void;
  /** 必须挂到虚拟列表的 onScrollEndDrag */
  onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** 必须挂到虚拟列表的 onMomentumScrollEnd */
  onMomentumScrollEnd: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** 必须挂到虚拟列表的 onScroll（仅做派生 UI，不解锁） */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** 用户主动滚到最新（点浮层按钮 / 点发送按钮） */
  jumpToLatest: (isListEndVisible?: () => boolean) => void;
  /** 用户主动定位到某条消息的开头，定位后维持 pinned */
  jumpToMessageStart: (resolveIndex: () => number | null, viewOffset?: number) => void;
  /** 必须挂到虚拟列表的 onScrollToIndexFailed，用于未测量目标的可取消重试 */
  onScrollToIndexFailed: (info: ScrollToIndexFailure) => void;
  /**
   * 自动跟随入口。仅当 !pinned 且未触摸列表时平滑 scrollToEnd。
   * 内部自带前沿节流与尾沿补偿，外部可以放心高频调用。
   */
  followIfAllowed: () => void;
}

type VirtualizedListHandle = {
  scrollToEnd: (params?: { animated?: boolean }) => void;
  scrollToIndex: (params: {
    animated?: boolean;
    index: number;
    viewOffset?: number;
    viewPosition?: number;
  }) => void;
  scrollToOffset: (params: { animated?: boolean; offset: number }) => void;
};

/**
 * 「↓」是用户主动离开底部后的恢复入口，不是自动跟随的进度指示器。
 * 流式内容增高和 scrollToEnd 的原生回调并非原子发生；此时即使短暂测得
 * 非零 distance，也不能打断用户正在看的底部内容并闪出按钮。
 */
export function shouldShowJumpToLatest(userPinned: boolean, distanceFromBottom: number): boolean {
  return userPinned && distanceFromBottom > BOTTOM_EPS;
}

export function useStickToBottom(
  listRef: RefObject<VirtualizedListHandle | null>,
): UseStickToBottom {
  // 用户是否已介入。pinned=true 后，任何代码都不得让视口跟随。
  const userPinnedRef = useRef(false);
  // 距底部的距离（contentSize.height - layoutMeasurement.height - contentOffset.y）。
  // 每次 onScroll 实时更新。0 表示完全贴底。只在用户已上锁时用于决定是否显示「↓」。
  const distanceFromBottomRef = useRef(0);
  // 最新可靠的原生 offset。手指落下时原地停一次无动画滚动，
  // 立即取消尚未结束的自动跟随动画，避免与用户拖动抢 offset。
  const currentOffsetRef = useRef(0);
  const hasCurrentOffsetRef = useRef(false);
  // followIfAllowed 节流戳 + 尾沿 timer：避免每个 store 更新都触发
  // scrollToEnd，同时保证节流窗口里的最后一次增长不会漏掉。
  const lastFollowAtRef = useRef(0);
  const trailingFollowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 按消息 ID 解析索引的定位任务。解析函数在重试时重新取索引，
  // 避免上拉分页在列表头部插入旧消息后跳到错误的行。
  const pendingIndexResolverRef = useRef<(() => number | null) | null>(null);
  const pendingIndexViewOffsetRef = useRef(0);
  const indexRetryCountRef = useRef(0);
  const indexRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // jumpToLatest 保护窗结束时间戳。期间 lock() 被静默忽略，
  // 防止保护期内的 onTouchStart / onScrollBeginDrag 把刚解的锁又锁上。
  const jumpProtectUntilRef = useRef(0);
  const jumpSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpSettleChecksRef = useRef(0);
  const jumpBottomChecksRef = useRef(0);
  const jumpEndVisibleResolverRef = useRef<(() => boolean) | null>(null);
  // 触摸本身不等于滚动：点代码块、图片或长按复制都不能永久关闭自动跟随。
  // touchActive 只在手指落下到抬起的极短窗口暂停自动滚动；真正进入拖动时才上锁。
  const touchActiveRef = useRef(false);
  // Android ScrollView 接管拖动时会 cancel JS touch。等待同一事件轮次的
  // onScrollBeginDrag 先上锁，避免 cancel 被误当成普通抬手后抢先回底。
  const touchCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActiveRef = useRef(false);
  // 只有用户拖动释放产生的惯性结束才能解锁；程序滚动的 momentum end 无权改写用户意图。
  const awaitingUserMomentumRef = useRef(false);

  const [showJumpToLatest, setShow] = useState(false);

  const inJumpProtect = () => Date.now() < jumpProtectUntilRef.current;

  const cancelTrailingFollow = useCallback(() => {
    if (trailingFollowTimerRef.current === null) return;
    clearTimeout(trailingFollowTimerRef.current);
    trailingFollowTimerRef.current = null;
  }, []);

  const cancelTouchCancelRelease = useCallback(() => {
    if (touchCancelTimerRef.current === null) return;
    clearTimeout(touchCancelTimerRef.current);
    touchCancelTimerRef.current = null;
  }, []);

  const cancelIndexNavigation = useCallback(() => {
    if (indexRetryTimerRef.current !== null) {
      clearTimeout(indexRetryTimerRef.current);
      indexRetryTimerRef.current = null;
    }
    pendingIndexResolverRef.current = null;
    indexRetryCountRef.current = 0;
  }, []);

  const cancelJumpSettle = useCallback(() => {
    if (jumpSettleTimerRef.current !== null) {
      clearTimeout(jumpSettleTimerRef.current);
      jumpSettleTimerRef.current = null;
    }
    jumpSettleChecksRef.current = 0;
    jumpBottomChecksRef.current = 0;
    jumpEndVisibleResolverRef.current = null;
  }, []);

  const scheduleJumpSettle = useCallback(
    (delay = JUMP_SETTLE_INTERVAL_MS) => {
      if (jumpSettleTimerRef.current !== null) clearTimeout(jumpSettleTimerRef.current);
      jumpSettleTimerRef.current = setTimeout(() => {
        jumpSettleTimerRef.current = null;
        if (touchActiveRef.current || userPinnedRef.current) {
          cancelJumpSettle();
          return;
        }

        jumpSettleChecksRef.current += 1;
        const nativeAtBottom =
          hasCurrentOffsetRef.current && distanceFromBottomRef.current <= BOTTOM_EPS;
        const endVisible = jumpEndVisibleResolverRef.current?.() ?? true;
        const atBottom = nativeAtBottom && endVisible;
        jumpBottomChecksRef.current = atBottom ? jumpBottomChecksRef.current + 1 : 0;

        if (jumpBottomChecksRef.current >= JUMP_SETTLE_REQUIRED_BOTTOM_CHECKS) {
          cancelIndexNavigation();
          cancelJumpSettle();
          return;
        }
        if (jumpSettleChecksRef.current >= JUMP_SETTLE_MAX_CHECKS) {
          cancelIndexNavigation();
          cancelJumpSettle();
          return;
        }

        // 只在确认尚未到底时做无动画收敛。已到底时继续观察两帧，
        // 防止虚拟列表随后重测变高 item，又把真实末尾向后推。
        if (!atBottom) listRef.current?.scrollToEnd({ animated: false });
        scheduleJumpSettle();
      }, delay);
    },
    [cancelIndexNavigation, cancelJumpSettle, listRef],
  );

  const performFollow = useCallback(() => {
    // timer 到点前用户可能已经开始触摸/滚动，执行时必须再次守门。
    if (userPinnedRef.current || touchActiveRef.current) return;
    lastFollowAtRef.current = Date.now();
    setShow(false);
    listRef.current?.scrollToEnd({ animated: true });
  }, [listRef]);

  const scheduleFollow = useCallback(() => {
    if (userPinnedRef.current || touchActiveRef.current) return;

    const elapsed = Date.now() - lastFollowAtRef.current;
    if (elapsed >= FOLLOW_THROTTLE_MS) {
      cancelTrailingFollow();
      performFollow();
      return;
    }

    // 前沿已滚过：只保留一个尾沿任务。持续流式时它会平滑追赶；流结束时
    // 它负责最后一次精确贴底，消除输入栏上方残留的半行遮挡。
    if (trailingFollowTimerRef.current !== null) return;
    trailingFollowTimerRef.current = setTimeout(() => {
      trailingFollowTimerRef.current = null;
      performFollow();
    }, FOLLOW_THROTTLE_MS - elapsed);
  }, [cancelTrailingFollow, performFollow]);

  useEffect(
    () => () => {
      cancelTrailingFollow();
      cancelTouchCancelRelease();
      cancelIndexNavigation();
      cancelJumpSettle();
    },
    [cancelIndexNavigation, cancelJumpSettle, cancelTouchCancelRelease, cancelTrailingFollow],
  );

  const lock = useCallback(() => {
    // 在保护窗期间禁止任何上锁。这是 iOS 上"点回到底部按钮后又被锁回"的根因修复。
    if (inJumpProtect()) return;
    cancelTrailingFollow();
    if (!userPinnedRef.current) userPinnedRef.current = true;
  }, [cancelTrailingFollow]);

  const unlockIfAtBottom = useCallback(() => {
    if (distanceFromBottomRef.current <= BOTTOM_EPS) {
      userPinnedRef.current = false;
      if (showJumpToLatest) setShow(false);
    }
  }, [showJumpToLatest]);

  // ── handlers ──

  const onTouchStart = useCallback(() => {
    cancelTouchCancelRelease();
    dragActiveRef.current = false;
    awaitingUserMomentumRef.current = false;
    touchActiveRef.current = true;
    // 这是用户真正触摸列表，不是点击列表外的“到底”按钮。
    // 立即取消未完成的跳底收敛和保护窗，把控制权还给手势。
    cancelJumpSettle();
    jumpProtectUntilRef.current = 0;
    cancelTrailingFollow();
    cancelIndexNavigation();
    if (hasCurrentOffsetRef.current) {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, currentOffsetRef.current),
        animated: false,
      });
    }
  }, [
    cancelIndexNavigation,
    cancelJumpSettle,
    cancelTouchCancelRelease,
    cancelTrailingFollow,
    listRef,
  ]);

  const onTouchEnd = useCallback(() => {
    cancelTouchCancelRelease();
    touchActiveRef.current = false;
    if (dragActiveRef.current) return;
    // 点按/长按会短暂暂停跟随。手指抬起时补一次，避免最后一个
    // chunk 恰好在触摸期间到达，之后没有新事件可以恢复贴底。
    scheduleFollow();
  }, [cancelTouchCancelRelease, scheduleFollow]);

  const onTouchCancel = useCallback(() => {
    cancelTrailingFollow();
    if (dragActiveRef.current) {
      touchActiveRef.current = false;
      return;
    }

    cancelTouchCancelRelease();
    touchCancelTimerRef.current = setTimeout(() => {
      touchCancelTimerRef.current = null;
      touchActiveRef.current = false;
      if (!dragActiveRef.current) scheduleFollow();
    }, 0);
  }, [cancelTouchCancelRelease, cancelTrailingFollow, scheduleFollow]);

  const onScrollBeginDrag = useCallback(() => {
    cancelTouchCancelRelease();
    dragActiveRef.current = true;
    awaitingUserMomentumRef.current = false;
    lock();
    // Android 已把触摸流交给原生 ScrollView，后续由 pinned 守门。
    touchActiveRef.current = false;
  }, [cancelTouchCancelRelease, lock]);

  const updateScrollMetrics = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const dist = contentSize.height - layoutMeasurement.height - contentOffset.y;
    currentOffsetRef.current = contentOffset.y;
    hasCurrentOffsetRef.current = true;
    distanceFromBottomRef.current = dist;
    return dist;
  }, []);

  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateScrollMetrics(e);
      dragActiveRef.current = false;
      touchActiveRef.current = false;
      const velocityY = Math.abs(e.nativeEvent.velocity?.y ?? 0);
      if (velocityY > 0.01) {
        awaitingUserMomentumRef.current = true;
        return;
      }
      awaitingUserMomentumRef.current = false;
      // iOS 上慢速拖到底松手没有惯性，不会触发 onMomentumScrollEnd，
      // 必须在这里也判定一次落点。
      unlockIfAtBottom();
    },
    [unlockIfAtBottom, updateScrollMetrics],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateScrollMetrics(e);
      // 自动跟随等程序滚动的结束事件不能解锁用户的新手势。
      if (!awaitingUserMomentumRef.current) return;
      awaitingUserMomentumRef.current = false;
      unlockIfAtBottom();
    },
    [unlockIfAtBottom, updateScrollMetrics],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const dist = updateScrollMetrics(e);

      // ⚠ 此处永不修改 userPinnedRef。锁/解锁的唯一权威路径是：
      //   - 锁：onScrollBeginDrag（onTouchStart 仅暂停跟随，避免点按误锁）
      //   - 解锁：onScrollEndDrag / onMomentumScrollEnd / jumpToLatest
      // 早期版本曾在 onScroll 里"touchActive && dist>EPS → 强制锁"做兜底，
      // 但程序滚动也会进 onScroll，这种隐式上锁会跟 jumpToLatest 互斥。

      const nextShow = shouldShowJumpToLatest(userPinnedRef.current, dist);
      if (nextShow !== showJumpToLatest) {
        setShow(nextShow);
      }
    },
    [showJumpToLatest, updateScrollMetrics],
  );

  const jumpToLatest = useCallback(
    (isListEndVisible?: () => boolean) => {
      // 立即解锁 + 启动保护窗。期间任何"自动重新上锁"路径都被屏蔽。
      cancelTrailingFollow();
      cancelIndexNavigation();
      awaitingUserMomentumRef.current = false;
      userPinnedRef.current = false;
      jumpProtectUntilRef.current = Date.now() + JUMP_PROTECT_MS;
      // 不能乐观地把 distance 置 0：长虚拟列表的第一次 scrollToEnd
      // 可能只落到估算末尾。保留原生上报值，由后续收敛任务验证。
      setShow(false);
      cancelJumpSettle();
      jumpEndVisibleResolverRef.current = isListEndVisible ?? null;
      listRef.current?.scrollToEnd({ animated: true });
      scheduleJumpSettle(JUMP_SETTLE_INITIAL_MS);
    },
    [cancelIndexNavigation, cancelJumpSettle, cancelTrailingFollow, listRef, scheduleJumpSettle],
  );

  const jumpToMessageStart = useCallback(
    (resolveIndex: () => number | null, viewOffset = 12) => {
      const index = resolveIndex();
      if (index === null || index < 0) return;

      cancelTrailingFollow();
      cancelIndexNavigation();
      awaitingUserMomentumRef.current = false;
      pendingIndexResolverRef.current = resolveIndex;
      pendingIndexViewOffsetRef.current = viewOffset;
      jumpProtectUntilRef.current = 0;
      userPinnedRef.current = true;
      setShow(true);
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0,
        viewOffset,
      });
    },
    [cancelIndexNavigation, cancelTrailingFollow, listRef],
  );

  const onScrollToIndexFailed = useCallback(
    (info: ScrollToIndexFailure) => {
      const resolveIndex = pendingIndexResolverRef.current;
      if (!resolveIndex || indexRetryCountRef.current >= MAX_INDEX_RETRIES) return;
      const index = resolveIndex();
      if (index === null || index < 0) {
        cancelIndexNavigation();
        return;
      }

      indexRetryCountRef.current += 1;
      listRef.current?.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * index),
        animated: false,
      });
      if (indexRetryTimerRef.current !== null) clearTimeout(indexRetryTimerRef.current);
      indexRetryTimerRef.current = setTimeout(() => {
        indexRetryTimerRef.current = null;
        const latestResolver = pendingIndexResolverRef.current;
        if (!latestResolver || touchActiveRef.current) return;
        const latestIndex = latestResolver();
        if (latestIndex === null || latestIndex < 0) {
          cancelIndexNavigation();
          return;
        }
        listRef.current?.scrollToIndex({
          index: latestIndex,
          animated: true,
          viewPosition: 0,
          viewOffset: pendingIndexViewOffsetRef.current,
        });
      }, INDEX_RETRY_MS);
    },
    [cancelIndexNavigation, listRef],
  );

  const followIfAllowed = useCallback(() => {
    // 唯一守门：用户没干预（pinned=false）就可以跟随。
    //
    // 不要再加 "distanceFromBottom > EPS 时拒绝" 的守门——这会在以下场景失效：
    //   1) 用户点 jumpToLatest，scrollToEnd 动画期间 dist 还没到 0
    //   2) 流式 chunk 在动画期间到达，触发 useEffect → followIfAllowed
    //   3) dist 守门拒绝
    //   4) 动画到底后，如果接下来一段时间内没有新 chunk（思考阶段），
    //      就再没人调 followIfAllowed 了 —— "无法开启自动跟随"的根因
    //
    // pinned 守门已经够了：
    //   - 用户介入会被锁住，followIfAllowed 拒绝；
    //   - 用户主动 jumpToLatest / 发送，pinned=false，期望跟随就跟随到底。
    if (userPinnedRef.current || touchActiveRef.current) return;

    // 前沿节流控制频率，尾沿补偿保证最后一个 chunk 最终也能贴底。
    scheduleFollow();
  }, [scheduleFollow]);

  // 只看 pinned。distanceFromBottom 不参与判定，避免动画期间 / 流式间隔
  // 这种瞬时 dist 偏大但用户期望跟随的场景被误判。
  const shouldFollow = useCallback(() => !userPinnedRef.current && !touchActiveRef.current, []);
  const isUserPinned = useCallback(() => userPinnedRef.current, []);
  const isAtBottom = useCallback(
    () => hasCurrentOffsetRef.current && distanceFromBottomRef.current <= BOTTOM_EPS,
    [],
  );

  // ChatScreen 会把这些 handler 直接交给虚拟列表，也会在多个 effect/callback
  // 中依赖整个控制器。稳定 facade 可避免每个 SSE delta 都让列表事件和外围
  // callback 换引用；只有按钮显隐或某个 handler 本身变化时才创建新对象。
  return useMemo(
    () => ({
      shouldFollow,
      isUserPinned,
      isAtBottom,
      showJumpToLatest,
      onTouchStart,
      onTouchEnd,
      onTouchCancel,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollEnd,
      onScroll,
      jumpToLatest,
      jumpToMessageStart,
      onScrollToIndexFailed,
      followIfAllowed,
    }),
    [
      followIfAllowed,
      isAtBottom,
      isUserPinned,
      jumpToLatest,
      jumpToMessageStart,
      onMomentumScrollEnd,
      onScroll,
      onScrollBeginDrag,
      onScrollEndDrag,
      onScrollToIndexFailed,
      onTouchCancel,
      onTouchEnd,
      onTouchStart,
      shouldFollow,
      showJumpToLatest,
    ],
  );
}
