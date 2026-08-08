// Connection status store: tracks SSE connection state shown in the UI.

import { create } from "zustand";

export type ConnectionStatus = "idle" | "connecting" | "open" | "error" | "fatal";

type StatusState = {
  status: ConnectionStatus;
  errorMessage: string | null;
  /** SSE 每次成功建立连接时递增，chat 页面用它检测重连并补齐消息 */
  openCount: number;
  set: (status: ConnectionStatus, errorMessage?: string | null) => void;
};

export const useStatusStore = create<StatusState>((set) => ({
  status: "idle",
  errorMessage: null,
  openCount: 0,
  set: (status, errorMessage = null) =>
    set((prev) => ({
      status,
      errorMessage,
      openCount: status === "open" ? prev.openCount + 1 : prev.openCount,
    })),
}));
