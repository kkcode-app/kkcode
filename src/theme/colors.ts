/**
 * [INPUT]: 独立定义，被 src/theme/index.ts 合成最终 Palette
 * [OUTPUT]: Palette、基础 palette（lightPalette/darkPalette）
 * [POS]: theme/ 的颜色数据层，被 useTheme() 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type Palette = {
  background: string;
  backgroundSecondary: string;
  surface: string;
  surfaceElevated: string;
  surfaceHover: string;
  groupedBackground: string;
  separator: string;
  border: string;
  borderFocus: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textCode: string;
  accent: string;
  accentMuted: string;
  accentSubtle: string;
  destructive: string;
  destructiveMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  codeBackground: string;
  toolBackground: string;
  toolBorder: string;
  reasoningBackground: string;
  reasoningBorder: string;
  bubbleOutgoing: string;
  bubbleOutgoingText: string;
  bubbleIncoming: string;
  bubbleIncomingText: string;
  bubbleIncomingBorder: string;
  inputBackground: string;
  inputBorder: string;
  inputPlaceholder: string;
  headerBackground: string;
  headerBorder: string;
  headerTint: string;
  shadow: string;
  shadowElevated: string;
  overlay: string;
  skeleton: string;
};

export const lightPalette: Palette = {
  background: "#FAFAFA",
  backgroundSecondary: "#F5F5F5",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  surfaceHover: "#F0F0F2",
  groupedBackground: "#F2F2F7",
  separator: "rgba(0,0,0,0.08)",
  border: "rgba(0,0,0,0.10)",
  borderFocus: "#3B5CCC",
  text: "#1A1A1A",
  textSecondary: "#515151",
  textTertiary: "#8C8C8C",
  textInverse: "#FFFFFF",
  textCode: "#3B3B40",
  accent: "#3B5CCC",
  accentMuted: "rgba(59,92,204,0.12)",
  accentSubtle: "rgba(59,92,204,0.06)",
  destructive: "#E53E3E",
  destructiveMuted: "rgba(229,62,62,0.08)",
  success: "#38A169",
  successMuted: "rgba(56,161,105,0.10)",
  warning: "#DD6B20",
  warningMuted: "rgba(221,107,32,0.10)",
  codeBackground: "#E8EBEF",
  toolBackground: "#F8FAFB",
  toolBorder: "#CBD5E0",
  reasoningBackground: "rgba(221,107,32,0.05)",
  reasoningBorder: "#DD6B20",
  bubbleOutgoing: "#3B5CCC",
  bubbleOutgoingText: "#FFFFFF",
  bubbleIncoming: "#EFEFF4",
  bubbleIncomingText: "#1A1A1A",
  bubbleIncomingBorder: "transparent",
  inputBackground: "#EFEFF4",
  inputBorder: "transparent",
  inputPlaceholder: "#AEAEB2",
  headerBackground: "rgba(250,250,250,0.92)",
  headerBorder: "rgba(0,0,0,0.08)",
  headerTint: "#3B5CCC",
  shadow: "rgba(0,0,0,0.06)",
  shadowElevated: "rgba(0,0,0,0.12)",
  overlay: "rgba(0,0,0,0.36)",
  skeleton: "#E8E8EC",
};

export const darkPalette: Palette = {
  background: "#0A0A0B",
  backgroundSecondary: "#0F0F11",
  surface: "#141416",
  surfaceElevated: "#1C1C1F",
  surfaceHover: "#222226",
  groupedBackground: "#0A0A0B",
  separator: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.08)",
  borderFocus: "#7892FF",
  text: "#F0F0F0",
  textSecondary: "#A0A0A8",
  textTertiary: "#5A5A65",
  textInverse: "#FFFFFF",
  textCode: "#D4D4D8",
  accent: "#7892FF",
  accentMuted: "rgba(120,146,255,0.18)",
  accentSubtle: "rgba(120,146,255,0.09)",
  destructive: "#FF6B6B",
  destructiveMuted: "rgba(255,107,107,0.12)",
  success: "#4ADE80",
  successMuted: "rgba(74,222,128,0.10)",
  warning: "#FB923C",
  warningMuted: "rgba(251,146,60,0.12)",
  codeBackground: "#2A2A2E",
  toolBackground: "#141416",
  toolBorder: "#2D2D35",
  reasoningBackground: "rgba(251,146,60,0.07)",
  reasoningBorder: "#FB923C",
  bubbleOutgoing: "#5D74E8",
  bubbleOutgoingText: "#FFFFFF",
  bubbleIncoming: "#1C1C1F",
  bubbleIncomingText: "#F0F0F0",
  bubbleIncomingBorder: "rgba(255,255,255,0.05)",
  inputBackground: "#1C1C1F",
  inputBorder: "rgba(255,255,255,0.08)",
  inputPlaceholder: "#48484F",
  headerBackground: "rgba(10,10,11,0.90)",
  headerBorder: "rgba(255,255,255,0.06)",
  headerTint: "#7892FF",
  shadow: "rgba(0,0,0,0.5)",
  shadowElevated: "rgba(0,0,0,0.8)",
  overlay: "rgba(0,0,0,0.65)",
  skeleton: "#1C1C1F",
};
