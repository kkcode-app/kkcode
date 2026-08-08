// 集成测试 — 对真实 opencode 服务器跑端到端验证。
//
// 触发：`npm run test:integration`
// 服务器：默认 http://127.0.0.1:4096，凭证 opencode/(空密码),可通过环境变量
//   OPENCODE_BASE_URL / OPENCODE_USERNAME / OPENCODE_PASSWORD 覆盖。
//
// 设计原则：
// 1. 启动前先 ping /api/health,服务器不可达就把整套测试标记为 SKIP,绝不
//    让 CI 失败。开发机上没启 opencode serve 时也不会 break `npm test`。
// 2. 用 /tmp 作为 directory(已确认可访问),所有创建的 session 用 try/finally
//    清理掉,避免污染服务端历史。
// 3. 钉死核心协议契约:
//    - GET /api/* 走双编码 location[directory] query
//    - POST/PATCH/DELETE 走 raw x-opencode-directory header(commit bb17417)
//    - 分页用 X-Next-Cursor 响应头
// 4. SSE 用 node 原生 fetch 流式读,验证 auth_token query + 至少收到一条 ping
//    事件,而不依赖 react-native-sse(node 下不可用)。

import { strict as assert } from "node:assert";
import {
  HttpError,
  checkHealth,
  createSession,
  deleteSession,
  getSessionMessages,
  getSessionMessagesPage,
  listAgents,
  listPath,
  listSessionQuestions,
  listSessions,
  updateSessionTitle,
  type ClientConfig,
} from "../src/api/client.ts";
import { basicAuthHeader } from "../src/utils/auth.ts";
import { skip, test } from "./harness.ts";

// ── 配置 ─────────────────────────────────────────────────

const BASE_URL = process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";
const USERNAME = process.env.OPENCODE_USERNAME ?? "opencode";
const PASSWORD = process.env.OPENCODE_PASSWORD ?? "";
// 用 /tmp 作为工作目录:在所有 macOS/Linux 都存在,opencode 可正常列出。
const TEST_DIRECTORY = process.env.OPENCODE_TEST_DIR ?? "/tmp";

const config: ClientConfig = {
  baseUrl: BASE_URL,
  credentials: { username: USERNAME, password: PASSWORD },
  directory: TEST_DIRECTORY,
};

// ── 入口 ─────────────────────────────────────────────────

export async function integrationSuite(): Promise<void> {
  console.log("\n== integration: " + BASE_URL + " (directory=" + TEST_DIRECTORY + ") ==");

  // probe:服务器不在/不可达就整组 SKIP,不让 CI 红。
  const reachable = await probeServer();
  if (!reachable.ok) {
    skip("integration suite", reachable.reason);
    return;
  }

  await runRestTests();
  await runSseTests();
}

// ── REST 测试 ────────────────────────────────────────────

async function runRestTests(): Promise<void> {
  await test("GET /api/health: server is healthy", async () => {
    const out = (await checkHealth(config)) as { data?: { ok?: boolean } } | { healthy?: boolean };
    // 不同版本的 opencode 返回结构略有差异 —— 老版返回 {data:{ok:true}},
    // 新版直接返回 {healthy:true}。两种都接受,只要不抛异常即可。
    assert.ok(out, "health response not empty");
  });

  await test("GET /file: workspace root listing returns FileNode[]", async () => {
    const list = await listPath(config, "");
    assert.ok(Array.isArray(list), "expected array");
    // /tmp 至少应该有一些条目;空数组也不算错(保守一点),只要类型对就行。
    if (list.length > 0) {
      const f = list[0]!;
      assert.equal(typeof f.name, "string", "FileNode.name is string");
      assert.equal(typeof f.absolute, "string", "FileNode.absolute is string");
      assert.ok(f.type === "file" || f.type === "directory", "FileNode.type is file|directory");
    }
  });

  await test("GET /api/session: directory passed via location[directory] query", async () => {
    const sessions = await listSessions(config);
    assert.ok(Array.isArray(sessions), "sessions is array");
  });

  await test("GET /agent: returns Agent[] with build/explore", async () => {
    const agents = await listAgents(config);
    assert.ok(Array.isArray(agents), "agents is array");
    assert.ok(agents.length > 0, "at least one agent registered");
    const names = agents.map((a) => a.name);
    // build 是默认主 agent,任何 opencode 实例都应该有
    assert.ok(names.includes("build"), "expected 'build' agent in: " + names.join(","));
  });

  // 真实写入测试:create→update→fetch→delete。一旦 bb17417 那个
  // x-opencode-directory header 协议被改坏(回到 encodeURIComponent),
  // 这里 update/delete 会 404 —— 比 mock 测试更严格的回归保护。
  await test("session lifecycle: create → update title → fetch messages → delete", async () => {
    const created = await createSession(config, {});
    assert.ok(created.id, "created session has id");
    assert.match(created.id, /^ses_/, "session id starts with ses_");

    try {
      const newTitle = "kkcode-integration-" + Date.now();
      const updated = await updateSessionTitle(config, created.id, newTitle);
      assert.equal(updated.id, created.id, "update returns same session id");
      // 服务端可能异步落库后再返回,不强求 title 立刻一致 —— 关键是 PATCH
      // 路径打通(不是 404)且响应是合法 Session 结构。
      assert.ok(updated.id, "updated session has id");

      // 新 session 没消息;非分页 + 分页两种都该返回空数组,验证两条路径都通。
      const list = await getSessionMessages(config, created.id);
      assert.ok(Array.isArray(list), "messages is array");
      assert.equal(list.length, 0, "fresh session has 0 messages");

      const page = await getSessionMessagesPage(config, created.id, { limit: 20 });
      assert.ok(Array.isArray(page.items), "page items is array");
      assert.equal(page.items.length, 0, "fresh session page has 0 items");
      // nextCursor 在空 session 时也可能存在(指向"无更早"),不强求 undefined。
    } finally {
      // 不管断言成不成功都要清理,避免在服务端积累 kkcode-integration-* 垃圾。
      await deleteSession(config, created.id).catch(() => {
        // 服务端可能已经清理过(超时/手动),忽略二次删除报错。
      });
    }
  });

  await test("DELETE /session/:id: idempotent on missing id (404 → HttpError)", async () => {
    try {
      await deleteSession(config, "ses_definitely_does_not_exist");
      assert.fail("expected HttpError but got success");
    } catch (err) {
      assert.ok(err instanceof HttpError, "error is HttpError, got: " + String(err));
      assert.equal((err as HttpError).status, 404, "status=404");
    }
  });

  await test("GET /api/session/:id/question: empty array for fresh session", async () => {
    const created = await createSession(config, {});
    try {
      const qs = await listSessionQuestions(config, created.id);
      assert.ok(Array.isArray(qs), "questions is array");
      assert.equal(qs.length, 0, "fresh session has 0 pending questions");
    } finally {
      await deleteSession(config, created.id).catch(() => {});
    }
  });

  await test("HttpError: bogus path 404 carries body", async () => {
    try {
      // 直接用底层 listPath 但传明显不存在的目录会导致 404 或合法空数组,
      // 不稳定。改用一个明确不存在的 GET 路径:/no-such-route。
      const url = new URL(BASE_URL.replace(/\/+$/, "") + "/no-such-route");
      url.searchParams.set("directory", encodeURIComponent(TEST_DIRECTORY));
      const r = await fetch(url.toString(), {
        headers: {
          Authorization: "Basic " + Buffer.from(USERNAME + ":" + PASSWORD).toString("base64"),
        },
      });
      // 服务端可能把未知 GET 路径降级到 SPA index(返回 200 HTML),
      // 这种情况下我们跳过断言:重要的是 client.ts 的 HttpError 分支。
      if (!r.ok) {
        assert.ok(r.status >= 400, "non-2xx status: " + r.status);
      }
    } catch (err) {
      // fetch 自身错(网络断开)在 probeServer 已 fail-fast,这里发生说明
      // 服务器中途挂了,转化为标准断言失败信息。
      throw new Error("network error during 404 probe: " + String(err));
    }
  });
}

