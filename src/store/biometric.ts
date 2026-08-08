// 生物识别偏好：记录用户是否开启了生物识别锁屏。
// 默认关闭，用户在设置页主动开启后需要面容/指纹才能进入 APP。

import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "kkcode.biometric.v1";

type BiometricState = {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};

export const useBiometricStore = create<BiometricState>((set) => ({
  enabled: false,
  hydrated: false,

  hydrate: async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    set({ enabled: raw === "1", hydrated: true });
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
