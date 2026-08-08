/**
 * [INPUT]: 依赖 React useEffect/useRef、OpenCode SSE transport、事件 dispatcher 与 connection/session/status stores
 * [OUTPUT]: 对外提供 useEventStream，仅为 OpenCode connection 建立全局事件订阅，支持回前台强制重连
 * [POS]: src/api 的 OpenCode React 协调层
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// React hook that opens the global SSE stream and dispatches events to the
// Zustand stores. Pure dispatcher logic lives in `./dispatch.ts` so it can be
// unit-tested without React or react-native-sse.

import { useEffect, useRef } from "react";

import { dispatchEvent, refetchQuestions } from "./dispatch";
import { subscribeGlobalEvents } from "./sse";
import type { Connection } from "../store/connection";
import { useSessionsStore } from "../store/sessions";
import { useStatusStore } from "../store/status";
import { trackEvent, AnalyticsEvents as Ev } from "../services/analytics";

export { dispatchEvent, refetchQuestions };
export type { GlobalEvent } from "./sse-types";

/**
 * 订阅全局 SSE 流并派发到 store。
 *
 * `foregroundEpoch` 在 App 从后台回到前台时递增。它让 effect 清理旧的
 * EventSource（包括已经进入 fatal、不会再自动重试的连接）并立即建立新连接，
 * 配合调用方先写入 connecting，避免聊天页短暂展示后台遗留的连接错误。
 */
export function useEventStream(connection: Connection | null, foregroundEpoch = 0) {
  // 当前 connection 生命周期内的累计 SSE 重连次数。onOpen 时清零,
  // onError 自增,onFatal 上报最后一次。便于排查"必须重启 App 才能恢复"的极端情形。
  const reconnectAttemptsRef = useRef(0);
  const latestForegroundEpochRef = useRef(foregroundEpoch);
  latestForegroundEpochRef.current = foregroundEpoch;
  const startedForegroundEpochRef = useRef(foregroundEpoch);

  useEffect(() => {
    let isForegroundRecovery = foregroundEpoch !== startedForegroundEpochRef.current;
    startedForegroundEpochRef.current = foregroundEpoch;

    if (!connection || connection.backend !== "opencode") {
      useStatusStore.getState().set("idle");
      return;
    }

    reconnectAttemptsRef.current = 0;
    useStatusStore.getState().set("connecting");
    void trackEvent(Ev.ConnectionStateChange, { state: "connecting" });
    let disposed = false;
    const isCurrent = () => !disposed && latestForegroundEpochRef.current === foregroundEpoch;

    // After every (re)open, resync the question store from the server. SSE
    // does not replay events that occurred while we were disconnected, so a
    // `question.v2.asked` emitted during the gap would otherwise be lost
    // forever (the QuestionPrompt would never show up).
    //
    // Only the session currently displayed in the chat screen needs this —
    // every other session in the list either has no pending questions (the
    // common case) or has them locally cached from when the user last
    // visited. Fetching per-session on every reconnect used to fan out to
    // `sessions.length` GETs, which on a flaky network and a long history
    // looked like a request storm in DevTools. The chat screen sets
    // `currentSessionID` via `setCurrentSession` on focus; on blur it
    // clears it, so on the sessions list / settings / etc. this is a no-op.
    const resyncQuestions = () => {
      const id = useSessionsStore.getState().currentSessionID;
      if (!id) return;
      void refetchQuestions(id);
    };

    const dispose = subscribeGlobalEvents({
      baseUrl: connection.baseUrl,
      credentials: {
        username: connection.username,
        password: connection.password,
      },
      onOpen: () => {
        if (!isCurrent()) return;
        const prev = useStatusStore.getState().status;
        const retried = reconnectAttemptsRef.current;
        reconnectAttemptsRef.current = 0;
        useStatusStore.getState().set("open");
        isForegroundRecovery = false;
        void trackEvent(Ev.ConnectionStateChange, {
          state: "open",
          retried: String(retried),
        });
        if (prev === "fatal") {
          // 之前已进入 fatal(连续失败/明确 401),这次成功重连:独立打点,便于分析"网络恢复"
          void trackEvent(Ev.SseFatalRecovered, { attempts_before_recovery: String(retried) });
        }
        resyncQuestions();
      },
      onError: (msg) => {
        if (!isCurrent()) return;
        reconnectAttemptsRef.current += 1;
        // 回前台后的几次失败属于恢复过程，保持连接中状态，让用户看到
        // SSE 正在自动重试；达到 fatal 阈值后再展示离线错误。
        useStatusStore
          .getState()
          .set(isForegroundRecovery ? "connecting" : "error", isForegroundRecovery ? null : msg);
        void trackEvent(Ev.ConnectionStateChange, {
          state: "error",
          has_message: msg ? "1" : "0",
          attempts: String(reconnectAttemptsRef.current),
        });
      },
      onFatal: () => {
        if (!isCurrent()) return;
        // 连续失败/明确 401 后,SSE 已停止重连;UI 浮起永久错误提示并指引用户。
        // errorMessage 留 null,由 sessions.tsx 通过 i18n key 渲染本地化文案。
        useStatusStore.getState().set("fatal", null);
        void trackEvent(Ev.ConnectionStateChange, {
          state: "fatal",
          attempts: String(reconnectAttemptsRef.current),
        });
      },
      onEvent: (event) => {
        if (isCurrent()) dispatchEvent(event);
      },
    });

    return () => {
      disposed = true;
      dispose();
    };
  }, [
    connection?.id,
    connection?.backend,
    connection?.baseUrl,
    connection?.backend === "opencode" ? connection.username : undefined,
    connection?.backend === "opencode" ? connection.password : undefined,
    foregroundEpoch,
  ]);
}
