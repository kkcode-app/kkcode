/**
 * [INPUT]: 依赖 react-native 无外部依赖，纯函数解析 IPv4/IPv6 字符串
 * [OUTPUT]: 对外提供 isLanHost 工具方法，识别局域网/链路本地/唯一本地地址
 * [POS]: src/utils 的网络层辅助，被 src/utils/lan-permission 与连接前置检查消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// LAN host 判定 — 纯函数工具，给 prewarmLocalNetwork 之类"首次连接要不要打
// 本地网络权限开关"判断用。覆盖范围刻意放宽：
//   - IPv4 RFC1918: 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16
//   - IPv4 link-local: 169.254.0.0/16（macOS 用作 AirPlay / 自协商地址）
//   - IPv6 唯一本地: fc00::/7（RFC 4193）
//   - IPv6 link-local: fe80::/10（自协商）
// 不覆盖：loopback（127.0.0.0/8、::1）、组播、公网。
//
// 设计取舍：用户输入域名（"opencode.local"/"nas.home"）通常走 mDNS，不算 LAN IP。
// Bonjour 服务发现不在本工具职责范围，iOS 端的"本地网络"授权仍由预热 fetch 触发。

export function isLanHost(host: string): boolean {
  const value = host.trim();
  if (!value) return false;

  if (value.includes(":")) {
    return isLanIPv6(stripIPv6Zone(value));
  }
  if (value.includes(".") || /^\d+$/.test(value)) {
    return isLanIPv4(value);
  }
  return false;
}

function stripIPv6Zone(host: string): string {
  const pct = host.indexOf("%");
  return pct >= 0 ? host.slice(0, pct) : host;
}

function isLanIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
    octets.push(n);
  }
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isLanIPv6(host: string): boolean {
  if (host.includes(":")) {
    try {
      const normalized = normalizeIPv6(host);
      if (!normalized) return false;
      const firstByte = parseInt(normalized.slice(0, 4), 16);
      // fc00::/7  (ULA):           firstByte & 0xfe00 === 0xfc00
      // fe80::/10 (link-local):     firstByte & 0xffc0 === 0xfe80
      return (firstByte & 0xfe00) === 0xfc00 || (firstByte & 0xffc0) === 0xfe80;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeIPv6(host: string): string | null {
  const lower = host.toLowerCase();
  if (!lower.includes("::") && lower.split(":").length !== 8) return null;
  let groups = lower.includes("::") ? lower.split("::") : [lower, ""];
  const head = groups[0] ? groups[0].split(":") : [];
  const tail = groups[1] ? groups[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const fill = Array(missing).fill("0");
  const all = [...head, ...fill, ...tail];
  if (all.length !== 8) return null;
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => g.padStart(4, "0")).join("");
}
