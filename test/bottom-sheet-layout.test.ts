/**
 * [INPUT]: 依赖 bottom-sheet-layout 的统一高度计算函数与边界常量
 * [OUTPUT]: 提供 bottomSheetLayoutSuite，覆盖短内容、封顶滚动、键盘和临界像素
 * [POS]: test/ 的 BottomSheet 高度规则回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { strict as assert } from "node:assert";

import { test } from "./harness.ts";
import { calculateBottomSheetLayout } from "../src/utils/bottom-sheet-layout.ts";

const baseInput = {
  viewportHeight: 812,
  keyboardHeight: 0,
  safeAreaTop: 47,
  topGap: 12,
  chromeHeight: 59,
  contentHeight: 103,
  bottomPadding: 34,
};

export async function bottomSheetLayoutSuite() {
  console.log("\n─── BottomSheet layout ───");

  await test("short content uses its complete intrinsic height without scrolling", () => {
    const layout = calculateBottomSheetLayout(baseInput);

    assert.equal(layout.maxSheetHeight, 730.8000000000001);
    assert.equal(layout.bodyViewportHeight, 103);
    assert.equal(layout.sheetHeight, 196);
    assert.equal(layout.isOverflowing, false);
  });

  await test("long content caps the sheet and enables body scrolling", () => {
    const layout = calculateBottomSheetLayout({ ...baseInput, contentHeight: 900 });

    assert.equal(layout.maxSheetHeight, 730.8000000000001);
    assert.equal(layout.bodyViewportHeight, 637.8000000000001);
    assert.equal(layout.sheetHeight, 730.8000000000001);
    assert.equal(layout.isOverflowing, true);
  });

  await test("one-pixel rounding difference does not create phantom scrolling", () => {
    const maxBodyHeight = 637.8000000000001;
    const layout = calculateBottomSheetLayout({
      ...baseInput,
      contentHeight: maxBodyHeight + 1,
    });

    assert.equal(layout.isOverflowing, false);
  });

  await test("keyboard height reduces the maximum sheet height", () => {
    const layout = calculateBottomSheetLayout({
      ...baseInput,
      keyboardHeight: 300,
      contentHeight: 900,
    });

    assert.equal(layout.maxSheetHeight, 453);
    assert.equal(layout.bodyViewportHeight, 360);
    assert.equal(layout.sheetHeight, 453);
    assert.equal(layout.isOverflowing, true);
  });
}
