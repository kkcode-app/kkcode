/**
 * [INPUT]: 依赖 @opencode-ai/sdk/v2 的 Session 类型与 zustand create
 * [OUTPUT]: 对外提供 useSessionsStore，会话列表增删改、当前会话标记及 loading/error/reset 状态；upsertSession 接受可选 serverID（多服务器隔离会话列表前向兼容字段，保留给 SSE/重命名/创建 等写入路径）
 * [POS]: store/ 的 OpenCode 会话索引，被会话列表、ChatScreen 与 SSE dispatch 共同消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Sessions store: list of sessions for the currently selected directory.

import { create } from "zustand";

import type { Session } from "@opencode-ai/sdk/v2";

type SessionsState = {
  sessions: Session[];
  // The session currently displayed in the chat screen (set by
  // app/chat/[id].tsx on focus, cleared on blur). The SSE-driven
  // `resyncQuestions` only fetches pending questions for this id — so
  // users on the sessions list, or any other surface, don't trigger a
  // fan-out of N GETs on every reconnect.
  currentSessionID: string | null;
  loading: boolean;
  error: string | null;
  setSessions: (sessions: Session[]) => void;
  upsertSession: (session: Session, serverID?: string) => void;
  removeSession: (id: string) => void;
  setCurrentSession: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  currentSessionID: null,
  loading: false,
  error: null,
  setSessions: (sessions) => set({ sessions }),
  upsertSession: (session, serverID) =>
    set((state) => {
      if (!session || !session.id) return state;
      // serverID 已是列表隔离前的占位字段；listSessions 走 listGlobal
      // 一次性拉跨项目会话，本存储维持单索引不变。
      void serverID;
      const idx = state.sessions.findIndex((s) => s.id === session.id);
      if (idx === -1) return { sessions: [session, ...state.sessions] };
      const next = state.sessions.slice();
      next[idx] = session;
      return { sessions: next };
    }),
  removeSession: (id) => set((state) => ({ sessions: state.sessions.filter((s) => s.id !== id) })),
  setCurrentSession: (id) => set({ currentSessionID: id }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      sessions: [],
      currentSessionID: null,
      loading: false,
      error: null,
    }),
}));
