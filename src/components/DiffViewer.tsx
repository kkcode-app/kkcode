/**
 * [INPUT]: 依赖 React Native ScrollView/Text、主题与 i18n，接收文件路径和文本/diff 内容
 * [OUTPUT]: 对外提供 DiffViewer 与 CodePreview，分别渲染 unified diff（可选全屏入口）和带词法高亮的源码
 * [POS]: components 的零依赖代码展示器，被工具详情和文件预览页面消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// DiffViewer — unified diff 渲染 + 语法高亮
// 纯手写，无外部依赖。
//
// 功能：
//   · Myers 行级 diff 算法，生成 context / delete / insert 行
//   · 按文件扩展名选择语法高亮规则（ts/tsx/js/jsx/py/go/rust/css/json/yaml/shell）
//   · 每行渲染：行号 · 前缀符号 · token 着色文本
//   · 超长内容折叠，点击展开

import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { useTheme } from "../theme";
import { useTranslation } from "react-i18next";

// ─── Diff 算法 ────────────────────────────────────────────

type DiffLine =
  | { kind: "context"; text: string; oldLine: number; newLine: number }
  | { kind: "delete"; text: string; oldLine: number }
  | { kind: "insert"; text: string; newLine: number };

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");

  const m = oldLines.length;
  const n = newLines.length;

  if (m === 0 && n === 0) return [];
  if (m === 0)
    return newLines.map((text, i) => ({ kind: "insert" as const, text, newLine: i + 1 }));
  if (n === 0)
    return oldLines.map((text, i) => ({ kind: "delete" as const, text, oldLine: i + 1 }));

  const max = m + n;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max;
      let x: number;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1];
      } else {
        x = v[ki - 1] + 1;
      }
      let y = x - k;
      while (x < m && y < n && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[ki] = x;
      if (x >= m && y >= n) {
        trace.push(v.slice());
        break outer;
      }
    }
  }

  type Move = { prevX: number; prevY: number; x: number; y: number };
  const path: Move[] = [];
  let x = m,
    y = n;
  for (let d = trace.length - 1; d >= 1; d--) {
    const vd = trace[d];
    const k = x - y;
    const ki = k + max;
    let prevK: number;
    if (k === -d + 1 || (k !== d - 1 && (vd[ki - 1] ?? -1) < (vd[ki + 1] ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vd[prevK + max] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX + 1 && y > prevY + 1) {
      x--;
      y--;
    }
    path.push({ prevX, prevY, x, y });
    x = prevX;
    y = prevY;
  }
  path.reverse();

  const lines: DiffLine[] = [];
  let cx = 0,
    cy = 0;
  for (const { prevX, prevY, x, y } of path) {
    while (cx < prevX && cy < prevY) {
      lines.push({ kind: "context", text: oldLines[cx], oldLine: cx + 1, newLine: cy + 1 });
      cx++;
      cy++;
    }
    if (x === prevX + 1 && y === prevY + 1) {
      // snake
    } else if (x === prevX) {
      lines.push({ kind: "insert", text: newLines[cy], newLine: cy + 1 });
      cy++;
    } else {
      lines.push({ kind: "delete", text: oldLines[cx], oldLine: cx + 1 });
      cx++;
    }
  }
  while (cx < m && cy < n) {
    lines.push({ kind: "context", text: oldLines[cx], oldLine: cx + 1, newLine: cy + 1 });
    cx++;
    cy++;
  }

  return lines;
}

// ─── Syntax Highlighting ──────────────────────────────────

type TokenKind = "keyword" | "string" | "comment" | "number" | "operator" | "type" | "plain";
type Token = { kind: TokenKind; text: string };

// All regex pre-compiled with sticky (`y`) flag.
// tokenize() sets re.lastIndex = pos directly — no new RegExp() at runtime.
type LangRule = [RegExp, TokenKind];

const TS_RULES: LangRule[] = [
  [/\/\/[^\n]*/y, "comment"],
  [/\/\*[\s\S]*?\*\//y, "comment"],
  [/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/y, "string"],
  [
    /\b(import|export|from|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|new|typeof|instanceof|in|of|async|await|try|catch|finally|throw|delete|void|default|null|undefined|true|false|this|super|type|interface|enum|implements|readonly|abstract|as|declare|keyof|infer|is|satisfies|override|using)\b/y,
    "keyword",
  ],
  [/[A-Z][A-Za-z0-9_]*/y, "type"],
  [/\d+\.?\d*([eE][+-]?\d+)?\b/y, "number"],
  [/[+\-*/%=<>!&|^~?:;,.()\[\]{}]/y, "operator"],
];

