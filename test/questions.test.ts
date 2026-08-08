/**
 * [INPUT]: 依赖 src/store/questions 的 useQuestionStore
 * [OUTPUT]: 提供 questionsSuite，测试 question store 的 add/remove/reset 与去重
 * [POS]: test 的 questions store 单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import { useQuestionStore, type QuestionRequest } from "../src/store/questions.ts";

function makeReq(id: string, sessionID: string = "S1"): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [{ question: "Q?", header: "h", options: [{ label: "A", description: "" }] }],
  };
}

function reset() {
  useQuestionStore.getState().reset();
}

export async function questionsSuite() {
  console.log("\n─── questions store ───");

  await test("initial state has empty pending", () => {
    reset();
    assert.deepEqual(useQuestionStore.getState().pending, []);
  });

  await test("add inserts a new request", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    assert.equal(useQuestionStore.getState().pending.length, 1);
    assert.equal(useQuestionStore.getState().pending[0].id, "r1");
  });

  await test("add dedupes by id", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().add(makeReq("r1"));
    assert.equal(useQuestionStore.getState().pending.length, 1);
  });

  await test("add multiple different ids", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().add(makeReq("r2"));
    useQuestionStore.getState().add(makeReq("r3"));
    assert.equal(useQuestionStore.getState().pending.length, 3);
    const ids = useQuestionStore.getState().pending.map((p) => p.id);
    assert.deepEqual(ids, ["r1", "r2", "r3"]);
  });

  await test("add preserves insertion order", () => {
    reset();
    useQuestionStore.getState().add(makeReq("first"));
    useQuestionStore.getState().add(makeReq("second"));
    useQuestionStore.getState().add(makeReq("third"));
    const ids = useQuestionStore.getState().pending.map((p) => p.id);
    assert.deepEqual(ids, ["first", "second", "third"]);
  });

  await test("add for different sessions coexist", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1", "S1"));
    useQuestionStore.getState().add(makeReq("r2", "S2"));
    assert.equal(useQuestionStore.getState().pending.length, 2);
    assert.equal(useQuestionStore.getState().pending[0].sessionID, "S1");
    assert.equal(useQuestionStore.getState().pending[1].sessionID, "S2");
  });

  await test("remove drops by id", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().add(makeReq("r2"));
    useQuestionStore.getState().remove("r1");
    assert.equal(useQuestionStore.getState().pending.length, 1);
    assert.equal(useQuestionStore.getState().pending[0].id, "r2");
  });

  await test("remove unknown id is a no-op", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().remove("nonexistent");
    assert.equal(useQuestionStore.getState().pending.length, 1);
  });

  await test("remove from empty store is a no-op", () => {
    reset();
    useQuestionStore.getState().remove("anything");
    assert.equal(useQuestionStore.getState().pending.length, 0);
  });

  await test("remove all one by one", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().add(makeReq("r2"));
    useQuestionStore.getState().remove("r1");
    useQuestionStore.getState().remove("r2");
    assert.equal(useQuestionStore.getState().pending.length, 0);
  });

  await test("reset clears all pending", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().add(makeReq("r2"));
    useQuestionStore.getState().add(makeReq("r3"));
    useQuestionStore.getState().reset();
    assert.equal(useQuestionStore.getState().pending.length, 0);
  });

  await test("reset on empty store is a no-op", () => {
    reset();
    useQuestionStore.getState().reset();
    assert.equal(useQuestionStore.getState().pending.length, 0);
  });

  await test("add after reset works", () => {
    reset();
    useQuestionStore.getState().add(makeReq("r1"));
    useQuestionStore.getState().reset();
    useQuestionStore.getState().add(makeReq("r2"));
    assert.equal(useQuestionStore.getState().pending.length, 1);
    assert.equal(useQuestionStore.getState().pending[0].id, "r2");
  });

  await test("question data is preserved in store", () => {
    reset();
    const req: QuestionRequest = {
      id: "r1",
      sessionID: "S1",
      questions: [
        {
          question: "Which framework?",
          header: "Choose",
          options: [
            { label: "React", description: "UI library" },
            { label: "Vue", description: "Progressive" },
          ],
          multiple: true,
          custom: true,
        },
      ],
    };
    useQuestionStore.getState().add(req);
    const stored = useQuestionStore.getState().pending[0];
    assert.equal(stored.questions[0].question, "Which framework?");
    assert.equal(stored.questions[0].header, "Choose");
    assert.equal(stored.questions[0].options.length, 2);
    assert.equal(stored.questions[0].options[0].label, "React");
    assert.equal(stored.questions[0].multiple, true);
    assert.equal(stored.questions[0].custom, true);
  });
}
