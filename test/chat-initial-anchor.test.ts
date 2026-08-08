/**
 * [INPUT]: 依赖 src/utils/chat-initial-anchor 与 test/harness
 * [OUTPUT]: 提供 chatInitialAnchorSuite，覆盖首屏稳定提前展示、最长等待与故障兜底
 * [POS]: test 的聊天首屏定位回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";
import {
  hasInitialChatAnchorFailed,
  INITIAL_ANCHOR_FAILURE_MS,
  INITIAL_ANCHOR_MAX_WAIT_MS,
  INITIAL_ANCHOR_STABLE_MS,
  isInitialChatViewportAtBottom,
  shouldRevealInitialChatList,
} from "../src/utils/chat-initial-anchor";
import { test } from "./harness.ts";

export async function chatInitialAnchorSuite() {
  // eslint-disable-next-line no-console
  console.log("\n== chat initial anchor ==");

  await test("does not treat a missing contentSize callback as stable", () => {
    assert.equal(shouldRevealInitialChatList(500, INITIAL_ANCHOR_MAX_WAIT_MS, 0, false), false);
  });

  await test("reveals as soon as contentSize stays stable for 120ms", () => {
    const changedAt = 40;
    assert.equal(
      shouldRevealInitialChatList(
        changedAt + INITIAL_ANCHOR_STABLE_MS,
        INITIAL_ANCHOR_MAX_WAIT_MS,
        changedAt,
        true,
      ),
      true,
    );
  });

  await test("a new contentSize change restarts the stability wait", () => {
    const changedAt = 500;
    assert.equal(
      shouldRevealInitialChatList(590, INITIAL_ANCHOR_MAX_WAIT_MS, changedAt, true),
      false,
    );
  });

  await test("600ms deadline reveals even while layout keeps changing", () => {
    assert.equal(
      shouldRevealInitialChatList(
        INITIAL_ANCHOR_MAX_WAIT_MS,
        INITIAL_ANCHOR_MAX_WAIT_MS,
        INITIAL_ANCHOR_MAX_WAIT_MS - 10,
        true,
      ),
      true,
    );
  });

  await test("deadline cannot reveal before native scroll reaches the bottom", () => {
    assert.equal(
      shouldRevealInitialChatList(
        INITIAL_ANCHOR_MAX_WAIT_MS,
        INITIAL_ANCHOR_MAX_WAIT_MS,
        INITIAL_ANCHOR_MAX_WAIT_MS - 10,
        false,
      ),
      false,
    );
  });

  await test("turns an unrecoverable initial anchor into a retryable failure", () => {
    const startedAt = 1_000;
    assert.equal(
      hasInitialChatAnchorFailed(startedAt + INITIAL_ANCHOR_FAILURE_MS - 1, startedAt),
      false,
    );
    assert.equal(
      hasInitialChatAnchorFailed(startedAt + INITIAL_ANCHOR_FAILURE_MS, startedAt),
      true,
    );
    assert.equal(hasInitialChatAnchorFailed(99_000, 0), false);
  });

  await test("a non-scrollable short list counts as already at bottom", () => {
    assert.equal(isInitialChatViewportAtBottom(false, 300, 700), true);
  });

  await test("missing viewport layout cannot masquerade as a short list", () => {
    assert.equal(isInitialChatViewportAtBottom(false, 0, 0), false);
  });

  await test("a long list still requires native bottom confirmation", () => {
    assert.equal(isInitialChatViewportAtBottom(false, 1200, 700), false);
    assert.equal(isInitialChatViewportAtBottom(true, 1200, 700), true);
  });
}
