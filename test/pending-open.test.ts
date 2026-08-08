/**
 * [INPUT]: 依赖 src/store/pending-open 的 usePendingOpenStore
 * [OUTPUT]: 提供 pendingOpenSuite，测试 iPad 双栏会话桥接 store
 * [POS]: test 的 pending-open store 单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import { usePendingOpenStore } from "../src/store/pending-open.ts";

function reset() {
  usePendingOpenStore.setState({ pendingSessionId: null });
}

export async function pendingOpenSuite() {
  console.log("\n─── pending-open store ───");

  await test("initial state has null pendingSessionId", () => {
    reset();
    assert.equal(usePendingOpenStore.getState().pendingSessionId, null);
  });

  await test("requestOpen sets pendingSessionId", () => {
    reset();
    usePendingOpenStore.getState().requestOpen("session-123");
    assert.equal(usePendingOpenStore.getState().pendingSessionId, "session-123");
  });

  await test("consume returns the pending id and clears it", () => {
    reset();
    usePendingOpenStore.getState().requestOpen("session-456");
    const id = usePendingOpenStore.getState().consume();
    assert.equal(id, "session-456");
    assert.equal(usePendingOpenStore.getState().pendingSessionId, null);
  });

  await test("consume when no pending returns null", () => {
    reset();
    const id = usePendingOpenStore.getState().consume();
    assert.equal(id, null);
  });

  await test("consume is idempotent — second consume returns null", () => {
    reset();
    usePendingOpenStore.getState().requestOpen("session-789");
    const first = usePendingOpenStore.getState().consume();
    const second = usePendingOpenStore.getState().consume();
    assert.equal(first, "session-789");
    assert.equal(second, null);
  });

  await test("requestOpen overwrites previous pending id", () => {
    reset();
    usePendingOpenStore.getState().requestOpen("first");
    usePendingOpenStore.getState().requestOpen("second");
    assert.equal(usePendingOpenStore.getState().pendingSessionId, "second");
    const id = usePendingOpenStore.getState().consume();
    assert.equal(id, "second");
  });

  await test("empty string id is a valid pending id (not null)", () => {
    reset();
    usePendingOpenStore.getState().requestOpen("");
    assert.equal(usePendingOpenStore.getState().pendingSessionId, "");
    const id = usePendingOpenStore.getState().consume();
    assert.equal(id, "");
    assert.equal(usePendingOpenStore.getState().pendingSessionId, null);
  });
}
