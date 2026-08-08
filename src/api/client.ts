/**
 * [INPUT]: 依赖 fetch 与 utils/auth 的 Basic Auth，并接收 connection store 提供的服务端配置
 * [OUTPUT]: 对外提供 OpenCode REST 请求封装、项目列表/跨项目全部会话列表（listGlobal）/深链单条会话读取、含顶层 variant 的会话/消息/命令 API helper 与本地响应类型
 * [POS]: src/api 的 HTTP 边界层，供页面、组件和事件协调层按会话目录访问 OpenCode Server
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Lightweight OpenCode HTTP client for React Native.
//
// Wire format follows the upstream `packages/sdk/js/src/v2/client.ts`
// contract — match the TUI, do NOT invent a new API surface:
//   - Authorization: Basic auth header
//   - Directory on every request: BOTH `directory` query (legacy) or
//     `location[directory]` query (v2 `/api/*`) AND `x-opencode-directory`
//     header. The server's workspace-routing middleware reads them in
//     priority order: query → header → process.cwd(). For POST we send
//     the header as the raw value and let URLSearchParams encode the query
//     once. OpenCode 1.17.x resolves the already-decoded query value directly;
//     pre-encoding it produces a literal "%2FUsers..." filesystem path.

import type {
  Session,
  Message,
  FileNode,
  PermissionRequest,
  Part,
  TextPartInput,
  FilePartInput,
  CommandV2Info,
} from "@opencode-ai/sdk/v2";

import { basicAuthHeader, type Credentials } from "../utils/auth";

export type ClientConfig = {
  baseUrl: string;
  credentials: Credentials;
  directory?: string;
};

/** A workspace registered by the OpenCode server. */
export type Project = {
  id: string;
  worktree: string;
  vcs?: string;
  time?: { created?: number; updated?: number };
  sandboxes?: unknown[];
};

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

function applyDirectoryToUrl(url: URL, path: string, directory: string | undefined): void {
  if (!directory) return;
  // `URLSearchParams` performs the only encoding layer required on the wire.
  // Do not pre-encode `directory`: current OpenCode servers pass the parsed
  // value to FileSystem.realPath, so `%252FUsers...` becomes an invalid literal
  // `%2FUsers...` path and `/api/command` responds with 500.
  if (path.startsWith("/api/")) {
    if (!url.searchParams.has("location[directory]")) {
      url.searchParams.set("location[directory]", directory);
    }
  } else {
    if (!url.searchParams.has("directory")) {
      url.searchParams.set("directory", directory);
    }
  }
}

export type RequestOptions = {
  method?: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

async function fetchResponse(
  config: ClientConfig,
  options: RequestOptions,
  accept: string,
): Promise<Response> {
  const method = options.method ?? "GET";
  const url = new URL(joinUrl(config.baseUrl, options.path));

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: accept,
    Authorization: basicAuthHeader(config.credentials),
  };

  // Always pass directory via both query AND header — this matches TUI
  // (see packages/sdk/js/src/v2/client.ts `rewrite` interceptor + the
  // createOpencodeClient header injection) and the reference curl
  // `POST /session?directory=...` with `x-opencode-directory: ...`. The
  // server reads query first, header second, then falls back to
  // process.cwd() — sending both means the route is unambiguous even if
  // a future server build drops one of the channels.
  if (config.directory) {
    applyDirectoryToUrl(url, options.path, config.directory);
    // Server reads this header as-is (no decoding). Do NOT encodeURIComponent.
    headers["x-opencode-directory"] = config.directory;
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }

  return fetch(url.toString(), {
    method,
    headers,
    body,
    signal: options.signal,
  });
}

export async function request<T = unknown>(
  config: ClientConfig,
  options: RequestOptions,
): Promise<T> {
  const response = await fetchResponse(config, options, "application/json");

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(response.status, text);
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(
      response.status,
      `Expected JSON response but got "${contentType || "no content-type"}" — is this an opencode server?`,
    );
  }
  return (await response.json()) as T;
}

async function requestText(config: ClientConfig, options: RequestOptions): Promise<string> {
  const response = await fetchResponse(config, options, "text/x-diff, text/plain;q=0.9, */*;q=0.1");
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(response.status, text);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/")) {
    throw new HttpError(
      response.status,
      `Expected text diff response but got "${contentType || "no content-type"}"`,
    );
  }
  return response.text();
}

// ---------- v2 API helpers ----------

