/**
 * [INPUT]: 独立定义
 * [OUTPUT]: Typography 类型、makeTypography 函数、systemMonoFontFamily 常量、默认 typography 实例
 * [POS]: theme/ 的字号阶梯定义层，被 useTheme() 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Platform, type TextStyle } from "react-native";

export const systemMonoFontFamily = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, Menlo, Monaco, monospace",
})!;

export const systemFontFamily = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
})!;

type T = TextStyle;

export type Typography = {
  largeTitle: T;
  title1: T;
  title2: T;
  title3: T;
  headline: T;
  body: T;
  bodyEmphasized: T;
  callout: T;
  calloutEmphasized: T;
  subheadline: T;
  subheadlineEmphasized: T;
  footnote: T;
  footnoteEmphasized: T;
  caption1: T;
  caption2: T;
  mono: T;
  monoSm: T;
};

export function makeTypography(
  fontFamily: string | undefined,
  monoFontFamily: string = systemMonoFontFamily,
): Typography {
  return {
    largeTitle: {
      fontFamily,
      fontSize: 34,
      lineHeight: 41,
      fontWeight: "700",
      letterSpacing: 0.37,
    },
    title1: { fontFamily, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: 0.36 },
    title2: { fontFamily, fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: 0.35 },
    title3: { fontFamily, fontSize: 20, lineHeight: 25, fontWeight: "600", letterSpacing: 0.38 },
    headline: { fontFamily, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.41 },
    body: { fontFamily, fontSize: 17, lineHeight: 22, fontWeight: "400", letterSpacing: -0.41 },
    bodyEmphasized: {
      fontFamily,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      letterSpacing: -0.41,
    },
    callout: { fontFamily, fontSize: 16, lineHeight: 21, fontWeight: "400", letterSpacing: -0.32 },
    calloutEmphasized: {
      fontFamily,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "600",
      letterSpacing: -0.32,
    },
    subheadline: {
      fontFamily,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "400",
      letterSpacing: -0.24,
    },
    subheadlineEmphasized: {
      fontFamily,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      letterSpacing: -0.24,
    },
    footnote: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: "400", letterSpacing: -0.08 },
    footnoteEmphasized: {
      fontFamily,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      letterSpacing: -0.08,
    },
    caption1: { fontFamily, fontSize: 12, lineHeight: 16, fontWeight: "400", letterSpacing: 0 },
    caption2: { fontFamily, fontSize: 11, lineHeight: 13, fontWeight: "400", letterSpacing: 0.07 },
    mono: { fontSize: 13, lineHeight: 18, fontFamily: monoFontFamily },
    monoSm: { fontSize: 11, lineHeight: 16, fontFamily: monoFontFamily },
  };
}

export const typography = makeTypography(undefined, systemMonoFontFamily);
