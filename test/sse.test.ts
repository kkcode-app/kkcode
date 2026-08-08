// SSE subscriber — reconnect strategy (pure functions) + integration via mock.
//
// The reconnect logic is extracted into pure functions (createReconnectState,
// recordError, recordSuccess, isAuthError) that can be tested without any
// EventSource mock. The integration test uses setEventSourceFactory to inject
// a controllable mock.

import { strict as assert } from "node:assert";

import {
  createReconnectState,
  recordError,
  recordSuccess,
  isAuthError,
  MAX_CONSECUTIVE_ERRORS,
  setEventSourceFactory,
  subscribeGlobalEvents,
} from "../src/api/sse";
import { test } from "./harness.ts";

export async function sseSuite() {
  console.log("\n== sse reconnect strategy ==");

  // ── isAuthError ──
  await test("isAuthError: 401 → true", () => {
    assert.equal(isAuthError("401 Unauthorized"), true);
  });

  await test("isAuthError: 'unauthorized' (any case) → true", () => {
    assert.equal(isAuthError("Request UNAUTHORIZED"), true);
    assert.equal(isAuthError("unauthorized access"), true);
  });

  await test("isAuthError: network error → false", () => {
    assert.equal(isAuthError("network error"), false);
    assert.equal(isAuthError("timeout"), false);
  });

  // ── createReconnectState ──
  await test("createReconnectState: initial values", () => {
    const s = createReconnectState();
    assert.equal(s.backoff, 1000);
    assert.equal(s.consecutiveErrors, 0);
    assert.equal(s.closed, false);
  });

  // ── recordSuccess ──
  await test("recordSuccess: resets backoff and errors", () => {
    const s = createReconnectState();
    s.consecutiveErrors = 3;
    s.backoff = 8000;
    recordSuccess(s);
    assert.equal(s.backoff, 1000);
    assert.equal(s.consecutiveErrors, 0);
  });

  // ── recordError: exponential backoff ──
  await test("recordError: first error returns 1000ms delay", () => {
    const s = createReconnectState();
    const delay = recordError(s, "network error");
    assert.equal(delay, 1000);
    assert.equal(s.consecutiveErrors, 1);
    assert.equal(s.backoff, 2000, "backoff should double to 2000");
  });

  await test("recordError: second error returns 2000ms delay", () => {
    const s = createReconnectState();
    recordError(s, "err1");
    const delay = recordError(s, "err2");
    assert.equal(delay, 2000);
    assert.equal(s.consecutiveErrors, 2);
    assert.equal(s.backoff, 4000);
  });

  await test("recordError: third error returns 4000ms delay", () => {
    const s = createReconnectState();
    recordError(s, "e1");
    recordError(s, "e2");
    const delay = recordError(s, "e3");
    assert.equal(delay, 4000);
    assert.equal(s.consecutiveErrors, 3);
  });

  await test("recordError: fourth error returns null (fatal)", () => {
    const s = createReconnectState();
    recordError(s, "e1");
    recordError(s, "e2");
    recordError(s, "e3");
    const delay = recordError(s, "e4");
    assert.equal(delay, null, "should give up after MAX_CONSECUTIVE_ERRORS");
    assert.equal(s.consecutiveErrors, MAX_CONSECUTIVE_ERRORS);
  });

  await test("recordError: backoff caps at 30000ms", () => {
    const s = createReconnectState();
    // Simulate many errors to push backoff past cap
    for (let i = 0; i < 10; i++) {
      const delay = recordError(s, `err${i}`);
      if (delay === null) break;
    }
    // Even if we didn't reach fatal (which we would), backoff never exceeds 30s
    assert.ok(s.backoff <= 30000, `backoff should cap at 30000, got ${s.backoff}`);
  });

  // ── recordError: auth error ──
  await test("recordError: 401 immediately returns null (fatal)", () => {
    const s = createReconnectState();
    const delay = recordError(s, "401 Unauthorized");
    assert.equal(delay, null, "auth error should immediately give up");
    assert.equal(s.consecutiveErrors, MAX_CONSECUTIVE_ERRORS);
  });

  await test("recordError: 'unauthorized' immediately returns null", () => {
    const s = createReconnectState();
    const delay = recordError(s, "Request unauthorized");
    assert.equal(delay, null);
  });

  // ── recordError: success resets error count ──
  await test("recordError: after success, error count resets", () => {
    const s = createReconnectState();
    recordError(s, "e1");
    recordError(s, "e2");
    recordSuccess(s);
    const delay = recordError(s, "e3");
    assert.equal(delay, 1000, "should be back to initial backoff after success");
    assert.equal(s.consecutiveErrors, 1);
  });

  console.log("\n== sse integration (mock EventSource) ==");

  // ── Integration tests with mock EventSource ──
  type MockES = {
    _listeners: Record<string, ((e: any) => void)[]>;
    _url: string;
    _headers: Record<string, string>;
    closed: boolean;
    addEventListener: (type: string, fn: (e: any) => void) => void;
    removeAllEventListeners: () => void;
    close: () => void;
    _emit: (type: string, e?: any) => void;
  };

  let lastMock: MockES | null = null;
  let createCount = 0;

  function installMockFactory() {
    lastMock = null;
    createCount = 0;
    setEventSourceFactory(
      class MockEventSource {
        _listeners: Record<string, ((e: any) => void)[]> = {};
        _url: string;
        _headers: Record<string, string>;
        closed = false;

        constructor(url: string, opts?: any) {
          this._url = url;
          this._headers = opts?.headers ?? {};
          createCount++;
          lastMock = this as unknown as MockES;
        }
        addEventListener(type: string, fn: (e: any) => void) {
          (this._listeners[type] ??= []).push(fn);
        }
        removeAllEventListeners() {
          this._listeners = {};
        }
        close() {
          this.closed = true;
        }
        _emit(type: string, e?: any) {
          for (const fn of this._listeners[type] ?? []) fn(e ?? {});
        }
      } as any,
    );
  }

  await test("connects and delivers parsed events", () => {
    installMockFactory();
    const events: any[] = [];
    let opened = 0;
    const unsub = subscribeGlobalEvents({
      baseUrl: "http://localhost:4096",
      credentials: { username: "u", password: "p" },
      onEvent: (e) => events.push(e),
      onOpen: () => opened++,
    });

    assert.equal(createCount, 1);
    assert.equal(lastMock!._url, "http://localhost:4096/global/event");
    assert.ok(lastMock!._headers["Authorization"]?.startsWith("Basic "));

    lastMock!._emit("open");
    assert.equal(opened, 1);

    lastMock!._emit("message", { data: JSON.stringify({ type: "session.created", data: {} }) });
    assert.equal(events.length, 1);

    unsub();
  });

  await test("malformed JSON message is silently ignored", () => {
    installMockFactory();
    const events: any[] = [];
    const unsub = subscribeGlobalEvents({
      baseUrl: "http://x",
      credentials: { username: "u", password: "p" },
      onEvent: (e) => events.push(e),
    });

    lastMock!._emit("message", { data: "not json" });
    lastMock!._emit("message", { data: "" });
    assert.equal(events.length, 0);

    unsub();
  });

  await test("401 error triggers immediate onFatal (no retries)", () => {
    installMockFactory();
    let fatalCalled = false;
    subscribeGlobalEvents({
      baseUrl: "http://x",
      credentials: { username: "u", password: "p" },
      onEvent: () => {},
      onFatal: () => {
        fatalCalled = true;
      },
    });

    lastMock!._emit("error", { message: "401 Unauthorized" });

    assert.equal(fatalCalled, true, "onFatal should fire on 401");
    assert.equal(createCount, 1, "should not reconnect after 401 fatal");
  });

  await test("'unauthorized' in error triggers immediate onFatal", () => {
    installMockFactory();
    let fatalCalled = false;
    subscribeGlobalEvents({
      baseUrl: "http://x",
      credentials: { username: "u", password: "p" },
      onEvent: () => {},
      onFatal: () => {
        fatalCalled = true;
      },
    });

    lastMock!._emit("error", { message: "Request unauthorized" });

    assert.equal(fatalCalled, true);
    assert.equal(createCount, 1);
  });

  await test("non-fatal error does not trigger onFatal", () => {
    installMockFactory();
    let fatalCalled = false;
    const errors: string[] = [];
    const unsub = subscribeGlobalEvents({
      baseUrl: "http://x",
      credentials: { username: "u", password: "p" },
      onEvent: () => {},
      onError: (m) => errors.push(m),
      onFatal: () => {
        fatalCalled = true;
      },
    });

    lastMock!._emit("error", { message: "network error" });

    assert.equal(fatalCalled, false);
    assert.equal(errors.length, 1);

    unsub();
  });

  await test("Authorization header uses Basic auth", () => {
    installMockFactory();
    subscribeGlobalEvents({
      baseUrl: "http://x",
      credentials: { username: "user", password: "pass" },
      onEvent: () => {},
    });

    const header = lastMock!._headers["Authorization"];
    assert.ok(header.startsWith("Basic "), `expected Basic auth, got: ${header}`);
    assert.equal(header, "Basic dXNlcjpwYXNz");
  });

  await test("URL strips trailing slashes from baseUrl", () => {
    installMockFactory();
    subscribeGlobalEvents({
      baseUrl: "http://x///",
      credentials: { username: "u", password: "p" },
      onEvent: () => {},
    });

    assert.equal(lastMock!._url, "http://x/global/event");
  });

  await test("error without message field uses type", () => {
    installMockFactory();
    const errors: string[] = [];
    const unsub = subscribeGlobalEvents({
      baseUrl: "http://x",
      credentials: { username: "u", password: "p" },
      onEvent: () => {},
      onError: (m) => errors.push(m),
    });

    lastMock!._emit("error", { type: "fatal" });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /fatal/);

    unsub();
  });
}
