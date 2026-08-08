// Slash command cache. Commands are location-scoped on the server, therefore
// this store represents exactly one `(server, directory)` snapshot at a time.
// CommandPicker/CommandAutocomplete load the active chat session's snapshot;
// ChatScreen checks the scope before using its name index so a previous
// workspace can never execute one of its commands in the current workspace.
//
// MVP scope: server slash commands only (see app/components/CommandPicker.tsx).
// Source-tagging (`source: "command" | "mcp" | "skill"`) and recent-usage
// tracking are explicitly out of scope.

import { create } from "zustand";
import type { ClientConfig, CommandV2Info } from "../api/client";
import { listCommandsV2 } from "../api/client";

export type CommandLoadingState = "idle" | "loading" | "ready" | "error";

/** Stable identity for a server/workspace command snapshot. */
export function commandScopeKey(config: ClientConfig): string {
  return `${config.baseUrl.replace(/\/+$/, "")}|${config.directory ?? ""}`;
}

type CommandState = {
  commands: CommandV2Info[];
  /** Server + directory that produced `commands`; undefined before the first request. */
  scopeKey: string | undefined;
  /** O(1) name → command lookup, derived from `commands` on every write. */
  byName: Record<string, CommandV2Info>;
  loading: CommandLoadingState;
  /** Last load failure's message (undefined when loading !== "error"). */
  error: string | undefined;
  /** Timestamp (ms since epoch) of last successful load, undefined until first success. */
  loadedAt: number | undefined;

  /** Active fetch for a server/workspace snapshot. Later requests win over stale responses. */
  load: (config: ClientConfig) => Promise<void>;
  /** External write hook (tests, future SSE-driven updates). */
  setAll: (commands: CommandV2Info[]) => void;
  /** Wipe everything; called on connection reset. */
  reset: () => void;
};

function normalizeCommands(commands: CommandV2Info[]): {
  commands: CommandV2Info[];
  byName: Record<string, CommandV2Info>;
} {
  const list: CommandV2Info[] = [];
  const byName: Record<string, CommandV2Info> = {};
  for (const c of commands) {
    // Defensive: SDK type guarantees `name: string`, but listCommandsV2
    // already passed server JSON through `Array.isArray(res?.data)`. Drop
    // entries without a truthy name so `commands` and `byName` stay in
    // sync — never expose a command the picker can't address by name.
    if (!c || typeof c.name !== "string" || !c.name) continue;
    list.push(c);
    byName[c.name] = c;
  }
  return { commands: list, byName };
}

export const useCommandStore = create<CommandState>((set, get) => ({
  commands: [],
  scopeKey: undefined,
  byName: {},
  loading: "idle",
  error: undefined,
  loadedAt: undefined,

  load: async (config) => {
    const scopeKey = commandScopeKey(config);
    // Mark the desired snapshot before starting I/O. If the user switches
    // server/workspace while this request is in flight, its response is
    // discarded below instead of overwriting the newer command list.
    const sameScope = get().scopeKey === scopeKey;
    set(
      sameScope
        ? { scopeKey, loading: "loading", error: undefined }
        : {
            commands: [],
            byName: {},
            scopeKey,
            loading: "loading",
            error: undefined,
            loadedAt: undefined,
          },
    );
    try {
      const raw = await listCommandsV2(config);
      const { commands, byName } = normalizeCommands(raw);
      if (useCommandStore.getState().scopeKey !== scopeKey) return;
      set({
        commands,
        byName,
        loading: "ready",
        error: undefined,
        loadedAt: Date.now(),
      });
    } catch (err) {
      if (useCommandStore.getState().scopeKey !== scopeKey) return;
      // Distinguish transient (network) from authoritative (404 not implemented)
      // failures only matters for retry policy — useEventStream already retries
      // the SSE connection itself. We just record the latest error string for
      // UI display in CommandPicker.
      set({
        loading: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setAll: (commands) => {
    const { commands: list, byName } = normalizeCommands(commands);
    set({
      commands: list,
      byName,
      loading: "ready",
      error: undefined,
      loadedAt: Date.now(),
    });
  },

  reset: () =>
    set({
      commands: [],
      byName: {},
      scopeKey: undefined,
      loading: "idle",
      error: undefined,
      loadedAt: undefined,
    }),
}));

// Selector hooks — single-field subscriptions avoid whole-store re-renders.
// Component-local callers (CommandPicker, ChatScreen.onSend) can pick the
// narrowest slice that satisfies their render need.
export const useCommands = () => useCommandStore((s) => s.commands);
export const useCommandByName = (name: string) => useCommandStore((s) => s.byName[name]);
export const useCommandLoading = () => useCommandStore((s) => s.loading);
export const useCommandError = () => useCommandStore((s) => s.error);
