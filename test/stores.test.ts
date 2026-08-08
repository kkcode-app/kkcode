/**
 * [INPUT]: 依赖 src/store/messages、permissions、sessions 的 Zustand store 与 test/harness
 * [OUTPUT]: 对外提供 storesSuite，覆盖消息因果顺序、合并/流式更新及权限、会话 store 行为
 * [POS]: test 的 Zustand store 聚合回归套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";

import { useMessagesStore } from "../src/store/messages.ts";
import { usePermissionStore } from "../src/store/permissions.ts";
import { useSessionsStore } from "../src/store/sessions.ts";
import { test } from "./harness.ts";

const m = (id: string, sid: string, role: "user" | "assistant" = "assistant") =>
  ({ id, sessionID: sid, role, time: { created: 1 } }) as never;

const assistant = (id: string, sid: string, parentID: string) =>
  ({ ...m(id, sid), parentID }) as never;

const p = (id: string, sid: string, mid: string, text: string) =>
  ({
    id,
    sessionID: sid,
    messageID: mid,
    type: "text",
    text,
  }) as never;

export async function storesSuite() {
  console.log("\n== messages store ==");

  await test("upsertPart preserves insertion order", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "hi"));
    useMessagesStore.getState().upsertPart(sid, p("P2", sid, "M1", "ok"));
    const entry = useMessagesStore.getState().bySession[sid]![0];
    assert.deepEqual(entry.partOrder, ["P1", "P2"]);
  });

  await test("upsertPart on existing id replaces in place (no duplicate)", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "v1"));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "v2-longer-text"));
    const entry = useMessagesStore.getState().bySession[sid]![0];
    assert.equal(entry.partOrder.length, 1);
    assert.equal((entry.partsById["P1"] as { text: string }).text, "v2-longer-text");
  });

  await test("upsertPart keeps streamed text when an authoritative part arrives shorter", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "streamed chunk"));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "earlier"));
    const part = useMessagesStore.getState().bySession[sid]![0].partsById["P1"];
    assert.equal((part as { text: string }).text, "streamed chunk");
  });

  await test("appendDelta concatenates streamed text", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "Hel"));
    useMessagesStore.getState().appendDelta(sid, "M1", "P1", "lo");
    useMessagesStore.getState().appendDelta(sid, "M1", "P1", " world");
    const part = useMessagesStore.getState().bySession[sid]![0].partsById["P1"];
    assert.equal((part as { text: string }).text, "Hello world");
  });

  await test("upsertPart before message creates stub", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "Mlate", "early"));
    const entry = useMessagesStore.getState().bySession[sid]![0];
    assert.equal(entry.message.id, "Mlate");
    assert.equal((entry.partsById["P1"] as { text: string }).text, "early");
  });

  await test("upsertMessage repairs assistant-before-parent SSE order", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";

    useMessagesStore.getState().upsertMessage(sid, assistant("A1", sid, "U1"));
    useMessagesStore.getState().upsertMessage(sid, m("U2", sid, "user"));
    useMessagesStore.getState().upsertMessage(sid, m("U1", sid, "user"));

    assert.deepEqual(
      useMessagesStore.getState().bySession[sid].map((entry) => entry.message.id),
      ["U1", "A1", "U2"],
    );
  });

  await test("authoritative assistant update reorders a part stub without losing parts", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";

    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "A1", "early"));
    useMessagesStore.getState().upsertMessage(sid, m("U1", sid, "user"));
    useMessagesStore.getState().upsertMessage(sid, assistant("A1", sid, "U1"));

    const list = useMessagesStore.getState().bySession[sid];
    assert.deepEqual(
      list.map((entry) => entry.message.id),
      ["U1", "A1"],
    );
    assert.equal((list[1].partsById.P1 as { text: string }).text, "early");
  });

  await test("setMessages repairs causal order without sorting unrelated rows", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";

    useMessagesStore
      .getState()
      .setMessages(
        sid,
        [assistant("A1", sid, "U1"), m("U2", sid, "user"), m("U1", sid, "user")],
        {},
      );

    assert.deepEqual(
      useMessagesStore.getState().bySession[sid].map((entry) => entry.message.id),
      ["U1", "A1", "U2"],
    );
  });

  await test("mergeMessages repairs an out-of-order initial REST page", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";

    useMessagesStore
      .getState()
      .mergeMessages(sid, [assistant("A1", sid, "U1"), m("U1", sid, "user")], {});

    assert.deepEqual(
      useMessagesStore.getState().bySession[sid].map((entry) => entry.message.id),
      ["U1", "A1"],
    );
  });

  await test("removePart drops part from order and map", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "x"));
    useMessagesStore.getState().upsertPart(sid, p("P2", sid, "M1", "y"));
    useMessagesStore.getState().removePart(sid, "P1");
    const entry = useMessagesStore.getState().bySession[sid]![0];
    assert.deepEqual(entry.partOrder, ["P2"]);
    assert.equal(entry.partsById["P1"], undefined);
  });

  await test("setMessages bulk-loads with parts", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().setMessages(sid, [m("M1", sid), m("M2", sid)] as never[], {
      M1: [p("P1", sid, "M1", "a"), p("P2", sid, "M1", "b")] as never[],
      M2: [p("P3", sid, "M2", "c")] as never[],
    });
    const list = useMessagesStore.getState().bySession[sid]!;
    assert.equal(list.length, 2);
    assert.deepEqual(list[0].partOrder, ["P1", "P2"]);
    assert.deepEqual(list[1].partOrder, ["P3"]);
  });

  await test("prependMessages inserts older messages at head, preserves order", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().setMessages(sid, [m("M3", sid), m("M4", sid)] as never[], {
      M3: [p("P3", sid, "M3", "c")] as never[],
      M4: [p("P4", sid, "M4", "d")] as never[],
    });
    useMessagesStore.getState().prependMessages(sid, [m("M1", sid), m("M2", sid)] as never[], {
      M1: [p("P1", sid, "M1", "a")] as never[],
      M2: [p("P2", sid, "M2", "b")] as never[],
    });
    const list = useMessagesStore.getState().bySession[sid]!;
    assert.deepEqual(
      list.map((e) => e.message.id),
      ["M1", "M2", "M3", "M4"],
    );
  });

  await test("prependMessages skips IDs already in the timeline (idempotent overlap)", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().setMessages(sid, [m("M2", sid), m("M3", sid)] as never[], {
      M2: [p("P2", sid, "M2", "b")] as never[],
      M3: [p("P3", sid, "M3", "c")] as never[],
    });
    useMessagesStore.getState().prependMessages(sid, [m("M1", sid), m("M2", sid)] as never[], {
      M1: [p("P1", sid, "M1", "a")] as never[],
      M2: [p("P2-new", sid, "M2", "b-new")] as never[],
    });
    const list = useMessagesStore.getState().bySession[sid]!;
    // M2 was kept (no replacement) and M1 prepended; no duplicate.
    assert.deepEqual(
      list.map((e) => e.message.id),
      ["M1", "M2", "M3"],
    );
    // The original M2 part remains; prependMessages does not overwrite.
    assert.deepEqual(list[1].partOrder, ["P2"]);
  });

  await test("mergeMessages preserves older history and inserts newly fetched messages", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore
      .getState()
      .setMessages(sid, [m("M1", sid), m("M2", sid), m("M3", sid)] as never[], {
        M1: [p("P1", sid, "M1", "old")] as never[],
        M2: [p("P2", sid, "M2", "middle")] as never[],
        M3: [p("P3", sid, "M3", "latest")] as never[],
      });

    useMessagesStore
      .getState()
      .mergeMessages(sid, [m("M2", sid), m("M3", sid), m("M4", sid)] as never[], {
        M2: [p("P2", sid, "M2", "middle")] as never[],
        M3: [p("P3", sid, "M3", "latest")] as never[],
        M4: [p("P4", sid, "M4", "new")] as never[],
      });

    const list = useMessagesStore.getState().bySession[sid]!;
    assert.deepEqual(
      list.map((entry) => entry.message.id),
      ["M1", "M2", "M3", "M4"],
    );
  });

  await test("mergeMessages inserts missing rows before the next overlapping row", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().setMessages(sid, [m("M3", sid), m("M4", sid)] as never[], {});

    useMessagesStore
      .getState()
      .mergeMessages(sid, [m("M1", sid), m("M2", sid), m("M3", sid)] as never[], {});

    assert.deepEqual(
      useMessagesStore.getState().bySession[sid]!.map((entry) => entry.message.id),
      ["M1", "M2", "M3", "M4"],
    );
  });

  await test("mergeMessages never truncates a newer SSE text delta", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().setMessages(sid, [m("M1", sid)] as never[], {
      M1: [p("P1", sid, "M1", "Hello from SSE")] as never[],
    });

    useMessagesStore.getState().mergeMessages(sid, [m("M1", sid)] as never[], {
      M1: [p("P1", sid, "M1", "Hello")] as never[],
    });

    const part = useMessagesStore.getState().bySession[sid]![0].partsById.P1;
    assert.equal((part as { text: string }).text, "Hello from SSE");
  });

  await test("mergeMessages restores content missed while disconnected", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().setMessages(sid, [m("M1", sid)] as never[], {
      M1: [p("P1", sid, "M1", "Hello")] as never[],
    });

    useMessagesStore.getState().mergeMessages(sid, [m("M1", sid)] as never[], {
      M1: [p("P1", sid, "M1", "Hello again")] as never[],
    });

    const part = useMessagesStore.getState().bySession[sid]![0].partsById.P1;
    assert.equal((part as { text: string }).text, "Hello again");
  });

  await test("mergeMessages does not regress terminal tool or message state", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    const completedMessage = {
      ...m("M1", sid),
      time: { created: 1, completed: 2 },
    } as never;
    const incompleteMessage = {
      ...m("M1", sid),
      time: { created: 1 },
    } as never;
    const completedTool = {
      id: "P-tool",
      sessionID: sid,
      messageID: "M1",
      type: "tool",
      tool: "bash",
      state: { status: "completed", output: "done" },
    } as never;
    const runningTool = {
      id: "P-tool",
      sessionID: sid,
      messageID: "M1",
      type: "tool",
      tool: "bash",
      state: { status: "running" },
    } as never;
    useMessagesStore.getState().setMessages(sid, [completedMessage], {
      M1: [completedTool],
    });

    useMessagesStore.getState().mergeMessages(sid, [incompleteMessage], {
      M1: [runningTool],
    });

    const entry = useMessagesStore.getState().bySession[sid]![0];
    assert.equal((entry.message as { time: { completed?: number } }).time.completed, 2);
    assert.equal(
      (entry.partsById["P-tool"] as { state: { status: string } }).state.status,
      "completed",
    );
  });

  await test("mergeMessages treats a completed snapshot's part list as authoritative", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    const completedMessage = {
      ...m("M1", sid),
      time: { created: 1, completed: 2 },
    } as never;
    useMessagesStore.getState().setMessages(sid, [m("M1", sid)] as never[], {
      M1: [p("P-keep", sid, "M1", "final"), p("P-removed", sid, "M1", "temporary")] as never[],
    });

    useMessagesStore.getState().mergeMessages(sid, [completedMessage], {
      M1: [p("P-keep", sid, "M1", "final")] as never[],
    });

    const entry = useMessagesStore.getState().bySession[sid]![0];
    assert.deepEqual(entry.partOrder, ["P-keep"]);
    assert.equal(entry.partsById["P-removed"], undefined);
  });

  // ── messages store edge cases ──

  await test("appendDelta to non-text part is ignored", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    // Insert a tool part (not text)
    useMessagesStore.getState().upsertPart(sid, {
      id: "P-tool",
      sessionID: sid,
      messageID: "M1",
      type: "tool",
      tool: "bash",
      state: "running",
    } as never);
    // Delta to non-text part should be a no-op
    useMessagesStore.getState().appendDelta(sid, "M1", "P-tool", "ignored");
    const entry = useMessagesStore.getState().bySession[sid][0];
    const part = entry.partsById["P-tool"] as { type: string; text?: string };
    assert.equal(part.type, "tool");
    assert.equal(part.text, undefined, "non-text part should not receive delta text");
  });

  await test("appendDelta to unknown message is a no-op", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().appendDelta(sid, "no-such-msg", "P1", "hello");
    assert.equal(useMessagesStore.getState().bySession[sid], undefined);
  });

  await test("appendDelta before part.updated creates text stub part", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    // Delta arrives before any part.updated — should create a text stub
    useMessagesStore.getState().appendDelta(sid, "M1", "P-early", "first chunk");
    const entry = useMessagesStore.getState().bySession[sid][0];
    const part = entry.partsById["P-early"] as { type: string; text: string };
    assert.equal(part.type, "text");
    assert.equal(part.text, "first chunk");
    // Subsequent delta concatenates
    useMessagesStore.getState().appendDelta(sid, "M1", "P-early", " second");
    const updated = entry.partsById["P-early"] as { text: string };
    // Re-read from store since entry is stale
    const fresh = useMessagesStore.getState().bySession[sid][0];
    assert.equal((fresh.partsById["P-early"] as { text: string }).text, "first chunk second");
  });

  await test("removeMessage drops message and its parts", () => {
    useMessagesStore.getState().reset();
    const sid = "S1";
    useMessagesStore.getState().upsertMessage(sid, m("M1", sid));
    useMessagesStore.getState().upsertPart(sid, p("P1", sid, "M1", "hi"));
    useMessagesStore.getState().upsertMessage(sid, m("M2", sid));
    useMessagesStore.getState().upsertPart(sid, p("P2", sid, "M2", "bye"));

    useMessagesStore.getState().removeMessage(sid, "M1");

    const list = useMessagesStore.getState().bySession[sid];
    assert.equal(list.length, 1);
    assert.equal(list[0].message.id, "M2");
  });

  await test("setLoading toggles per-session loading flag", () => {
    useMessagesStore.getState().reset();
    useMessagesStore.getState().setLoading("S1", true);
    assert.equal(useMessagesStore.getState().loading["S1"], true);
    useMessagesStore.getState().setLoading("S1", false);
    assert.equal(useMessagesStore.getState().loading["S1"], false);
    // Different sessions are independent
    useMessagesStore.getState().setLoading("S2", true);
    assert.equal(useMessagesStore.getState().loading["S1"], false);
    assert.equal(useMessagesStore.getState().loading["S2"], true);
  });

  await test("reset wipes all sessions and loading", () => {
    useMessagesStore.getState().reset();
    useMessagesStore.getState().upsertMessage("S1", m("M1", "S1"));
    useMessagesStore.getState().upsertMessage("S2", m("M2", "S2"));
    useMessagesStore.getState().setLoading("S1", true);

    useMessagesStore.getState().reset();

    assert.deepEqual(useMessagesStore.getState().bySession, {});
    assert.deepEqual(useMessagesStore.getState().loading, {});
  });

  await test("upsertSession with null/empty id is a no-op", () => {
    useSessionsStore.getState().reset();
    useSessionsStore.getState().upsertSession(null as never);
    useSessionsStore.getState().upsertSession({} as never);
    useSessionsStore.getState().upsertSession({ id: "" } as never);
    assert.equal(useSessionsStore.getState().sessions.length, 0);
  });

  await test("upsertSession with loading/error state", () => {
    useSessionsStore.getState().reset();
    useSessionsStore.getState().setLoading(true);
    assert.equal(useSessionsStore.getState().loading, true);
    useSessionsStore.getState().setLoading(false);
    assert.equal(useSessionsStore.getState().loading, false);
    useSessionsStore.getState().setError("something went wrong");
    assert.equal(useSessionsStore.getState().error, "something went wrong");
    useSessionsStore.getState().setError(null);
    assert.equal(useSessionsStore.getState().error, null);
  });

  console.log("\n== permission store ==");

  await test("permission add dedupes by id", () => {
    usePermissionStore.getState().reset();
    usePermissionStore.getState().add({
      id: "perm1",
      sessionID: "S1",
      permission: "shell",
    });
    usePermissionStore.getState().add({
      id: "perm1",
      sessionID: "S1",
      permission: "shell",
    });
    assert.equal(usePermissionStore.getState().pending.length, 1);
  });

  await test("permission remove drops the prompt", () => {
    usePermissionStore.getState().reset();
    usePermissionStore.getState().add({ id: "perm1", sessionID: "S1", permission: "shell" });
    usePermissionStore.getState().remove("perm1");
    assert.equal(usePermissionStore.getState().pending.length, 0);
  });

  console.log("\n== sessions store ==");

  await test("upsertSession adds new and updates existing", () => {
    useSessionsStore.getState().reset();
    useSessionsStore.getState().upsertSession({ id: "A", slug: "a" } as never);
    useSessionsStore.getState().upsertSession({ id: "B", slug: "b" } as never);
    useSessionsStore.getState().upsertSession({ id: "A", slug: "a-updated" } as never);
    const list = useSessionsStore.getState().sessions;
    assert.equal(list.length, 2);
    const a = list.find((s) => s.id === "A")!;
    assert.equal((a as { slug: string }).slug, "a-updated");
  });

  await test("removeSession drops by id", () => {
    useSessionsStore.getState().reset();
    useSessionsStore.getState().upsertSession({ id: "A" } as never);
    useSessionsStore.getState().upsertSession({ id: "B" } as never);
    useSessionsStore.getState().removeSession("A");
    const list = useSessionsStore.getState().sessions;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "B");
  });

  await test("setCurrentSession / reset clears currentSessionID", () => {
    useSessionsStore.getState().reset();
    assert.equal(useSessionsStore.getState().currentSessionID, null);
    useSessionsStore.getState().setCurrentSession("S1");
    assert.equal(useSessionsStore.getState().currentSessionID, "S1");
    // chat screen blur cleanup: clear so SSE resync stops fetching for it
    useSessionsStore.getState().setCurrentSession(null);
    assert.equal(useSessionsStore.getState().currentSessionID, null);
    // reset() must also wipe currentSessionID (called on server switch /
    // sign-out to avoid leaking the previous server's session id).
    useSessionsStore.getState().setCurrentSession("S2");
    useSessionsStore.getState().reset();
    assert.equal(useSessionsStore.getState().currentSessionID, null);
  });
}
