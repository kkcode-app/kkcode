/**
 * [INPUT]: 接收当前工作区变更页已解析出的单文件 diff 文本与统计
 * [OUTPUT]: 提供有上限的内存预览缓存，供全屏 diff 路由按 opaque key 读取
 * [POS]: utils 的工作区 diff 页面间数据桥接层，不持久化且不触发网络请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type WorkspaceDiffPreview = {
  file: string;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
};

const MAX_PREVIEWS = 20;
const previews = new Map<string, WorkspaceDiffPreview>();
let nextPreviewID = 0;

/** Stores a parsed file diff for the short-lived full-screen route handoff. */
export function cacheWorkspaceDiffPreview(preview: WorkspaceDiffPreview): string {
  const key = `workspace-diff-${Date.now().toString(36)}-${++nextPreviewID}`;
  previews.set(key, preview);
  while (previews.size > MAX_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (!oldest) break;
    previews.delete(oldest);
  }
  return key;
}

/** Returns a preview held by the current app process, without fetching or persisting data. */
export function getWorkspaceDiffPreview(key: string): WorkspaceDiffPreview | undefined {
  return previews.get(key);
}
