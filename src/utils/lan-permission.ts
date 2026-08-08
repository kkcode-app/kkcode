/**
 * [INPUT]: 依赖 expo/fetch、src/utils/lan-host 的 isLanHost；不需要鉴权头（warmup 阶段还没拿凭据）
 * [OUTPUT]: 对外提供 prewarmLocalNetwork 工具方法，提前触发 iOS 14+ 的"本地网络"授权弹窗
 * [POS]: src/utils 的网络预热辅助，被 app/server-edit.tsx 的连接按钮消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 局域网权限预热 —— iOS 14 起首次访问 RFC1918 / link-local / IPv6 ULA 时，系统会自动
// 弹"KKCode 想查找并连接本地网络上的设备"。问题在于：
//   1. 弹窗是被动的：必须先发起一次网络栈的访问 iOS 才会弹。
//   2. 默认的连接表单走 checkHealth → request → fetch(url)，用户在收到系统弹窗之前
//      已经看到 fetch 抛出的 TypeError "Network request failed"，体验上是"第一次
//      永远失败"。
// 解决：在正式 checkHealth 之前发一次"无害"请求，触发系统弹窗。warmup 失败是预期
// 路径（服务器可能还没开、IP 可能写错），绝对不能把它的错误向上抛——它只是用来
// 推系统弹窗的。
//
// 选 `/api/health` 的 HEAD 等价探测：服务端不收 HEAD 时会 405，但 iOS 端已经收到
// 包，所以弹窗已触发；并且 HEAD 比 GET 不带任何凭据/无副作用。host 非 LAN 时
// 直接跳过，避免对公网做无谓请求。

import { isLanHost } from "./lan-host";

const PREWARM_TIMEOUT_MS = 6000;

export type PrewarmOutcome = "skipped" | "done";

export function shouldPrewarmLocalNetwork(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return isLanHost(u.hostname);
  } catch {
    return false;
  }
}

export async function prewarmLocalNetwork(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<PrewarmOutcome> {
  if (!shouldPrewarmLocalNetwork(baseUrl)) return "skipped";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);
  const linkAbort = () => controller.abort();
  signal?.addEventListener("abort", linkAbort);

  try {
    let endpoint = baseUrl;
    try {
      const u = new URL(baseUrl);
      u.pathname = "/api/health";
      endpoint = u.toString();
    } catch {
      // baseUrl 不合法时啥也不做 —— 实际的"测试并连接"会捕获这个错误。
      return "skipped";
    }

    await fetch(endpoint, {
      method: "HEAD",
      signal: controller.signal,
    }).catch(() => undefined);
    return "done";
  } catch {
    return "done";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", linkAbort);
  }
}
