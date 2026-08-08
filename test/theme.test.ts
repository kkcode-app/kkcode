/**
 * [INPUT]: 依赖 store/theme 的 useThemeStore、theme/useTheme 与 react-test-renderer
 * [OUTPUT]: 提供 themeSuite，覆盖主题持久化迁移、设置与 Theme 聚合对象引用稳定性
 * [POS]: test/ 的主题状态与聚合 hook 回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useThemeStore } from "../src/store/theme.ts";
import { useTheme, type Theme } from "../src/theme/index.ts";
import { test } from "./harness.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const STORAGE_KEY = "kkcode.theme.v1";
const LEGACY_STORAGE_KEY = "opencode-mobile.theme.v1";

async function resetStore() {
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  useThemeStore.setState({
    mode: "system",
    hydrated: false,
  });
}

export async function themeSuite() {
  console.log("\n== theme store ==");

  await test("useTheme is stable until a real theme dependency changes", async () => {
    await resetStore();
    let currentTheme: Theme | null = null;
    let renderer: ReactTestRenderer | null = null;

    function Harness({ tick }: { tick: number }) {
      void tick;
      currentTheme = useTheme();
      return null;
    }

    await act(async () => {
      renderer = create(createElement(Harness, { tick: 0 }));
    });
    const firstTheme = currentTheme;
    assert.ok(firstTheme);

    act(() => {
      renderer!.update(createElement(Harness, { tick: 1 }));
    });
    assert.equal(currentTheme, firstTheme);

    act(() => {
      useThemeStore.setState({ mode: "dark" });
    });
    assert.notEqual(currentTheme, firstTheme);
    assert.equal(currentTheme?.isDark, true);

    act(() => renderer?.unmount());
  });

  await test("hydrate: empty storage defaults to system mode", async () => {
    await resetStore();
    await useThemeStore.getState().hydrate();
    const s = useThemeStore.getState();
    assert.equal(s.hydrated, true);
    assert.equal(s.mode, "system");
  });

  await test("hydrate: reads persisted 'dark' mode", async () => {
    await resetStore();
    await AsyncStorage.setItem(STORAGE_KEY, "dark");
    await useThemeStore.getState().hydrate();
    assert.equal(useThemeStore.getState().mode, "dark");
  });

  await test("hydrate: reads persisted 'light' mode", async () => {
    await resetStore();
    await AsyncStorage.setItem(STORAGE_KEY, "light");
    await useThemeStore.getState().hydrate();
    assert.equal(useThemeStore.getState().mode, "light");
  });

  await test("hydrate: invalid stored value falls back to system", async () => {
    await resetStore();
    await AsyncStorage.setItem(STORAGE_KEY, "bogus_value");
    await useThemeStore.getState().hydrate();
    assert.equal(useThemeStore.getState().mode, "system");
  });

  await test("hydrate: migrates from legacy key", async () => {
    await resetStore();
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, "dark");
    await useThemeStore.getState().hydrate();
    assert.equal(useThemeStore.getState().mode, "dark");
    const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    assert.equal(legacy, null);
    const newVal = await AsyncStorage.getItem(STORAGE_KEY);
    assert.equal(newVal, "dark");
  });

  await test("hydrate: existing new key takes precedence over legacy", async () => {
    await resetStore();
    await AsyncStorage.setItem(STORAGE_KEY, "light");
    await AsyncStorage.setItem(LEGACY_STORAGE_KEY, "dark");
    await useThemeStore.getState().hydrate();
    assert.equal(useThemeStore.getState().mode, "light");
  });

  await test("setMode persists and updates state", async () => {
    await resetStore();
    await useThemeStore.getState().hydrate();
    await useThemeStore.getState().setMode("dark");
    assert.equal(useThemeStore.getState().mode, "dark");
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    assert.equal(stored, "dark");
  });

  await test("setMode: switch from dark to light", async () => {
    await resetStore();
    await useThemeStore.getState().hydrate();
    await useThemeStore.getState().setMode("dark");
    await useThemeStore.getState().setMode("light");
    assert.equal(useThemeStore.getState().mode, "light");
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    assert.equal(stored, "light");
  });

  await test("setMode: switch back to system", async () => {
    await resetStore();
    await useThemeStore.getState().hydrate();
    await useThemeStore.getState().setMode("dark");
    await useThemeStore.getState().setMode("system");
    assert.equal(useThemeStore.getState().mode, "system");
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    assert.equal(stored, "system");
  });
}
