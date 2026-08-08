/**
 * [INPUT]: 依赖 zustand 与 utils/secure-store，接收 OpenCode 服务器连接配置
 * [OUTPUT]: 对外提供 OpenCode Server 类型、useConnectionStore 与 toClientConfig
 * [POS]: src/store 的 OpenCode 连接注册表，负责持久化、迁移和当前服务器选择
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { create } from "zustand";

import * as SecureStore from "../utils/secure-store";
import type { ClientConfig } from "../api/client";
import type { Credentials } from "../utils/auth";

const STORAGE_KEY = "kkcode.servers.v3";

type ServerBase = {
  id: string;
  baseUrl: string;
  nickname?: string;
};

export type OpenCodeServer = ServerBase & {
  backend: "opencode";
  username: string;
  password: string;
};

export type Server = OpenCodeServer;

type LegacyOpenCodeServerInput = Omit<OpenCodeServer, "id" | "backend"> & {
  id?: string;
  backend?: "opencode";
};
type ServerInput = LegacyOpenCodeServerInput | (Omit<OpenCodeServer, "id"> & { id?: string });
type ServerPatch = Partial<Omit<OpenCodeServer, "id" | "backend">>;

export type Connection = Server;

type Persisted = {
  v: 2 | 3;
  servers: Record<string, unknown>[];
  order: string[];
  activeId: string | null;
};

type ConnectionState = {
  servers: Record<string, Server>;
  order: string[];
  activeId: string | null;
  active: Connection | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  addServer: (input: ServerInput) => Promise<string>;
  updateServer: (id: string, patch: ServerPatch) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  clear: () => Promise<void>;
};

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "srv-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pickActive(servers: Record<string, Server>, activeId: string | null): Connection | null {
  return activeId ? (servers[activeId] ?? null) : null;
}

function persist(
  state: Pick<ConnectionState, "servers" | "order" | "activeId">,
): Omit<Persisted, "servers"> & { servers: Server[] } {
  return {
    v: 3,
    servers: state.order.map((id) => state.servers[id]).filter(Boolean),
    order: state.order,
    activeId: state.activeId,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeServer(value: Record<string, unknown>): Server | null {
  if (
    typeof value.id !== "string" ||
    typeof value.baseUrl !== "string" ||
    (value.backend !== undefined && value.backend !== "opencode")
  ) {
    return null;
  }
  return {
    id: value.id,
    backend: "opencode",
    baseUrl: value.baseUrl,
    username: optionalString(value.username) ?? "opencode",
    password: optionalString(value.password) ?? "",
    nickname: optionalString(value.nickname),
  };
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  servers: {},
  order: [],
  activeId: null,
  active: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Persisted;
        if (
          parsed &&
          (parsed.v === 2 || parsed.v === 3) &&
          Array.isArray(parsed.servers) &&
          Array.isArray(parsed.order)
        ) {
          const servers: Record<string, Server> = {};
          for (const value of parsed.servers) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const server = normalizeServer(value);
            if (server) servers[server.id] = server;
          }
          const order = parsed.order.filter((id) => servers[id] !== undefined);
          const activeId =
            parsed.activeId && servers[parsed.activeId] ? parsed.activeId : (order[0] ?? null);
          set({ servers, order, activeId, active: pickActive(servers, activeId), hydrated: true });
          await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(persist(get())));
          return;
        }
      } catch {
        // fall through
      }
    }

    set({ servers: {}, order: [], activeId: null, active: null, hydrated: true });
  },

  addServer: async (input) => {
    const { id: inputId, ...rest } = input;
    const id = inputId ?? newId();
    const server: Server = { ...rest, backend: "opencode", id };
    set((state) => {
      const servers = { ...state.servers, [id]: server };
      const order = [id, ...state.order.filter((x) => x !== id)];
      return { servers, order, activeId: id, active: server };
    });
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(persist(get())));
    return id;
  },

  updateServer: async (id, patch) => {
    const current = get().servers[id];
    if (!current) return;
    const next: Server = { ...current, ...patch, id };
    set((state) => {
      const servers = { ...state.servers, [id]: next };
      return {
        servers,
        active: state.activeId === id ? next : state.active,
      };
    });
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(persist(get())));
  },

  removeServer: async (id) => {
    const state = get();
    if (!state.servers[id]) return;
    const order = state.order.filter((x) => x !== id);
    const { [id]: _removed, ...rest } = state.servers;
    let activeId = state.activeId;
    if (activeId === id) {
      activeId = order[0] ?? null;
    }
    const active = pickActive(rest, activeId);
    set({ servers: rest, order, activeId, active });
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(persist(get())));
  },

  setActive: async (id) => {
    const state = get();
    if (id !== null && !state.servers[id]) return;
    set({ activeId: id, active: pickActive(state.servers, id) });
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(persist(get())));
  },

  clear: async () => {
    set({ servers: {}, order: [], activeId: null, active: null });
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
}));

export function toClientConfig(connection: Connection, directory?: string): ClientConfig {
  const credentials: Credentials = {
    username: connection.username,
    password: connection.password,
  };
  return {
    baseUrl: connection.baseUrl,
    credentials,
    directory,
  };
}
