/**
 * [INPUT]: 依赖 src/hooks/useResponsive 的 useResponsive，依赖 react-native 的 Platform/useWindowDimensions
 * [OUTPUT]: 提供 responsiveSuite，测试响应式布局 hook 的各种维度判断
 * [POS]: test 的 useResponsive hook 单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useWindowDimensions } from "react-native";

import { test } from "./harness.ts";
import { useResponsive } from "../src/hooks/useResponsive.ts";
import { breakpoints } from "../src/theme/breakpoints.ts";

// React 19 要求非 Jest 测试器显式声明 act 环境。
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// react-native is stubbed in register-mocks.ts. We control the mock state via
// globalThis.__RN_MOCK_IS_PAD and the useWindowDimensions return value.
let mockWidth = 375;
let mockHeight = 812;

(useWindowDimensions as unknown as () => { width: number; height: number }) = () => ({
  width: mockWidth,
  height: mockHeight,
});

function Harness({ capture }: { capture: (r: ReturnType<typeof useResponsive>) => void }) {
  const r = useResponsive();
  capture(r);
  return null;
}

export async function responsiveSuite() {
  console.log("\n─── useResponsive ───");

  await test("iPhone portrait: not tablet, not splitView, not wide", async () => {
    mockWidth = 375;
    mockHeight = 812;
    (globalThis as any).__RN_MOCK_IS_PAD = false;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isTablet, false);
    assert.equal(result!.splitView, false);
    assert.equal(result!.isWide, false);
    assert.equal(result!.isLandscape, false);
    assert.equal(result!.width, 375);
    assert.equal(result!.height, 812);

    act(() => renderer?.unmount());
  });

  await test("iPhone landscape: isLandscape true, still not tablet", async () => {
    mockWidth = 812;
    mockHeight = 375;
    (globalThis as any).__RN_MOCK_IS_PAD = false;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isLandscape, true);
    assert.equal(result!.isTablet, false);
    assert.equal(result!.splitView, false);
    // 812 < 900, so not wide
    assert.equal(result!.isWide, false);

    act(() => renderer?.unmount());
  });

  await test("iPad portrait (768pt): tablet but not splitView (below twoColumn)", async () => {
    mockWidth = 768;
    mockHeight = 1024;
    (globalThis as any).__RN_MOCK_IS_PAD = true;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isTablet, true);
    assert.equal(result!.splitView, false); // 768 < 900
    assert.equal(result!.isWide, false);
    assert.equal(result!.isLandscape, false);

    act(() => renderer?.unmount());
  });

  await test("iPad landscape (1024pt): tablet and splitView enabled", async () => {
    mockWidth = 1024;
    mockHeight = 768;
    (globalThis as any).__RN_MOCK_IS_PAD = true;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isTablet, true);
    assert.equal(result!.splitView, true); // 1024 >= 900 and isPad
    assert.equal(result!.isWide, true);
    assert.equal(result!.isLandscape, true);

    act(() => renderer?.unmount());
  });

  await test("Android tablet (wide but not iPad): isWide true, splitView false", async () => {
    mockWidth = 1200;
    mockHeight = 800;
    (globalThis as any).__RN_MOCK_IS_PAD = false; // Platform.isPad is false
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isTablet, false);
    assert.equal(result!.splitView, false);
    assert.equal(result!.isWide, true); // wide regardless of platform

    act(() => renderer?.unmount());
  });

  await test("contentMaxWidth/sheetMaxWidth are from breakpoints", async () => {
    mockWidth = 400;
    mockHeight = 800;
    (globalThis as any).__RN_MOCK_IS_PAD = false;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.contentMaxWidth, breakpoints.contentMaxWidth);
    assert.equal(result!.formMaxWidth, breakpoints.formMaxWidth);
    assert.equal(result!.sidebarWidth, breakpoints.sidebarWidth);
    assert.equal(result!.sheetMaxWidth, breakpoints.sheetMaxWidth);

    act(() => renderer?.unmount());
  });

  await test("exactly at twoColumn breakpoint (900) is wide", async () => {
    mockWidth = 900;
    mockHeight = 1200;
    (globalThis as any).__RN_MOCK_IS_PAD = true;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isWide, true); // >= 900
    assert.equal(result!.splitView, true); // iPad and isWide

    act(() => renderer?.unmount());
  });

  await test("just below twoColumn breakpoint (899) is not wide", async () => {
    mockWidth = 899;
    mockHeight = 1200;
    (globalThis as any).__RN_MOCK_IS_PAD = true;
    let result: ReturnType<typeof useResponsive> | null = null;

    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(Harness, { capture: (r) => (result = r) }));
    });

    assert.ok(result);
    assert.equal(result!.isWide, false);
    assert.equal(result!.splitView, false);

    act(() => renderer?.unmount());
  });

  // Clean up mock state
  (globalThis as any).__RN_MOCK_IS_PAD = false;
}
