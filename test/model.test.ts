/**
 * [INPUT]: 依赖 store/model 的模型状态与默认模型解析器、AsyncStorage mock、test/harness 测试基座
 * [OUTPUT]: 对外提供 modelSuite，覆盖状态读写、variant 规范化、持久化与会话/最近选择/Server 配置优先级
 * [POS]: test/ 的模型选择回归测试，约束聊天页默认模型与思考档位初始化语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  normalizeModelSelection,
  resolveInitialModel,
  resolveMessageModel,
  useModelStore,
  type ModelSelection,
} from "../src/store/model.ts";
import { test } from "./harness.ts";

const RECENT_KEY = "@kkcode/model-recent";

async function resetStore() {
  await AsyncStorage.removeItem(RECENT_KEY);
  useModelStore.setState({
    agents: [],
    providers: [],
    providerDefault: {},
    configModel: null,
    selectedAgent: null,
    selectedModel: null,
    sessionSelections: {},
    recent: [],
    recentHydrated: false,
  });
}

export async function modelSuite() {
  console.log("\n== model store ==");

  const providers = [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-session": {
          id: "claude-session",
          name: "Session",
          release_date: "2026",
          variants: { none: {}, low: {}, high: {} },
        },
        "claude-config": { id: "claude-config", name: "Config", release_date: "2026" },
      },
    },
    {
      id: "openai",
      name: "OpenAI",
      models: { "gpt-recent": { id: "gpt-recent", name: "Recent", release_date: "2026" } },
    },
  ] as never;

  await test("resolveInitialModel: existing session model has highest priority", () => {
    const picked = resolveInitialModel({
      providers,
      sessionModel: { providerID: "anthropic", modelID: "claude-session" },
      recent: [{ providerID: "openai", modelID: "gpt-recent" }],
      configModel: "anthropic/claude-config",
      providerDefault: {},
    });
    assert.deepEqual(picked, { providerID: "anthropic", modelID: "claude-session" });
  });

  await test("resolveMessageModel: restores model and variant from the latest user message", () => {
    assert.deepEqual(
      resolveMessageModel({
        id: "M-user",
        sessionID: "S1",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-session", variant: "high" },
      } as never),
      {
        providerID: "anthropic",
        modelID: "claude-session",
        variant: "high",
      },
    );
  });

  await test("resolveMessageModel: uses the actual latest assistant message", () => {
    assert.deepEqual(
      resolveMessageModel({
        id: "M-assistant",
        sessionID: "S1",
        role: "assistant",
        time: { created: 2 },
        parentID: "M-user",
        providerID: "openai",
        modelID: "gpt-recent",
        variant: "low",
      } as never),
      {
        providerID: "openai",
        modelID: "gpt-recent",
        variant: "low",
      },
    );
  });

  await test("resolveMessageModel: empty conversation has no session candidate", () => {
    assert.equal(resolveMessageModel(undefined), null);
  });

  await test("normalizeModelSelection: preserves supported variants including none", () => {
    assert.deepEqual(
      normalizeModelSelection(providers, {
        providerID: "anthropic",
        modelID: "claude-session",
        variant: "none",
      }),
      { providerID: "anthropic", modelID: "claude-session", variant: "none" },
    );
  });

  await test("normalizeModelSelection: default and stale variants fall back to model default", () => {
    for (const variant of ["default", "removed"]) {
      assert.deepEqual(
        normalizeModelSelection(providers, {
          providerID: "anthropic",
          modelID: "claude-session",
          variant,
        }),
        { providerID: "anthropic", modelID: "claude-session" },
      );
    }
  });

  await test("resolveInitialModel: restores a valid session variant", () => {
    const picked = resolveInitialModel({
      providers,
      sessionModel: {
        providerID: "anthropic",
        modelID: "claude-session",
        variant: "high",
      },
      recent: [],
      providerDefault: {},
    });
    assert.deepEqual(picked, {
      providerID: "anthropic",
      modelID: "claude-session",
      variant: "high",
    });
  });

  await test("resolveInitialModel: keeps model but drops an unsupported session variant", () => {
    const picked = resolveInitialModel({
      providers,
      sessionModel: {
        providerID: "anthropic",
        modelID: "claude-session",
        variant: "xhigh",
      },
      recent: [{ providerID: "openai", modelID: "gpt-recent" }],
      providerDefault: {},
    });
    assert.deepEqual(picked, { providerID: "anthropic", modelID: "claude-session" });
  });

  await test("resolveInitialModel: new session uses global last selected model", () => {
    const picked = resolveInitialModel({
      providers,
      recent: [{ providerID: "openai", modelID: "gpt-recent" }],
      configModel: "anthropic/claude-config",
      providerDefault: {},
    });
    assert.deepEqual(picked, { providerID: "openai", modelID: "gpt-recent" });
  });

  await test("resolveInitialModel: new session restores the last actively selected variant", () => {
    const picked = resolveInitialModel({
      providers,
      recent: [{ providerID: "anthropic", modelID: "claude-session", variant: "high" }],
      configModel: "anthropic/claude-config",
      providerDefault: {},
    });
    assert.deepEqual(picked, {
      providerID: "anthropic",
      modelID: "claude-session",
      variant: "high",
    });
  });

  await test("resolveInitialModel: empty session only considers the latest active selection", () => {
    const picked = resolveInitialModel({
      providers,
      hasMessages: false,
      recent: [
        { providerID: "removed", modelID: "removed", variant: "high" },
        { providerID: "openai", modelID: "gpt-recent" },
      ],
      configModel: "anthropic/claude-config",
      providerDefault: {},
    });
    assert.deepEqual(picked, { providerID: "anthropic", modelID: "claude-config" });
  });

  await test("resolveInitialModel: non-empty session never falls back to global recent", () => {
    const picked = resolveInitialModel({
      providers,
      hasMessages: true,
      sessionModel: { providerID: "removed", modelID: "removed", variant: "high" },
      recent: [{ providerID: "openai", modelID: "gpt-recent" }],
      configModel: "anthropic/claude-config",
      providerDefault: {},
    });
    assert.deepEqual(picked, { providerID: "anthropic", modelID: "claude-config" });
  });

  await test("resolveInitialModel: first install uses Server config model", () => {
    const picked = resolveInitialModel({
      providers,
      recent: [],
      configModel: "anthropic/claude-config",
      providerDefault: { anthropic: "claude-session" },
    });
    assert.deepEqual(picked, { providerID: "anthropic", modelID: "claude-config" });
  });

  await test("resolveInitialModel: skips unavailable candidates", () => {
    const picked = resolveInitialModel({
      providers,
      sessionModel: { providerID: "removed", modelID: "removed" },
      recent: [{ providerID: "removed", modelID: "removed" }],
      configModel: "removed/removed",
      providerDefault: { anthropic: "claude-session" },
    });
    assert.deepEqual(picked, { providerID: "anthropic", modelID: "claude-session" });
  });

  await test("setAgents stores agent list", () => {
    useModelStore.getState().setAgents([
      { name: "build", mode: "primary", builtIn: true },
      { name: "explore", mode: "all", builtIn: true },
    ] as never);
    const agents = useModelStore.getState().agents;
    assert.equal(agents.length, 2);
    assert.equal(agents[0].name, "build");
  });

  await test("setProviders stores provider list", () => {
    useModelStore.getState().setProviders([
      {
        id: "anthropic",
        name: "Anthropic",
        models: { claude: { id: "claude", name: "Claude", release_date: "2024" } },
      },
    ] as never);
    const providers = useModelStore.getState().providers;
    assert.equal(providers.length, 1);
    assert.equal(providers[0].id, "anthropic");
  });

  await test("setSelectedAgent / setSelectedModel", () => {
    useModelStore.getState().setSelectedAgent("build");
    assert.equal(useModelStore.getState().selectedAgent, "build");
    useModelStore.getState().setSelectedModel({ providerID: "anthropic", modelID: "claude" });
    assert.deepEqual(useModelStore.getState().selectedModel, {
      providerID: "anthropic",
      modelID: "claude",
    });
  });

  await test("setSelectedAgent null clears selection", () => {
    useModelStore.getState().setSelectedAgent("build");
    useModelStore.getState().setSelectedAgent(null);
    assert.equal(useModelStore.getState().selectedAgent, null);
  });

  await test("setSessionSelection: stores per-session preferences", () => {
    useModelStore.setState({ sessionSelections: {} });
    useModelStore.getState().setSessionSelection("S1", {
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude", variant: "high" },
    });
    const sel = useModelStore.getState().sessionSelections["S1"];
    assert.equal(sel?.agent, "build");
    assert.deepEqual(sel?.model, {
      providerID: "anthropic",
      modelID: "claude",
      variant: "high",
    });
  });

  await test("setSessionSelection: merges with existing (partial update)", () => {
    useModelStore.setState({ sessionSelections: {} });
    useModelStore.getState().setSessionSelection("S1", { agent: "build" });
    useModelStore
      .getState()
      .setSessionSelection("S1", { model: { providerID: "openai", modelID: "gpt-4" } });
    const sel = useModelStore.getState().sessionSelections["S1"];
    assert.equal(sel?.agent, "build");
    assert.deepEqual(sel?.model, { providerID: "openai", modelID: "gpt-4" });
  });

  await test("setSessionSelection: different sessions are isolated", () => {
    useModelStore.setState({ sessionSelections: {} });
    useModelStore.getState().setSessionSelection("S1", { agent: "build" });
    useModelStore.getState().setSessionSelection("S2", { agent: "explore" });
    assert.equal(useModelStore.getState().sessionSelections["S1"]?.agent, "build");
    assert.equal(useModelStore.getState().sessionSelections["S2"]?.agent, "explore");
  });

  await test("hydrateRecent: empty storage yields empty recent", async () => {
    await resetStore();
    await useModelStore.getState().hydrateRecent();
    assert.equal(useModelStore.getState().recentHydrated, true);
    assert.deepEqual(useModelStore.getState().recent, []);
  });

  await test("hydrateRecent: reads persisted list", async () => {
    await resetStore();
    const data: ModelSelection[] = [
      { providerID: "anthropic", modelID: "claude" },
      { providerID: "openai", modelID: "gpt-4" },
    ];
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(data));
    await useModelStore.getState().hydrateRecent();
    assert.equal(useModelStore.getState().recent.length, 2);
    assert.equal(useModelStore.getState().recent[0].modelID, "claude");
  });

  await test("hydrateRecent: restores the last actively selected variant", async () => {
    await resetStore();
    await AsyncStorage.setItem(
      RECENT_KEY,
      JSON.stringify([{ providerID: "anthropic", modelID: "claude", variant: "high" }]),
    );
    await useModelStore.getState().hydrateRecent();
    assert.deepEqual(useModelStore.getState().recent, [
      { providerID: "anthropic", modelID: "claude", variant: "high" },
    ]);
  });

  await test("hydrateRecent: corrupt JSON does not crash", async () => {
    await resetStore();
    await AsyncStorage.setItem(RECENT_KEY, "{not valid");
    await useModelStore.getState().hydrateRecent();
    assert.equal(useModelStore.getState().recentHydrated, true);
    assert.deepEqual(useModelStore.getState().recent, []);
  });

  await test("hydrateRecent: is idempotent (no-op on second call)", async () => {
    await resetStore();
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify([{ providerID: "a", modelID: "m1" }]));
    await useModelStore.getState().hydrateRecent();
    // Mutate storage after first hydrate
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify([{ providerID: "b", modelID: "m2" }]));
    await useModelStore.getState().hydrateRecent(); // should be no-op
    assert.equal(useModelStore.getState().recent[0].providerID, "a");
  });

  await test("addRecent: pushes to front and deduplicates", () => {
    useModelStore.setState({ recent: [], recentHydrated: true });
    useModelStore.getState().addRecent({ providerID: "a", modelID: "m1" });
    useModelStore.getState().addRecent({ providerID: "b", modelID: "m2" });
    useModelStore.getState().addRecent({ providerID: "a", modelID: "m1" }); // duplicate
    const recent = useModelStore.getState().recent;
    assert.equal(recent.length, 2);
    assert.equal(recent[0].providerID, "a"); // most recent first
    assert.equal(recent[1].providerID, "b");
  });

  await test("addRecent: preserves the latest variant while deduplicating by model", () => {
    useModelStore.setState({ recent: [], recentHydrated: true });
    useModelStore.getState().addRecent({ providerID: "a", modelID: "m1", variant: "low" });
    useModelStore.getState().addRecent({ providerID: "a", modelID: "m1", variant: "high" });
    assert.deepEqual(useModelStore.getState().recent, [
      { providerID: "a", modelID: "m1", variant: "high" },
    ]);
  });

  await test("addRecent: caps at 10 entries", () => {
    useModelStore.setState({ recent: [], recentHydrated: true });
    for (let i = 0; i < 15; i++) {
      useModelStore.getState().addRecent({ providerID: "p", modelID: `m${i}` });
    }
    assert.equal(useModelStore.getState().recent.length, 10);
    // Most recent should be m14 (last added)
    assert.equal(useModelStore.getState().recent[0].modelID, "m14");
  });

  await test("addRecent: ignores invalid entries (empty providerID/modelID)", () => {
    useModelStore.setState({ recent: [], recentHydrated: true });
    useModelStore.getState().addRecent({ providerID: "", modelID: "m1" });
    useModelStore.getState().addRecent({ providerID: "a", modelID: "" });
    useModelStore.getState().addRecent(null as never);
    assert.equal(useModelStore.getState().recent.length, 0);
  });

  await test("reset: clears agents/providers/selections but keeps recent", () => {
    useModelStore.setState({
      agents: [{ name: "build" }] as never,
      providers: [{ id: "a" }] as never,
      providerDefault: { a: "m1" },
      configModel: "a/m1",
      selectedAgent: "build",
      selectedModel: { providerID: "a", modelID: "m1" },
      sessionSelections: { S1: { agent: "build" } },
      recent: [{ providerID: "a", modelID: "m1" }],
      recentHydrated: true,
    });
    useModelStore.getState().reset();
    const s = useModelStore.getState();
    assert.deepEqual(s.agents, []);
    assert.deepEqual(s.providers, []);
    assert.deepEqual(s.providerDefault, {});
    assert.equal(s.configModel, null);
    assert.equal(s.selectedAgent, null);
    assert.equal(s.selectedModel, null);
    assert.deepEqual(s.sessionSelections, {});
    // recent preserved
    assert.equal(s.recent.length, 1);
    assert.equal(s.recentHydrated, true);
  });

  await test("setProviderDefault / setConfigModel", () => {
    useModelStore.getState().setProviderDefault({ anthropic: "claude-4" });
    assert.deepEqual(useModelStore.getState().providerDefault, { anthropic: "claude-4" });
    useModelStore.getState().setConfigModel("anthropic/claude-4");
    assert.equal(useModelStore.getState().configModel, "anthropic/claude-4");
  });
}
