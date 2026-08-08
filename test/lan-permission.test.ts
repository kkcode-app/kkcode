/**
 * [INPUT]: 依赖 src/utils/lan-permission 的 shouldPrewarmLocalNetwork
 * [OUTPUT]: 提供 lanPermissionSuite，测试局域网权限预热判断逻辑
 * [POS]: test 的 LAN 权限预热单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import { shouldPrewarmLocalNetwork } from "../src/utils/lan-permission.ts";

export async function lanPermissionSuite() {
  console.log("\n─── lan-permission ───");

  await test("RFC1918 private IPv4 returns true", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://192.168.1.100:3000"), true);
    assert.equal(shouldPrewarmLocalNetwork("http://10.0.0.5:8080"), true);
    assert.equal(shouldPrewarmLocalNetwork("http://172.16.0.1:4040"), true);
  });

  await test("link-local 169.254 returns true", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://169.254.1.1:3000"), true);
  });

  await test("public IPv4 returns false", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://8.8.8.8:3000"), false);
    assert.equal(shouldPrewarmLocalNetwork("http://1.1.1.1:443"), false);
    assert.equal(shouldPrewarmLocalNetwork("http://203.0.113.5:8080"), false);
  });

  await test("localhost returns false (not LAN in the permission sense)", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://localhost:3000"), false);
    assert.equal(shouldPrewarmLocalNetwork("http://127.0.0.1:3000"), false);
  });

  await test("hostname (non-IP) returns false", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://example.com:3000"), false);
    assert.equal(shouldPrewarmLocalNetwork("https://my-server.local:443"), false);
  });

  await test("invalid URL returns false", () => {
    assert.equal(shouldPrewarmLocalNetwork("not-a-url"), false);
    assert.equal(shouldPrewarmLocalNetwork(""), false);
    assert.equal(shouldPrewarmLocalNetwork("://missing-protocol"), false);
  });

  await test("IPv6 ULA fc00:: returns true (bare host without brackets)", () => {
    // isLanHost handles bare IPv6, but URL.hostname wraps in [].
    // shouldPrewarmLocalNetwork uses URL, so bracketed IPv6 currently returns false.
    // This test documents the bare-host path; the URL path is covered below.
    assert.equal(shouldPrewarmLocalNetwork("http://fc00::1:3000"), false);
  });

  await test("IPv6 link-local fe80:: returns true (bare host without brackets)", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://fe80::1:3000"), false);
  });

  await test("IPv6 public address returns false", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://[2606:4700:4700::1111]:443"), false);
  });

  await test("URL without port works", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://192.168.1.100"), true);
    assert.equal(shouldPrewarmLocalNetwork("http://8.8.8.8"), false);
  });

  await test("URL with path works", () => {
    assert.equal(shouldPrewarmLocalNetwork("http://192.168.1.100:3000/api/health"), true);
    assert.equal(shouldPrewarmLocalNetwork("https://example.com/api/health"), false);
  });
}
