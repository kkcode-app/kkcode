/**
 * [INPUT]: 无依赖（纯字符串扫描）
 * [OUTPUT]: 对外提供 parseAnsi（解析 SGR 转义码为分段）、hasAnsi（快速判断是否有 ANSI）、AnsiSpan/AnsiColorRef 类型与 ANSI_NAMED_FG/BG_*_LIGHT/DARK 16 色 hex 调色板常量
 * [POS]: src/utils 的 ANSI 渲染工具，被 components/ToolDetailModal 的 AnsiText 消费；纯解析不依赖 React/RN，浏览器与 Node 测试均可运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const ESC = "\x1b";

export type AnsiColorRef =
  { kind: "named"; index: number } | { kind: "rgb"; r: number; g: number; b: number };

export interface AnsiStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface AnsiSpan {
  text: string;
  fg?: AnsiColorRef;
  bg?: AnsiColorRef;
  style?: AnsiStyle;
}

export function hasAnsi(input: string): boolean {
  return input.indexOf(ESC) !== -1;
}

// 16 色 ANSI 调色板：亮背景用饱和度略低的深色更易读，暗背景用饱和度较高的亮色
// 下标 0..15 对应 SGR 30..37 / 40..47 / 90..97 / 100..107

export const ANSI_NAMED_FG_LIGHT: readonly string[] = [
  "#1F2937",
  "#B91C1C",
  "#15803D",
  "#A16207",
  "#1D4ED8",
  "#7E22CE",
  "#0E7490",
  "#4B5563",
  "#374151",
  "#DC2626",
  "#16A34A",
  "#CA8A04",
  "#2563EB",
  "#9333EA",
  "#0891B2",
  "#111827",
];

export const ANSI_NAMED_BG_LIGHT: readonly string[] = [
  "#E5E7EB",
  "#FECACA",
  "#BBF7D0",
  "#FEF08A",
  "#BFDBFE",
  "#E9D5FF",
  "#A5F3FC",
  "#F3F4F6",
  "#D1D5DB",
  "#FCA5A5",
  "#86EFAC",
  "#FDE68A",
  "#93C5FD",
  "#D8B4FE",
  "#67E8F9",
  "#F9FAFB",
];

export const ANSI_NAMED_FG_DARK: readonly string[] = [
  "#4B5563",
  "#F87171",
  "#4ADE80",
  "#FACC15",
  "#60A5FA",
  "#C084FC",
  "#22D3EE",
  "#D1D5DB",
  "#9CA3AF",
  "#FCA5A5",
  "#86EFAC",
  "#FDE68A",
  "#93C5FD",
  "#D8B4FE",
  "#67E8F9",
  "#F9FAFB",
];

export const ANSI_NAMED_BG_DARK: readonly string[] = [
  "#1F2937",
  "#7F1D1D",
  "#14532D",
  "#713F12",
  "#1E3A8A",
  "#581C87",
  "#164E63",
  "#374151",
  "#374151",
  "#991B1B",
  "#166534",
  "#854D0E",
  "#1E40AF",
  "#6B21A8",
  "#155E75",
  "#1F2937",
];

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, n | 0))
      .toString(16)
      .padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

function parseColorParams(
  params: number[],
  start: number,
): { color: AnsiColorRef; nextIndex: number } | null {
  const mode = params[start];
  if (mode === 5) {
    const idx = params[start + 1];
    if (idx == null || Number.isNaN(idx)) return null;
    if (idx < 16) {
      return { color: { kind: "named", index: idx }, nextIndex: start + 2 };
    }
    if (idx >= 232) {
      const v = 8 + (idx - 232) * 10;
      return { color: { kind: "rgb", r: v, g: v, b: v }, nextIndex: start + 2 };
    }
    const i = idx - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const levels = [0, 95, 135, 175, 215, 255];
    return {
      color: { kind: "rgb", r: levels[r], g: levels[g], b: levels[b] },
      nextIndex: start + 2,
    };
  }
  if (mode === 2) {
    const r = params[start + 1];
    const g = params[start + 2];
    const b = params[start + 3];
    if ([r, g, b].some((v) => v == null || Number.isNaN(v))) return null;
    return { color: { kind: "rgb", r, g, b }, nextIndex: start + 4 };
  }
  return null;
}

interface ParserState {
  fg?: AnsiColorRef;
  bg?: AnsiColorRef;
  style: AnsiStyle;
}

function applySgr(params: number[], state: ParserState): void {
  if (params.length === 0) {
    state.fg = undefined;
    state.bg = undefined;
    state.style = {};
    return;
  }
  let i = 0;
  while (i < params.length) {
    const p = params[i];
    switch (p) {
      case 0:
        state.fg = undefined;
        state.bg = undefined;
        state.style = {};
        break;
      case 1:
        state.style.bold = true;
        break;
      case 2:
        state.style.dim = true;
        break;
      case 3:
        state.style.italic = true;
        break;
      case 4:
        state.style.underline = true;
        break;
      case 7:
        state.style.inverse = true;
        break;
      case 22:
        state.style.bold = false;
        state.style.dim = false;
        break;
      case 23:
        state.style.italic = false;
        break;
      case 24:
        state.style.underline = false;
        break;
      case 27:
        state.style.inverse = false;
        break;
      case 39:
        state.fg = undefined;
        break;
      case 49:
        state.bg = undefined;
        break;
      case 30:
      case 31:
      case 32:
      case 33:
      case 34:
      case 35:
      case 36:
      case 37:
        state.fg = { kind: "named", index: p - 30 };
        break;
      case 40:
      case 41:
      case 42:
      case 43:
      case 44:
      case 45:
      case 46:
      case 47:
        state.bg = { kind: "named", index: p - 40 };
        break;
      case 90:
      case 91:
      case 92:
      case 93:
      case 94:
      case 95:
      case 96:
      case 97:
        state.fg = { kind: "named", index: p - 90 + 8 };
        break;
      case 100:
      case 101:
      case 102:
      case 103:
      case 104:
      case 105:
      case 106:
      case 107:
        state.bg = { kind: "named", index: p - 100 + 8 };
        break;
      case 38: {
        const parsed = parseColorParams(params, i + 1);
        if (parsed) {
          state.fg = parsed.color;
          i = parsed.nextIndex - 1;
        }
        break;
      }
      case 48: {
        const parsed = parseColorParams(params, i + 1);
        if (parsed) {
          state.bg = parsed.color;
          i = parsed.nextIndex - 1;
        }
        break;
      }
      default:
        break;
    }
    i++;
  }
}

function styleKey(state: ParserState): string {
  return JSON.stringify({
    fg: state.fg ?? null,
    bg: state.bg ?? null,
    s: state.style,
  });
}

function pushSpan(out: AnsiSpan[], text: string, state: ParserState, key: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && (last as AnsiSpan & { _key?: string })._key === key) {
    last.text += text;
    return;
  }
  const span: AnsiSpan = { text };
  if (state.fg) span.fg = state.fg;
  if (state.bg) span.bg = state.bg;
  const s = state.style;
  if (s.bold || s.dim || s.italic || s.underline || s.inverse) {
    span.style = { ...s };
  }
  (span as AnsiSpan & { _key?: string })._key = key;
  out.push(span);
}

export function parseAnsi(input: string): AnsiSpan[] {
  if (!input) return [];
  if (input.indexOf(ESC) === -1) return [{ text: input }];

  const spans: AnsiSpan[] = [];
  const state: ParserState = { style: {} };
  let currentKey = styleKey(state);
  let buf = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch === ESC && input[i + 1] === "[") {
      if (buf) {
        pushSpan(spans, buf, state, currentKey);
        buf = "";
      }
      let j = i + 2;
      while (j < input.length && input[j] !== "m") j++;
      if (j >= input.length || input[j] !== "m") {
        // 未闭合的 ESC 序列，按字面文本吞掉，避免脏字符泄漏
        buf += input.slice(i, j);
        i = j;
        continue;
      }
      const paramStr = input.slice(i + 2, j);
      const params =
        paramStr === ""
          ? []
          : paramStr.split(";").map((s) => {
              const n = parseInt(s, 10);
              return Number.isNaN(n) ? 0 : n;
            });
      applySgr(params, state);
      currentKey = styleKey(state);
      i = j + 1;
    } else {
      buf += ch;
      i++;
    }
  }
  if (buf) pushSpan(spans, buf, state, currentKey);

  // 清除仅用于合并判等的内部标记
  for (const span of spans) {
    delete (span as AnsiSpan & { _key?: string })._key;
  }
  return spans;
}

export function ansiColorToHex(ref: AnsiColorRef, isDark: boolean, isBackground: boolean): string {
  if (ref.kind === "named") {
    const palette = isBackground
      ? isDark
        ? ANSI_NAMED_BG_DARK
        : ANSI_NAMED_BG_LIGHT
      : isDark
        ? ANSI_NAMED_FG_DARK
        : ANSI_NAMED_FG_LIGHT;
    return palette[ref.index] ?? (isBackground ? "transparent" : palette[7]);
  }
  return toHex(ref.r, ref.g, ref.b);
}
