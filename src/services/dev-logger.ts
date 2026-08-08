/**
 * [INPUT]: 无外部依赖，patch 全局 console.*
 * [OUTPUT]: startDevLogger / stopDevLogger / isDevLoggerActive / getDevLogs / clearDevLogs / setPaused / isPaused / subscribeDevLogs / exportDevLogs
 * [POS]: services/ 的开发面板日志服务，仅 __DEV__ 下由 _layout.tsx 调用 initDevLogger 初始化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type LogLevel = "log" | "warn" | "error" | "info" | "debug";

export interface DevLogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  args: unknown[];
  stack?: string;
  tag?: string;
}

const MAX_LOGS = 1000;
let logs: DevLogEntry[] = [];
let nextId = 1;
let paused = false;
let listeners: Set<() => void> = new Set();
let patched = false;

// 环形缓冲：超过上限时丢弃最旧条目
function push(entry: DevLogEntry): void {
  if (paused) return;
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(logs.length - MAX_LOGS);
  }
  notify();
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // 静默
    }
  }
}

// 从 args[0] 提取 [xxx] 前缀作为 tag
function extractTag(args: unknown[]): string | undefined {
  if (args.length === 0) return undefined;
  const first = args[0];
  if (typeof first === "string") {
    const m = first.match(/^\[([^\]]+)\]/);
    if (m) return m[1];
  }
  return undefined;
}

function safeStringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function captureStack(): string | undefined {
  try {
    const err = new Error();
    return err.stack?.split("\n").slice(3, 8).join("\n");
  } catch {
    return undefined;
  }
}

type OriginalConsole = {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
  info: typeof console.info;
  debug: typeof console.debug;
};

let original: OriginalConsole | null = null;

export function startDevLogger(): void {
  if (patched) return;
  patched = true;

  /* eslint-disable no-console -- dev-logger 需要读取并替换 console 方法 */
  original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  const wrap = (level: LogLevel) => {
    return (...args: unknown[]) => {
      push({
        id: nextId++,
        ts: Date.now(),
        level,
        args,
        tag: extractTag(args),
        stack: level === "error" || level === "warn" ? captureStack() : undefined,
      });
      (original as OriginalConsole)[level](...args);
    };
  };

  console.log = wrap("log");
  console.warn = wrap("warn");
  console.error = wrap("error");
  console.info = wrap("info");
  console.debug = wrap("debug");
  /* eslint-enable no-console */
}

export function stopDevLogger(): void {
  if (!patched || !original) return;
  patched = false;
  /* eslint-disable no-console -- 恢复原始 console 方法 */
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  console.info = original.info;
  console.debug = original.debug;
  /* eslint-enable no-console */
  original = null;
}

export function isDevLoggerActive(): boolean {
  return patched;
}

export function getDevLogs(): DevLogEntry[] {
  return logs;
}

export function clearDevLogs(): void {
  logs = [];
  notify();
}

export function setPaused(p: boolean): void {
  paused = p;
}

export function isPaused(): boolean {
  return paused;
}

export function subscribeDevLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function exportDevLogs(): string {
  return logs
    .map((e) => {
      const time = new Date(e.ts).toISOString();
      const content = e.args.map(safeStringify).join(" ");
      const tag = e.tag ? ` [${e.tag}]` : "";
      let line = `${time} ${e.level.toUpperCase()}${tag} ${content}`;
      if (e.stack) line += `\n${e.stack}`;
      return line;
    })
    .join("\n");
}
