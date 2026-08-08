/**
 * [INPUT]: 依赖 src/store/messages 的 MessageWithParts 类型
 * [OUTPUT]: 对外提供 isSessionStreaming(messages) 派生函数
 * [POS]: utils/ 的 session 状态工具，被 app/chat/[id].tsx (InputBar 三分支按钮)
 *        和 app/sessions.tsx (列表行 running pill) 共同依赖
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Session 运行状态派生 — "AI 还在生成" 这个信号不在任何 store 字段里,
// 而是从最后一条 assistant 消息的 `time.completed` 是否为 null 推出来。
// chat 页输入框、sessions 列表页的 running 指示都共用这一个事实来源。

import type { MessageWithParts } from "../store/messages";

// SDK 那边 AssistantMessage 的 time 形如 { created: number; completed?: number },
// 流式输出中 completed 是 undefined,完成时是时间戳。UserMessage 没有 completed
// 字段,这里用结构 narrowing 避免在 UserMessage 上误读。
type AssistantTime = { created: number; completed?: number };

function asAssistantTime(t: unknown): AssistantTime | null {
  if (t == null || typeof t !== "object") return null;
  const created = (t as { created?: unknown }).created;
  if (typeof created !== "number") return null;
  const completed = (t as { completed?: unknown }).completed;
  return {
    created,
    completed: typeof completed === "number" ? completed : undefined,
  };
}

export function isSessionStreaming(messages: MessageWithParts[] | undefined): boolean {
  if (!messages || messages.length === 0) return false;
  // 从尾部往前找最近一条 assistant 消息 —— 用户可能刚发了新消息,
  // 还没收到任何 AI 回复,这时应返回 false
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!.message;
    if (m.role === "assistant") {
      const time = asAssistantTime((m as unknown as { time?: unknown }).time);
      if (!time) return false;
      return time.completed == null;
    }
  }
  return false;
}
