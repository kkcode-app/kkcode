/**
 * [INPUT]: 依赖 src/utils/time 的时间分隔能力与 test/harness
 * [OUTPUT]: 对外提供 timeSuite，覆盖分隔阈值与日期时间格式
 * [POS]: test 的时间工具回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";

import {
  shouldShowTimeSeparator,
  formatTimeSeparator,
  TIME_SEPARATOR_THRESHOLD_MS,
} from "../src/utils/time";
import { test } from "./harness.ts";

export async function timeSuite() {
  console.log("\n== time separator ==");

  // ── shouldShowTimeSeparator ──
  await test("first message always shows separator (prevCreated undefined)", () => {
    assert.equal(shouldShowTimeSeparator(undefined, Date.now()), true);
  });

  await test("prevCreated null shows separator", () => {
    assert.equal(shouldShowTimeSeparator(null as unknown as undefined, Date.now()), true);
  });

  await test("within threshold, same day: no separator", () => {
    const now = Date.now();
    assert.equal(shouldShowTimeSeparator(now, now + 1000), false);
  });

  await test("exceeds threshold (5min): show separator", () => {
    const now = Date.now();
    assert.equal(shouldShowTimeSeparator(now, now + TIME_SEPARATOR_THRESHOLD_MS), true);
  });

  await test("just below threshold: no separator", () => {
    const now = Date.now();
    assert.equal(shouldShowTimeSeparator(now, now + TIME_SEPARATOR_THRESHOLD_MS - 1), false);
  });

  await test("crosses midnight: show separator even if < threshold", () => {
    // 23:59:50 today
    const lateNight = new Date();
    lateNight.setHours(23, 59, 50, 0);
    // 00:00:05 next day — only 15s apart but crosses date boundary
    const afterMidnight = new Date(lateNight);
    afterMidnight.setHours(0, 0, 5, 0);
    afterMidnight.setDate(afterMidnight.getDate() + 1);
    assert.equal(shouldShowTimeSeparator(lateNight.getTime(), afterMidnight.getTime()), true);
  });

  await test("custom threshold overrides default", () => {
    const now = Date.now();
    assert.equal(shouldShowTimeSeparator(now, now + 5000, 10000), false);
    assert.equal(shouldShowTimeSeparator(now, now + 10001, 10000), true);
  });

  // ── formatTimeSeparator ──
  await test("formatTimeSeparator: today returns time only", () => {
    const now = new Date();
    const result = formatTimeSeparator(now.getTime(), "Yesterday");
    // Should match HH:MM or H:MM (locale may produce 12h or 24h)
    assert.match(result, /\d{1,2}:\d{2}/);
    // Should NOT contain "Yesterday"
    assert.ok(!result.includes("Yesterday"));
  });

  await test("formatTimeSeparator: yesterday returns label + time", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = formatTimeSeparator(yesterday.getTime(), "Yesterday");
    assert.ok(result.startsWith("Yesterday "), `expected prefix, got: ${result}`);
    assert.match(result, /Yesterday \d{1,2}:\d{2}/);
  });

  await test("formatTimeSeparator: older date returns date + time", () => {
    const old = new Date();
    old.setDate(old.getDate() - 7);
    const result = formatTimeSeparator(old.getTime(), "Yesterday");
    // Should not start with "Yesterday" and should contain a time component
    assert.ok(!result.startsWith("Yesterday"), `should not be yesterday: ${result}`);
    assert.match(result, /\d{1,2}:\d{2}/);
  });
}
