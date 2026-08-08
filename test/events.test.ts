import { strict as assert } from "node:assert";

import { dispatchEvent } from "../src/api/dispatch.ts";
import type { GlobalEvent } from "../src/api/sse-types.ts";
import { useMessagesStore } from "../src/store/messages.ts";
import { usePermissionStore } from "../src/store/permissions.ts";
import { useSessionsStore } from "../src/store/sessions.ts";
import { useStatusStore } from "../src/store/status.ts";
import { test } from "./harness.ts";

export async function eventsSuite() {
  console.log("\n== event dispatcher ==");

  await test("server.connected -> status open", () => {
    useStatusStore.getState().set("idle");
    dispatchEvent({
      payload: { id: "evt1", type: "server.connected", properties: {} },
    } as GlobalEvent);
    assert.equal(useStatusStore.getState().status, "open");
  });

  await test("server.heartbeat is a no-op", () => {
    useStatusStore.getState().set("open");
    dispatchEvent({
      payload: { id: "evt1", type: "server.heartbeat", properties: {} },
    } as GlobalEvent);
    assert.equal(useStatusStore.getState().status, "open");
  });

  await test("session.updated -> upserts in sessions store", () => {
    useSessionsStore.getState().reset();
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "session.updated",
        properties: {
          info: { id: "S1", slug: "demo", projectID: "p1" },
        },
      },
    } as GlobalEvent);
    const list = useSessionsStore.getState().sessions;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "S1");
  });

  await test("message.updated -> upserts message in messages store", () => {
    useMessagesStore.getState().reset();
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.updated",
        properties: {
          sessionID: "S1",
          info: {
            id: "M1",
            sessionID: "S1",
            role: "user",
            time: { created: 1 },
          },
        },
      },
    } as GlobalEvent);
    const list = useMessagesStore.getState().bySession["S1"];
    assert.ok(list);
    assert.equal(list![0].message.id, "M1");
  });

  await test("message.part.updated -> upserts part", () => {
    useMessagesStore.getState().reset();
    // First create a message via the same dispatcher.
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.updated",
        properties: {
          sessionID: "S1",
          info: { id: "M1", sessionID: "S1", role: "assistant", time: { created: 1 } },
        },
      },
    } as GlobalEvent);
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.part.updated",
        properties: {
          sessionID: "S1",
          part: {
            id: "P1",
            sessionID: "S1",
            messageID: "M1",
            type: "text",
            text: "streaming",
          },
        },
      },
    } as GlobalEvent);
    const entry = useMessagesStore.getState().bySession["S1"]![0];
    assert.deepEqual(entry.partOrder, ["P1"]);
    assert.equal((entry.partsById["P1"] as { text: string }).text, "streaming");
  });

  await test("permission.asked -> adds to permission store", () => {
    usePermissionStore.getState().reset();
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "permission.asked",
        properties: {
          id: "perm1",
          sessionID: "S1",
          permission: "shell",
          patterns: ["rm -rf"],
        },
      },
    } as GlobalEvent);
    const pending = usePermissionStore.getState().pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, "perm1");
    assert.deepEqual(pending[0].patterns, ["rm -rf"]);
  });

  await test("permission.replied -> removes from store", () => {
    usePermissionStore.getState().reset();
    usePermissionStore.getState().add({ id: "perm1", sessionID: "S1", permission: "shell" });
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "permission.replied",
        properties: { sessionID: "S1", requestID: "perm1" },
      },
    } as GlobalEvent);
    assert.equal(usePermissionStore.getState().pending.length, 0);
  });

  await test("session.deleted -> removes session and clears messages", () => {
    useSessionsStore.getState().reset();
    useMessagesStore.getState().reset();
    useSessionsStore.getState().upsertSession({ id: "S1" } as never);
    useMessagesStore.getState().upsertMessage("S1", {
      id: "M1",
      sessionID: "S1",
      role: "user",
      time: { created: 1 },
    } as never);
    dispatchEvent({
      payload: { id: "evt1", type: "session.deleted", properties: { info: { id: "S1" } } },
    } as GlobalEvent);
    assert.equal(useSessionsStore.getState().sessions.length, 0);
    assert.equal(useMessagesStore.getState().bySession["S1"], undefined);
  });

  await test("realistic streaming sequence reconstructs message", () => {
    useMessagesStore.getState().reset();
    // Simulate: user prompt admitted -> assistant message created ->
    // text part appears empty -> deltas stream in -> part marked complete.
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.updated",
        properties: {
          sessionID: "S1",
          info: {
            id: "Muser",
            sessionID: "S1",
            role: "user",
            time: { created: 1 },
          },
        },
      },
    } as GlobalEvent);
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.part.updated",
        properties: {
          sessionID: "S1",
          part: {
            id: "Puser",
            sessionID: "S1",
            messageID: "Muser",
            type: "text",
            text: "hi",
          },
        },
      },
    } as GlobalEvent);
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.updated",
        properties: {
          sessionID: "S1",
          info: {
            id: "Mai",
            sessionID: "S1",
            role: "assistant",
            time: { created: 2 },
          },
        },
      },
    } as GlobalEvent);
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.part.updated",
        properties: {
          sessionID: "S1",
          part: {
            id: "Pai",
            sessionID: "S1",
            messageID: "Mai",
            type: "text",
            text: "",
          },
        },
      },
    } as GlobalEvent);
    // Stream three deltas (this is how live token streaming arrives).
    for (const chunk of ["Hel", "lo", " world"]) {
      useMessagesStore.getState().appendDelta("S1", "Mai", "Pai", chunk);
    }

    const list = useMessagesStore.getState().bySession["S1"]!;
    assert.equal(list.length, 2);
    const ai = list.find((e) => e.message.id === "Mai")!;
    assert.equal((ai.partsById["Pai"] as { text: string }).text, "Hello world");
  });

  await test("slash command result streams through message.* (no command.executed case needed)", () => {
    // Regression / design lock for docs/command-system.md §5.2: when the
    // server executes a slash command, it promotes the resolved template
    // into a user message + assistant response and emits the standard
    // message.* events. The chat UI therefore lights up via the same paths
    // a regular prompt does — no separate command.executed branch in
    // dispatch.ts.
    useMessagesStore.getState().reset();

    // server emits the resolved template as a user message
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.updated",
        properties: {
          sessionID: "S1",
          info: {
            id: "Mcmd",
            sessionID: "S1",
            role: "user",
            time: { created: 1 },
          },
        },
      },
    } as GlobalEvent);
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.part.updated",
        properties: {
          sessionID: "S1",
          part: {
            id: "Pcmd",
            sessionID: "S1",
            messageID: "Mcmd",
            type: "text",
            text: "<command-template>Set up AGENTS.md</command-template>",
          },
        },
      },
    } as GlobalEvent);

    // then the assistant response streams in
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.updated",
        properties: {
          sessionID: "S1",
          info: {
            id: "Mai2",
            sessionID: "S1",
            role: "assistant",
            time: { created: 2 },
          },
        },
      },
    } as GlobalEvent);
    dispatchEvent({
      payload: {
        id: "evt1",
        type: "message.part.updated",
        properties: {
          sessionID: "S1",
          part: {
            id: "Pai2",
            sessionID: "S1",
            messageID: "Mai2",
            type: "text",
            text: "",
          },
        },
      },
    } as GlobalEvent);
    for (const chunk of ["I'm ", "ready to ", "help."]) {
      useMessagesStore.getState().appendDelta("S1", "Mai2", "Pai2", chunk);
    }

    const list = useMessagesStore.getState().bySession["S1"]!;
    assert.equal(list.length, 2, "user + assistant");
    const ai = list.find((e) => e.message.id === "Mai2")!;
    assert.equal((ai.partsById["Pai2"] as { text: string }).text, "I'm ready to help.");
  });

  await test("unknown event types are no-ops (forward-compatible)", () => {
    // dispatch.ts intentionally has no `default` — new event types from
    // future server versions must not crash the dispatcher. This locks in
    // that contract so the slash-command work doesn't accidentally add
    // an exhaustive switch that breaks on new events.
    const before = useMessagesStore.getState();
    assert.doesNotThrow(() => {
      dispatchEvent({
        payload: { id: "evt1", type: "future.event.we.dont.know", properties: {} },
      } as GlobalEvent);
    });
    const after = useMessagesStore.getState();
    assert.deepEqual(after, before, "store unchanged for unknown event");
  });
}
