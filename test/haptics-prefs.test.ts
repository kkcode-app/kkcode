// Haptics preferences store test suite
import { test } from "./harness.ts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useHapticsPrefsStore } from "../src/store/haptics-prefs.ts";

const STORAGE_KEY = "kkcode.haptics.v1";

function reset() {
  useHapticsPrefsStore.setState({ enabled: true, hydrated: false });
}

export async function hapticsSuite() {
  console.log("\n─── haptics-prefs store ───");

  await test("hydrate — empty storage defaults to enabled=true", async () => {
    await AsyncStorage.clear();
    reset();
    await useHapticsPrefsStore.getState().hydrate();
    const s = useHapticsPrefsStore.getState();
    if (!s.enabled) throw new Error("expected enabled=true");
    if (!s.hydrated) throw new Error("expected hydrated=true");
  });

  await test("hydrate — '1' means enabled", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "1");
    reset();
    await useHapticsPrefsStore.getState().hydrate();
    if (!useHapticsPrefsStore.getState().enabled) throw new Error("expected enabled=true");
  });

  await test("hydrate — '0' means disabled", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "0");
    reset();
    await useHapticsPrefsStore.getState().hydrate();
    if (useHapticsPrefsStore.getState().enabled) throw new Error("expected enabled=false");
  });

  await test("hydrate — null (no key) means enabled", async () => {
    await AsyncStorage.clear();
    reset();
    await useHapticsPrefsStore.getState().hydrate();
    if (!useHapticsPrefsStore.getState().enabled) throw new Error("expected enabled=true");
  });

  await test("setEnabled(false) — persists '0'", async () => {
    await AsyncStorage.clear();
    reset();
    await useHapticsPrefsStore.getState().setEnabled(false);
    if (useHapticsPrefsStore.getState().enabled) throw new Error("expected enabled=false");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== "0") throw new Error("expected '0', got: " + raw);
  });

  await test("setEnabled(true) — persists '1'", async () => {
    await AsyncStorage.clear();
    reset();
    await useHapticsPrefsStore.getState().setEnabled(true);
    if (!useHapticsPrefsStore.getState().enabled) throw new Error("expected enabled=true");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== "1") throw new Error("expected '1', got: " + raw);
  });

  await test("toggle off then on — state matches", async () => {
    await AsyncStorage.clear();
    reset();
    await useHapticsPrefsStore.getState().setEnabled(false);
    await useHapticsPrefsStore.getState().setEnabled(true);
    if (!useHapticsPrefsStore.getState().enabled)
      throw new Error("expected enabled=true after toggle");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== "1") throw new Error("expected '1' after re-enable");
  });
}
