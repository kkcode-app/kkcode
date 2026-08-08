/**
 * [INPUT]: 无外部依赖，纯函数
 * [OUTPUT]: 对外提供 stripMarkdown，把 markdown 源码粗略转成纯文本
 * [POS]: src/utils 的 markdown 剥离工具，被 ChatScreen 长按菜单的「复制」(复制渲染后纯文本) 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 把 markdown 源码粗略转成纯文本：剥离标题井号、加粗/斜体标记、行内代码反引号、
// 链接的 URL 部分、图片、列表标记、引用标记、水平线等。
// 这不是完整的 markdown→text 渲染器，只是够用的正则剥离；不完美可接受——
// 用户有「复制原文」兜底拿完整 markdown 源码。
//
// 保留代码块内容（仅去掉 ``` 围栏），因为代码本身就是纯文本。

export function stripMarkdown(src: string): string {
  if (!src) return "";

  let out = src;

  // 代码块围栏 ```lang ... ``` → 保留内容，去围栏行
  out = out.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => code);

  // 行内代码 `code` → code
  out = out.replace(/`([^`]+)`/g, "$1");

  // 图片 ![alt](url) → alt
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // 链接 [text](url) → text
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 标题井号 # / ## / ### ... → 去掉前导 #
  out = out.replace(/^#{1,6}\s+/gm, "");

  // 加粗 **text** / __text__ → text
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");

  // 斜体 *text* / _text_ → text（避免误伤单词内下划线，要求两侧无字母）
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, "$1$2");

  // 删除线 ~~text~~ → text
  out = out.replace(/~~([^~]+)~~/g, "$1");

  // 无序列表标记 - / * / + 开头 → 去掉
  out = out.replace(/^\s*[-*+]\s+/gm, "");

  // 有序列表标记 1. → 去掉
  out = out.replace(/^\s*\d+\.\s+/gm, "");

  // 引用 > → 去掉
  out = out.replace(/^\s*>\s?/gm, "");

  // 水平线 --- / *** / ___ → 去掉
  out = out.replace(/^\s*([-*_]){3,}\s*$/gm, "");

  // 多余空行压缩
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}