// v2 responses are wrapped as { data: ... }
type Wrapped<T> = { data: T };

export async function checkHealth(config: ClientConfig): Promise<void> {
  const res = await request<unknown>(config, { path: "/api/health" });
  if (res == null || typeof res !== "object" || (res as Record<string, unknown>).healthy !== true) {
    throw new Error("Not an opencode server");
  }
}

// List the immediate children of an absolute path on the opencode server.
// Mirrors the upstream `GET /file?path=<abs>` route (see
// packages/opencode/src/server/routes/instance/httpapi/groups/file.ts).
// `path` must be an absolute filesystem path; "~" is NOT expanded.
export async function listPath(config: ClientConfig, path: string): Promise<FileNode[]> {
  return request<FileNode[]>(config, {
    path: "/file",
    query: { path },
  });
}

export type FileContent = {
  type: "text" | "binary";
  content: string;
  diff?: string;
  encoding?: "base64";
  mimeType?: string;
};

/** Reads a file at its server-side absolute path. Binary responses are not previewed by the UI. */
export async function getFileContent(config: ClientConfig, path: string): Promise<FileContent> {
  return request<FileContent>(config, {
    path: "/file/content",
    query: { path },
  });
}

/**
 * Lists every project known to the server. Project IDs are the most reliable
 * link to global-session records; `worktree` is retained as a fallback for
 * older sessions that do not contain a project ID.
 */
export async function listProjects(config: ClientConfig): Promise<Project[]> {
  return request<Project[]>(config, { path: "/project" });
}

export async function listSessions(config: ClientConfig): Promise<Session[]> {
  // Use `/experimental/session` (listGlobal) instead of `/session` to get
  // all sessions across all projects, not just the current directory's project.
  // Response is a bare `GlobalSession[]` which is a superset of `Session[]`.
  return request<Session[]>(config, {
    path: "/experimental/session",
  });
}

/** Reads one session before opening a deep-linked chat that is not cached yet. */
export async function getSession(config: ClientConfig, sessionID: string): Promise<Session> {
  return request<Session>(config, { path: `/session/${sessionID}` });
}

export async function createSession(
  config: ClientConfig,
  payload: {
    title?: string;
    agent?: string;
    model?: { id: string; providerID: string; variant?: string };
  } = {},
): Promise<Session> {
  // Use the legacy `POST /session` route — same path TUI's
  // `sdk.client.session.create()` hits (see
  // packages/sdk/js/src/v2/gen/sdk.gen.ts Session2.create). The body is
  // the v1 shape: title / agent / model only. Directory is NOT in the
  // body — it travels via the `directory` query param and the
  // `x-opencode-directory` header that `request()` already attaches from
  // `config.directory`. The server reads them in
  // workspace-routing.ts::defaultDirectory and falls back to
  // process.cwd() if both are absent, which is exactly the failure mode
  // we want to avoid (session gets pinned to server's cwd, every
  // downstream sessionDirectory-derived request — loadMessages /
  // listAgents / sendPrompt / SSE — then carries the wrong directory).
  //
  // Legacy route returns the Session object directly (NOT wrapped in
  // `{ data }` — see SessionCreateResponses in
  // packages/sdk/js/src/v2/gen/types.gen.ts), unlike v2 `/api/session`
  // which wraps it.
  return request<Session>(config, {
    method: "POST",
    path: "/session",
    body: payload,
  });
}

export async function deleteSession(config: ClientConfig, sessionID: string): Promise<void> {
  await request(config, {
    method: "DELETE",
    path: `/session/${sessionID}`,
  });
}

export async function updateSessionTitle(
  config: ClientConfig,
  sessionID: string,
  title: string,
): Promise<Session> {
  // 注意:走 legacy /session/:id 路径(同 deleteSession),服务端直接返回
  // Session 对象(不像 /api/session 那样包 { data } wrapper)。早期按
  // Wrapped 解包会拿到 undefined,upsertSession(undefined) 抛
  // "Cannot read property 'id' of undefined",但服务端其实已经改名成功了
  // —— 集成测试已锁定此契约。
  return request<Session>(config, {
    method: "PATCH",
    path: `/session/${sessionID}`,
    body: { title },
  });
}

