// isLanHost — IPv4/IPv6 LAN host detection.
// Covers RFC1918, link-local, ULA, and edge cases (loopback, public, domains).

import { strict as assert } from "node:assert";

import { isLanHost } from "../src/utils/lan-host";
import { test } from "./harness.ts";

export async function lanHostSuite() {
  console.log("\n== lan-host ==");

  // ── IPv4 RFC1918 ──
  await test("10.x.x.x is LAN", () => {
    assert.equal(isLanHost("10.0.0.1"), true);
    assert.equal(isLanHost("10.255.255.255"), true);
  });

  await test("172.16-31.x.x is LAN", () => {
    assert.equal(isLanHost("172.16.0.1"), true);
    assert.equal(isLanHost("172.31.255.255"), true);
  });

  await test("172.15.x.x is NOT LAN (below range)", () => {
    assert.equal(isLanHost("172.15.0.1"), false);
  });

  await test("172.32.x.x is NOT LAN (above range)", () => {
    assert.equal(isLanHost("172.32.0.1"), false);
  });

  await test("192.168.x.x is LAN", () => {
    assert.equal(isLanHost("192.168.1.1"), true);
    assert.equal(isLanHost("192.168.0.0"), true);
  });

  // ── IPv4 link-local ──
  await test("169.254.x.x is LAN (link-local)", () => {
    assert.equal(isLanHost("169.254.1.1"), true);
  });

  // ── IPv4 negative cases ──
  await test("127.x.x.x is NOT LAN (loopback)", () => {
    assert.equal(isLanHost("127.0.0.1"), false);
  });

  await test("8.8.8.8 is NOT LAN (public)", () => {
    assert.equal(isLanHost("8.8.8.8"), false);
  });

  await test("0.0.0.0 is NOT LAN", () => {
    assert.equal(isLanHost("0.0.0.0"), false);
  });

  await test("255.255.255.255 is NOT LAN", () => {
    assert.equal(isLanHost("255.255.255.255"), false);
  });

  await test("malformed IPv4 returns false", () => {
    assert.equal(isLanHost("10.0.0"), false);
    assert.equal(isLanHost("10.0.0.256"), false);
    assert.equal(isLanHost("10.0.0.1.5"), false);
    assert.equal(isLanHost("abc.def.ghi.jkl"), false);
  });

  // ── IPv6 ULA (fc00::/7) ──
  await test("fc00:: is LAN (ULA)", () => {
    assert.equal(isLanHost("fc00::1"), true);
  });

  await test("fd00::1 is LAN (ULA)", () => {
    assert.equal(isLanHost("fd00::1"), true);
  });

  await test("fd12:3456:7890::1 is LAN (ULA)", () => {
    assert.equal(isLanHost("fd12:3456:7890::1"), true);
  });

  // ── IPv6 link-local (fe80::/10) — regression ──
  await test("fe80::1 is LAN (link-local) — regression", () => {
    assert.equal(isLanHost("fe80::1"), true);
  });

  await test("fe80::1234:5678 is LAN (link-local)", () => {
    assert.equal(isLanHost("fe80::1234:5678"), true);
  });

  await test("fe90::1 is LAN (within fe80::/10 range fe80-febf)", () => {
    assert.equal(isLanHost("fe90::1"), true);
  });

  await test("febf::1 is LAN (top of fe80::/10 range)", () => {
    assert.equal(isLanHost("febf::1"), true);
  });

  await test("fec0::1 is NOT LAN (above fe80::/10, not ULA)", () => {
    assert.equal(isLanHost("fec0::1"), false);
  });

  // ── IPv6 negative cases ──
  await test("::1 is NOT LAN (loopback)", () => {
    assert.equal(isLanHost("::1"), false);
  });

  await test("2001:db8::1 is NOT LAN (documentation prefix)", () => {
    assert.equal(isLanHost("2001:db8::1"), false);
  });

  await test("2606:4700::1 is NOT LAN (public Cloudflare)", () => {
    assert.equal(isLanHost("2606:4700::1"), false);
  });

  // ── IPv6 zone ID ──
  await test("fe80::1%en0 strips zone and detects LAN", () => {
    assert.equal(isLanHost("fe80::1%en0"), true);
  });

  // ── Edge cases ──
  await test("empty string is NOT LAN", () => {
    assert.equal(isLanHost(""), false);
    assert.equal(isLanHost("   "), false);
  });

  await test("domain names are NOT LAN", () => {
    assert.equal(isLanHost("opencode.local"), false);
    assert.equal(isLanHost("nas.home"), false);
    assert.equal(isLanHost("example.com"), false);
  });

  await test("trims whitespace", () => {
    assert.equal(isLanHost("  10.0.0.1  "), true);
  });
}
