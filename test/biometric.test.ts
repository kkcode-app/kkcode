/**
 * [INPUT]: 依赖 src/store/biometric 的 useBiometricStore
 * [OUTPUT]: 提供 biometricSuite，测试生物识别开关持久化
 * [POS]: test 的 biometric store 单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "./harness.ts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useBiometricStore } from "../src/store/biometric.ts";

const STORAGE_KEY = "kkcode.biometric.v1";

function reset() {
  useBiometricStore.setState({ enabled: false, hydrated: false });
}

export async function biometricSuite() {
  console.log("\n─── biometric store ───");

  await test("hydrate — empty storage defaults to false", async () => {
    await AsyncStorage.clear();
    reset();
    await useBiometricStore.getState().hydrate();
    const s = useBiometricStore.getState();
    if (s.enabled !== false) throw new Error("expected enabled=false");
    if (!s.hydrated) throw new Error("expected hydrated=true");
  });

  await test("hydrate — '1' means enabled", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "1");
    reset();
    await useBiometricStore.getState().hydrate();
    if (!useBiometricStore.getState().enabled) throw new Error("expected enabled=true");
  });

  await test("hydrate — '0' means disabled", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "0");
    reset();
    await useBiometricStore.getState().hydrate();
    if (useBiometricStore.getState().enabled) throw new Error("expected enabled=false");
  });

  await test("hydrate — any other value means disabled", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "yes");
    reset();
    await useBiometricStore.getState().hydrate();
    if (useBiometricStore.getState().enabled) throw new Error("expected enabled=false");
  });

  await test("setEnabled(true) — sets state and persists", async () => {
    await AsyncStorage.clear();
    reset();
    await useBiometricStore.getState().hydrate();
    await useBiometricStore.getState().setEnabled(true);
    if (!useBiometricStore.getState().enabled) throw new Error("expected enabled=true");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== "1") throw new Error("expected '1' in storage");
  });

  await test("setEnabled(false) — sets state and persists", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "1");
    reset();
    await useBiometricStore.getState().hydrate();
    await useBiometricStore.getState().setEnabled(false);
    if (useBiometricStore.getState().enabled) throw new Error("expected enabled=false");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== "0") throw new Error("expected '0' in storage");
  });

  await test("setEnabled — toggle back and forth", async () => {
    await AsyncStorage.clear();
    reset();
    await useBiometricStore.getState().hydrate();
    await useBiometricStore.getState().setEnabled(true);
    if (!useBiometricStore.getState().enabled) throw new Error("expected true after first toggle");
    await useBiometricStore.getState().setEnabled(false);
    if (useBiometricStore.getState().enabled) throw new Error("expected false after second toggle");
    await useBiometricStore.getState().setEnabled(true);
    if (!useBiometricStore.getState().enabled) throw new Error("expected true after third toggle");
  });
}
