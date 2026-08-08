// Connection store tests: hydrate, add/update/remove/setActive,
// and the derived `active` selector.
//
// 注意：之前这里有 4 个针对 opencode-mobile / codepocket legacy key
// (LEGACY_KEY / LEGACY_V2_KEY) 的迁移测试,但 commit 8710873 已经把
// 迁移代码从 src/store/connection.ts 全部删掉 —— 不再支持从旧 key
// 升级。测试期望了已删除的产品行为,必然失败,这里一并清掉。

import { strict as assert } from "node:assert";

import * as SecureStore from "../src/utils/secure-store";
import { useConnectionStore, toClientConfig, type Server } from "../src/store/connection";
import { test } from "./harness.ts";

const STORAGE_KEY = "kkcode.servers.v3";

async function resetBackend() {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  useConnectionStore.setState({
    servers: {},
    order: [],
    activeId: null,
    active: null,
    hydrated: false,
  });
}

const SAMPLE: Server = {
  id: "srv-A",
  backend: "opencode",
  baseUrl: "http://10.0.0.1:4096",
  username: "opencode",
  password: "secret-A",
  nickname: "Home",
};

export async function connectionSuite() {
  console.log("\n== connection store ==");

  await test("addServer inserts at top and becomes active", async () => {
    await resetBackend();
    const id = await useConnectionStore.getState().addServer(SAMPLE);
    assert.equal(id, SAMPLE.id);
    const s = useConnectionStore.getState();
    assert.equal(s.activeId, SAMPLE.id);
    assert.deepEqual(s.order, [SAMPLE.id]);
    assert.deepEqual(s.servers[SAMPLE.id], SAMPLE);
  });

  await test("addServer multiple keeps newest first in order", async () => {
    await resetBackend();
    const a = await useConnectionStore.getState().addServer({
      ...SAMPLE,
      id: "A",
      baseUrl: "http://a",
    });
    const b = await useConnectionStore.getState().addServer({
      ...SAMPLE,
      id: "B",
      baseUrl: "http://b",
    });
    const s = useConnectionStore.getState();
    assert.deepEqual(s.order, [b, a]);
    assert.equal(s.activeId, b);
  });

  await test("addServer auto-assigns id when omitted", async () => {
    await resetBackend();
    const id = await useConnectionStore.getState().addServer({
      baseUrl: "http://x",
      username: "u",
      password: "p",
    });
    assert.ok(id.length > 0);
    assert.ok(useConnectionStore.getState().servers[id]);
  });

  await test("updateServer patches fields and persists", async () => {
    await resetBackend();
    const id = await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    await useConnectionStore.getState().updateServer(id, {
      nickname: "Office",
      baseUrl: "http://a-new",
    });
    const s = useConnectionStore.getState().servers[id]!;
    assert.equal(s.nickname, "Office");
    assert.equal(s.baseUrl, "http://a-new");
    // Untouched fields stay.
    assert.equal(s.password, "p");

    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    assert.ok(raw && raw.includes("http://a-new"));
  });

  await test("setActive switches the current server and persists", async () => {
    await resetBackend();
    const a = await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    const b = await useConnectionStore.getState().addServer({
      baseUrl: "http://b",
      username: "u",
      password: "p",
    });
    await useConnectionStore.getState().setActive(a);
    assert.equal(useConnectionStore.getState().activeId, a);

    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    assert.ok(raw && raw.includes('"activeId":"' + a + '"'));
  });

  await test("setActive ignores unknown ids (no-op)", async () => {
    await resetBackend();
    const a = await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    await useConnectionStore.getState().setActive("does-not-exist");
    assert.equal(useConnectionStore.getState().activeId, a);
  });

  await test("removeServer falls back to first remaining server", async () => {
    await resetBackend();
    const a = await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    const b = await useConnectionStore.getState().addServer({
      baseUrl: "http://b",
      username: "u",
      password: "p",
    });
    // Active is the most recently added (b). Removing a (not active) leaves
    // activeId pointing at b unchanged.
    await useConnectionStore.getState().removeServer(a);
    const s = useConnectionStore.getState();
    assert.equal(s.servers[a], undefined);
    assert.equal(s.activeId, b);
    assert.ok(s.activeId && s.servers[s.activeId]);

    // Now remove the active (b); activeId must fall back to the first
    // remaining server, or null when none remain.
    await useConnectionStore.getState().removeServer(b);
    assert.equal(useConnectionStore.getState().activeId, null);
  });

  await test("removeServer of last entry sets activeId to null", async () => {
    await resetBackend();
    const a = await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    await useConnectionStore.getState().removeServer(a);
    const s = useConnectionStore.getState();
    assert.equal(s.activeId, null);
    assert.deepEqual(s.order, []);
  });

  await test("derived active is null when activeId unset", async () => {
    await resetBackend();
    assert.equal(useConnectionStore.getState().active, null);
  });

  await test("clear wipes all servers and storage", async () => {
    await resetBackend();
    await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    await useConnectionStore.getState().clear();
    const s = useConnectionStore.getState();
    assert.equal(s.activeId, null);
    assert.deepEqual(s.order, []);
    assert.equal(await SecureStore.getItemAsync(STORAGE_KEY), null);
  });

  await test("hydrate: empty store leaves active null and sets hydrated", async () => {
    await resetBackend();
    await useConnectionStore.getState().hydrate();
    const s = useConnectionStore.getState();
    assert.equal(s.hydrated, true);
    assert.equal(s.active, null);
    assert.deepEqual(s.order, []);
  });

  await test("hydrate: valid v3 payload populates servers and active", async () => {
    await resetBackend();
    const payload = {
      v: 3,
      servers: [
        {
          id: "srv-1",
          baseUrl: "http://10.0.0.1:4096",
          username: "opencode",
          password: "secret",
          nickname: "Home",
        },
      ],
      order: ["srv-1"],
      activeId: "srv-1",
    };
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(payload));
    await useConnectionStore.getState().hydrate();
    const s = useConnectionStore.getState();
    assert.equal(s.hydrated, true);
    assert.equal(s.active?.baseUrl, "http://10.0.0.1:4096");
    assert.equal(s.active?.backend, "opencode");
    assert.equal(s.active?.backend === "opencode" ? s.active.password : undefined, "secret");
    assert.equal(s.activeId, "srv-1");
  });

  await test("hydrate: drops unsupported backend entries and rewrites storage", async () => {
    await resetBackend();
    const payload = {
      v: 3,
      servers: [
        {
          id: "srv-unsupported",
          backend: "unsupported",
          baseUrl: "http://unsupported",
        },
        {
          id: "srv-open",
          backend: "opencode",
          baseUrl: "http://open",
          username: "opencode",
          password: "secret",
        },
      ],
      order: ["srv-unsupported", "srv-open"],
      activeId: "srv-unsupported",
    };
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(payload));
    await useConnectionStore.getState().hydrate();

    const state = useConnectionStore.getState();
    assert.deepEqual(state.order, ["srv-open"]);
    assert.equal(state.activeId, "srv-open");
    assert.equal(state.servers["srv-unsupported"], undefined);

    const persisted = await SecureStore.getItemAsync(STORAGE_KEY);
    assert.ok(persisted);
    assert.equal(persisted.includes("srv-unsupported"), false);
  });

  await test("hydrate: corrupt JSON is dropped, store stays empty", async () => {
    await resetBackend();
    await SecureStore.setItemAsync(STORAGE_KEY, "{not json");
    await useConnectionStore.getState().hydrate();
    const s = useConnectionStore.getState();
    assert.equal(s.hydrated, true);
    assert.equal(s.active, null);
    // corrupt entry is NOT cleared by hydrate — hydrate is read-only on
    // missing keys; corruption is left in place so the next addServer
    // overwrites it. We only assert that hydrate does not crash.
  });

  await test("hydrate: wrong schema version (v1) is dropped", async () => {
    await resetBackend();
    const v1 = {
      baseUrl: "http://legacy",
      username: "opencode",
      password: "old",
    };
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(v1));
    await useConnectionStore.getState().hydrate();
    const s = useConnectionStore.getState();
    assert.equal(s.hydrated, true);
    // 没有 v === 2 的 schema,hydrate 直接放弃并保持空状态
    assert.equal(s.active, null);
  });

  await test("hydrate: drops legacy `directory` field on Server (v3 schema)", async () => {
    await resetBackend();
    // Legacy v3 payload (post-session-directory) with a `directory` on a Server
    // — should be silently stripped on hydrate. Working directory is now
    // per-session, not per-server.
    const payload = {
      v: 3,
      servers: [
        {
          id: "srv-legacy",
          baseUrl: "http://legacy",
          username: "u",
          password: "p",
          directory: "/Users/x/old",
        },
      ],
      order: ["srv-legacy"],
      activeId: "srv-legacy",
    };
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(payload));
    await useConnectionStore.getState().hydrate();
    const s = useConnectionStore.getState();
    assert.equal(s.activeId, "srv-legacy");
    assert.equal(
      (s.active as unknown as { directory?: string }).directory,
      undefined,
      "legacy directory must be dropped",
    );
  });

  await test("hydrate on already-hydrated is a no-op", async () => {
    await resetBackend();
    const id = await useConnectionStore.getState().addServer({
      baseUrl: "http://a",
      username: "u",
      password: "p",
    });
    // Force hydrated flag back to false to assert hydrate still re-uses the
    // current in-memory state via the early-return.
    useConnectionStore.setState({ hydrated: false });
    await useConnectionStore.getState().hydrate();
    assert.equal(useConnectionStore.getState().activeId, id);
  });

  await test("toClientConfig: no directory by default", () => {
    const cfg = toClientConfig(SAMPLE);
    assert.equal(cfg.baseUrl, SAMPLE.baseUrl);
    assert.deepEqual(cfg.credentials, {
      username: SAMPLE.username,
      password: SAMPLE.password,
    });
    assert.equal(cfg.directory, undefined);
  });

  await test("toClientConfig: explicit directory override is forwarded", () => {
    const cfg = toClientConfig(SAMPLE, "/Users/x/proj");
    assert.equal(cfg.directory, "/Users/x/proj");
  });
}
