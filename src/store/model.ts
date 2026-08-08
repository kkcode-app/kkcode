/**
 * [INPUT]: 依赖 @opencode-ai/sdk/v2 的 Message 类型、api/client 的 Agent/ProviderInfo 类型、AsyncStorage 的最近模型持久化、zustand 的状态容器
 * [OUTPUT]: 对外提供 ModelSelection/SessionSelection 类型、resolveMessageModel 消息选择解析器、variant 规范化、resolveInitialModel 默认模型解析器与 useModelStore
 * [POS]: src/store 的模型选择核心，统一管理 Server 模型配置、思考档位、全局最近选择与会话选择状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { Message } from "@opencode-ai/sdk/v2";
import type { Agent, ProviderInfo } from "../api/client";

export type ModelSelection = {
  providerID: string;
  modelID: string;
  variant?: string;
};

export type SessionSelection = {
  agent?: string;
  model?: ModelSelection;
};

// AsyncStorage key for the user's recent-model list (mirrors TUI's
// ~/.local/state/opencode/model.json `recent` array).
const RECENT_KEY = "@kkcode/model-recent";
const RECENT_MAX = 10;

type ModelState = {
  agents: Agent[];
  providers: ProviderInfo[];
  // server 端 GET /config/providers 返回的 default 映射:
  // Record<providerID, modelID>。来自 opencode.json + provider 内置默认的
  // 合并结果，是"该 provider 推荐的默认模型"。TUI 里是 fallback 链的倒数
  // 第二档（packages/tui/src/context/local.tsx fallbackModel 末尾的
  // sync.data.provider_default[provider.id]）。
  providerDefault: Record<string, string>;
  // server 端 opencode.json 顶级 `model` 字段（格式 "provider/model"），
  // 来自 GET /config。TUI 里是 fallback 链的第二档（仅次于 CLI --model）。
  configModel: string | null;

  selectedAgent: string | null;
  selectedModel: ModelSelection | null;

  // Per-session "last used" selection. Each chat session remembers its own
  // agent/model so re-opening a session restores the user's previous pick
  // (matters for LLM provider-side prompt-cache hit rate).
  sessionSelections: Record<string, SessionSelection>;

  // 用户最近主动选过的模型与思考档位，最新在前。TUI 在 model.json 里也叫 recent，
  // 是新会话兜底链的"上次选择"来源。我们持久化到 AsyncStorage，跨 server
  // 共享（用户换 server 时也希望保留偏好；切换后该模型若在新 server 不
  // 存在，自然会被 isModelValid 过滤掉）。
  recent: ModelSelection[];
  recentHydrated: boolean;

  setAgents: (agents: Agent[]) => void;
  setProviders: (providers: ProviderInfo[]) => void;
  setProviderDefault: (m: Record<string, string>) => void;
  setConfigModel: (m: string | null) => void;
  setSelectedAgent: (name: string | null) => void;
  setSelectedModel: (model: ModelSelection | null) => void;
  // Persist the currently-active agent/model against a session. Either field
  // can be omitted to leave the stored value untouched.
  setSessionSelection: (sessionID: string, sel: SessionSelection) => void;

  // 从 AsyncStorage 读 recent 列表，仅在 App 启动时调一次。
  hydrateRecent: () => Promise<void>;
  // 用户主动确认模型后调用：放到 recent 列表头部、去重、裁剪到 RECENT_MAX、
  // 异步落盘。重复调用幂等。
  addRecent: (m: ModelSelection) => void;

  // Wipe per-server caches (agents/providers/configModel/providerDefault) and
  // the in-memory selections; recent stays — it's the user's cross-server
  // preference history, mirroring TUI's recent[]。
  reset: () => void;
};

function dedupRecent(list: ModelSelection[]): ModelSelection[] {
  const seen = new Set<string>();
  const out: ModelSelection[] = [];
  for (const m of list) {
    if (!m || !m.providerID || !m.modelID) continue;
    const key = `${m.providerID}/${m.modelID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      providerID: m.providerID,
      modelID: m.modelID,
      ...(m.variant && m.variant !== "default" ? { variant: m.variant } : {}),
    });
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

function parseModel(value: string | null | undefined): ModelSelection | null {
  if (!value) return null;
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

/** Resolve the exact model selection carried by the latest conversation message. */
export function resolveMessageModel(message: Message | null | undefined): ModelSelection | null {
  if (!message) return null;
  if (message.role === "user") {
    return {
      providerID: message.model.providerID,
      modelID: message.model.modelID,
      variant: message.model.variant,
    };
  }
  return {
    providerID: message.providerID,
    modelID: message.modelID,
    variant: message.variant,
  };
}

