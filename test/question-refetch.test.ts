// Exercises the question-recovery path: when SSE misses a `question.v2.asked`
// (e.g. the connection drops while the user is on the sessions list), the
// chat page re-focusing must call `refetchQuestions` which merges the
// server's authoritative list into the local store.
import { strict as assert } from "node:assert";

import { refetchQuestions } from "../src/api/dispatch.ts";
import { useConnectionStore } from "../src/store/connection.ts";
import { useQuestionStore } from "../src/store/questions.ts";
import { test } from "./harness.ts";

const server = {
  id: "srv1",
  backend: "opencode" as const,
  baseUrl: "http://example.com",
  username: "u",
  password: "p",
  directory: "/Users/x/demo",
};

function mockFetch(payload: unknown, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    // listSessionQuestions 现在调 `GET /question`(packages/opencode 端点),
    // 返回裸 array,**不带** `{ data: ... }` wrapper —— 那是 packages/server
    // `/api/session/:id/question` 的旧格式。test fixture 必须跟生产端点
    // 一致,否则 cast 出来是 object 而不是 array,filter 报 "not a function"。
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

export async function questionRefetchSuite() {
  console.log("\n== question refetch (recovery from SSE drop) ==");

  // Seed the connection store with one active server. refetchQuestions reads
  // `active` to build the ClientConfig.
  useConnectionStore.setState({
    servers: { [server.id]: server },
    order: [server.id],
    activeId: server.id,
    active: server,
    hydrated: true,
  });

  await test("refetchQuestions pulls missing questions into the store", async () => {
    useQuestionStore.getState().reset();

    // Simulate: SSE dropped, server still has req1 pending. We have nothing
    // locally — the user just landed back on the chat page.
    const restore = mockFetch([
      {
        id: "req1",
        sessionID: "S1",
        questions: [{ question: "Q?", header: "h", options: [{ label: "A", description: "" }] }],
      },
    ]);

    await refetchQuestions("S1");

    const pending = useQuestionStore.getState().pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, "req1");
    assert.equal(pending[0].sessionID, "S1");
    assert.equal(pending[0].questions.length, 1);

    restore();
  });

  await test("refetchQuestions drops local entries that the server no longer reports", async () => {
    useQuestionStore.getState().reset();

    // Locally we have a question the server doesn't know about (e.g. it was
    // replied/expired during the SSE drop). The server now returns empty.
    useQuestionStore.getState().add({
      id: "stale",
      sessionID: "S2",
      questions: [{ question: "old?", header: "h", options: [{ label: "A", description: "" }] }],
    });

    const restore = mockFetch([]);
    await refetchQuestions("S2");

    const pending = useQuestionStore.getState().pending;
    assert.equal(pending.length, 0, "stale local question must be removed");
    restore();
  });

  await test("refetchQuestions is idempotent — running twice does not duplicate", async () => {
    useQuestionStore.getState().reset();
    const restore = mockFetch([
      {
        id: "req1",
        sessionID: "S3",
        questions: [{ question: "Q?", header: "h", options: [{ label: "A", description: "" }] }],
      },
    ]);

    await refetchQuestions("S3");
    await refetchQuestions("S3");

    assert.equal(useQuestionStore.getState().pending.length, 1);
    restore();
  });

  await test("refetchQuestions preserves questions for OTHER sessions", async () => {
    useQuestionStore.getState().reset();

    // Add a question for session Sother, then refetch S1. Sother must remain.
    useQuestionStore.getState().add({
      id: "req-other",
      sessionID: "Sother",
      questions: [{ question: "Q?", header: "h", options: [{ label: "A", description: "" }] }],
    });

    const restore = mockFetch([
      {
        id: "req1",
        sessionID: "S1",
        questions: [{ question: "Q?", header: "h", options: [{ label: "A", description: "" }] }],
      },
    ]);
    await refetchQuestions("S1");
    restore();

    const pending = useQuestionStore.getState().pending;
    assert.equal(pending.length, 2);
    assert.ok(pending.some((p) => p.id === "req-other"));
    assert.ok(pending.some((p) => p.id === "req1"));
  });

  await test("refetchQuestions swallows network errors (best-effort fallback)", async () => {
    useQuestionStore.getState().reset();

    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    // Must not throw. Local state must not be wiped either.
    await refetchQuestions("S1");
    globalThis.fetch = original;

    assert.deepEqual(useQuestionStore.getState().pending, []);
  });

  await test("concurrent refetchQuestions for the SAME sessionID coalesce to one HTTP call", async () => {
    useQuestionStore.getState().reset();

    // SSE 重连触发 resyncQuestions 时,会对 store 里所有 session 各发一次
    // refetchQuestions。如果同一 sessionID 没有 in-flight 去重,N 个并发
    // 调用就会发出 N 个相同的 GET /api/session/:id/question。这里用一个
    // 受控的 fetch 替身:第一个 fetch 阻塞,直到我们手动 resolve,期间
    // 第二次 refetchQuestions 必须复用第一个 promise 而不是再发一次。
    const original = globalThis.fetch;
    let fetchCount = 0;
    let release: (() => void) | null = null;
    globalThis.fetch = (async () => {
      fetchCount++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const p1 = refetchQuestions("Sdedup");
      // 第二个调用必须看到 inflight 缓存,直接返回同一个 promise。
      const p2 = refetchQuestions("Sdedup");
      const p3 = refetchQuestions("Sdedup");
      assert.equal(fetchCount, 1, "only one HTTP call must be issued");

      release!();
      await Promise.all([p1, p2, p3]);
      assert.equal(fetchCount, 1, "still one call after all awaited");
    } finally {
      globalThis.fetch = original;
    }

    // 在错误路径上,in-flight 缓存必须被清理,下次调用才能重新发请求
    // (否则一次失败会让这个 sessionID 永久"卡死")。
    let failCount = 0;
    globalThis.fetch = (async () => {
      failCount++;
      throw new Error("network down");
    }) as typeof fetch;
    try {
      await refetchQuestions("Sdedup2");
      await refetchQuestions("Sdedup2");
      assert.equal(failCount, 2, "after a failure, the next call must retry");
    } finally {
      globalThis.fetch = original;
    }
  });
}
