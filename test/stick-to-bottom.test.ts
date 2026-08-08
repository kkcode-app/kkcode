/**
 * [INPUT]: 依赖 hooks/useStickToBottom 与 react-test-renderer 的 hook 驱动能力
 * [OUTPUT]: 提供 stickToBottomSuite，覆盖稳定控制器引用、自动跟随、Android cancel 竞态、原生落点解锁与消息定位
 * [POS]: test/ 的聊天滚动主权回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { test } from "./harness.ts";
import {
  FOLLOW_THROTTLE_MS,
  JUMP_SETTLE_INITIAL_MS,
  JUMP_SETTLE_INTERVAL_MS,
  shouldShowJumpToLatest,
  useStickToBottom,
  type UseStickToBottom,
} from "../src/hooks/useStickToBottom.ts";

// React 19 要求非 Jest 测试器显式声明 act 环境。
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

export async function stickToBottomSuite() {
  // eslint-disable-next-line no-console
  console.log("\n─── stick to bottom ───");

  await test("jump button stays hidden while automatic follow settles", () => {
    if (shouldShowJumpToLatest(false, 48)) {
      throw new Error("automatic follow must not show the jump button for transient distance");
    }
  });

  await test("jump button appears only after a user scroll leaves the bottom", () => {
    if (shouldShowJumpToLatest(true, 24)) {
      throw new Error("bottom tolerance should keep the jump button hidden");
    }
    if (!shouldShowJumpToLatest(true, 25)) {
      throw new Error("a pinned user above the bottom needs a jump button");
    }
  });

  await test("controller identity stays stable across unrelated parent renders", async () => {
    const listRef = { current: { scrollToEnd: () => undefined } };
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness({ tick }: { tick: number }) {
      void tick;
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness, { tick: 0 }));
    });
    const first = stick;
    assert.ok(first);

    act(() => {
      renderer!.update(createElement(Harness, { tick: 1 }));
    });
    assert.equal(stick, first, "stream deltas must not churn FlatList handler references");

    act(() => renderer?.unmount());
  });

  await test("automatic follow is animated and trailing edge reaches the final chunk", async () => {
    const calls: { animated?: boolean }[] = [];
    const listRef = {
      current: {
        scrollToEnd: (options: { animated?: boolean }) => calls.push(options),
      },
    };
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness() {
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness));
    });
    assert.ok(stick);

    act(() => {
      stick!.followIfAllowed();
      stick!.followIfAllowed();
    });
    assert.equal(calls.length, 1, "burst updates should share the leading follow");
    assert.equal(calls[0]?.animated, true, "automatic follow should be smooth");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_THROTTLE_MS + 20));
    });
    assert.equal(calls.length, 2, "the throttled final update needs a trailing follow");
    assert.equal(calls[1]?.animated, true);

    act(() => renderer?.unmount());
  });

  await test("user touch stops active animation and cancels trailing follow", async () => {
    let calls = 0;
    const stoppedAt: { offset: number; animated?: boolean }[] = [];
    const listRef = {
      current: {
        scrollToEnd: () => {
          calls += 1;
        },
        scrollToOffset: (options: { offset: number; animated?: boolean }) => {
          stoppedAt.push(options);
        },
      },
    };
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness() {
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness));
    });
    act(() => {
      stick!.followIfAllowed();
      stick!.followIfAllowed();
      stick!.onScroll({
        nativeEvent: {
          contentOffset: { y: 320 },
          contentSize: { height: 1200 },
          layoutMeasurement: { height: 600 },
        },
      } as never);
      stick!.onTouchStart();
      stick!.onScrollBeginDrag();
    });

    assert.deepEqual(stoppedAt, [{ offset: 320, animated: false }]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_THROTTLE_MS + 20));
    });
    assert.equal(calls, 1, "user intervention must stop the scheduled follow");

    act(() => renderer?.unmount());
  });

  await test("Android touch cancel cannot resume follow before native drag locks", async () => {
    let calls = 0;
    const listRef = {
      current: {
        scrollToEnd: () => {
          calls += 1;
        },
      },
    };
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness() {
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness));
    });
    act(() => {
      stick!.onTouchStart();
      stick!.onTouchCancel();
      stick!.onScrollBeginDrag();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOLLOW_THROTTLE_MS + 20));
    });
    assert.equal(calls, 0, "native gesture takeover must not emit scrollToEnd");
    assert.equal(stick!.shouldFollow(), false, "native drag must retain user scroll sovereignty");

    act(() => renderer?.unmount());
  });

  await test("drag release uses its native snapshot and waits for user momentum", async () => {
    const listRef = { current: { scrollToOffset: () => undefined } };
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness() {
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness));
    });
    act(() => {
      stick!.onTouchStart();
      stick!.onScrollBeginDrag();
      stick!.onScrollEndDrag({
        nativeEvent: {
          contentOffset: { y: 590 },
          contentSize: { height: 1200 },
          layoutMeasurement: { height: 600 },
          velocity: { y: -1 },
        },
      } as never);
    });
    assert.equal(
      stick!.shouldFollow(),
      false,
      "release near bottom with momentum must stay pinned",
    );

    act(() => {
      stick!.onMomentumScrollEnd({
        nativeEvent: {
          contentOffset: { y: 300 },
          contentSize: { height: 1200 },
          layoutMeasurement: { height: 600 },
        },
      } as never);
    });
    assert.equal(stick!.shouldFollow(), false, "momentum landing above bottom must remain pinned");

    act(() => {
      stick!.onTouchStart();
      stick!.onScrollBeginDrag();
      stick!.onScrollEndDrag({
        nativeEvent: {
          contentOffset: { y: 600 },
          contentSize: { height: 1200 },
          layoutMeasurement: { height: 600 },
          velocity: { y: 0 },
        },
      } as never);
    });
    assert.equal(stick!.shouldFollow(), true, "a slow drag ending at bottom must unlock on iOS");

    act(() => renderer?.unmount());
  });

  await test("jump to latest converges after a variable-height list reveals a farther end", async () => {
    const calls: { animated?: boolean }[] = [];
    let endVisible = false;
    const listRef = {
      current: {
        scrollToEnd: (options: { animated?: boolean }) => calls.push(options),
      },
    };
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness() {
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness));
    });
    act(() => {
      stick!.onScroll({
        nativeEvent: {
          contentOffset: { y: 400 },
          contentSize: { height: 1800 },
          layoutMeasurement: { height: 600 },
        },
      } as never);
      stick!.onScrollBeginDrag();
      stick!.jumpToLatest(() => endVisible);
    });
    assert.deepEqual(calls, [{ animated: true }]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, JUMP_SETTLE_INITIAL_MS + 30));
    });
    assert.equal(calls[1]?.animated, false, "estimated end needs a non-animated correction");

    act(() => {
      stick!.onScroll({
        nativeEvent: {
          contentOffset: { y: 1200 },
          contentSize: { height: 1800 },
          layoutMeasurement: { height: 600 },
        },
      } as never);
      endVisible = true;
    });
    const settledCallCount = calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, JUMP_SETTLE_INTERVAL_MS * 3 + 40));
    });
    assert.equal(calls.length, settledCallCount, "stable native bottom should stop corrections");

    act(() => renderer?.unmount());
  });

  await test("message-start navigation pins and retries the latest resolved index", async () => {
    const indexCalls: {
      index: number;
      animated?: boolean;
      viewPosition?: number;
      viewOffset?: number;
    }[] = [];
    const offsetCalls: { offset: number; animated?: boolean }[] = [];
    const listRef = {
      current: {
        scrollToIndex: (options: (typeof indexCalls)[number]) => indexCalls.push(options),
        scrollToOffset: (options: (typeof offsetCalls)[number]) => offsetCalls.push(options),
      },
    };
    let targetIndex = 4;
    let stick: UseStickToBottom | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness() {
      stick = useStickToBottom(listRef as never);
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness));
    });
    assert.ok(stick);

    act(() => {
      stick!.jumpToMessageStart(() => targetIndex, 12);
    });
    assert.deepEqual(indexCalls, [{ index: 4, animated: true, viewPosition: 0, viewOffset: 12 }]);
    assert.equal(stick!.shouldFollow(), false, "message navigation must pause stream following");

    // 模拟定位期间上拉分页：旧消息插入头部后，目标的最新索引发生变化。
    targetIndex = 5;
    act(() => {
      stick!.onScrollToIndexFailed({
        index: 4,
        highestMeasuredFrameIndex: 1,
        averageItemLength: 100,
      });
    });
    assert.deepEqual(offsetCalls, [{ offset: 500, animated: false }]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    assert.deepEqual(indexCalls[1], {
      index: 5,
      animated: true,
      viewPosition: 0,
      viewOffset: 12,
    });

    act(() => renderer?.unmount());
  });
}
