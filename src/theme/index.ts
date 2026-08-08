/**
 * [INPUT]: colors.ts 的基础 palette、store/theme 的 useThemeStore、typography 的 makeTypography
 * [OUTPUT]: useTheme() hook，返回引用稳定的合成 Theme（含基础 palette 与系统等宽字体 typography）
 * [POS]: theme/ 的聚合层，按主题模式选择基础 palette 并构建 typography
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useColorScheme } from "react-native";
import { useMemo } from "react";

import { darkPalette, lightPalette, type Palette } from "./colors";
import { hitSlop, radius, spacing } from "./spacing";
import { makeTypography, systemMonoFontFamily, systemFontFamily } from "./typography";
import { useThemeStore } from "../store/theme";

export type Theme = {
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: ReturnType<typeof makeTypography>;
  hitSlop: typeof hitSlop;
  isDark: boolean;
  monoFontFamily: string;
  fontFamily: string;
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const mode = useThemeStore((s) => s.mode);
  const isDark = mode === "dark" ? true : mode === "light" ? false : scheme === "dark";

  return useMemo(() => {
    const fontFamily = systemFontFamily;
    const monoFontFamily = systemMonoFontFamily;
    return {
      colors: isDark ? darkPalette : lightPalette,
      spacing,
      radius,
      typography: makeTypography(fontFamily, monoFontFamily),
      hitSlop,
      isDark,
      monoFontFamily,
      fontFamily,
    };
  }, [isDark]);
}

export { systemMonoFontFamily };
export { darkPalette, lightPalette };
export type { Palette } from "./colors";
