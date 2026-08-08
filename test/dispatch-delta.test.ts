/**
 * [INPUT]: 依赖 api/dispatch 的事件分发与 messages store，使用可控 requestAnimationFrame
 * [OUTPUT]: 提供 dispatchDeltaSuite，覆盖 32ms+rAF delta 合并、跨会话原子提交、完成时消息壳与 pending delta 原子合并、删除时 discard 与 text/reasoning 早到 delta 保留
 * [POS]: test/ 的 OpenCode 流式事件节流回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { test } from "./harness.ts";
import { useMessagesStore } from "../src/store/messages.ts";
import { DELTA_FLUSH_INTERVAL_MS, dispatchEvent } from "../src/api/dispatch.ts";
import type { GlobalEvent } from "../src/api/sse-types.ts";

function makeEvent(type: string, properties: Record<string, unknown>): GlobalEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    payload: { type, properties },
  } as GlobalEvent;
}

// 在 Node 环境 requestAnimationFrame 不存在，dispatch 模块会 fallback 到
// setTimeout(cb, 16)。我们用 globalThis.requestAnimationFrame polyfill
// 来控制 flush 时机。
function installRafPolyfill() {
  const cbs: (() => void)[] = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    cbs.push(cb);
    return cbs.length;
  };
  return {
    flush: () => {
      const snapshot = [...cbs];
      cbs.length = 0;
      for (const cb of snapshot) cb();
    },
    pending: () => cbs.length,
    cleanup: () => {
      delete (globalThis as any).requestAnimationFrame;
    },
  };
}

async function flushRaf(raf: ReturnType<typeof installRafPolyfill>) {
  // 前一个测试或前一帧可能刚提交过；等待最小节流窗，让 timer 把本次
  // flush 安排进可控 rAF 队列后再执行。
  await new Promise((resolve) => setTimeout(resolve, DELTA_FLUSH_INTERVAL_MS + 10));
  raf.flush();
}

function resetMessages() {
  useMessagesStore.setState({ bySession: {} });
}

// Seed a message + part so appendDelta has something to append to.
// The store uses { message, partOrder, partsById } structure with text in `text` field.
function seedPart(sessionID: string, messageID: string, partID: string) {
  useMessagesStore.getState().upsertMessage(sessionID, {
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
  } as never);
  useMessagesStore.getState().upsertPart(sessionID, {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text: "",
  } as never);
}

// Seed a reasoning part — reasoning 与 text 的增量字段都叫 text，
// appendDelta 必须同时支持两种类型，否则思考过程流式 delta 被丢弃。
function seedReasoningPart(sessionID: string, messageID: string, partID: string) {
  useMessagesStore.getState().upsertMessage(sessionID, {
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
  } as never);
  useMessagesStore.getState().upsertPart(sessionID, {
    id: partID,
    sessionID,
    messageID,
    type: "reasoning",
    text: "",
  } as never);
}

export async function dispatchDeltaSuite() {
  console.log("\n─── dispatch delta throttling ───");

  await test("message.part.delta — batches multiple deltas per frame", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");

      // Dispatch 3 deltas before frame fires
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "Hello",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: " World",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "!",
        }),
      );

      // Before flush — the store should not have the delta yet (still "" from seed)
      const msgs = useMessagesStore.getState().bySession.s1;
      const entry = msgs?.find((m: any) => m.message.id === "m1");
      const partBefore = entry?.partsById?.["p1"] as any;
      if (partBefore?.text === "Hello World!") {
        throw new Error("delta should be batched, not immediately applied");
      }

      // Now flush the rAF callback
      await flushRaf(raf);

      // After flush — all deltas should be concatenated
      const msgs2 = useMessagesStore.getState().bySession.s1;
      const entry2 = msgs2?.find((m: any) => m.message.id === "m1");
      const part2 = entry2?.partsById?.["p1"] as any;
      if (part2?.text !== "Hello World!") {
        throw new Error("expected 'Hello World!', got: " + JSON.stringify(part2?.text));
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.delta — sustained stream respects the minimum commit interval", async () => {
    const raf = installRafPolyfill();
    const realNow = Date.now;
    let now = realNow() + 1000;
    Date.now = () => now;
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "A",
        }),
      );
      await flushRaf(raf);

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "B",
        }),
      );
      if (raf.pending() !== 0) {
        throw new Error("continuous delta must not schedule the next rAF immediately");
      }

      await new Promise((resolve) => setTimeout(resolve, DELTA_FLUSH_INTERVAL_MS + 10));
      if (raf.pending() !== 1) {
        throw new Error("trailing delta must schedule one rAF after the throttle window");
      }
      // 把 scheduler 的最终时间戳落回真实时钟，避免影响后续用例。
      now = realNow();
      raf.flush();

      const part = useMessagesStore.getState().bySession.s1?.[0].partsById.p1 as any;
      if (part?.text !== "AB") throw new Error("expected throttled text 'AB', got: " + part?.text);
    } finally {
      Date.now = realNow;
      raf.cleanup();
    }
  });

  await test("message.part.delta — different parts accumulate independently", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");
      seedPart("s1", "m1", "p2");

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "AA",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p2",
          delta: "BB",
        }),
      );

      await flushRaf(raf);

      const msgs = useMessagesStore.getState().bySession.s1;
      const entry = msgs?.find((m: any) => m.message.id === "m1");
      const p1 = entry?.partsById?.["p1"] as any;
      const p2 = entry?.partsById?.["p2"] as any;
      if (p1?.text !== "AA") throw new Error("p1 expected 'AA', got: " + p1?.text);
      if (p2?.text !== "BB") throw new Error("p2 expected 'BB', got: " + p2?.text);
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.delta — multiple sessions commit once per frame", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");
      seedPart("s2", "m2", "p2");

      let notifications = 0;
      const unsubscribe = useMessagesStore.subscribe(() => {
        notifications++;
      });
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "A",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s2",
          messageID: "m2",
          partID: "p2",
          delta: "B",
        }),
      );

      await flushRaf(raf);
      unsubscribe();

      if (notifications !== 1) {
        throw new Error(`expected one store update per frame, got ${notifications}`);
      }
      const s1 = useMessagesStore.getState().bySession.s1?.[0].partsById.p1 as any;
      const s2 = useMessagesStore.getState().bySession.s2?.[0].partsById.p2 as any;
      if (s1?.text !== "A" || s2?.text !== "B") {
        throw new Error("expected both session deltas to be committed");
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.delta — empty delta is ignored", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "",
        }),
      );

      await flushRaf(raf);

      const msgs = useMessagesStore.getState().bySession.s1;
      const entry = msgs?.find((m: any) => m.message.id === "m1");
      const part = entry?.partsById?.["p1"] as any;
      if (part?.text !== "")
        throw new Error("expected empty text unchanged, got: " + JSON.stringify(part?.text));
    } finally {
      raf.cleanup();
    }
  });

  await test("message.updated — atomically applies pending deltas with completion", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "final token",
        }),
      );
      dispatchEvent(
        makeEvent("message.updated", {
          sessionID: "s1",
          info: {
            id: "m1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1, completed: 2 },
          },
        }),
      );

      const entry = useMessagesStore.getState().bySession.s1?.[0];
      const part = entry?.partsById.p1 as any;
      if (part?.text !== "final token") {
        throw new Error("completion must not overtake its pending text delta");
      }
      if ((entry?.message.time as { completed?: number } | undefined)?.completed !== 2) {
        throw new Error("authoritative completion should still be applied");
      }

      await flushRaf(raf);
      const finalPart = useMessagesStore.getState().bySession.s1?.[0].partsById.p1 as any;
      if (finalPart?.text !== "final token")
        throw new Error("scheduled rAF must not duplicate text");
    } finally {
      raf.cleanup();
    }
  });

  await test("message.updated — atomically keeps delta that arrived before the message shell", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      let notifications = 0;
      const unsubscribe = useMessagesStore.subscribe(() => {
        notifications++;
      });

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "early final token",
        }),
      );
      dispatchEvent(
        makeEvent("message.updated", {
          sessionID: "s1",
          info: {
            id: "m1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1, completed: 2 },
          },
        }),
      );
      unsubscribe();

      const entry = useMessagesStore.getState().bySession.s1?.[0];
      const part = entry?.partsById.p1 as any;
      if (part?.text !== "early final token") {
        throw new Error("completion must retain a delta that arrived before message.updated");
      }
      if (notifications !== 1) {
        throw new Error(
          `message shell and pending delta must commit atomically, got ${notifications}`,
        );
      }

      await flushRaf(raf);
      const finalPart = useMessagesStore.getState().bySession.s1?.[0].partsById.p1 as any;
      if (finalPart?.text !== "early final token") {
        throw new Error("scheduled rAF must not duplicate or remove the early delta");
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.updated — flushes pending delta for that part first", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");

      // Enqueue a delta (not yet flushed)
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "streaming...",
        }),
      );

      // Now dispatch part.updated — this should flush delta first, then overwrite with authoritative part
      dispatchEvent(
        makeEvent("message.part.updated", {
          sessionID: "s1",
          part: { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "final content" },
        }),
      );

      // After authoritative update, text should be final
      const msgs = useMessagesStore.getState().bySession.s1;
      const entry = msgs?.find((m: any) => m.message.id === "m1");
      const part = entry?.partsById?.["p1"] as any;
      if (part?.text !== "final content") {
        throw new Error("expected 'final content', got: " + JSON.stringify(part?.text));
      }

      // rAF callback should be harmless (no pending delta for this part anymore)
      await flushRaf(raf);
      const msgs2 = useMessagesStore.getState().bySession.s1;
      const entry2 = msgs2?.find((m: any) => m.message.id === "m1");
      const part2 = entry2?.partsById?.["p1"] as any;
      if (part2?.text !== "final content") {
        throw new Error("after raf flush, text should still be 'final content'");
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.removed — discards pending delta using v2 event fields", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "must disappear",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.removed", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
        }),
      );

      if (useMessagesStore.getState().bySession.s1?.[0].partsById.p1 !== undefined) {
        throw new Error("removed part should disappear immediately");
      }
      await flushRaf(raf);
      if (useMessagesStore.getState().bySession.s1?.[0].partsById.p1 !== undefined) {
        throw new Error("queued delta must not resurrect a removed part");
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.removed — discards pending delta using v2 event fields", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedPart("s1", "m1", "p1");
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "must disappear",
        }),
      );
      dispatchEvent(
        makeEvent("message.removed", {
          sessionID: "s1",
          messageID: "m1",
        }),
      );

      if (useMessagesStore.getState().bySession.s1?.length !== 0) {
        throw new Error("removed message should disappear immediately");
      }
      await flushRaf(raf);
      if (useMessagesStore.getState().bySession.s1?.length !== 0) {
        throw new Error("queued delta must not resurrect a removed message");
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.delta — reasoning part accumulates delta (not dropped)", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      seedReasoningPart("s1", "m1", "p1");

      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "thinking...",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: " step 1",
        }),
      );

      await flushRaf(raf);

      const msgs = useMessagesStore.getState().bySession.s1;
      const entry = msgs?.find((m: any) => m.message.id === "m1");
      const part = entry?.partsById?.["p1"] as any;
      if (part?.type !== "reasoning") {
        throw new Error("expected type 'reasoning', got: " + part?.type);
      }
      if (part?.text !== "thinking... step 1") {
        throw new Error("expected 'thinking... step 1', got: " + JSON.stringify(part?.text));
      }
    } finally {
      raf.cleanup();
    }
  });

  await test("message.part.updated — keeps an early reasoning delta when type arrives later", async () => {
    const raf = installRafPolyfill();
    try {
      resetMessages();
      useMessagesStore.getState().upsertMessage("s1", {
        id: "m1",
        sessionID: "s1",
        role: "assistant",
        time: { created: Date.now() },
      } as never);
      dispatchEvent(
        makeEvent("message.part.delta", {
          sessionID: "s1",
          messageID: "m1",
          partID: "p1",
          delta: "early reasoning",
        }),
      );
      dispatchEvent(
        makeEvent("message.part.updated", {
          sessionID: "s1",
          part: {
            id: "p1",
            sessionID: "s1",
            messageID: "m1",
            type: "reasoning",
            text: "",
            time: { start: 1 },
          },
        }),
      );
      const part = useMessagesStore.getState().bySession.s1?.[0].partsById.p1 as any;
      if (part?.type !== "reasoning" || part?.text !== "early reasoning") {
        throw new Error("early reasoning delta was lost during part type reconciliation");
      }
      await flushRaf(raf);
    } finally {
      raf.cleanup();
    }
  });

  await test("dispatchEvent — session.created upserts into sessions store", () => {
    const { useSessionsStore } = require("../src/store/sessions.ts");
    useSessionsStore.setState({ sessions: [] });
    dispatchEvent(
      makeEvent("session.created", {
        info: { id: "sess1", directory: "/home", createdAt: Date.now() },
      }),
    );
    const sessions = useSessionsStore.getState().sessions;
    if (sessions.length !== 1) throw new Error("expected 1 session");
    if (sessions[0].id !== "sess1") throw new Error("wrong session id");
  });

  await test("dispatchEvent — session.deleted removes session", () => {
    const { useSessionsStore } = require("../src/store/sessions.ts");
    useSessionsStore.setState({ sessions: [{ id: "sess1", directory: "/x" }] });
    resetMessages();
    dispatchEvent(
      makeEvent("session.deleted", {
        info: { id: "sess1" },
      }),
    );
    const sessions = useSessionsStore.getState().sessions;
    if (sessions.length !== 0) throw new Error("expected 0 sessions after delete");
  });

  await test("dispatchEvent — unknown type is silently ignored", () => {
    // Should not throw
    dispatchEvent(makeEvent("unknown.future.event", { foo: "bar" }));
  });

  await test("dispatchEvent — missing type returns early", () => {
    // Should not throw
    dispatchEvent({ id: "x", payload: {} } as any);
    dispatchEvent({ id: "x" } as any);
  });
}
