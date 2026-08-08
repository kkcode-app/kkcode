/**
 * [INPUT]: 依赖 Node HTTP mock server、api/client 的 REST helper 与 harness 断言运行器
 * [OUTPUT]: 对外提供 clientSuite，验证 HTTP 路由、认证、目录透传、顶层 variant 与会话 diff 等响应解析
 * [POS]: test 的 API 客户端契约测试，锁定 OpenCode legacy/v2 路由行为
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  abortSession,
  checkHealth,
  createSession,
  deleteSession,
  executeCommand,
  getFileContent,
  getWorkspaceRawDiff,
  getWorkspaceStatus,
  getSessionDiff,
  getSessionMessages,
  getSessionMessagesPage,
  HttpError,
  listCommandsV2,
  listPath,
  listProjects,
  listSessions,
  replyPermission,
  sendPrompt,
  type ClientConfig,
} from "../src/api/client.ts";
import { test } from "./harness.ts";

type Recorded = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
};

const VALID_AUTH = "Basic b3BlbmNvZGU6c2VjcmV0";

function buildMockServer(recorded: Recorded[]): http.Server {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      recorded.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(",") : (v ?? ""),
          ]),
        ),
        body,
      });

      if (req.headers["authorization"] !== VALID_AUTH) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const url = new URL(req.url ?? "", "http://x");
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const empty = (status: number) => {
        res.writeHead(status);
        res.end();
      };

      if (url.pathname === "/api/health") {
        // checkHealth (client.ts:144-153) 要求响应是 `{healthy: true}`,
        // 否则抛 "Not an opencode server"。b2a8fd7 收紧了这个契约以防
        // 假成功跳转,但 mock 一直没跟上 —— 之前一直返回 `{data:{ok:true}}`,
        // 触发 checkHealth 抛错,导致 "sends Basic Auth header" 测试
        // 走到 catch 分支而不是断言 recorded headers。
        return json(200, { healthy: true });
      }
      if (url.pathname === "/file" && req.method === "GET") {
        return json(200, [
          {
            name: "demo",
            path: "demo/",
            absolute: "/Users/x/demo",
            type: "directory",
            ignored: false,
          },
          {
            name: "README.md",
            path: "README.md",
            absolute: "/Users/x/README.md",
            type: "file",
            ignored: false,
          },
        ]);
      }
      if (url.pathname === "/file/content" && req.method === "GET") {
        return json(200, {
          type: "text",
          content: "export const example = true;\n",
          mimeType: "text/typescript",
        });
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        return json(200, {
          data: [
            {
              id: "S1",
              slug: "demo",
              projectID: "p1",
              directory: "/Users/x/demo",
            },
          ],
        });
      }
      // listSessions 走 /experimental/session (listGlobal) 获取跨项目所有会话
      if (url.pathname === "/experimental/session" && req.method === "GET") {
        return json(200, [
          {
            id: "S1",
            slug: "demo",
            projectID: "p1",
            directory: "/Users/x/demo",
          },
        ]);
      }
      if (url.pathname === "/project" && req.method === "GET") {
        return json(200, [
          {
            id: "p1",
            worktree: "/Users/x/demo",
            vcs: "git",
            time: { created: 1, updated: 2 },
            sandboxes: [],
          },
        ]);
      }
      if (url.pathname === "/api/session" && req.method === "POST") {
        return json(200, {
          data: {
            id: "S2",
            slug: "new",
            projectID: "p1",
            directory: "/Users/x/demo",
          },
        });
      }
      // createSession 现在走 legacy /session(对齐 TUI),mock 也要覆盖。
      if (url.pathname === "/session" && req.method === "POST") {
        return json(200, {
          id: "S2",
          slug: "new",
          projectID: "p1",
          directory: "/Users/x/demo",
        });
      }
      if (url.pathname === "/api/session/S1" && req.method === "DELETE") {
        return empty(204);
      }
      // deleteSession/updateSessionTitle 走旧版路径(client.ts 的 v2 迁移注释说明),
      // mock 把两个路径都注册上,免得测试因服务端路由差异 404。
      if (url.pathname === "/session/S1" && req.method === "DELETE") {
        return empty(204);
      }
      if (url.pathname === "/session/S1/message" && req.method === "GET") {
        const limit = url.searchParams.get("limit");
        const before = url.searchParams.get("before");
        // Paginated mode: limit query expected by MessageV2.page.
        if (limit) {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (!before) {
            // First page: more older history is available.
            headers["X-Next-Cursor"] = "OLDER1";
          }
          res.writeHead(200, headers);
          res.end(
            JSON.stringify([
              {
                info: {
                  id: before ? "M0" : "M1",
                  sessionID: "S1",
                  role: "user",
                  time: { created: before ? 50 : 100 },
                  agent: "code",
                  model: { providerID: "anthropic", modelID: "claude" },
                },
                parts: [
                  {
                    id: before ? "P0" : "P1",
                    sessionID: "S1",
                    messageID: before ? "M0" : "M1",
                    type: "text",
                    text: before ? "older" : "hello",
                  },
                ],
              },
            ]),
          );
          return;
        }
        // Non-paginated mode (no limit): return everything in legacy shape.
        return json(200, [
          {
            info: {
              id: "M1",
              sessionID: "S1",
              role: "user",
              time: { created: 100 },
              agent: "code",
              model: { providerID: "anthropic", modelID: "claude" },
            },
            parts: [
              {
                id: "P1",
                sessionID: "S1",
                messageID: "M1",
                type: "text",
                text: "hello",
              },
            ],
          },
        ]);
      }
      if (url.pathname === "/session/S1/diff" && req.method === "GET") {
        return json(200, [
          {
            file: "src/example.ts",
            patch: "@@ -1 +1 @@\n-old\n+new",
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ]);
      }
      if (url.pathname === "/vcs/status" && req.method === "GET") {
        return json(200, [
          { file: "src/example.ts", additions: 2, deletions: 1, status: "modified" },
        ]);
      }
      if (url.pathname === "/vcs/diff/raw" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/x-diff; charset=utf-8" });
        res.end(
          "diff --git a/src/example.ts b/src/example.ts\\n--- a/src/example.ts\\n+++ b/src/example.ts\\n@@ -1 +1 @@\\n-old\\n+new\\n",
        );
        return;
      }
      if (url.pathname === "/session/S1/message" && req.method === "POST") {
        return json(200, { accepted: true });
      }
      if (url.pathname === "/session/S1/prompt_async" && req.method === "POST") {
        return empty(204);
      }
      if (url.pathname === "/session/S1/permissions/perm1" && req.method === "POST") {
        return empty(204);
      }
      if (url.pathname === "/session/S1/abort" && req.method === "POST") {
        return empty(204);
      }
      // Slash command list — v2 /api/command, returns { data: CommandV2Info[] }
      if (url.pathname === "/api/command" && req.method === "GET") {
        return json(200, {
          data: [
            {
              name: "init",
              template: "Set up an AGENTS.md",
              description: "guided AGENTS.md setup",
              subtask: false,
            },
            {
              name: "review",
              template: "Review changes",
              description: "review changes [commit|branch|pr]",
              agent: "review",
              subtask: true,
            },
          ],
        });
      }
      // Slash command execute — legacy /session/:id/command
      if (url.pathname === "/session/S1/command" && req.method === "POST") {
        return json(200, {
          info: {
            id: "AM1",
            sessionID: "S1",
            role: "assistant",
            time: { created: 200 },
          },
          parts: [],
        });
      }
      if (url.pathname === "/missing" && req.method === "GET") {
        return json(404, { error: "not found" });
      }

      res.writeHead(404);
      res.end();
    });
  });
}

export async function clientSuite() {
  console.log("\n== mock server + http client ==");

  const recorded: Recorded[] = [];
  const server = buildMockServer(recorded);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  const config: ClientConfig = {
    baseUrl: "http://127.0.0.1:" + port,
    credentials: { username: "opencode", password: "secret" },
    directory: "/Users/x/demo",
  };

  await test("checkHealth: sends Basic Auth header", async () => {
    recorded.length = 0;
    await checkHealth(config);
    assert.equal(recorded[0]!.headers["authorization"], VALID_AUTH);
  });

  await test("missing auth produces HttpError(401)", async () => {
    const bad: ClientConfig = {
      ...config,
      credentials: { username: "opencode", password: "WRONG" },
    };
    recorded.length = 0;
    let captured: unknown = null;
    try {
      await checkHealth(bad);
    } catch (err) {
      captured = err;
    }
    assert.ok(captured instanceof HttpError, "should throw HttpError");
    assert.equal((captured as HttpError).status, 401);
  });

  await test("GET /file: empty `path` lists workspace root; relative entries returned", async () => {
    recorded.length = 0;
    // Empty path → `path=` query; the server returns the workspace's children.
    // The server's `entry.path` is workspace-relative (with trailing slash for
    // directories) so the mobile client can use it as the next `path=` value.
    const list = await listPath(config, "");
    assert.equal(list.length, 2);
    assert.equal(list[0]!.name, "demo");
    assert.equal(list[0]!.type, "directory");
    assert.equal(list[0]!.absolute, "/Users/x/demo");
    // The trailing-slash-on-directory form lets the client re-send it
    // verbatim and the server still resolves it back to the absolute path.
    assert.equal(list[0]!.path, "demo/");
    const r = recorded[0]!;
    assert.equal(r.method, "GET");
    assert.ok(
      r.path.startsWith("/file?path="),
      "expected `path=` query (empty) at the start, got: " + r.path,
    );
    // URLSearchParams applies the single required percent-encoding layer.
    assert.ok(
      r.path.includes("directory=%2FUsers%2Fx%2Fdemo"),
      "expected single-encoded workspace directory in query, got: " + r.path,
    );
    // 与 TUI 对齐:GET 也同时带 x-opencode-directory header(server 优先读 query,
    // header 是 fallback —— 双发保证 server 任意版本都能解析)。
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
  });

  await test("GET /file/content: returns text content with absolute file path", async () => {
    recorded.length = 0;
    const content = await getFileContent(config, "/Users/x/demo/src/example.ts");
    assert.equal(content.type, "text");
    assert.equal(content.content, "export const example = true;\n");
    const r = recorded[0]!;
    assert.equal(r.method, "GET");
    assert.ok(r.path.startsWith("/file/content?path="), r.path);
    assert.ok(r.path.includes("path=%2FUsers%2Fx%2Fdemo%2Fsrc%2Fexample.ts"), r.path);
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
  });

  await test("GET /experimental/session: listSessions 走 listGlobal 端点, directory 在 URL query 里(single-encoded)", async () => {
    recorded.length = 0;
    const sessions = await listSessions(config);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.id, "S1");
    const r = recorded[0]!;
    assert.equal(r.method, "GET");
    // listSessions 走 /experimental/session (listGlobal),directory 在 URL query
    // 里用 `directory=...` 而不是 v2 的 `location[directory]=...`。
    assert.ok(
      r.path.startsWith("/experimental/session?"),
      "expected /experimental/session, got: " + r.path,
    );
    assert.ok(
      r.path.includes("directory=%2FUsers%2Fx%2Fdemo"),
      "expected single-encoded `directory` query, got: " + r.path,
    );
    assert.ok(
      !r.path.includes("location%5Bdirectory%5D"),
      "must NOT use v2 location[directory] key, got: " + r.path,
    );
  });

  await test("GET /project: listProjects returns the server project records", async () => {
    recorded.length = 0;
    const projects = await listProjects(config);
    assert.equal(projects.length, 1);
    assert.equal(projects[0]!.worktree, "/Users/x/demo");
    assert.equal(recorded[0]!.method, "GET");
    assert.ok(recorded[0]!.path.startsWith("/project?"));
  });

  await test("POST /session: legacy route, directory in BOTH query AND header", async () => {
    recorded.length = 0;
    const session = await createSession(config);
    assert.equal(session.id, "S2");
    const r = recorded[0]!;
    assert.equal(r.method, "POST");
    // 与 TUI 对齐:createSession 走 legacy /session(不是 v2 /api/session),
    // directory 必须同时通过 URL query 和 x-opencode-directory header 传,
    // 跟参考 curl `POST /session?directory=...` 一致。
    assert.ok(r.path.startsWith("/session?"), "expected /session (legacy), got: " + r.path);
    assert.ok(
      r.path.includes("directory=%2FUsers%2Fx%2Fdemo"),
      "expected single-encoded `directory` query, got: " + r.path,
    );
    assert.ok(
      !r.path.includes("location%5Bdirectory%5D"),
      "must NOT use v2 location[directory] key, got: " + r.path,
    );
    // 服务端 raw 读取 x-opencode-directory(无 decodeURIComponent),所以客户端
    // 必须发送原值而不是 encodeURIComponent(...)。这条断言绑定了 client.ts
    // bb17417 commit 引入的协议契约。
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
    // body 不应包含 v2 专属的 location 字段(legacy 路由不识别)。
    const body = JSON.parse(r.body || "{}");
    assert.equal(body.location, undefined, "body must not include v2 `location`");
  });

  await test("DELETE /session/:id: 204 returns void", async () => {
    recorded.length = 0;
    await deleteSession(config, "S1");
    const r = recorded[0]!;
    assert.equal(r.method, "DELETE");
    assert.equal(r.path.split("?")[0], "/session/S1");
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
  });

  await test("GET /session/:id/message: returns Message+Part array", async () => {
    recorded.length = 0;
    const out = await getSessionMessages(config, "S1");
    assert.equal(out.length, 1);
    assert.equal(out[0].info.id, "M1");
    assert.equal(out[0].parts.length, 1);
    assert.equal((out[0].parts[0] as { text: string }).text, "hello");
  });

  await test("GET /session/:id/diff: returns file patches and preserves messageID", async () => {
    recorded.length = 0;
    const diffs = await getSessionDiff(config, "S1", "M1");
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0]!.file, "src/example.ts");
    assert.equal(diffs[0]!.patch, "@@ -1 +1 @@\n-old\n+new");
    const r = recorded[0]!;
    assert.equal(r.method, "GET");
    assert.equal(r.path.split("?")[0], "/session/S1/diff");
    assert.ok(r.path.includes("messageID=M1"), r.path);
    assert.ok(r.path.includes("directory=%2FUsers%2Fx%2Fdemo"), r.path);
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
  });

  await test("GET /vcs: loads a lightweight status list and the raw text diff", async () => {
    recorded.length = 0;
    const [status, raw] = await Promise.all([
      getWorkspaceStatus(config),
      getWorkspaceRawDiff(config),
    ]);
    assert.equal(status[0]!.file, "src/example.ts");
    assert.equal(status[0]!.additions, 2);
    assert.ok(raw.startsWith("diff --git a/src/example.ts"));
    assert.equal(recorded.length, 2);
    for (const request of recorded) {
      assert.ok(request.path.startsWith("/vcs/"), request.path);
      assert.ok(request.path.includes("directory=%2FUsers%2Fx%2Fdemo"), request.path);
      assert.equal(request.headers["x-opencode-directory"], "/Users/x/demo");
      assert.equal(request.headers["authorization"], VALID_AUTH);
    }
  });

  await test("GET /api/session/:id/message: paginated v2 returns SessionMessage[] + cursor", async () => {
    recorded.length = 0;
    const page = await getSessionMessagesPage(config, "S1", { limit: 30 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].info.id, "M1");
    assert.equal(page.nextCursor, "OLDER1");
    const r = recorded[0]!;
    assert.equal(r.method, "GET");
    assert.ok(r.path.includes("limit=30"), r.path);
    assert.ok(!r.path.includes("before="), "first page must not send before");
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
  });

  await test("GET /api/session/:id/message: cursor passes through and order omitted", async () => {
    recorded.length = 0;
    const page = await getSessionMessagesPage(config, "S1", {
      limit: 30,
      before: "OLDER1",
    });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].info.id, "M0");
    // No further pages on cursored req: header X-Next-Cursor not set.
    assert.equal(page.nextCursor, undefined);
    const r = recorded[0]!;
    assert.ok(r.path.includes("before=OLDER1"), r.path);
  });

  await test("POST /session/:id/prompt_async: sends prompt JSON body", async () => {
    recorded.length = 0;
    await sendPrompt(config, "S1", {
      parts: [{ type: "text", text: "hi" }],
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
    });
    const r = recorded[0]!;
    assert.equal(r.method, "POST");
    assert.equal(r.path.split("?")[0], "/session/S1/prompt_async");
    assert.equal(r.headers["content-type"], "application/json");
    const body = JSON.parse(r.body);
    assert.equal(body.parts[0].type, "text");
    assert.equal(body.parts[0].text, "hi");
    assert.deepEqual(body.model, { providerID: "openai", modelID: "gpt-5" });
    assert.equal(body.model.variant, undefined);
    assert.equal(body.variant, "high");
  });

  await test("replyPermission: posts response to legacy route", async () => {
    recorded.length = 0;
    await replyPermission(config, "S1", "perm1", "once");
    const r = recorded[0]!;
    assert.equal(r.method, "POST");
    assert.equal(r.path.split("?")[0], "/session/S1/permissions/perm1");
    const body = JSON.parse(r.body);
    assert.equal(body.response, "once");
  });

  await test("abortSession: POSTs to /session/:id/abort with auth", async () => {
    recorded.length = 0;
    await abortSession(config, "S1");
    const r = recorded[0]!;
    assert.equal(r.method, "POST");
    assert.equal(r.path.split("?")[0], "/session/S1/abort");
    // 跟其他写操作一样,必须带 Basic Auth
    assert.equal(r.headers["authorization"], VALID_AUTH);
  });

  await test("404 produces HttpError with status", async () => {
    let captured: unknown = null;
    try {
      // checkHealth uses GET /api/health, so use a different request to hit /missing
      const bad: ClientConfig = { ...config };
      const { request } = await import("../src/api/client.ts");
      await request(bad, { path: "/missing" });
    } catch (err) {
      captured = err;
    }
    assert.ok(captured instanceof HttpError);
    assert.equal((captured as HttpError).status, 404);
  });

  await test("listCommandsV2: GET /api/command unwraps { data } and routes via location[directory]", async () => {
    recorded.length = 0;
    const cmds = await listCommandsV2(config);
    assert.equal(cmds.length, 2);
    assert.equal(cmds[0]!.name, "init");
    assert.equal(cmds[1]!.name, "review");
    // /api/* 走 v2 路由规则:directory 编码进 `location[directory]` query
    // (不是 legacy `directory`)。参见 client.ts::applyDirectoryToUrl。
    const r = recorded[0]!;
    assert.equal(r.method, "GET");
    assert.ok(r.path.startsWith("/api/command?"), "expected /api/command path, got: " + r.path);
    assert.ok(
      r.path.includes("location%5Bdirectory%5D"),
      "expected v2 location[directory] query, got: " + r.path,
    );
    assert.ok(
      !r.path.includes("directory="),
      "must NOT use legacy `directory` query for v2 routes, got: " + r.path,
    );
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
  });

  await test("listCommandsV2: empty/malformed data yields empty array (no throw)", async () => {
    // 用一个一次性 server 返回 { data: null } 来验证容错
    const fluke = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: null }));
    });
    await new Promise<void>((resolve) => fluke.listen(0, "127.0.0.1", () => resolve()));
    const port = (fluke.address() as AddressInfo).port;
    try {
      const cmds = await listCommandsV2({
        baseUrl: "http://127.0.0.1:" + port,
        credentials: { username: "x", password: "y" },
      });
      assert.deepEqual(cmds, []);
    } finally {
      await new Promise<void>((resolve) => fluke.close(() => resolve()));
    }
  });

  await test("executeCommand: POSTs to legacy /session/:id/command with body fields", async () => {
    recorded.length = 0;
    const out = await executeCommand(config, "S1", {
      command: "review",
      arguments: "main..feature",
      agent: "review",
      model: "anthropic/claude",
      variant: "none",
    });
    assert.ok(out, "expected initial {info, parts} payload");
    assert.equal(out!.info.id, "AM1");
    const r = recorded[0]!;
    assert.equal(r.method, "POST");
    assert.ok(
      r.path.startsWith("/session/S1/command?"),
      "expected legacy /session/:id/command, got: " + r.path,
    );
    // 跟其它 legacy POST 一致:directory 双路由(query + header),不走 v2 location
    assert.ok(
      r.path.includes("directory=%2FUsers%2Fx%2Fdemo"),
      "expected single-encoded directory, got: " + r.path,
    );
    assert.equal(r.headers["x-opencode-directory"], "/Users/x/demo");
    const body = JSON.parse(r.body);
    assert.equal(body.command, "review");
    assert.equal(body.arguments, "main..feature");
    assert.equal(body.agent, "review");
    assert.equal(body.model, "anthropic/claude");
    assert.equal(body.variant, "none");
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
}
