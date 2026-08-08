import { strict as assert } from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { ClientConfig, CommandV2Info } from "../src/api/client.ts";
import { useCommandStore } from "../src/store/commands.ts";
import { test } from "./harness.ts";

function buildCommandServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== "GET" || !req.url?.startsWith("/api/command")) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          { name: "init", template: "Set up AGENTS.md", description: "guided setup" },
          {
            name: "review",
            template: "Review changes",
            description: "review changes",
            agent: "review",
            subtask: true,
          },
        ],
      }),
    );
  });
}

function buildFailingServer(): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "boom" }));
  });
}

function resetStore() {
  useCommandStore.getState().reset();
}

const SAMPLE_COMMANDS: CommandV2Info[] = [
  { name: "init", template: "T", description: "D1" },
  { name: "review", template: "T2", description: "D2" },
];

export async function commandStoreSuite() {
  console.log("\n== command store ==");

  await test("initial state is idle with empty arrays", () => {
    resetStore();
    const s = useCommandStore.getState();
    assert.equal(s.commands.length, 0);
    assert.deepEqual(s.byName, {});
    assert.equal(s.loading, "idle");
    assert.equal(s.error, undefined);
    assert.equal(s.loadedAt, undefined);
  });

  await test("setAll populates commands + byName index in one shot", () => {
    resetStore();
    useCommandStore.getState().setAll(SAMPLE_COMMANDS);
    const s = useCommandStore.getState();
    assert.equal(s.commands.length, 2);
    assert.equal(s.byName["init"]?.name, "init");
    assert.equal(s.byName["review"]?.description, "D2");
    assert.equal(s.loading, "ready");
    assert.ok(s.loadedAt, "loadedAt should be set after success");
  });

  await test("setAll skips entries without a name (defensive)", () => {
    resetStore();
    useCommandStore.getState().setAll([
      { name: "", template: "x" }, // invalid
      { name: "ok", template: "y" },
      // biome-ignore lint/suspicious/noExplicitAny: SDK allows optional fields, simulating edge
    ] as any);
    const s = useCommandStore.getState();
    assert.equal(s.commands.length, 1);
    assert.equal(Object.keys(s.byName).length, 1);
    assert.equal(s.byName["ok"]?.template, "y");
  });

  await test("load() success: fills store and goes to ready", async () => {
    resetStore();
    const server = buildCommandServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const config: ClientConfig = {
      baseUrl: "http://127.0.0.1:" + port,
      credentials: { username: "u", password: "p" },
    };
    try {
      await useCommandStore.getState().load(config);
      const s = useCommandStore.getState();
      assert.equal(s.loading, "ready");
      assert.equal(s.error, undefined);
      assert.equal(s.commands.length, 2);
      assert.equal(s.byName["init"]?.description, "guided setup");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await test("load() failure for a new scope clears stale commands", async () => {
    resetStore();
    useCommandStore.getState().setAll(SAMPLE_COMMANDS);
    const server = buildFailingServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const config: ClientConfig = {
      baseUrl: "http://127.0.0.1:" + port,
      credentials: { username: "u", password: "p" },
    };
    try {
      await useCommandStore.getState().load(config);
      const s = useCommandStore.getState();
      assert.equal(s.loading, "error");
      assert.ok(s.error, "error message should be captured");
      // `setAll` has no scope. A subsequent scoped request must not expose
      // that unscoped snapshot as a different workspace's command list.
      assert.equal(s.commands.length, 0);
      assert.equal(s.byName["init"], undefined);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await test("reset() wipes everything", () => {
    useCommandStore.getState().setAll(SAMPLE_COMMANDS);
    useCommandStore.getState().reset();
    const s = useCommandStore.getState();
    assert.equal(s.commands.length, 0);
    assert.deepEqual(s.byName, {});
    assert.equal(s.loading, "idle");
    assert.equal(s.error, undefined);
    assert.equal(s.loadedAt, undefined);
  });

  await test("selector hooks read narrow slices (verified via getState, hooks are pure accessors)", () => {
    resetStore();
    useCommandStore.getState().setAll(SAMPLE_COMMANDS);
    // The exported `useCommands` / `useCommandByName` / `useCommandLoading`
    // hooks are thin `(s) => s.field` selectors — they're the same call as
    // `useCommandStore.getState()` followed by field access. We can't call
    // them in plain Node (they depend on react's useSyncExternalStore), so
    // verify the underlying state slice each one would return.
    const s = useCommandStore.getState();
    assert.equal(s.commands.length, 2);
    assert.equal(s.byName["init"]?.name, "init");
    assert.equal(s.byName["missing"], undefined);
    assert.equal(s.loading, "ready");
  });
}
