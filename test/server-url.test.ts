// server-url 工具单测：parseBaseUrl / composeBaseUrl / isValidPort / validateAddress

import { strict as assert } from "node:assert";

import {
  DEFAULT_PORT,
  DEFAULT_PROTOCOL,
  PROTOCOL_OPTIONS,
  composeBaseUrl,
  isValidPort,
  parseBaseUrl,
  validateAddress,
} from "../src/utils/server-url.ts";
import { test } from "./harness.ts";

export async function serverUrlSuite() {
  console.log("\n== server-url ==");

  await test("parseBaseUrl: 标准 http URL", () => {
    const r = parseBaseUrl("http://192.168.31.5:4096");
    assert.ok(r);
    assert.equal(r!.protocol, "http");
    assert.equal(r!.host, "192.168.31.5");
    assert.equal(r!.port, "4096");
  });

  await test("parseBaseUrl: 标准 https URL", () => {
    const r = parseBaseUrl("https://example.com:8443");
    assert.ok(r);
    assert.equal(r!.protocol, "https");
    assert.equal(r!.host, "example.com");
    assert.equal(r!.port, "8443");
  });

  await test("parseBaseUrl: 带尾部斜杠也能拆", () => {
    const r = parseBaseUrl("http://10.0.0.1:4096/");
    assert.ok(r);
    assert.equal(r!.port, "4096");
    assert.equal(r!.host, "10.0.0.1");
  });

  await test("parseBaseUrl: https 隐式端口 → 443", () => {
    const r = parseBaseUrl("https://example.com");
    assert.ok(r);
    assert.equal(r!.port, "443");
  });

  await test("parseBaseUrl: http 隐式端口 → 80", () => {
    const r = parseBaseUrl("http://example.com");
    assert.ok(r);
    assert.equal(r!.port, "80");
  });

  await test("parseBaseUrl: 空字符串 / 纯空白 → null", () => {
    assert.equal(parseBaseUrl(""), null);
    assert.equal(parseBaseUrl("   "), null);
  });

  await test("parseBaseUrl: 非法字符串 → null", () => {
    assert.equal(parseBaseUrl("not a url at all !!!"), null);
  });

  await test("parseBaseUrl: IPv6 地址（hostname 保留方括号）", () => {
    const r = parseBaseUrl("http://[::1]:8080");
    assert.ok(r);
    // WHATWG URL.hostname 对 IPv6 保留方括号，compose 时直接拼回去即可
    assert.equal(r!.host, "[::1]");
    assert.equal(r!.port, "8080");
  });

  await test("parseBaseUrl: scheme 大写归一为小写", () => {
    const r = parseBaseUrl("HTTP://EXAMPLE.COM:8080");
    assert.ok(r);
    assert.equal(r!.protocol, "http");
    assert.equal(r!.host, "example.com");
  });

  await test("composeBaseUrl: 标准输出", () => {
    assert.equal(
      composeBaseUrl({ protocol: "http", host: "10.0.0.1", port: "4096" }),
      "http://10.0.0.1:4096",
    );
  });

  await test("composeBaseUrl: https 非默认端口保留", () => {
    assert.equal(
      composeBaseUrl({ protocol: "https", host: "example.com", port: "8443" }),
      "https://example.com:8443",
    );
  });

  await test("composeBaseUrl: https 默认 443 省略端口", () => {
    assert.equal(
      composeBaseUrl({ protocol: "https", host: "example.com", port: "443" }),
      "https://example.com",
    );
  });

  await test("composeBaseUrl: http 默认 80 省略端口", () => {
    assert.equal(
      composeBaseUrl({ protocol: "http", host: "example.com", port: "80" }),
      "http://example.com",
    );
  });

  await test("composeBaseUrl: host 前后空白被 trim", () => {
    assert.equal(
      composeBaseUrl({ protocol: "http", host: "  10.0.0.1  ", port: "4096" }),
      "http://10.0.0.1:4096",
    );
  });

  await test("isValidPort: 合法边界", () => {
    assert.equal(isValidPort("1"), true);
    assert.equal(isValidPort("80"), true);
    assert.equal(isValidPort("4096"), true);
    assert.equal(isValidPort("65535"), true);
  });

  await test("isValidPort: 越界 / 非数字", () => {
    assert.equal(isValidPort("0"), false);
    assert.equal(isValidPort("65536"), false);
    assert.equal(isValidPort("-1"), false);
    assert.equal(isValidPort("abc"), false);
    assert.equal(isValidPort(""), false);
    assert.equal(isValidPort("80.5"), false);
    assert.equal(isValidPort("80a"), false);
    assert.equal(isValidPort("a80"), false);
  });

  await test("isValidPort: 前后空白被 trim 后视为合法", () => {
    // TextInput 输入时常带前后空白，统一 trim 后再校验
    assert.equal(isValidPort("  4096  "), true);
    assert.equal(isValidPort(" 80 "), true);
  });

  await test("validateAddress: 全合法 → null", () => {
    assert.equal(validateAddress({ host: "10.0.0.1", port: "4096" }), null);
  });

  await test("validateAddress: host 空 → host_empty", () => {
    assert.equal(validateAddress({ host: "", port: "4096" }), "host_empty");
    assert.equal(validateAddress({ host: "   ", port: "4096" }), "host_empty");
  });

  await test("validateAddress: port 非法 → port_invalid", () => {
    assert.equal(validateAddress({ host: "10.0.0.1", port: "99999" }), "port_invalid");
    assert.equal(validateAddress({ host: "10.0.0.1", port: "" }), "port_invalid");
  });

  await test("默认常量", () => {
    assert.equal(DEFAULT_PROTOCOL, "http");
    assert.equal(DEFAULT_PORT, "4096");
    assert.deepEqual([...PROTOCOL_OPTIONS], ["http", "https"]);
  });

  await test("round-trip: 拆分后能拼回", () => {
    const samples = [
      "http://10.0.0.1:4096",
      "https://example.com:8443",
      "http://192.168.1.10:3000",
    ];
    for (const s of samples) {
      const parts = parseBaseUrl(s);
      assert.ok(parts, "should parse: " + s);
      assert.equal(composeBaseUrl(parts!), s);
    }
  });
}
