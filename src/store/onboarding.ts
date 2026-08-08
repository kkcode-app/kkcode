// Onboarding 状态：记录用户是否完成应用介绍。
// 完成后写入持久化，启动时自动跳过；用户也可在设置页反复观看。

import { create } from "zustand";

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "kkcode.onboarding.v1";

type OnboardingState = {
  completed: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  markCompleted: () => Promise<void>;
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  completed: false,
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    set({ completed: raw === "1", hydrated: true });
  },

  markCompleted: async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // 兜底
    }
    set({ completed: true });
  },
}));
