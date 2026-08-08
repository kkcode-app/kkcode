/**
 * [INPUT]: 依赖 @opencode-ai/sdk/v2 的 Part 类型，依赖 store/messages 的 MessageWithParts 类型
 * [OUTPUT]: 对外提供 getMessagePlainText，从 MessageWithParts 拼接出可复制的纯文本（markdown 源码）
 * [POS]: src/utils 的消息文本提取工具，被 ChatScreen 的 MessageBubble 长按菜单、message-text 选择页消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 从 MessageWithParts 中拼接出可复制的纯文本。
// 过滤 step-start/step-finish/空 text/系统元数据 part，把 text 与 reasoning
// part 的 .text 字段用 \n\n 连接。返回的是 markdown 源码（未剥离符号），
// 与 ChatScreen 早期 copyText 逻辑完全一致，只是抽出来供多处复用。

import type { Part } from "@opencode-ai/sdk/v2";
import type { MessageWithParts } from "../store/messages";

export function getMessagePlainText(item: MessageWithParts): string {
  const parts = item.partOrder
    .map((id) => item.partsById[id])
    .filter((part): part is Part => Boolean(part));

  const visibleParts = parts.filter(
    (p) =>
      p.type !== "step-start" &&
      p.type !== "step-finish" &&
      !(p.type === "text" && !("text" in p && p.text?.trim())),
  );

  return visibleParts
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text;
      if (part.type === "file") return part.filename ?? part.mime ?? "";
      return "";
    })
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}