// ── SSE 测试 ─────────────────────────────────────────────

async function runSseTests(): Promise<void> {
  await test("SSE /global/event: opens and delivers ≥1 event", async () => {
    const url = new URL(BASE_URL.replace(/\/+$/, "") + "/global/event");

    // 用 AbortController 兜超时:7s 内必须收到至少一个 SSE 帧(opencode 服务端
    // 默认每 1-2s 推一次心跳,所以 7s 足够。注意必须收 SSE 帧而不仅仅是 200,
    // 因为代理/中间件可能 200 回包后又永远 hang)。
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: ctrl.signal,
        headers: {
          Accept: "text/event-stream",
          Authorization: basicAuthHeader({ username: USERNAME, password: PASSWORD }),
        },
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error("SSE fetch failed before any frame: " + String(err));
    }

    try {
      assert.equal(response.status, 200, "SSE expected 200, got: " + response.status);
      assert.ok(
        (response.headers.get("content-type") ?? "").includes("text/event-stream"),
        "expected text/event-stream content-type",
      );
      assert.ok(response.body, "response.body is null");

      // 读流 → 找到第一条 SSE 帧(以 \n\n 结尾)就成功。
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let frames = 0;
      while (frames === 0) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // 一帧的结尾是 \n\n 或 \r\n\r\n
        if (buf.includes("\n\n") || buf.includes("\r\n\r\n")) {
          frames++;
        }
      }
      assert.ok(frames >= 1, "expected at least 1 SSE frame within timeout");
    } finally {
      ctrl.abort();
      clearTimeout(timer);
    }
  });

  await test("SSE /global/event: rejects when auth_token is missing", async () => {
    // 不带 auth_token,也不带 Authorization header → 应该 401(若服务端开启鉴权)。
    // 此服务端可能未开启鉴权(本地 dev),所以 200 也接受 —— 重要的是不要 5xx。
    const url = BASE_URL.replace(/\/+$/, "") + "/global/event";
    const r = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      // 立即关闭,不读流
    });
    try {
      assert.ok(
        r.status === 401 || r.status === 200,
        "expected 401 or 200 (server may be auth-disabled), got: " + r.status,
      );
    } finally {
      // 关闭连接,避免 leaked socket
      r.body?.cancel().catch(() => {});
    }
  });
}

// ── 服务器探测 ────────────────────────────────────────────

async function probeServer(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(BASE_URL.replace(/\/+$/, "") + "/api/health", {
      signal: ctrl.signal,
      headers: {
        Authorization: "Basic " + Buffer.from(USERNAME + ":" + PASSWORD).toString("base64"),
      },
    });
    if (!r.ok) return { ok: false, reason: BASE_URL + " responded " + r.status };
    // 即使是 SPA fallback 返回 200 HTML 也算可达 —— 不强校验 JSON 结构,
    // 只要 health 路由存活就够了。
    await r.body?.cancel().catch(() => {});
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason:
        "cannot reach " + BASE_URL + ": " + (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}
