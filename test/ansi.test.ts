/**
 * [INPUT]: 依赖 src/utils/ansi 的 parseAnsi / hasAnsi / ansiColorToHex / AnsiSpan / AnsiColorRef
 * [OUTPUT]: 提供 ansiSuite，测试 SGR 转义码解析、命名色/RGB/256 色映射、合并、空闭合序列与无 ANSI 短路
 * [POS]: test 的 ANSI 渲染工具单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import {
  ANSI_NAMED_BG_DARK,
  ANSI_NAMED_BG_LIGHT,
  ANSI_NAMED_FG_DARK,
  ANSI_NAMED_FG_LIGHT,
  ansiColorToHex,
  hasAnsi,
  parseAnsi,
} from "../src/utils/ansi.ts";

export async function ansiSuite() {
  console.log("\n─── ansi ───");

  await test("empty string yields empty array", () => {
    assert.deepEqual(parseAnsi(""), []);
  });

  await test("plain text without ESC returns single untagged span", () => {
    const spans = parseAnsi("hello world");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "hello world");
    assert.equal(spans[0].fg, undefined);
    assert.equal(spans[0].bg, undefined);
    assert.equal(spans[0].style, undefined);
  });

  await test("hasAnsi detects ESC presence", () => {
    assert.equal(hasAnsi(""), false);
    assert.equal(hasAnsi("plain"), false);
    assert.equal(hasAnsi("\x1b[31mred"), true);
    assert.equal(hasAnsi("\x1b[0m"), true);
  });

  await test("foreground 30-37 maps to named color index", () => {
    const spans = parseAnsi("\x1b[31mred\x1b[0m");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "red");
    assert.deepEqual(spans[0].fg, { kind: "named", index: 1 });
  });

  await test("background 40-47 maps to named color index", () => {
    const spans = parseAnsi("\x1b[42mbg-green\x1b[0m");
    assert.equal(spans[0].text, "bg-green");
    assert.deepEqual(spans[0].bg, { kind: "named", index: 2 });
  });

  await test("bright fg/bg (90-97 / 100-107) maps to index 8-15", () => {
    const spans = parseAnsi("\x1b[91;101mbright\x1b[0m");
    assert.equal(spans.length, 1);
    assert.deepEqual(spans[0].fg, { kind: "named", index: 9 });
    assert.deepEqual(spans[0].bg, { kind: "named", index: 9 });
  });

  await test("bold/italic/underline/dim/inverse recorded in style", () => {
    const spans = parseAnsi("\x1b[1;3;4;2;7mflags\x1b[0m");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].style?.bold, true);
    assert.equal(spans[0].style?.italic, true);
    assert.equal(spans[0].style?.underline, true);
    assert.equal(spans[0].style?.dim, true);
    assert.equal(spans[0].style?.inverse, true);
  });

  await test("reset (0) clears fg/bg/style", () => {
    const spans = parseAnsi("\x1b[31;1mred\x1b[0mnormal");
    assert.equal(spans.length, 2);
    assert.equal(spans[0].text, "red");
    assert.deepEqual(spans[0].fg, { kind: "named", index: 1 });
    assert.equal(spans[0].style?.bold, true);
    assert.equal(spans[1].text, "normal");
    assert.equal(spans[1].fg, undefined);
    assert.equal(spans[1].bg, undefined);
    assert.equal(spans[1].style, undefined);
  });

  await test("partial reset 22/23/24/27 toggles single attributes", () => {
    const spans = parseAnsi("\x1b[1;3mbold-italic\x1b[23mbold-only");
    assert.equal(spans.length, 2);
    assert.equal(spans[0].style?.bold, true);
    assert.equal(spans[0].style?.italic, true);
    assert.equal(spans[1].style?.bold, true);
    assert.equal(spans[1].style?.italic, false);
  });

  await test("default fg/bg (39/49) clears only the matching channel", () => {
    const spans = parseAnsi("\x1b[31;42mhi\x1b[39monly-bg\x1b[0m");
    assert.equal(spans.length, 2);
    assert.deepEqual(spans[0].fg, { kind: "named", index: 1 });
    assert.deepEqual(spans[0].bg, { kind: "named", index: 2 });
    assert.equal(spans[1].fg, undefined);
    assert.deepEqual(spans[1].bg, { kind: "named", index: 2 });
  });

  await test("RGB truecolor via 38;2;r;g;b", () => {
    const spans = parseAnsi("\x1b[38;2;255;128;0morange\x1b[0m");
    assert.equal(spans.length, 1);
    assert.deepEqual(spans[0].fg, { kind: "rgb", r: 255, g: 128, b: 0 });
  });

  await test("256-color index 0-15 maps to named", () => {
    const spans = parseAnsi("\x1b[38;5;9mxxx");
    assert.equal(spans.length, 1);
    assert.deepEqual(spans[0].fg, { kind: "named", index: 9 });
  });

  await test("256-color index 16-231 maps to 6x6x6 cube RGB", () => {
    // index 16 = r=0, g=0, b=0
    const spans = parseAnsi("\x1b[38;5;16mcube");
    assert.deepEqual(spans[0].fg, { kind: "rgb", r: 0, g: 0, b: 0 });
    // index 231 = r=5, g=5, b=5 → all 255
    const spans2 = parseAnsi("\x1b[38;5;231mcube");
    assert.deepEqual(spans2[0].fg, { kind: "rgb", r: 255, g: 255, b: 255 });
  });

  await test("256-color index 232-255 maps to grayscale", () => {
    const spans = parseAnsi("\x1b[38;5;232mg");
    assert.deepEqual(spans[0].fg, { kind: "rgb", r: 8, g: 8, b: 8 });
  });

  await test("background 48;5 / 48;2 RGB parsed", () => {
    const spans = parseAnsi("\x1b[48;2;10;20;30mbg\x1b[0m");
    assert.deepEqual(spans[0].bg, { kind: "rgb", r: 10, g: 20, b: 30 });
  });

  await test("consecutive same-style sequences merge", () => {
    const spans = parseAnsi("\x1b[31mfoo\x1b[31mbar\x1b[0m");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "foobar");
    assert.deepEqual(spans[0].fg, { kind: "named", index: 1 });
  });

  await test("multiple alternating colors stay separate", () => {
    const spans = parseAnsi("\x1b[31mred\x1b[32mgreen\x1b[0m");
    assert.equal(spans.length, 2);
    assert.equal(spans[0].text, "red");
    assert.deepEqual(spans[0].fg, { kind: "named", index: 1 });
    assert.equal(spans[1].text, "green");
    assert.deepEqual(spans[1].fg, { kind: "named", index: 2 });
  });

  await test("unterminated ESC sequence is kept as literal", () => {
    const spans = parseAnsi("plain \x1b[31oops");
    // 解析器遇到非 m 终止符，把 \x1b[31 当字面文本吞掉
    assert.equal(spans.length, 1);
    assert.ok(spans[0].text.includes("plain"));
    assert.ok(spans[0].text.includes("\x1b[31"));
  });

  await test("mixed real content + ESC noise", () => {
    const spans = parseAnsi("a\x1b[31mb\x1b[0mc");
    assert.equal(spans.length, 3);
    assert.equal(spans[0].text, "a");
    assert.equal(spans[1].text, "b");
    assert.equal(spans[1].fg?.kind, "named");
    assert.equal(spans[2].text, "c");
  });

  await test("ansiColorToHex named returns palette hex (light)", () => {
    assert.equal(ansiColorToHex({ kind: "named", index: 1 }, false, false), ANSI_NAMED_FG_LIGHT[1]);
    assert.equal(ansiColorToHex({ kind: "named", index: 4 }, false, false), ANSI_NAMED_FG_LIGHT[4]);
  });

  await test("ansiColorToHex named returns palette hex (dark)", () => {
    assert.equal(ansiColorToHex({ kind: "named", index: 1 }, true, false), ANSI_NAMED_FG_DARK[1]);
  });

  await test("ansiColorToHex background uses bg palette", () => {
    assert.equal(ansiColorToHex({ kind: "named", index: 2 }, false, true), ANSI_NAMED_BG_LIGHT[2]);
    assert.equal(ansiColorToHex({ kind: "named", index: 2 }, true, true), ANSI_NAMED_BG_DARK[2]);
  });

  await test("ansiColorToHex RGB clamps and formats as 7-char hex", () => {
    assert.equal(ansiColorToHex({ kind: "rgb", r: 255, g: 128, b: 0 }, false, false), "#ff8000");
    assert.equal(ansiColorToHex({ kind: "rgb", r: 0, g: 0, b: 0 }, false, false), "#000000");
    assert.equal(ansiColorToHex({ kind: "rgb", r: 300, g: -5, b: 128 }, false, false), "#ff0080");
  });

  await test("empty SGR parameters (just \\x1b[m) acts as full reset", () => {
    const spans = parseAnsi("\x1b[1;31mbold-red\x1b[mplain");
    assert.equal(spans.length, 2);
    assert.equal(spans[0].style?.bold, true);
    assert.deepEqual(spans[0].fg, { kind: "named", index: 1 });
    assert.equal(spans[1].text, "plain");
    assert.equal(spans[1].fg, undefined);
    assert.equal(spans[1].style, undefined);
  });
}
