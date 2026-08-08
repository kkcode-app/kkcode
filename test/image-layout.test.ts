/**
 * [INPUT]: 依赖 src/utils/image-layout 与 test/harness
 * [OUTPUT]: 提供 imageLayoutSuite，覆盖横图、竖图与无效尺寸的等比适配
 * [POS]: test 的图片布局回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";

import { fitImageWithinViewport } from "../src/utils/image-layout.ts";
import { test } from "./harness.ts";

export async function imageLayoutSuite() {
  console.log("\n== image layout ==");

  await test("fits a wide image by viewport width without distortion", () => {
    assert.deepEqual(fitImageWithinViewport(2000, 1000, 400, 800), {
      width: 400,
      height: 200,
    });
  });

  await test("fits a tall image by viewport height without distortion", () => {
    assert.deepEqual(fitImageWithinViewport(1000, 2000, 400, 600), {
      width: 300,
      height: 600,
    });
  });

  await test("provides a bounded fallback for invalid source dimensions", () => {
    assert.deepEqual(fitImageWithinViewport(0, 0, 400, 200), {
      width: 400,
      height: 200,
    });
  });
}
