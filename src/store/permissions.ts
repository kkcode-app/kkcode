// Permission store: permission requests pause the agent until the user
// replies, so we need to surface them prominently in the UI.

import { create } from "zustand";

export type PermissionPrompt = {
  id: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
  // Best-effort human description pulled from the event payload.
  description?: string;
};

type PermissionState = {
  pending: PermissionPrompt[];
  add: (prompt: PermissionPrompt) => void;
  remove: (id: string) => void;
  reset: () => void;
};

export const usePermissionStore = create<PermissionState>((set) => ({
  pending: [],
  add: (prompt) =>
    set((state) => {
      if (state.pending.some((p) => p.id === prompt.id)) return state;
      return { pending: [...state.pending, prompt] };
    }),
  remove: (id) => set((state) => ({ pending: state.pending.filter((p) => p.id !== id) })),
  reset: () => set({ pending: [] }),
}));
