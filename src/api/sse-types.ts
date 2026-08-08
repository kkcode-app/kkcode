/**
 * [INPUT]: 无运行时依赖，镜像 OpenCode v2 global event 的 payload envelope
 * [OUTPUT]: 对外提供 EventPayload 与 GlobalEvent 类型
 * [POS]: api/ 的 SSE 共享类型边界，使 dispatch/tests 不必加载 react-native-sse
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// Shared SSE event type, separated from sse.ts so callers that only need the
// type don't pull in react-native-sse (which references XHR globals).

export type EventPayload = {
  id: string;
  type: string;
  properties: Record<string, unknown>;
};

// v2 /global/event wraps each event in a `payload` envelope with directory
// scoping metadata, see packages/sdk/js/src/v2/gen/types.gen.ts > GlobalEvent.
export type GlobalEvent = {
  directory: string;
  project?: string;
  workspace?: string;
  payload: EventPayload;
};
