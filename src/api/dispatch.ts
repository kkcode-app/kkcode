/**
 * [INPUT]: 依赖 global SSE 事件、client question API 与 connection/messages/permission/question/session/status stores
 * [OUTPUT]: 对外提供 dispatchEvent/refetchQuestions/DELTA_FLUSH_INTERVAL_MS，并以 rAF 对齐且最小 32ms 间隔提交流式 message delta、在完成事件中原子合并消息壳与按服务器隔离的项目会话缓存
 * [POS]: api/ 的 OpenCode 事件分发核心，连接 SSE 输入与各业务 store
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Pure event dispatcher: routes a parsed `/global/event` SSE payload into the
// matching Zustand stores. Kept free of React/RN imports so it can be unit
// tested in plain Node. Concurrent-session deltas are committed atomically
// on an animation frame with a bounded commit cadence.
//
// Slash command events:
//   - `command.executed` is INTENTIONALLY not handled here. After a slash
//     command fires (POST /session/:id/command), the server promotes the
//     resolved template into a user message and emits the same
//     `message.updated` / `message.part.updated` / `message.part.delta`
//     stream that a regular prompt produces. So the chat UI lights up
//     through the existing paths below — no separate "command.executed"
//     branch is needed for the MVP. A future iteration may add it to
//     record an execution history slice (refs the `messageID` field from
//     `EventCommandExecuted`).
//   - `tui.command.execute` / `tui.toast.show` / `tui.session.select` /
//     `tui.prompt.append` belong to the TUI coordination layer and are
//     out of scope for the mobile MVP.

import type { GlobalEvent } from "./sse-types";
import { listSessionQuestions, type ServerQuestion } from "./client";
import { toClientConfig, useConnectionStore } from "../store/connection";
import { useMessagesStore, type MessageDelta } from "../store/messages";
import { usePermissionStore } from "../store/permissions";
import { useQuestionStore } from "../store/questions";
import { useSessionsStore } from "../store/sessions";
import { useStatusStore } from "../store/status";

type EventProperties = Record<string, unknown> & {
  sessionID?: string;
  info?: unknown;
  part?: unknown;
  partID?: string;
  messageID?: string;
  delta?: string;
  id?: string;
  permission?: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
  description?: string;
  requestID?: string;
  request?: unknown;
};

// In-flight de-duplication. Without this, a single SSE reconnect triggers
// `resyncQuestions()` in useEventStream which fans out to N sessions — and
// chat screens also call this in their useFocusEffect — so on a flaky network
// you get N concurrent identical GET /api/session/:id/question requests every
// few seconds. Cache the in-flight Promise by sessionID; concurrent callers
// await the same Promise, post-rejection callers start a fresh request.
const inflightRefetch = new Map<string, Promise<void>>();

export async function refetchQuestions(sessionID: string): Promise<void> {
  if (!sessionID) return;
  const cached = inflightRefetch.get(sessionID);
  if (cached) return cached;
  const promise = doRefetchQuestions(sessionID).finally(() => {
    inflightRefetch.delete(sessionID);
  });
  inflightRefetch.set(sessionID, promise);
  return promise;
}

async function doRefetchQuestions(sessionID: string): Promise<void> {
  const active = useConnectionStore.getState().active;
  if (!active) return;
  // 用 session 自己的 directory 路由到正确的 instance
  const session = useSessionsStore.getState().sessions.find((s) => s.id === sessionID);
  try {
    const server = await listSessionQuestions(
      toClientConfig(active, session?.directory),
      sessionID,
    );
    mergeQuestionsFromServer(sessionID, server);
  } catch (err) {
    console.warn("[question] refetch failed", err);
  }
}

function mergeQuestionsFromServer(sessionID: string, server: ServerQuestion[]) {
  const store = useQuestionStore.getState();
  const serverIds = new Set(server.map((q) => q.id));
  const localIdsForSession = new Set(
    store.pending.filter((p) => p.sessionID === sessionID).map((p) => p.id),
  );

  // 1) Add any server-reported questions we don't know about yet.
  for (const q of server) {
    if (q.sessionID !== sessionID) continue;
    if (localIdsForSession.has(q.id)) continue;
    store.add({
      id: q.id,
      sessionID: q.sessionID,
      questions: q.questions as never,
    });
  }

  // 2) Drop local entries for this session that the server no longer reports.
  //    (Only after we successfully fetched, so a transient network error
  //    doesn't wipe out our local knowledge.)
  for (const localId of localIdsForSession) {
    if (!serverIds.has(localId)) {
      store.remove(localId);
    }
  }
}

function getProps(event: GlobalEvent): EventProperties {
  return (event.payload?.properties ?? {}) as EventProperties;
}

// ── SSE delta 节流 ─────────────────────────────────────────────────────
// 流式 delta 来得很快（每秒数十次），如果每条都立刻 set zustand state，
// 整个 ChatScreen 会以同样频率 re-render，既费 CPU 又让"自动跟随"被拽得抖动。
//
// 策略：把同一 (sessionID, messageID, partID) 的 delta 在内存里累计，
// 以 requestAnimationFrame 对齐提交，并限制连续提交至少间隔 32ms。稀疏
// delta 仍在下一帧显示；持续高速流最多约 31Hz，避免增长中的完整 Markdown
// 在 60/120Hz 设备上逐帧重解析并与滚动事件争抢 JS 线程。
//
// 注意：只对 delta 节流，message.updated / part.updated 这类一次性事件
// 仍然立即 dispatch，避免"消息完成"信号被压在节流队列里出不来。
type DeltaKey = string; // `${sessionID}|${messageID}|${partID}`
const pendingDelta = new Map<DeltaKey, string>();
let flushScheduled = false;
let lastFlushAt = 0;
export const DELTA_FLUSH_INTERVAL_MS = 32;

function flushPendingDeltas(): void {
  flushScheduled = false;
  if (pendingDelta.size === 0) return;
  lastFlushAt = Date.now();
  // 同一提交窗口可能有多个会话同时流式输出。必须一次性更新 store；逐条 set
  // 会让订阅者收到 N 次快照，滚动历史消息时会抢占 JS 线程。
  const entries = Array.from(pendingDelta.entries());
  pendingDelta.clear();
  const deltas: MessageDelta[] = [];
  for (const [key, delta] of entries) {
    if (!delta) continue;
    const [sessionID, messageID, partID] = key.split("|");
    deltas.push({ sessionID, messageID, partID, delta });
  }
  useMessagesStore.getState().appendDeltas(deltas);
}

function requestFlushFrame(): void {
  // 优先 rAF，没有时回退 setTimeout(16)
  const schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16);
  schedule(flushPendingDeltas);
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const elapsed = Math.max(0, Date.now() - lastFlushAt);
  const wait = Math.max(0, DELTA_FLUSH_INTERVAL_MS - elapsed);
  if (wait > 0) {
    setTimeout(requestFlushFrame, wait);
    return;
  }
  requestFlushFrame();
}

function enqueueDelta(sessionID: string, messageID: string, partID: string, delta: string): void {
  if (!delta) return;
  const key = `${sessionID}|${messageID}|${partID}`;
  pendingDelta.set(key, (pendingDelta.get(key) ?? "") + delta);
  scheduleFlush();
}

function takePendingDeltas(sessionID: string, messageID?: string, partID?: string): MessageDelta[] {
  const deltas: MessageDelta[] = [];
  for (const [key, delta] of Array.from(pendingDelta.entries())) {
    const [sid, mid, pid] = key.split("|");
    if (sid !== sessionID || (messageID && mid !== messageID) || (partID && pid !== partID)) {
      continue;
    }
    pendingDelta.delete(key);
    if (delta) deltas.push({ sessionID: sid, messageID: mid, partID: pid, delta });
  }
  return deltas;
}

// part 权威更新到达前先一次性提交对应 pending delta；message 权威更新
// 会把消息壳与 pending delta 合成一次 store 更新。删除事件直接丢弃 pending。
function flushDeltasFor(sessionID: string, messageID: string, partID?: string): void {
  const deltas = takePendingDeltas(sessionID, messageID, partID);
  if (deltas.length > 0) useMessagesStore.getState().appendDeltas(deltas);
}

function discardDeltasFor(sessionID: string, messageID?: string, partID?: string): void {
  takePendingDeltas(sessionID, messageID, partID);
}

export function dispatchEvent(event: GlobalEvent) {
  const props = getProps(event);
  const type = event.payload?.type;
  if (!type) return;

  switch (type) {
    case "server.connected":
      useStatusStore.getState().set("open");
      return;

    case "server.heartbeat":
      return;

    case "session.created":
    case "session.updated": {
      const info = props.info;
      if (info && typeof info === "object" && "id" in info) {
        const serverID = useConnectionStore.getState().active?.id;
        useSessionsStore.getState().upsertSession(info as never, serverID);
      }
      return;
    }

    case "session.deleted": {
      const id = (props.info as { id?: string } | undefined)?.id;
      if (id) {
        discardDeltasFor(id);
        useSessionsStore.getState().removeSession(id);
        useMessagesStore.setState((state) => {
          const next = { ...state.bySession };
          delete next[id];
          return { bySession: next };
        });
      }
      return;
    }

    case "message.updated": {
      const sessionID = props.sessionID;
      const info = props.info;
      const messageID =
        info && typeof info === "object" && "id" in info
          ? (info as { id?: unknown }).id
          : undefined;
      if (sessionID && typeof messageID === "string") {
        const deltas = takePendingDeltas(sessionID, messageID);
        // delta 可能先于 message.updated 到达。把建壳与 delta 应用放进同一次
        // store 更新，既不丢尾字，也不会向订阅者暴露“已完成但正文为空”的中间态。
        useMessagesStore.getState().upsertMessage(sessionID, info as never, deltas);
      }
      return;
    }

    case "message.removed": {
      const sessionID = props.sessionID;
      const messageID = props.messageID;
      if (sessionID && messageID) {
        discardDeltasFor(sessionID, messageID);
        useMessagesStore.getState().removeMessage(sessionID, messageID);
      }
      return;
    }

    case "message.part.updated": {
      const sessionID = props.sessionID;
      const part = props.part;
      if (sessionID && part && typeof part === "object" && "id" in part) {
        // 先 flush 同 part 的累计 delta，再用权威 part 覆盖。
        const partID = (part as { id?: string }).id;
        const messageID = (part as { messageID?: string }).messageID;
        if (messageID && partID) {
          flushDeltasFor(sessionID, messageID, partID);
          useMessagesStore.getState().upsertPart(sessionID, part as never);
        }
      }
      return;
    }

    case "message.part.removed": {
      const sessionID = props.sessionID;
      const messageID = props.messageID;
      const partID = props.partID;
      if (sessionID && messageID && partID) {
        discardDeltasFor(sessionID, messageID, partID);
        useMessagesStore.getState().removePart(sessionID, partID);
      }
      return;
    }

    case "message.part.delta": {
      const sessionID = props.sessionID;
      const messageID = props.messageID;
      const partID = props.partID;
      const delta = props.delta;
      if (sessionID && messageID && partID && typeof delta === "string") {
        // 节流：累计到下一帧统一 flush，避免每秒数十次 store update 把
        // ChatScreen 拉得抖动。
        enqueueDelta(sessionID, messageID, partID, delta);
      }
      return;
    }

    case "permission.asked":
    case "permission.v2.asked": {
      const sessionID = props.sessionID;
      const id = props.id;
      if (sessionID && id) {
        usePermissionStore.getState().add({
          id,
          sessionID,
          permission: props.permission ?? (type === "permission.v2.asked" ? "tool" : "unknown"),
          patterns: props.patterns,
          metadata: props.metadata,
          description: props.description ?? (props.metadata?.description as string | undefined),
        });
      }
      return;
    }

    case "permission.replied":
    case "permission.v2.replied": {
      const id = props.requestID ?? props.id;
      if (id) usePermissionStore.getState().remove(id);
      return;
    }

    case "question.asked":
    case "question.v2.asked": {
      const id = props.id as string | undefined;
      const sessionID = props.sessionID as string | undefined;
      const questions = props.questions as unknown[] | undefined;
      if (id && sessionID && Array.isArray(questions)) {
        useQuestionStore.getState().add({ id, sessionID, questions: questions as never });
      }
      return;
    }

    case "question.replied":
    case "question.v2.replied":
    case "question.rejected":
    case "question.v2.rejected": {
      const id = (props.requestID ?? props.id) as string | undefined;
      if (id) useQuestionStore.getState().remove(id);
      return;
    }
  }
}
