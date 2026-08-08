/**
 * [INPUT]: 依赖 @react-native-async-storage/async-storage 的持久化
 * [OUTPUT]: 对外提供 useSessionPrefsStore（showSubSessions/groupByProject 状态、hydrate、setShowSubSessions、setGroupByProject）
 * [POS]: src/store 的会话列表显示偏好 store，被 app/sessions.tsx 切换分组/扁平与子会话过滤、app/settings.tsx 开关、app/_layout.tsx hydrate 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 会话列表显示偏好：控制是否在会话列表中显示子会话（parentID 不为空的会话），
// 以及是否按项目分组。默认都保持旧行为（显示子会话、按项目分组），用户可在设置页关闭。

import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "kkcode.session-prefs.v1";

type SessionPrefsState = {
  showSubSessions: boolean;
  groupByProject: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setShowSubSessions: (show: boolean) => Promise<void>;
  setGroupByProject: (group: boolean) => Promise<void>;
};

const DEFAULTS = {
  showSubSessions: true,
  groupByProject: true,
} as const;

type PersistedPrefs = {
  showSubSessions: boolean;
  groupByProject: boolean;
};

const isPersistedPrefs = (value: unknown): value is PersistedPrefs => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.showSubSessions === "boolean" && typeof v.groupByProject === "boolean";
};

export const useSessionPrefsStore = create<SessionPrefsState>((set, get) => ({
  showSubSessions: DEFAULTS.showSubSessions,
  groupByProject: DEFAULTS.groupByProject,
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    let showSubSessions: boolean = DEFAULTS.showSubSessions;
    let groupByProject: boolean = DEFAULTS.groupByProject;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (isPersistedPrefs(parsed)) {
          showSubSessions = parsed.showSubSessions;
          groupByProject = parsed.groupByProject;
        } else {
          // 旧格式（v1 早期）：直接存 "0"/"1" 字符串，仅承载 showSubSessions。
          showSubSessions = raw !== "0";
        }
      } catch {
        showSubSessions = raw !== "0";
      }
    }
    set({ showSubSessions, groupByProject, hydrated: true });
  },

  setShowSubSessions: async (show) => {
    const next: PersistedPrefs = {
      showSubSessions: show,
      groupByProject: get().groupByProject,
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 静默
    }
    set({ showSubSessions: show });
  },

  setGroupByProject: async (group) => {
    const next: PersistedPrefs = {
      showSubSessions: get().showSubSessions,
      groupByProject: group,
    };
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 静默
    }
    set({ groupByProject: group });
  },
}));
