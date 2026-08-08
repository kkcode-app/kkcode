/**
 * [INPUT]: AsyncStorage 持久化层
 * [OUTPUT]: useThemeStore - mode（明暗模式）及其持久化 setter
 * [POS]: store/ 的主题偏好持久化，被 useTheme() 和 settings 页消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "kkcode.theme.v1";
const LEGACY_STORAGE_KEY = "opencode-mobile.theme.v1";

type ThemeState = {
  mode: ThemeMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
};

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "system",
  hydrated: false,

  hydrate: async () => {
    let raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw == null) {
      const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy != null) {
        await AsyncStorage.setItem(STORAGE_KEY, legacy);
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    const mode: ThemeMode = raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
    set({ mode, hydrated: true });
  },

  setMode: async (mode) => {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
    set({ mode });
  },
}));