const PY_RULES: LangRule[] = [
  [/#[^\n]*/y, "comment"],
  [/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')/y, "string"],
  [
    /\b(def|class|import|from|return|if|elif|else|for|while|break|continue|pass|try|except|finally|raise|with|as|lambda|and|or|not|in|is|None|True|False|global|nonlocal|yield|async|await|del|assert)\b/y,
    "keyword",
  ],
  [/[A-Z][A-Za-z0-9_]*/y, "type"],
  [/\d+\.?\d*\b/y, "number"],
  [/[+\-*/%=<>!&|^~?:;,.()\[\]{}]/y, "operator"],
];

const GO_RULES: LangRule[] = [
  [/\/\/[^\n]*/y, "comment"],
  [/"(?:\\.|[^"])*"/y, "string"],
  [/`[^`]*`/y, "string"],
  [
    /\b(package|import|func|return|if|else|for|range|break|continue|switch|case|default|go|defer|select|chan|map|struct|interface|type|var|const|nil|true|false|make|new|append|len|cap|copy|delete|panic|recover|error)\b/y,
    "keyword",
  ],
  [/[A-Z][A-Za-z0-9_]*/y, "type"],
  [/\d+\.?\d*\b/y, "number"],
  [/[+\-*/%=<>!&|^~?:;,.()\[\]{}]/y, "operator"],
];

const RUST_RULES: LangRule[] = [
  [/\/\/[^\n]*/y, "comment"],
  [/"(?:\\.|[^"])*"/y, "string"],
  [
    /\b(fn|let|mut|const|static|use|mod|pub|struct|enum|impl|trait|type|where|for|if|else|match|loop|while|break|continue|return|async|await|move|ref|in|as|crate|super|self|Self|true|false|None|Some|Ok|Err)\b/y,
    "keyword",
  ],
  [/[A-Z][A-Za-z0-9_]*/y, "type"],
  [/\d+\.?\d*\b/y, "number"],
  [/[+\-*/%=<>!&|^~?:;,.()\[\]{}]/y, "operator"],
];

const JSON_RULES: LangRule[] = [
  [/"(?:\\.|[^"])*"\s*:/y, "keyword"],
  [/"(?:\\.|[^"])*"/y, "string"],
  [/\b(true|false|null)\b/y, "keyword"],
  [/-?\d+\.?\d*([eE][+-]?\d+)?\b/y, "number"],
  [/[{}\[\]:,]/y, "operator"],
];

const SHELL_RULES: LangRule[] = [
  [/#[^\n]*/y, "comment"],
  [/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/y, "string"],
  [
    /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|in|export|local|readonly|declare|unset|source|echo|printf|read|shift|set|trap|exec|eval)\b/y,
    "keyword",
  ],
  [/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/y, "type"],
  [/\d+\b/y, "number"],
  [/[|&;<>()$`\\!*?]/y, "operator"],
];