export function normalizeModelSelection(
  providers: ProviderInfo[],
  selection: ModelSelection | null | undefined,
): ModelSelection | null {
  if (!selection) return null;
  const provider = providers.find((item) => item.id === selection.providerID);
  const model = provider?.models[selection.modelID];
  if (!model) return null;

  const normalized: ModelSelection = {
    providerID: selection.providerID,
    modelID: selection.modelID,
  };
  const variant = selection.variant;
  if (
    variant &&
    variant !== "default" &&
    Object.prototype.hasOwnProperty.call(model.variants ?? {}, variant)
  ) {
    normalized.variant = variant;
  }
  return normalized;
}

export function resolveInitialModel({
  providers,
  hasMessages,
  sessionModel,
  recent,
  configModel,
  providerDefault,
}: {
  providers: ProviderInfo[];
  hasMessages?: boolean;
  sessionModel?: ModelSelection | null;
  recent: ModelSelection[];
  configModel?: string | null;
  providerDefault: Record<string, string>;
}): ModelSelection | null {
  // Priority is a product invariant. Read MODEL_SELECTION.md before changing this chain.
  const conversationHasMessages = hasMessages ?? sessionModel != null;
  const candidates: (ModelSelection | null | undefined)[] = conversationHasMessages
    ? [sessionModel]
    : [recent[0]];
  candidates.push(parseModel(configModel));

  const firstProvider = providers[0];
  if (firstProvider) {
    const defaultModelID = providerDefault[firstProvider.id];
    if (defaultModelID) {
      candidates.push({ providerID: firstProvider.id, modelID: defaultModelID });
    }
    const firstModelID = Object.keys(firstProvider.models)[0];
    if (firstModelID) candidates.push({ providerID: firstProvider.id, modelID: firstModelID });
  }

  for (const candidate of candidates) {
    const normalized = normalizeModelSelection(providers, candidate);
    if (normalized) return normalized;
  }
  return null;
}

export const useModelStore = create<ModelState>((set, get) => ({
  agents: [],
  providers: [],
  providerDefault: {},
  configModel: null,
  selectedAgent: null,
  selectedModel: null,
  sessionSelections: {},
  recent: [],
  recentHydrated: false,

  setAgents: (agents) => set({ agents }),
  setProviders: (providers) => set({ providers }),
  setProviderDefault: (providerDefault) => set({ providerDefault }),
  setConfigModel: (configModel) => set({ configModel }),
  setSelectedAgent: (selectedAgent) => set({ selectedAgent }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),

  setSessionSelection: (sessionID, sel) =>
    set((state) => {
      const prev = state.sessionSelections[sessionID] ?? {};
      const next: SessionSelection = { ...prev, ...sel };
      // Strip undefined keys so we don't carry `{ agent: undefined }` around.
      if (next.agent === undefined) delete (next as Partial<SessionSelection>).agent;
      if (next.model === undefined) delete (next as Partial<SessionSelection>).model;
      return {
        sessionSelections: {
          ...state.sessionSelections,
          [sessionID]: next,
        },
      };
    }),

  hydrateRecent: async () => {
    if (get().recentHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          set({ recent: dedupRecent(parsed as ModelSelection[]) });
        }
      }
    } catch {
      // 损坏的存储忽略，下次写入时自然覆盖。
    } finally {
      set({ recentHydrated: true });
    }
  },

  addRecent: (m) => {
    if (!m || !m.providerID || !m.modelID) return;
    const next = dedupRecent([m, ...get().recent]);
    set({ recent: next });
    // 异步落盘，失败静默 —— 内存态已更新，不阻塞 UI。
    void AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
  },

  reset: () =>
    set((state) => ({
      agents: [],
      providers: [],
      providerDefault: {},
      configModel: null,
      selectedAgent: null,
      selectedModel: null,
      sessionSelections: {},
      // 显式保留 recent / recentHydrated：它们是跨 server 的用户历史偏好。
      recent: state.recent,
      recentHydrated: state.recentHydrated,
    })),
}));
