/**
 * [INPUT]: 依赖 ../src/utils/session-status 的 isSessionStreaming
 * [OUTPUT]: 对外提供 sessionStatusSuite() 测试套件
 * [POS]: test/ 下 session-status 工具的单测，在 test/run.ts 中注册
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// isSessionStreaming 单测 — 覆盖空、纯 user、纯 assistant、混合、stub、边界

import { strict as assert } from "node:assert";

import { isSessionStreaming } from "../src/utils/session-status.ts";
import { test } from "./harness.ts";
import type { MessageWithParts } from "../src/store/messages.ts";

function makeAssistant(opts: { id: string; completed?: number | null }): MessageWithParts {
  return {
    message: {
      id: opts.id,
      sessionID: "S1",
      role: "assistant",
      time: {
        created: 1,
        ...(opts.completed === null || opts.completed === undefined
          ? {}
          : { completed: opts.completed }),
      },
    } as never,
    partOrder: [],
    partsById: {},
  };
}

function makeUser(opts: { id: string }): MessageWithParts {
  return {
    message: {
      id: opts.id,
      sessionID: "S1",
      role: "user",
      time: { created: 1 },
    } as never,
    partOrder: [],
    partsById: {},
  };
}

export async function sessionStatusSuite() {
  console.log("\n== session-status ==");

  await test("isSessionStreaming: undefined → false", () => {
    assert.equal(isSessionStreaming(undefined), false);
  });

  await test("isSessionStreaming: 空数组 → false", () => {
    assert.equal(isSessionStreaming([]), false);
  });

  await test("isSessionStreaming: 纯 user 消息 → false", () => {
    assert.equal(isSessionStreaming([makeUser({ id: "u1" })]), false);
  });

  await test("isSessionStreaming: assistant 已完成 → false", () => {
    const list = [makeAssistant({ id: "a1", completed: 100 })];
    assert.equal(isSessionStreaming(list), false);
  });

  await test("isSessionStreaming: assistant 未完成 (completed undefined) → true", () => {
    const list = [makeAssistant({ id: "a1" })];
    assert.equal(isSessionStreaming(list), true);
  });

  await test("isSessionStreaming: assistant 未完成 (completed null) → true", () => {
    const list = [makeAssistant({ id: "a1", completed: null })];
    assert.equal(isSessionStreaming(list), true);
  });

  await test("isSessionStreaming: 末尾 user 之后无 assistant → false", () => {
    const list = [makeAssistant({ id: "a1", completed: 50 }), makeUser({ id: "u1" })];
    assert.equal(isSessionStreaming(list), false);
  });

  await test("isSessionStreaming: 尾部 assistant 未完成 → true (忽略前面已完成的)", () => {
    const list = [
      makeAssistant({ id: "a1", completed: 50 }),
      makeUser({ id: "u1" }),
      makeAssistant({ id: "a2" }),
    ];
    assert.equal(isSessionStreaming(list), true);
  });

  await test("isSessionStreaming: 尾部 assistant 已完成 → false (忽略前面未完成的)", () => {
    const list = [
      makeAssistant({ id: "a1" }),
      makeUser({ id: "u1" }),
      makeAssistant({ id: "a2", completed: 200 }),
    ];
    assert.equal(isSessionStreaming(list), false);
  });

  await test("isSessionStreaming: time 字段缺失 → false (容错)", () => {
    const list: MessageWithParts[] = [
      {
        message: { id: "a1", sessionID: "S1", role: "assistant" } as never,
        partOrder: [],
        partsById: {},
      },
    ];
    assert.equal(isSessionStreaming(list), false);
  });
}
