/**
 * [INPUT]: 依赖 src/store/messages 的 useMessagesStore
 * [OUTPUT]: 提供 messagesDeltaSuite，测试 appendDeltas 尾项/非尾项提交与跨 session 引用稳定性
 * [POS]: test 的 messages delta 批量操作单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import { useMessagesStore, type MessageDelta } from "../src/store/messages.ts";

const m = (id: string, sid: string, role: "user" | "assistant" = "assistant") =>
  ({ id, sessionID: sid, role, time: { created: 1 } }) as never;

const p = (id: string, sid: string, mid: string, text: string) =>
  ({
    id,
    sessionID: sid,
    messageID: mid,
    type: "text",
    text,
  }) as never;

export async function messagesDeltaSuite() {
  console.log("\n─── messages delta (batch) ───");

  await test("appendDeltas with empty array is a no-op", () => {
    useMessagesStore.getState().reset();
    const before = useMessagesStore.getState().bySession;
    useMessagesStore.getState().appendDeltas([]);
    assert.strictEqual(useMessagesStore.getState().bySession, before);
  });

  await test("appendDeltas applies multiple deltas in one batch", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", ""));

    const deltas: MessageDelta[] = [
      { sessionID: sid, messageID: "M1", partID: "P1", delta: "Hello" },
      { sessionID: sid, messageID: "M1", partID: "P1", delta: " " },
      { sessionID: sid, messageID: "M1", partID: "P1", delta: "world" },
    ];
    useMessagesStore.getState().appendDeltas(deltas);

    const part = useMessagesStore.getState().bySession[sid][0].partsById["P1"];
    assert.equal((part as { text: string }).text, "Hello world");
  });

  await test("appendDeltas applies to different parts in same message", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", ""));
    useMessagesStore.getState().upsertPart(sid, p("P2", sid, "M1", ""));

    const deltas: MessageDelta[] = [
      { sessionID: sid, messageID: "M1", partID: "P1", delta: "part1" },
      { sessionID: sid, messageID: "M1", partID: "P2", delta: "part2" },
    ];
    useMessagesStore.getState().appendDeltas(deltas);

    const entry = useMessagesStore.getState().bySession[sid][0];
    assert.equal((entry.partsById["P1"] as { text: string }).text, "part1");
    assert.equal((entry.partsById["P2"] as { text: string }).text, "part2");
  });

  await test("appendDeltas falls back to a non-tail message", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "older"));
    useMessagesStore.getState().upsertMessage(sid, m("M2", sid));
    useMessagesStore.getState().upsertPart(sid, p("P2", sid, "M2", "tail"));

    useMessagesStore
      .getState()
      .appendDeltas([{ sessionID: sid, messageID: "M1", partID: "P1", delta: " updated" }]);

    const messages = useMessagesStore.getState().bySession[sid];
    assert.equal((messages[0].partsById["P1"] as { text: string }).text, "older updated");
    assert.equal((messages[1].partsById["P2"] as { text: string }).text, "tail");
  });

  await test("appendDeltas applies to different sessions in one batch", () => {
    useMessagesStore.getState().reset();
    useMessagesStore.getState().upsertMessage("S1", m("M1", "S1"));
    useMessagesStore.getState().upsertPart("S1", p("P1", "S1", "M1", ""));
    useMessagesStore.getState().upsertMessage("S2", m("M2", "S2"));
    useMessagesStore.getState().upsertPart("S2", p("P2", "S2", "M2", ""));

    const deltas: MessageDelta[] = [
      { sessionID: "S1", messageID: "M1", partID: "P1", delta: "alpha" },
      { sessionID: "S2", messageID: "M2", partID: "P2", delta: "beta" },
    ];
    useMessagesStore.getState().appendDeltas(deltas);

    assert.equal(
      (useMessagesStore.getState().bySession["S1"][0].partsById["P1"] as { text: string }).text,
      "alpha",
    );
    assert.equal(
      (useMessagesStore.getState().bySession["S2"][0].partsById["P2"] as { text: string }).text,
      "beta",
    );
  });

  await test("appendDeltas keeps unrelated session array referentially stable", () => {
    useMessagesStore.getState().reset();
    // Set up two sessions with messages
    useMessagesStore.getState().upsertMessage("S1", m("M1", "S1"));
    useMessagesStore.getState().upsertPart("S1", p("P1", "S1", "M1", "existing"));
    useMessagesStore.getState().upsertMessage("S2", m("M2", "S2"));
    useMessagesStore.getState().upsertPart("S2", p("P2", "S2", "M2", "untouched"));

    // Capture S2's reference before applying delta to S1
    const s2Before = useMessagesStore.getState().bySession["S2"];

    useMessagesStore
      .getState()
      .appendDeltas([{ sessionID: "S1", messageID: "M1", partID: "P1", delta: " +delta" }]);

    // S2 must not have been reallocated
    assert.strictEqual(
      useMessagesStore.getState().bySession["S2"],
      s2Before,
      "unrelated session array must be referentially stable",
    );
  });

  await test("appendDeltas with empty delta strings skips them", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "base"));

    const deltas: MessageDelta[] = [
      { sessionID: sid, messageID: "M1", partID: "P1", delta: "" },
      { sessionID: sid, messageID: "M1", partID: "P1", delta: "appended" },
    ];
    useMessagesStore.getState().appendDeltas(deltas);

    const part = useMessagesStore.getState().bySession[sid][0].partsById["P1"];
    assert.equal((part as { text: string }).text, "baseappended");
  });

  await test("appendDeltas to non-existent message is a no-op for that delta", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", ""));

    const deltas: MessageDelta[] = [
      { sessionID: sid, messageID: "M1", partID: "P1", delta: "real" },
      { sessionID: sid, messageID: "no-such-msg", partID: "Px", delta: "ghost" },
    ];
    useMessagesStore.getState().appendDeltas(deltas);

    assert.equal(
      (useMessagesStore.getState().bySession[sid][0].partsById["P1"] as { text: string }).text,
      "real",
    );
    // No ghost message should have been created
    assert.equal(useMessagesStore.getState().bySession[sid].length, 1);
  });

  await test("appendDeltas to non-existent session is a no-op", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "x"));

    const deltas: MessageDelta[] = [
      { sessionID: sid, messageID: "M1", partID: "P1", delta: " +y" },
      { sessionID: "S-other", messageID: "Mx", partID: "Px", delta: "z" },
    ];
    useMessagesStore.getState().appendDeltas(deltas);

    assert.equal(
      (useMessagesStore.getState().bySession[sid][0].partsById["P1"] as { text: string }).text,
      "x +y",
    );
    assert.equal(useMessagesStore.getState().bySession["S-other"], undefined);
  });

  await test("appendDeltas creates text stub when part doesn't exist yet", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));

    useMessagesStore
      .getState()
      .appendDeltas([{ sessionID: sid, messageID: "M1", partID: "P-early", delta: "early chunk" }]);

    const entry = useMessagesStore.getState().bySession[sid][0];
    const part = entry.partsById["P-early"] as { type: string; text: string };
    assert.equal(part.type, "text");
    assert.equal(part.text, "early chunk");
    assert.ok(entry.partOrder.includes("P-early"));
  });

  await test("appendDeltas ignores non-text/non-reasoning parts", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, {
      id: "P-tool",
      sessionID: sid,
      messageID: "M1",
      type: "tool",
      tool: "bash",
      state: "running",
    } as never);

    useMessagesStore
      .getState()
      .appendDeltas([
        { sessionID: sid, messageID: "M1", partID: "P-tool", delta: "should be ignored" },
      ]);

    const part = useMessagesStore.getState().bySession[sid][0].partsById["P-tool"] as {
      type: string;
      text?: string;
    };
    assert.equal(part.type, "tool");
    assert.equal(part.text, undefined);
  });

  await test("appendDeltas returns same state reference when nothing changed", () => {
    useMessagesStore.getState().reset();
    const before = useMessagesStore.getState().bySession;

    useMessagesStore
      .getState()
      .appendDeltas([{ sessionID: "S1", messageID: "M1", partID: "P1", delta: "" }]);

    assert.strictEqual(useMessagesStore.getState().bySession, before);
  });

  await test("appendDeltas handles reasoning part text accumulation", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, {
      id: "P-reasoning",
      sessionID: sid,
      messageID: "M1",
      type: "reasoning",
      text: "",
    } as never);

    useMessagesStore.getState().appendDeltas([
      { sessionID: sid, messageID: "M1", partID: "P-reasoning", delta: "Thinking" },
      { sessionID: sid, messageID: "M1", partID: "P-reasoning", delta: " step by step" },
    ]);

    const part = useMessagesStore.getState().bySession[sid][0].partsById["P-reasoning"] as {
      type: string;
      text: string;
    };
    assert.equal(part.type, "reasoning");
    assert.equal(part.text, "Thinking step by step");
  });
}