export async function getSessionMessages(
  config: ClientConfig,
  sessionID: string,
): Promise<{ info: Message; parts: Part[] }[]> {
  // Use the legacy /session/:id/message route because it returns the same
  // Message/Part shape that SSE events emit, which lets the store reuse a
  // single normalized representation. The v2 /api/session/:id/message route
  // returns a different "SessionMessage" union AND queries a separate table
  // that does not contain history for sessions created before the v2
  // migration.
  return request<{ info: Message; parts: Part[] }[]>(config, {
    path: `/session/${sessionID}/message`,
  });
}

/** A server-computed workspace diff snapshot for a session or user-message point. */
export type SessionFileDiff = {
  file?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
};

export async function getSessionDiff(
  config: ClientConfig,
  sessionID: string,
  messageID?: string,
): Promise<SessionFileDiff[]> {
  // The server computes snapshots against the session workspace. Keep this on
  // the legacy route so `request()` sends the session directory in both forms.
  return request<SessionFileDiff[]>(config, {
    path: `/session/${sessionID}/diff`,
    query: messageID ? { messageID } : undefined,
  });
}

/** A git working-tree file summary, without any patch content. */
export type WorkspaceFileStatus = {
  file: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
};

/** Lists uncommitted changes in the configured session workspace. */
export async function getWorkspaceStatus(config: ClientConfig): Promise<WorkspaceFileStatus[]> {
  return request<WorkspaceFileStatus[]>(config, { path: "/vcs/status" });
}

/** Returns the configured session workspace's full, multi-file unified Git diff. */
export async function getWorkspaceRawDiff(config: ClientConfig): Promise<string> {
  return requestText(config, { path: "/vcs/diff/raw" });
}

export type SessionMessagesPage = {
  items: { info: Message; parts: Part[] }[];
  // Opaque cursor pointing to the next *older* page; absent when there is no
  // more history. Returned by the server in the `X-Next-Cursor` response
  // header (the body itself is still a plain array).
  nextCursor?: string;
};

export async function getSessionMessagesPage(
  config: ClientConfig,
  sessionID: string,
  query: { limit: number; before?: string },
): Promise<SessionMessagesPage> {
  // Legacy /session/:id/message paginated mode: pass `limit` (>=1) to opt
  // into MessageV2.page on the server. The body is the same WithParts[]
  // shape; the next cursor is in the `X-Next-Cursor` header. Older messages
  // come first via the `before` cursor.
  const url = new URL(joinUrl(config.baseUrl, `/session/${sessionID}/message`));
  url.searchParams.set("limit", String(query.limit));
  if (query.before) url.searchParams.set("before", query.before);
  applyDirectoryToUrl(url, url.pathname, config.directory);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: basicAuthHeader(config.credentials),
  };
  if (config.directory) headers["x-opencode-directory"] = config.directory;

  const response = await fetch(url.toString(), {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new HttpError(response.status, text);
  }
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new HttpError(
      response.status,
      `Expected JSON response but got "${ct || "no content-type"}"`,
    );
  }
  const items = (await response.json()) as { info: Message; parts: Part[] }[];
  const nextCursor = response.headers.get("x-next-cursor") ?? undefined;
  return { items, nextCursor };
}

export type PromptPayload = {
  // 服务端的 parts 数组接受 text / file / agent / subtask 四种 input。
  // 图片走 file：{ type: "file", mime: "image/*", url: "data:...;base64,..." }
  parts: (TextPartInput | FilePartInput)[];
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
};

export async function sendPrompt(
  config: ClientConfig,
  sessionID: string,
  payload: PromptPayload,
): Promise<void> {
  // POST /session/:id/prompt_async — the async admission endpoint.
  //
  // The legacy POST /session/:id/message endpoint is a **long-lived** request
  // that holds the HTTP connection open until the entire AI generation
  // completes (its 200 response body is { info: AssistantMessage, parts: Part[] }).
  // Under weak network or when the app goes to background, the OS suspends the
  // fetch; when the app returns to foreground the fetch may fail, triggering
  // the error handler in ChatScreen.onSend which restores the composer — even
  // though the server already received the message. The user then sees the
  // text back in the input box and re-sends, creating a duplicate.
  //
  // prompt_async returns 204 No Content immediately after the server admits the
  // message. The actual generation streams back through SSE message.* events,
  // exactly as before. This eliminates the long-lived fetch window.
  return request(config, {
    method: "POST",
    path: `/session/${sessionID}/prompt_async`,
    body: payload,
  });
}

