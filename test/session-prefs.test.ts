/**
 * [INPUT]: 依赖 src/store/session-prefs 的 useSessionPrefsStore
 * [OUTPUT]: 提供 sessionPrefsSuite，测试会话列表显隐偏好持久化
 * [POS]: test 的 session-prefs store 单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test } from "./harness.ts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSessionPrefsStore } from "../src/store/session-prefs.ts";

const STORAGE_KEY = "kkcode.session-prefs.v1";

function reset() {
  useSessionPrefsStore.setState({
    showSubSessions: true,
    groupByProject: true,
    hydrated: false,
  });
}

async function readRaw(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEY);
}

export async function sessionPrefsSuite() {
  console.log("\n─── session-prefs store ───");

  await test("hydrate — empty storage defaults to true/true", async () => {
    await AsyncStorage.clear();
    reset();
    await useSessionPrefsStore.getState().hydrate();
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== true) throw new Error("expected showSubSessions=true");
    if (s.groupByProject !== true) throw new Error("expected groupByProject=true");
    if (!s.hydrated) throw new Error("expected hydrated=true");
  });

  await test("hydrate — legacy '0' means showSubSessions=false, groupByProject default", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "0");
    reset();
    await useSessionPrefsStore.getState().hydrate();
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== false) throw new Error("expected showSubSessions=false");
    if (s.groupByProject !== true) throw new Error("expected groupByProject default true");
  });

  await test("hydrate — legacy '1' means showSubSessions=true, groupByProject default", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "1");
    reset();
    await useSessionPrefsStore.getState().hydrate();
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== true) throw new Error("expected showSubSessions=true");
    if (s.groupByProject !== true) throw new Error("expected groupByProject default true");
  });

  await test("hydrate — unknown value defaults both to true", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "maybe");
    reset();
    await useSessionPrefsStore.getState().hydrate();
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== true) throw new Error("expected showSubSessions=true");
    if (s.groupByProject !== true) throw new Error("expected groupByProject=true");
  });

  await test("hydrate — JSON payload restores both flags", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSubSessions: false, groupByProject: false }),
    );
    reset();
    await useSessionPrefsStore.getState().hydrate();
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== false) throw new Error("expected showSubSessions=false");
    if (s.groupByProject !== false) throw new Error("expected groupByProject=false");
  });

  await test("setShowSubSessions(false) — sets state and persists JSON", async () => {
    await AsyncStorage.clear();
    reset();
    await useSessionPrefsStore.getState().hydrate();
    await useSessionPrefsStore.getState().setShowSubSessions(false);
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== false) throw new Error("expected showSubSessions=false");
    const raw = await readRaw();
    if (!raw) throw new Error("expected persisted value");
    const parsed = JSON.parse(raw);
    if (parsed.showSubSessions !== false) throw new Error("expected showSubSessions=false in JSON");
    if (parsed.groupByProject !== true) throw new Error("expected groupByProject=true in JSON");
  });

  await test("setShowSubSessions(true) — sets state and persists JSON", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "0");
    reset();
    await useSessionPrefsStore.getState().hydrate();
    await useSessionPrefsStore.getState().setShowSubSessions(true);
    const s = useSessionPrefsStore.getState();
    if (s.showSubSessions !== true) throw new Error("expected showSubSessions=true");
    const raw = await readRaw();
    if (!raw) throw new Error("expected persisted value");
    const parsed = JSON.parse(raw);
    if (parsed.showSubSessions !== true) throw new Error("expected showSubSessions=true in JSON");
  });

  await test("setShowSubSessions — toggle back and forth", async () => {
    await AsyncStorage.clear();
    reset();
    await useSessionPrefsStore.getState().hydrate();
    await useSessionPrefsStore.getState().setShowSubSessions(false);
    if (useSessionPrefsStore.getState().showSubSessions !== false) {
      throw new Error("expected false");
    }
    await useSessionPrefsStore.getState().setShowSubSessions(true);
    if (useSessionPrefsStore.getState().showSubSessions !== true) {
      throw new Error("expected true");
    }
    await useSessionPrefsStore.getState().setShowSubSessions(false);
    if (useSessionPrefsStore.getState().showSubSessions !== false) {
      throw new Error("expected false");
    }
  });

  await test("setGroupByProject — flips groupByProject without touching showSubSessions", async () => {
    await AsyncStorage.clear();
    reset();
    await useSessionPrefsStore.getState().hydrate();
    await useSessionPrefsStore.getState().setGroupByProject(false);
    const s1 = useSessionPrefsStore.getState();
    if (s1.groupByProject !== false) throw new Error("expected groupByProject=false");
    if (s1.showSubSessions !== true) throw new Error("expected showSubSessions untouched");
    const raw1 = await readRaw();
    if (!raw1) throw new Error("expected persisted value");
    if (JSON.parse(raw1).groupByProject !== false)
      throw new Error("expected groupByProject=false in JSON");

    await useSessionPrefsStore.getState().setGroupByProject(true);
    const s2 = useSessionPrefsStore.getState();
    if (s2.groupByProject !== true) throw new Error("expected groupByProject=true");
    if (s2.showSubSessions !== true) throw new Error("expected showSubSessions still true");
  });

  await test("setShowSubSessions does not clobber groupByProject in storage", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showSubSessions: true, groupByProject: false }),
    );
    reset();
    await useSessionPrefsStore.getState().hydrate();
    await useSessionPrefsStore.getState().setShowSubSessions(false);
    const raw = await readRaw();
    if (!raw) throw new Error("expected persisted value");
    const parsed = JSON.parse(raw);
    if (parsed.groupByProject !== false) {
      throw new Error("expected groupByProject preserved as false");
    }
    if (parsed.showSubSessions !== false) {
      throw new Error("expected showSubSessions=false after set");
    }
  });
}
