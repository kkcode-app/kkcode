/**
 * [INPUT]: 依赖 zustand 的 create
 * [OUTPUT]: 对外提供 usePendingOpenStore hook，含 pendingSessionId / requestOpen / consume
 * [POS]: store/ 的跨页桥接层，select-directory 创建新会话后回传 id 给 sessions 双栏容器打开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 仅服务于 iPad 双栏（Split View）：select-directory 在双栏下不再 router.replace
 * 到独立 chat 路由，而是 requestOpen(newSessionId) 后 router.back() 回 sessions，
 * sessions 容器消费该 id 把右侧栏切到新会话。单栏不使用此 store。
 */
import { create } from "zustand";

type PendingOpenState = {
  /** 待打开的新会话 id，null 表示无 */
  pendingSessionId: string | null;
  /** 标记一个待打开会话 */
  requestOpen: (id: string) => void;
  /** 消费并清空（返回 id 后置空，避免重复触发） */
  consume: () => string | null;
};

export const usePendingOpenStore = create<PendingOpenState>((set, get) => ({
  pendingSessionId: null,
  requestOpen: (id) => set({ pendingSessionId: id }),
  consume: () => {
    const id = get().pendingSessionId;
    if (id !== null) set({ pendingSessionId: null });
    return id;
  },
}));