// Abort a session's currently running message generation. Server emits a
// final `message.updated` with `time.completed` set, so the UI's streaming
// signal (derived from `time.completed == null`) will automatically flip to
// idle — no optimistic state required.
export async function abortSession(config: ClientConfig, sessionID: string): Promise<unknown> {
  return request(config, {
    method: "POST",
    path: `/session/${sessionID}/abort`,
  });
}

// Permission reply lives under legacy /session route per plan §五.6.
export async function replyPermission(
  config: ClientConfig,
  sessionID: string,
  permissionID: string,
  response: "always" | "once" | "reject",
): Promise<void> {
  await request(config, {
    method: "POST",
    path: `/session/${sessionID}/permissions/${permissionID}`,
    body: { response },
  });
}

export async function replyQuestion(
  config: ClientConfig,
  sessionID: string,
  requestID: string,
  answers: string[][],
): Promise<void> {
  // 单一端点:见 listSessionQuestions 注释。opencode 主进程的
  // `Question.Service` 才有真实的 pending Map,`/api/session/...` 那条
  // 走 `QuestionV2.Service` (packages/core) —— opencode 工具调起
  // question 时从不写那边,这条路径永远是死路。原先的 404 → fallback
  // 链把"真 404 (question 已过期)"和"路径选错"两种状态混在一起,难
  // 诊断。直接走对的路径,真 404 让上层按"已过期"处理(QuestionPrompt
  // 的 catch 已经会 remove entry)。
  await request(config, {
    method: "POST",
    path: `/question/${requestID}/reply`,
    body: { answers },
  });
}

// Pull pending questions for a session from the server. Used as a fallback for
// SSE reconnection — SSE does not replay events, so any `question.v2.asked`
// emitted during a disconnect is lost; this REST endpoint is the authoritative
// source of "what is still pending right now".
//
// 端点选择踩坑笔记:opencode 主进程把挂起 question 放在
//   packages/opencode/src/question/index.ts 的 `Question.Service`
//   (in-memory Map,每个 Location 一份),通过 packages/opencode/.../httpapi
//   路由的 `GET /question` 暴露。
//
// `packages/server` 那条 `/api/session/:id/question` 调的是
// `QuestionV2.Service` (packages/core/question.ts 里的另一套,也是
// in-memory Map),**这两套互不同步** —— opencode 工具调起 question 时往
// `Question.Service.pending.set(...)`,但从不写 `QuestionV2.Service`。
// 所以 `/api/session/.../question` 永远返回空(调了也是白调),导致
// refetchQuestions 拿不到任何挂起 entry,SSE 丢了之后 QuestionPrompt
// 静默不弹。
//
// 修正:走 `GET /question` (packages/opencode 的真实端点),它返回的是
// **整个 Location** 所有 session 的挂起 question 列表,client-side
// 按 sessionID 过滤。注意:返回的是裸 array,**不带** `{ data: ... }`
// wrapper(跟 packages/server 那条不一样,别加错解包)。
export type ServerQuestion = {
  id: string;
  sessionID: string;
  questions: {
    question: string;
    header: string;
    options: { label: string; description: string }[];
    multiple?: boolean;
    custom?: boolean;
  }[];
  // Question.Request 里的 tool 字段,packages/opencode 服务端 ask 时
  // 写入,包含 messageID + callID。我们用 callID 把"消息历史里的
  // question part"和"服务端的 question request"对应起来,这样
  // refetch 时能用同一个 id(无需 local: 兜底)。
  tool?: { messageID: string; callID: string };
};

export async function listSessionQuestions(
  config: ClientConfig,
  sessionID: string,
): Promise<ServerQuestion[]> {
  const all = await request<ServerQuestion[]>(config, {
    path: "/question",
  });
  // /question 是 Location-wide 列表,client-side 按 session 过滤。
  return Array.isArray(all) ? all.filter((q) => q.sessionID === sessionID) : [];
}

export async function rejectQuestion(
  config: ClientConfig,
  sessionID: string,
  requestID: string,
): Promise<void> {
  // 单一端点:opencode 主进程把挂起 question 放在
  // `Question.Service` (packages/opencode/src/question),`POST
  // /question/:id/reject` 直接命中。`/api/session/.../question/:id/reject`
  // 走的是 `QuestionV2.Service` (packages/core) —— opencode 工具调起
  // question 时从不写那边,这条路径永远是死路。原先的 404 → fallback
  // 链反而把"真的 404 (question 已过期)"和"路径选错"两种状态混在一起,
  // 难诊断。直接用对的路径,404 就让上层按"已过期"处理(QuestionPrompt
  // 的 catch 已经会 remove entry)。
  await request(config, {
    method: "POST",
    path: `/question/${requestID}/reject`,
    body: {},
  });
}

