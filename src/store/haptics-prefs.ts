// Haptic feedback 偏好：用户在设置页可以一键关掉所有震动。
// 单独建一个 store,跟 directory-prefs 同模式(zustand + SecureStore),
// 不混进 connection / theme 那些跟"具体对象"绑定的 store。

import { create } from "zustand";

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "kkcode.haptics.v1";

type HapticsPrefsState = {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};

export const useHapticsPrefsStore = create<HapticsPrefsState>((set) => ({
  // 默认开 —— 大部分用户拿到新手机默认就震,符合肌肉记忆。
  // 设置页里提供"反馈"一节可以关。
  enabled: true,
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const enabled = raw !== "0";
    set({ enabled, hydrated: true });
  },

  setEnabled: async (enabled) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // 静默
    }
    set({ enabled });
  },
}));
