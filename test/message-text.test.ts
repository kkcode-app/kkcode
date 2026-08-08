/**
 * [INPUT]: 依赖 src/utils/message-text 的 getMessagePlainText
 * [OUTPUT]: 提供 messageTextSuite，测试从 MessageWithParts 提取纯文本
 * [POS]: test 的消息文本提取单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import { getMessagePlainText } from "../src/utils/message-text.ts";
import type { MessageWithParts } from "../src/store/messages.ts";

function makeMessage(
  parts: { type: string; id: string; text?: string; filename?: string; mime?: string }[],
): MessageWithParts {
  const partOrder = parts.map((p) => p.id);
  const partsById: Record<string, any> = {};
  for (const p of parts) {
    partsById[p.id] = {
      id: p.id,
      messageID: "M1",
      sessionID: "S1",
      ...p,
    };
  }
  return {
    message: { id: "M1", sessionID: "S1", role: "assistant", time: { created: 1 } } as never,
    partOrder,
    partsById,
  };
}

export async function messageTextSuite() {
  console.log("\n─── message-text ───");

  await test("empty parts returns empty string", () => {
    const item = makeMessage([]);
    assert.equal(getMessagePlainText(item), "");
  });

  await test("single text part returns its text", () => {
    const item = makeMessage([{ type: "text", id: "P1", text: "Hello world" }]);
    assert.equal(getMessagePlainText(item), "Hello world");
  });

  await test("multiple text parts joined with double newline", () => {
    const item = makeMessage([
      { type: "text", id: "P1", text: "First paragraph" },
      { type: "text", id: "P2", text: "Second paragraph" },
    ]);
    assert.equal(getMessagePlainText(item), "First paragraph\n\nSecond paragraph");
  });

  await test("reasoning parts are included", () => {
    const item = makeMessage([
      { type: "text", id: "P1", text: "Answer" },
      { type: "reasoning", id: "P2", text: "Let me think..." },
    ]);
    assert.equal(getMessagePlainText(item), "Answer\n\nLet me think...");
  });

  await test("step-start and step-finish parts are filtered out", () => {
    const item = makeMessage([
      { type: "step-start", id: "P0" },
      { type: "text", id: "P1", text: "content" },
      { type: "step-finish", id: "P2" },
    ]);
    assert.equal(getMessagePlainText(item), "content");
  });

  await test("empty text parts are filtered out", () => {
    const item = makeMessage([
      { type: "text", id: "P1", text: "real content" },
      { type: "text", id: "P2", text: "   " },
      { type: "text", id: "P3", text: "" },
    ]);
    assert.equal(getMessagePlainText(item), "real content");
  });

  await test("file parts return filename", () => {
    const item = makeMessage([
      { type: "text", id: "P1", text: "Here is the file" },
      { type: "file", id: "P2", filename: "report.pdf" },
    ]);
    assert.equal(getMessagePlainText(item), "Here is the file\n\nreport.pdf");
  });

  await test("file parts without filename fall back to mime", () => {
    const item = makeMessage([{ type: "file", id: "P1", mime: "image/png" }]);
    assert.equal(getMessagePlainText(item), "image/png");
  });

  await test("file parts without filename or mime return empty (filtered)", () => {
    const item = makeMessage([{ type: "file", id: "P1" }]);
    assert.equal(getMessagePlainText(item), "");
  });

  await test("unknown part types return empty (filtered)", () => {
    const item = makeMessage([
      { type: "tool", id: "P1" },
      { type: "text", id: "P2", text: "visible" },
    ]);
    assert.equal(getMessagePlainText(item), "visible");
  });

  await test("partOrder with missing partsById entries are handled gracefully", () => {
    const item: MessageWithParts = {
      message: { id: "M1", sessionID: "S1", role: "assistant", time: { created: 1 } } as never,
      partOrder: ["P1", "P-missing", "P2"],
      partsById: {
        P1: { id: "P1", messageID: "M1", sessionID: "S1", type: "text", text: "a" } as never,
        P2: { id: "P2", messageID: "M1", sessionID: "S1", type: "text", text: "b" } as never,
      },
    };
    assert.equal(getMessagePlainText(item), "a\n\nb");
  });

  await test("whitespace-only parts are filtered from join", () => {
    const item = makeMessage([
      { type: "text", id: "P1", text: "keep" },
      { type: "reasoning", id: "P2", text: "\n  \t  " },
      { type: "text", id: "P3", text: "also keep" },
    ]);
    assert.equal(getMessagePlainText(item), "keep\n\nalso keep");
  });
}
