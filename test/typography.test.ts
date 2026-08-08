/**
 * [INPUT]: 依赖 theme/typography 的 makeTypography/systemMonoFontFamily
 * [OUTPUT]: 提供 typographySuite，测试字号阶梯与 mono 字体处理
 * [POS]: test/ 的 typography 单元测试套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";
import { makeTypography, systemMonoFontFamily, typography } from "../src/theme/typography.ts";
import { test } from "./harness.ts";

export async function typographySuite() {
  console.log("\n─── typography ───");

  await test("each token has fontSize, lineHeight, and fontFamily property", () => {
    for (const [key, token] of Object.entries(typography)) {
      const t = token as any;
      assert.ok(typeof t.fontSize === "number", `${key} missing fontSize`);
      assert.ok(typeof t.lineHeight === "number", `${key} missing lineHeight`);
      assert.ok("fontFamily" in t, `${key} missing fontFamily property`);
    }
  });

  await test("default typography uses base values", () => {
    assert.equal(typography.body.fontSize, 17);
    assert.equal(typography.body.lineHeight, 22);
    assert.equal(typography.title1.fontSize, 28);
    assert.equal(typography.caption2.fontSize, 11);
  });

  await test("custom fontFamily is applied to non-mono tokens", () => {
    const t = makeTypography("Inter", systemMonoFontFamily);
    assert.equal(t.body.fontFamily, "Inter");
    assert.equal(t.title1.fontFamily, "Inter");
    assert.equal(t.headline.fontFamily, "Inter");
  });

  await test("undefined fontFamily passes through as undefined", () => {
    const t = makeTypography(undefined, systemMonoFontFamily);
    assert.equal(t.body.fontFamily, undefined);
  });

  await test("monoFontFamily is applied to mono tokens", () => {
    const t = makeTypography("Inter", "JetBrainsMono");
    assert.equal(t.mono.fontFamily, "JetBrainsMono");
    assert.equal(t.monoSm.fontFamily, "JetBrainsMono");
  });

  await test("mono tokens do not get the main fontFamily", () => {
    const t = makeTypography("Inter", "JetBrainsMono");
    assert.notEqual(t.mono.fontFamily, "Inter");
    assert.notEqual(t.monoSm.fontFamily, "Inter");
  });

  await test("default monoFontFamily is systemMonoFontFamily", () => {
    const t = makeTypography("Inter");
    assert.equal(t.mono.fontFamily, systemMonoFontFamily);
    assert.equal(t.monoSm.fontFamily, systemMonoFontFamily);
  });

  await test("largeTitle is the biggest fontSize", () => {
    assert.equal(typography.largeTitle.fontSize, 34);
    const allSizes = Object.values(typography).map((tok: any) => tok.fontSize);
    assert.equal(Math.max(...allSizes), 34);
  });

  await test("caption2 is the smallest fontSize", () => {
    assert.equal(typography.caption2.fontSize, 11);
    const allSizes = Object.values(typography).map((tok: any) => tok.fontSize);
    assert.equal(Math.min(...allSizes), 11);
  });

  await test("emphasized variants have fontWeight 600", () => {
    assert.equal((typography.bodyEmphasized as any).fontWeight, "600");
    assert.equal((typography.calloutEmphasized as any).fontWeight, "600");
    assert.equal((typography.subheadlineEmphasized as any).fontWeight, "600");
    assert.equal((typography.footnoteEmphasized as any).fontWeight, "600");
  });

  await test("non-emphasized body has fontWeight 400", () => {
    assert.equal((typography.body as any).fontWeight, "400");
    assert.equal((typography.callout as any).fontWeight, "400");
    assert.equal((typography.subheadline as any).fontWeight, "400");
    assert.equal((typography.footnote as any).fontWeight, "400");
  });

  await test("caption1 has zero letterSpacing", () => {
    assert.equal((typography.caption1 as any).letterSpacing, 0);
  });
}
