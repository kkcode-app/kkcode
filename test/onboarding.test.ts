// Onboarding store test suite
import { test } from "./harness.ts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useOnboardingStore } from "../src/store/onboarding.ts";

const STORAGE_KEY = "kkcode.onboarding.v1";

function reset() {
  useOnboardingStore.setState({ completed: false, hydrated: false });
}

export async function onboardingSuite() {
  console.log("\n─── onboarding store ───");

  await test("hydrate — empty storage defaults to not completed", async () => {
    await AsyncStorage.clear();
    reset();
    await useOnboardingStore.getState().hydrate();
    const s = useOnboardingStore.getState();
    if (s.completed !== false) throw new Error("expected completed=false");
    if (!s.hydrated) throw new Error("expected hydrated=true");
  });

  await test("hydrate — '1' means completed", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "1");
    reset();
    await useOnboardingStore.getState().hydrate();
    if (!useOnboardingStore.getState().completed) throw new Error("expected completed=true");
  });

  await test("hydrate — '0' means not completed", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "0");
    reset();
    await useOnboardingStore.getState().hydrate();
    if (useOnboardingStore.getState().completed) throw new Error("expected completed=false");
  });

  await test("hydrate — any other value means not completed", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "hello");
    reset();
    await useOnboardingStore.getState().hydrate();
    if (useOnboardingStore.getState().completed) throw new Error("expected completed=false");
  });

  await test("markCompleted — sets state and persists", async () => {
    await AsyncStorage.clear();
    reset();
    await useOnboardingStore.getState().hydrate();
    await useOnboardingStore.getState().markCompleted();
    if (!useOnboardingStore.getState().completed) throw new Error("expected completed=true");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw !== "1") throw new Error("expected '1' in storage, got: " + raw);
  });

  await test("markCompleted — idempotent", async () => {
    await AsyncStorage.clear();
    reset();
    await useOnboardingStore.getState().hydrate();
    await useOnboardingStore.getState().markCompleted();
    await useOnboardingStore.getState().markCompleted();
    if (!useOnboardingStore.getState().completed) throw new Error("expected completed=true");
  });
}
