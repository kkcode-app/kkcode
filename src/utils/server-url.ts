// URL 拆分/拼接工具 — 用于「添加服务器」页把 host/port/protocol 三段化表单，
// 提交时再拼回 baseUrl 字符串，保持存储 schema 不变。

export type Protocol = "http" | "https";

export type AddressParts = {
  protocol: Protocol;
  host: string;
  port: string;
};

export const DEFAULT_PROTOCOL: Protocol = "http";
export const DEFAULT_PORT = "4096";

export const PROTOCOL_OPTIONS: readonly Protocol[] = ["http", "https"];

function isProtocol(value: string): value is Protocol {
  return value === "http" || value === "https";
}

export function parseBaseUrl(baseUrl: string): AddressParts | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  // 兼容旧数据：用户可能存了裸 host 或漏了 scheme
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const u = new URL(withScheme);
    const proto = u.protocol.replace(":", "");
    if (!isProtocol(proto)) return null;
    // URL.port 在显式给出时是字符串；未给出时为空串——按协议默认端口兜底
    const port = u.port || (proto === "https" ? "443" : "80");
    return { protocol: proto, host: u.hostname, port };
  } catch {
    return null;
  }
}

export function composeBaseUrl(parts: AddressParts): string {
  const { protocol, host, port } = parts;
  const trimmedHost = host.trim();
  const trimmedPort = port.trim();
  const base = `${protocol}://${trimmedHost}`;
  // 默认端口对协议来说可以不写，用户填的非默认端口必须保留
  if (!trimmedPort) return base;
  const defaultPort = protocol === "https" ? "443" : "80";
  return trimmedPort === defaultPort ? base : `${base}:${trimmedPort}`;
}

export function isValidPort(port: string): boolean {
  if (!/^\d+$/.test(port.trim())) return false;
  const n = Number(port);
  return n >= 1 && n <= 65535;
}

// 返回错误 code，null 表示通过；UI 层映射到 i18n 文案
export function validateAddress(
  parts: Pick<AddressParts, "host" | "port">,
): "host_empty" | "port_invalid" | null {
  if (!parts.host.trim()) return "host_empty";
  if (!isValidPort(parts.port)) return "port_invalid";
  return null;
}
