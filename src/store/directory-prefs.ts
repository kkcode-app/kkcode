// [INPUT]: 依赖 @react-native-async-storage/async-storage 的持久化能力
// [OUTPUT]: 对外提供 useDirectoryPrefsStore hook，含 showHidden / recentDirs 状态及操作
// [POS]: store/ 的目录选择偏好管理，被 select-directory.tsx 消费
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import { create } from "zustand";

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "kkcode.directory-prefs.v2";
const MAX_RECENT = 10;

export type RecentDirEntry = {
  path: string;
  count: number;
  lastUsed: number;
};

function score(e: RecentDirEntry): number {
  // 最近使用时间衰减（天为单位），近 7 天权重高
  const daysSince = (Date.now() - e.lastUsed) / (1000 * 60 * 60 * 24);
  const recency = Math.max(0, 1 - daysSince / 30);
  return e.count * 0.4 + recency * 0.6;
}

function sortedDirs(dirs: RecentDirEntry[]): RecentDirEntry[] {
  return [...dirs].sort((a, b) => score(b) - score(a));
}

type DirectoryPrefsState = {
  showHidden: boolean;
  recentDirsCollapsed: boolean;
  // serverId → 该服务器下的常用目录列表（已按 score 排序）
  recentDirs: Record<string, RecentDirEntry[]>;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setShowHidden: (show: boolean) => Promise<void>;
  setRecentDirsCollapsed: (collapsed: boolean) => Promise<void>;
  // 记录一次使用（新建会话成功时调用）
  recordDir: (serverId: string, path: string) => Promise<void>;
  // 长按删除某条常用目录
  removeDirEntry: (serverId: string, path: string) => Promise<void>;
};

async function save(state: DirectoryPrefsState) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        showHidden: state.showHidden,
        recentDirsCollapsed: state.recentDirsCollapsed,
        recentDirs: state.recentDirs,
      }),
    );
  } catch {
    // 静默
  }
}

export const useDirectoryPrefsStore = create<DirectoryPrefsState>((set, get) => ({
  showHidden: false,
  recentDirsCollapsed: false,
  recentDirs: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    // 尝试读取 v2
    let raw = await AsyncStorage.getItem(STORAGE_KEY);

    // 迁移：读取旧 v1 的 showHidden
    let migratedShowHidden = false;
    if (!raw) {
      const oldRaw = await AsyncStorage.getItem("kkcode.directory-prefs.v1");
      if (oldRaw === "1") migratedShowHidden = true;
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        set({
          showHidden: parsed.showHidden ?? false,
          recentDirsCollapsed: parsed.recentDirsCollapsed ?? false,
          recentDirs: parsed.recentDirs ?? {},
          hydrated: true,
        });
        return;
      } catch {
        // 损坏则重置
      }
    }

    set({ showHidden: migratedShowHidden, recentDirs: {}, hydrated: true });
  },

  setShowHidden: async (show) => {
    set({ showHidden: show });
    await save(get());
  },

  setRecentDirsCollapsed: async (collapsed) => {
    set({ recentDirsCollapsed: collapsed });
    await save(get());
  },

  recordDir: async (serverId, path) => {
    const state = get();
    const existing = state.recentDirs[serverId] ?? [];
    const idx = existing.findIndex((e) => e.path === path);
    let updated: RecentDirEntry[];
    if (idx >= 0) {
      updated = existing.map((e, i) =>
        i === idx ? { ...e, count: e.count + 1, lastUsed: Date.now() } : e,
      );
    } else {
      updated = [...existing, { path, count: 1, lastUsed: Date.now() }];
    }
    // 排序后限制 MAX_RECENT 条
    const trimmed = sortedDirs(updated).slice(0, MAX_RECENT);
    const recentDirs = { ...state.recentDirs, [serverId]: trimmed };
    set({ recentDirs });
    await save(get());
  },

  removeDirEntry: async (serverId, path) => {
    const state = get();
    const existing = state.recentDirs[serverId] ?? [];
    const updated = existing.filter((e) => e.path !== path);
    const recentDirs = { ...state.recentDirs, [serverId]: updated };
    set({ recentDirs });
    await save(get());
  },
}));