const CSS_RULES: LangRule[] = [
  [/\/\*[\s\S]*?\*\//y, "comment"],
  [/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/y, "string"],
  [/#[0-9a-fA-F]{3,8}\b/y, "number"],
  [/\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|pt|cm|mm|s|ms|deg|rad|fr)\b/y, "number"],
  [/:[a-z-]+/y, "keyword"],
  [/@[a-z-]+/y, "keyword"],
  [
    /\b(var|calc|rgb|rgba|hsl|hsla|linear-gradient|url|inherit|initial|unset|auto|none|flex|grid|block|inline|absolute|relative|fixed|sticky)\b/y,
    "type",
  ],
  [/[{};:,]/y, "operator"],
];

const YAML_RULES: LangRule[] = [
  [/#[^\n]*/y, "comment"],
  [/(["'])(?:\\[\s\S]|(?!\1)[^\\])*\1/y, "string"],
  [/[a-zA-Z_][a-zA-Z0-9_-]*(?=\s*:)/y, "keyword"],
  [/\b(true|false|null|~)\b/y, "type"],
  [/-?\d+\.?\d*\b/y, "number"],
  [/[|>:\[\]{},]/y, "operator"],
];

// Sticky fallback: matches whitespace, identifier, or any single char
const PLAIN_RE = /\s+|[A-Za-z_][A-Za-z0-9_]*|[\s\S]/y;

function getRules(filePath: string): LangRule[] {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(ext)) return TS_RULES;
  if (ext === "py") return PY_RULES;
  if (ext === "go") return GO_RULES;
  if (ext === "rs") return RUST_RULES;
  if (ext === "json") return JSON_RULES;
  if (["sh", "bash", "zsh"].includes(ext)) return SHELL_RULES;
  if (["css", "scss", "less"].includes(ext)) return CSS_RULES;
  if (["yml", "yaml"].includes(ext)) return YAML_RULES;
  return TS_RULES;
}

function tokenize(line: string, rules: LangRule[]): Token[] {
  if (!line) return [{ kind: "plain", text: "" }];
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < line.length) {
    let matched = false;
    for (const [re, kind] of rules) {
      re.lastIndex = pos;
      const m = re.exec(line);
      if (m) {
        tokens.push({ kind, text: m[0] });
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      PLAIN_RE.lastIndex = pos;
      const plain = PLAIN_RE.exec(line);
      if (plain) {
        tokens.push({ kind: "plain", text: plain[0] });
        pos += plain[0].length;
      } else {
        pos++;
      }
    }
  }
  return tokens;
}

// ─── Token color ──────────────────────────────────────────

type ColorSet = {
  text: string;
  textTertiary: string;
  textSecondary: string;
  accent: string;
  warning: string;
  success: string;
  destructive: string;
  textCode: string;
};

function tokenColor(
  kind: TokenKind,
  isDel: boolean,
  isIns: boolean,
  colors: ColorSet,
  isDark: boolean,
): string {
  const alpha = isDel ? "99" : isIns ? "ff" : "dd";
  if (isDark) {
    switch (kind) {
      case "keyword":
        return `#C792EA${alpha}`;
      case "string":
        return `#C3E88D${alpha}`;
      case "comment":
        return `#546E7A${alpha}`;
      case "number":
        return `#F78C6C${alpha}`;
      case "operator":
        return `#89DDFF${alpha}`;
      case "type":
        return `#FFCB6B${alpha}`;
      default:
        return isDel ? `${colors.text}99` : isIns ? colors.text : `${colors.text}dd`;
    }
  } else {
    switch (kind) {
      case "keyword":
        return `#8250df${alpha}`; // purple — VS Code Light
      case "string":
        return `#0a3069${alpha}`; // dark blue — GitHub Light
      case "comment":
        return `#6e7781${alpha}`; // gray
      case "number":
        return `#0550ae${alpha}`; // blue
      case "operator":
        return `#0550ae${alpha}`; // blue
      case "type":
        return `#953800${alpha}`; // dark orange-brown
      default:
        return isDel ? `${colors.text}99` : isIns ? colors.text : `${colors.text}cc`;
    }
  }
}

// ─── Row components (memo = skip re-render when content unchanged) ────

type RenderedLine =
  | { kind: "fold"; count: number }
  | {
      kind: "context" | "delete" | "insert";
      tokens: Token[];
      oldLine: number | null;
      newLine: number | null;
    };

interface DiffLineRowProps {
  item: RenderedLine;
  colors: ColorSet & {
    separator: string;
    destructive: string;
    success: string;
    accent: string;
    textTertiary: string;
  };
  isDark: boolean;
  monoFontFamily: string;
}

const DiffLineRow = React.memo(function DiffLineRow({
  item,
  colors,
  isDark,
  monoFontFamily,
}: DiffLineRowProps) {
  const { t } = useTranslation();
  const styles = useMemo(() => makeDiffStyles(monoFontFamily), [monoFontFamily]);
  if (item.kind === "fold") {
    return (
      <View
        style={[
          styles.foldRow,
          { borderTopColor: colors.separator, borderBottomColor: colors.separator },
        ]}
      >
        <Text style={[styles.foldText, { color: colors.textTertiary }]}>
          {t("part.collapsedLines", { count: item.count })}
        </Text>
      </View>
    );
  }

  const isDel = item.kind === "delete";
  const isIns = item.kind === "insert";
  const bg = isDel ? `${colors.destructive}14` : isIns ? `${colors.success}14` : "transparent";
  const prefix = isDel ? "−" : isIns ? "+" : " ";
  const prefixColor = isDel ? colors.destructive : isIns ? colors.success : colors.textTertiary;

  return (
    <View style={[styles.lineRow, { backgroundColor: bg }]}>
      <Text style={[styles.lineNum, { color: colors.textTertiary }]}>
        {item.oldLine != null ? String(item.oldLine).padStart(3) : "   "}
      </Text>
      <Text style={[styles.lineNum, { color: colors.textTertiary }]}>
        {item.newLine != null ? String(item.newLine).padStart(3) : "   "}
      </Text>
      <Text style={[styles.prefix, { color: prefixColor }]}>{prefix}</Text>
      <Text style={styles.lineText}>
        {item.tokens.map((tok, ti) => (
          <Text
            key={ti}
            style={{
              fontFamily: monoFontFamily,
              color: tokenColor(tok.kind, isDel, isIns, colors, isDark),
            }}
          >
            {tok.text}
          </Text>
        ))}
      </Text>
    </View>
  );
});

// ─── Component ────────────────────────────────────────────

const CONTEXT_LINES = 3;
const FOLD_THRESHOLD = 60;

interface DiffViewerProps {
  oldText: string;
  newText: string;
  filePath?: string;
  // 后端给的权威增删行数（来自 tool metadata.filediff）。
  // 注意：edit 工具传入的是单次替换片段的 diff，本组件自算的 adds/dels
  // 只反映这一片段；后端 filediff 才是整个文件层面的统计。
  // 优先使用后端值，确保和聊天列表里的 +N/−M 徽章一致。
  additions?: number;
  deletions?: number;
  /** Opens the same already-parsed diff in a dedicated full-screen route. */
  onOpenFullscreen?: () => void;
  /** Bypasses the initial long-diff fold, for dedicated detail screens. */
  initiallyExpanded?: boolean;
}

export function DiffViewer({
  oldText,
  newText,
  filePath = "",
  additions,
  deletions,
  onOpenFullscreen,
  initiallyExpanded = false,
}: DiffViewerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colors, radius, isDark, monoFontFamily } = theme;
  const [expanded, setExpanded] = useState(initiallyExpanded);

  const styles = useMemo(() => makeDiffStyles(monoFontFamily), [monoFontFamily]);

  const rules = useMemo(() => getRules(filePath), [filePath]);

  const allLines = useMemo(() => computeDiff(oldText, newText), [oldText, newText]);

  const visibleLines = useMemo(() => {
    const changed = new Set<number>();
    allLines.forEach((l, i) => {
      if (l.kind !== "context") changed.add(i);
    });
    const show = new Set<number>();
    changed.forEach((i) => {
      for (
        let j = Math.max(0, i - CONTEXT_LINES);
        j <= Math.min(allLines.length - 1, i + CONTEXT_LINES);
        j++
      ) {
        show.add(j);
      }
    });
    const result: (DiffLine | { kind: "fold"; count: number })[] = [];
    let prev = -1;
    [...show]
      .sort((a, b) => a - b)
      .forEach((i) => {
        if (prev !== -1 && i > prev + 1) result.push({ kind: "fold", count: i - prev - 1 });
        result.push(allLines[i]);
        prev = i;
      });
    return result;
  }, [allLines]);

  const hasFold = visibleLines.length > FOLD_THRESHOLD;
  const rawLines = expanded ? visibleLines : visibleLines.slice(0, FOLD_THRESHOLD);

  // Tokenize once here — not inside render. Scroll events won't re-tokenize.
  const displayLines = useMemo<RenderedLine[]>(
    () =>
      rawLines.map((item) => {
        if (item.kind === "fold") return item;
        const line = item as DiffLine;
        return {
          kind: line.kind,
          tokens: tokenize(line.text, rules),
          oldLine: "oldLine" in line ? line.oldLine : null,
          newLine: "newLine" in line ? line.newLine : null,
        };
      }),
    [rawLines, rules],
  );

  // header 显示的增删行数：优先后端权威值（整文件级），否则退回自算（片段级）
  const adds = additions ?? allLines.filter((l) => l.kind === "insert").length;
  const dels = deletions ?? allLines.filter((l) => l.kind === "delete").length;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.codeBackground, borderRadius: radius.sm },
      ]}
    >
      {/* Header */}
      <View
        style={[
          styles.fileHeader,
          { borderBottomColor: colors.separator, backgroundColor: colors.groupedBackground },
        ]}
      >
        <Text style={[styles.fileName, { color: colors.textSecondary }]} numberOfLines={1}>
          {filePath ? filePath.split("/").pop() : "diff"}
        </Text>
        <View style={styles.headerActions}>
          <View style={styles.stats}>
            {adds > 0 && <Text style={[styles.statAdd, { color: colors.success }]}>+{adds}</Text>}
            {dels > 0 && (
              <Text style={[styles.statDel, { color: colors.destructive }]}>−{dels}</Text>
            )}
          </View>
          {onOpenFullscreen ? (
            <TouchableOpacity
              onPress={onOpenFullscreen}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t("workspaceDiff.fullscreen")}
              style={styles.fullscreenButton}
            >
              <Ionicons name="expand-outline" size={16} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Diff lines */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        directionalLockEnabled
        nestedScrollEnabled
      >
        <View style={styles.linesWrap}>
          {displayLines.map((item, idx) => (
            <DiffLineRow
              key={idx}
              item={item}
              colors={colors as DiffLineRowProps["colors"]}
              isDark={isDark}
              monoFontFamily={monoFontFamily}
            />
          ))}

          {hasFold && !expanded && (
            <TouchableOpacity
              style={[styles.expandRow, { borderTopColor: colors.separator }]}
              onPress={() => setExpanded(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.expandText, { color: colors.accent }]}>
                {t("part.showAll", { count: visibleLines.length })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** Renders source text with the same lightweight tokenizer used by DiffViewer. */
export function CodePreview({ content, filePath }: { content: string; filePath: string }) {
  const theme = useTheme();
  const { colors, monoFontFamily, isDark, radius } = theme;
  const rules = useMemo(() => getRules(filePath), [filePath]);
  const lines = useMemo(
    () => content.split("\n").map((line) => tokenize(line, rules)),
    [content, rules],
  );
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, borderRadius: radius.sm, backgroundColor: colors.codeBackground },
        content: { paddingVertical: 8 },
        line: { flexDirection: "row", minHeight: 19 },
        lineNumber: {
          width: 44,
          paddingRight: 8,
          textAlign: "right",
          color: colors.textTertiary,
          fontFamily: monoFontFamily,
          fontSize: 12,
          lineHeight: 19,
        },
        code: { fontFamily: monoFontFamily, fontSize: 12, lineHeight: 19 },
      }),
    [colors.codeBackground, colors.textTertiary, monoFontFamily, radius.sm],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((tokens, index) => (
            <View key={index} style={styles.line}>
              <Text selectable={false} style={styles.lineNumber}>
                {index + 1}
              </Text>
              <Text selectable style={styles.code}>
                {tokens.map((token, tokenIndex) => (
                  <Text
                    key={tokenIndex}
                    style={{
                      color: tokenColor(token.kind, false, false, colors as ColorSet, isDark),
                    }}
                  >
                    {token.text}
                  </Text>
                ))}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────

function makeDiffStyles(monoFontFamily: string) {
  return StyleSheet.create({
    container: {
      overflow: "hidden",
    },
    fileHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    fileName: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      flex: 1,
    },
    stats: {
      flexDirection: "row",
      gap: 8,
      marginLeft: 8,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 8,
    },
    fullscreenButton: {
      marginLeft: 8,
      padding: 2,
    },
    statAdd: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      fontWeight: "700",
    },
    statDel: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      fontWeight: "700",
    },
    linesWrap: {
      paddingBottom: 4,
    },
    lineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 1,
      paddingRight: 16,
    },
    lineNum: {
      fontFamily: monoFontFamily,
      fontSize: 10,
      lineHeight: 17,
      width: 28,
      textAlign: "right",
      paddingRight: 4,
      opacity: 0.5,
      flexShrink: 0,
    },
    prefix: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      lineHeight: 17,
      width: 14,
      flexShrink: 0,
      textAlign: "center",
    },
    lineText: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      lineHeight: 17,
    },
    foldRow: {
      paddingVertical: 3,
      paddingHorizontal: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    foldText: {
      fontFamily: monoFontFamily,
      fontSize: 10,
    },
    expandRow: {
      paddingVertical: 8,
      alignItems: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    expandText: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      fontWeight: "600",
    },
  });
}