export type Agent = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  builtIn: boolean;
  hidden?: boolean;
  model?: { providerID: string; modelID: string };
  variant?: string;
};

export type Model = {
  id: string;
  name: string;
  release_date: string;
  /** 模型能力声明（/config/providers 实际返回结构） */
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: {
      text?: boolean;
      audio?: boolean;
      image?: boolean;
      video?: boolean;
      pdf?: boolean;
    };
    output?: {
      text?: boolean;
      audio?: boolean;
      image?: boolean;
      video?: boolean;
      pdf?: boolean;
    };
  };
  /** Server-defined adjustable reasoning presets. Empty means not user-adjustable. */
  variants?: Record<string, Record<string, unknown>>;
};

export type ProviderInfo = {
  id: string;
  name: string;
  models: Record<string, Model>;
};

export async function listAgents(config: ClientConfig): Promise<Agent[]> {
  return request<Agent[]>(config, { path: "/agent" });
}

// ---------- Slash commands ----------
//
// Slash commands are server-side prompt templates (Config.command + built-in
// defaults + MCP prompts). The v2 `/api/command` endpoint lists everything
// registered for the current directory's Location; TUI consumes the same
// shape via `sdk.client.command.list` (packages/tui/src/context/sync.tsx:506).
//
// Response is wrapped as `{ location, data: CommandV2Info[] }` — we unwrap
// `data` here so consumers see a bare array.
//
// Note on skill separation: `/api/skill` returns SkillV2Info entries with an
// optional `slash: boolean` flag. This MVP only deals with commands; if a
// future iteration wants skills in the same picker, fetch `/api/skill` and
// filter by `slash === true`.
export async function listCommandsV2(config: ClientConfig): Promise<CommandV2Info[]> {
  const res = await request<{ data: CommandV2Info[] }>(config, {
    path: "/api/command",
  });
  return Array.isArray(res?.data) ? res.data : [];
}

// Execute a slash command on an existing session. Server accepts the command
// name (no leading `/`) plus an opaque arguments string and asynchronously
// promotes the resolved template into a user message - actual streaming
// output arrives via SSE `message.*` events, mirroring TUI's
// `void sdk.client.session.command({...})` fire-and-forget call
// (packages/tui/src/component/prompt/index.tsx:1077).
//
// POST /session/:id/command is a long-lived endpoint (200 response body is
// { info: Message, parts: Part[] }) - it waits for generation to complete.
// There is no async variant, so a 10s AbortController timeout guards the
// fetch: quick errors (400/401/404/500) arrive well within the window; a
// timeout means the server has accepted the command and is processing it.
// This prevents the same background→foreground duplicate-send bug as
// sendPrompt when the app is suspended mid-request.
export async function executeCommand(
  config: ClientConfig,
  sessionID: string,
  input: {
    command: string;
    arguments: string;
    messageID?: string;
    agent?: string;
    model?: string;
    variant?: string;
    parts?: FilePartInput[];
  },
): Promise<{ info: Message; parts: Part[] } | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await request<{ info: Message; parts: Part[] } | undefined>(config, {
      method: "POST",
      path: `/session/${sessionID}/command`,
      body: input,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return undefined;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type ProvidersResponse = {
  providers: ProviderInfo[];
  default: Record<string, string>;
};

export async function listProviders(config: ClientConfig): Promise<ProvidersResponse> {
  return request<ProvidersResponse>(config, { path: "/config/providers" });
}

// opencode.json 合并后的全局配置。我们只关心顶级的 `model` 字段（格式
// "provider/model"），用作"无任何用户偏好时"的默认模型来源 —— 与 TUI
// (packages/tui/src/context/local.tsx fallbackModel) 保持一致。
//
// GET /config 是 v2 HttpApi 路由，直接返回对象，不带 { data } 包裹。
export type ServerConfig = {
  model?: string;
  small_model?: string;
  default_agent?: string;
  // 字段还有很多，这里只声明用得上的，其它任意。
  [key: string]: unknown;
};

export async function getConfig(config: ClientConfig): Promise<ServerConfig> {
  return request<ServerConfig>(config, { path: "/config" });
}

export type { Session, Message, FileNode, PermissionRequest, Part, CommandV2Info };
