/**
 * [INPUT]: 依赖 AsyncStorage 持久化开发者入口解锁状态，依赖 Zustand 提供响应式状态
 * [OUTPUT]: 对外提供 useDevAccessStore，管理设置页开发者入口的显隐与持久化
 * [POS]: store/ 的开发者入口门禁，被 app/about 的 Logo 十连击切换、被 app/settings 消费决定入口显隐
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "kkcode.dev-access.v1";

type DevAccessState = {
  unlocked: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggleUnlocked: () => Promise<boolean>;
  setUnlocked: (v: boolean) => Promise<void>;
};

export const useDevAccessStore = create<DevAccessState>((set, get) => ({
  unlocked: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ unlocked: raw === "1", hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  toggleUnlocked: async () => {
    const unlocked = !get().unlocked;
    await get().setUnlocked(unlocked);
    return unlocked;
  },

  setUnlocked: async (v) => {
    try {
      if (v) {
        await AsyncStorage.setItem(STORAGE_KEY, "1");
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // 内存状态仍立即生效，持久化失败不阻塞本次切换。
    }
    set({ unlocked: v });
  },
}));
