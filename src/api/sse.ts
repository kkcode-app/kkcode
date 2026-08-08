// SSE subscriber for /global/event with reconnect: long-lived connection,
// parse JSON per event, exponential backoff on disconnect, and resync
// messages on reconnect.

import EventSource from "react-native-sse";

import { basicAuthHeader, type Credentials } from "../utils/auth";
import type { GlobalEvent } from "./sse-types";

export type { GlobalEvent };

export type SubscribeConfig = {
  baseUrl: string;
  credentials: Credentials;
  onEvent: (event: GlobalEvent) => void;
  onOpen?: () => void;
  onError?: (message: string) => void;
  /** 连续失败到达阈值/明确 401 后触发,UI 应展示永久错误提示。 */
  onFatal?: () => void;
};

// ── Reconnect strategy (pure, testable) ──────────────────────

export const MAX_CONSECUTIVE_ERRORS = 4;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export type ReconnectState = {
  backoff: number;
  consecutiveErrors: number;
  closed: boolean;
};

export function createReconnectState(): ReconnectState {
  return { backoff: INITIAL_BACKOFF_MS, consecutiveErrors: 0, closed: false };
}

/**
 * Returns true if the error message indicates an auth failure (401/unauthorized),
 * which should immediately trigger onFatal without retries.
 */
export function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("401") || lower.includes("unauthorized");
}

/**
 * Record a connection success — resets backoff and error count.
 */
export function recordSuccess(state: ReconnectState): void {
  state.backoff = INITIAL_BACKOFF_MS;
  state.consecutiveErrors = 0;
}

/**
 * Record an error. Returns the reconnect delay (ms) to wait, or null if
 * the strategy has given up (fatal threshold reached or auth error).
 *
 * After this returns null, the caller should invoke onFatal and stop.
 */
export function recordError(state: ReconnectState, message: string): number | null {
  state.consecutiveErrors++;
  if (isAuthError(message)) {
    state.consecutiveErrors = MAX_CONSECUTIVE_ERRORS;
  }
  if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    return null;
  }
  const delay = state.backoff;
  state.backoff = Math.min(state.backoff * 2, MAX_BACKOFF_MS);
  return delay;
}

// ── EventSource factory ──────────────────────────────────────

type EventSourceLike = {
  addEventListener: (type: string, fn: (e: any) => void) => void;
  removeAllEventListeners: () => void;
  close: () => void;
};
type EventSourceCtor = new (url: string, opts?: Record<string, unknown>) => EventSourceLike;

/**
 * Injectable EventSource constructor. In production this is react-native-sse's
 * default export. In tests it can be swapped via setEventSourceFactory.
 */
let eventSourceFactory: EventSourceCtor = EventSource as unknown as EventSourceCtor;

export function setEventSourceFactory(factory: EventSourceCtor): void {
  eventSourceFactory = factory;
}

export function subscribeGlobalEvents(config: SubscribeConfig): () => void {
  let source: EventSourceLike | null = null;
  const state = createReconnectState();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const buildUrl = () => {
    return config.baseUrl.replace(/\/+$/, "") + "/global/event";
  };

  const connect = () => {
    if (state.closed) return;

    const url = buildUrl();
    source = new eventSourceFactory(url, {
      headers: {
        Authorization: basicAuthHeader(config.credentials),
      },
      timeout: 0,
      pollingInterval: 0,
    });

    source.addEventListener("open", () => {
      recordSuccess(state);
      config.onOpen?.();
    });

    source.addEventListener("message", (e) => {
      if (!e.data) return;
      try {
        const parsed = JSON.parse(e.data) as GlobalEvent;
        config.onEvent(parsed);
      } catch {
        // 静默：单条消息解析失败不影响整体连接
      }
    });

    source.addEventListener("error", (event) => {
      const msg = "message" in event ? event.message : `error type=${event.type}`;
      config.onError?.(msg);
      scheduleReconnect(msg);
    });
  };

  const scheduleReconnect = (errorMsg: string) => {
    source?.close();
    source = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = recordError(state, errorMsg);
    if (delay === null) {
      config.onFatal?.();
      state.closed = true;
      return;
    }
    reconnectTimer = setTimeout(() => connect(), delay);
  };

  connect();

  return () => {
    state.closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.removeAllEventListeners();
    source?.close();
    source = null;
  };
}
