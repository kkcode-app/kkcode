// Directory preferences store test suite
import { test } from "./harness.ts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDirectoryPrefsStore } from "../src/store/directory-prefs.ts";

const STORAGE_KEY = "kkcode.directory-prefs.v2";
const V1_KEY = "kkcode.directory-prefs.v1";

function reset() {
  useDirectoryPrefsStore.setState({
    showHidden: false,
    recentDirsCollapsed: false,
    recentDirs: {},
    hydrated: false,
  });
}

export async function directoryPrefsSuite() {
  console.log("\n─── directory-prefs store ───");

  await test("hydrate — empty storage defaults", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    const s = useDirectoryPrefsStore.getState();
    if (s.showHidden !== false) throw new Error("expected showHidden=false");
    if (s.recentDirsCollapsed !== false) throw new Error("expected recentDirsCollapsed=false");
    if (Object.keys(s.recentDirs).length !== 0) throw new Error("expected empty recentDirs");
    if (!s.hydrated) throw new Error("expected hydrated=true");
  });

  await test("hydrate — reads persisted v2 data", async () => {
    await AsyncStorage.clear();
    const data = {
      showHidden: true,
      recentDirsCollapsed: true,
      recentDirs: { s1: [{ path: "/a", count: 3, lastUsed: Date.now() }] },
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    const s = useDirectoryPrefsStore.getState();
    if (!s.showHidden) throw new Error("expected showHidden=true");
    if (!s.recentDirsCollapsed) throw new Error("expected recentDirsCollapsed=true");
    if (s.recentDirs.s1?.length !== 1) throw new Error("expected 1 recent dir");
  });

  await test("hydrate — v1 migration ('1' means showHidden=true)", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(V1_KEY, "1");
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    if (!useDirectoryPrefsStore.getState().showHidden) {
      throw new Error("expected showHidden=true from v1 migration");
    }
  });

  await test("hydrate — v2 takes priority over v1", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(V1_KEY, "1");
    const data = { showHidden: false, recentDirsCollapsed: false, recentDirs: {} };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    if (useDirectoryPrefsStore.getState().showHidden) {
      throw new Error("expected v2 value (false) to win");
    }
  });

  await test("hydrate — corrupted v2 falls back to defaults", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(STORAGE_KEY, "not json!");
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    if (useDirectoryPrefsStore.getState().showHidden) {
      throw new Error("expected showHidden=false on corruption");
    }
  });

  await test("hydrate — idempotent (second call no-op)", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    useDirectoryPrefsStore.setState({ showHidden: true });
    await useDirectoryPrefsStore.getState().hydrate();
    // Should NOT reset because hydrated is already true
    if (!useDirectoryPrefsStore.getState().showHidden) {
      throw new Error("expected second hydrate to be no-op");
    }
  });

  await test("setShowHidden — toggles and persists", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().setShowHidden(true);
    if (!useDirectoryPrefsStore.getState().showHidden) throw new Error("expected true");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    if (!parsed.showHidden) throw new Error("expected persisted showHidden=true");
  });

  await test("setRecentDirsCollapsed — toggles and persists", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().setRecentDirsCollapsed(true);
    if (!useDirectoryPrefsStore.getState().recentDirsCollapsed) throw new Error("expected true");
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    if (!parsed.recentDirsCollapsed) throw new Error("expected persisted collapsed=true");
  });

  await test("recordDir — new entry added with count=1", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/home/user");
    const dirs = useDirectoryPrefsStore.getState().recentDirs.srv1;
    if (!dirs || dirs.length !== 1) throw new Error("expected 1 entry");
    if (dirs[0].path !== "/home/user") throw new Error("wrong path");
    if (dirs[0].count !== 1) throw new Error("expected count=1");
  });

  await test("recordDir — same path increments count", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/home/user");
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/home/user");
    const dirs = useDirectoryPrefsStore.getState().recentDirs.srv1;
    if (!dirs || dirs.length !== 1) throw new Error("expected 1 entry");
    if (dirs[0].count !== 2) throw new Error("expected count=2, got: " + dirs[0].count);
  });

  await test("recordDir — different servers isolated", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/a");
    await useDirectoryPrefsStore.getState().recordDir("srv2", "/b");
    const s = useDirectoryPrefsStore.getState();
    if (s.recentDirs.srv1?.length !== 1) throw new Error("srv1 should have 1");
    if (s.recentDirs.srv2?.length !== 1) throw new Error("srv2 should have 1");
  });

  await test("recordDir — caps at MAX_RECENT=10", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    for (let i = 0; i < 12; i++) {
      await useDirectoryPrefsStore.getState().recordDir("srv1", "/dir" + i);
    }
    const dirs = useDirectoryPrefsStore.getState().recentDirs.srv1;
    if (!dirs || dirs.length > 10) {
      throw new Error("expected max 10, got: " + dirs?.length);
    }
  });

  await test("removeDirEntry — removes specific path", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/a");
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/b");
    await useDirectoryPrefsStore.getState().removeDirEntry("srv1", "/a");
    const dirs = useDirectoryPrefsStore.getState().recentDirs.srv1;
    if (!dirs || dirs.length !== 1) throw new Error("expected 1 remaining");
    if (dirs[0].path !== "/b") throw new Error("wrong remaining path");
  });

  await test("removeDirEntry — no-op for unknown path", async () => {
    await AsyncStorage.clear();
    reset();
    await useDirectoryPrefsStore.getState().hydrate();
    await useDirectoryPrefsStore.getState().recordDir("srv1", "/a");
    await useDirectoryPrefsStore.getState().removeDirEntry("srv1", "/xyz");
    const dirs = useDirectoryPrefsStore.getState().recentDirs.srv1;
    if (!dirs || dirs.length !== 1) throw new Error("expected 1 entry unchanged");
  });
}
