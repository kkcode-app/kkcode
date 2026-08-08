/**
 * [INPUT]: 依赖 react-native 的 Text/View/TouchableOpacity，依赖 theme 的 useTheme，依赖 store/font 的 useFontStore，依赖 theme/fonts 的 resolveMonoFontFamily
 * [OUTPUT]: JsonView 组件，递归渲染任意 JSON 值为可折叠树
 * [POS]: components/dev-panel/ 的通用 JSON 渲染器，被 DevInspectModal/DevStorage/DevStores/DevLogs/DevNetwork 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, type Theme } from "../../theme";

interface JsonViewProps {
  value: unknown;
  /** 顶层不显示折叠按钮，直接展开 */
  defaultExpanded?: boolean;
  /** 最大渲染行数，超过截断（防大对象卡顿） */
  maxLines?: number;
}

const MAX_RENDER_LINES = 500;

export function JsonView({
  value,
  defaultExpanded = true,
  maxLines = MAX_RENDER_LINES,
}: JsonViewProps) {
  const theme = useTheme();
  const monoFamily = theme.monoFontFamily;
  const styles = useMemo(() => makeStyles(theme, monoFamily), [theme, monoFamily]);

  const lineCounter = { count: 0 };
  const rendered = renderValue(value, "", 0, defaultExpanded, styles, lineCounter, maxLines);

  return <View style={styles.container}>{rendered}</View>;
}

function renderValue(
  value: unknown,
  key: string,
  depth: number,
  defaultExpanded: boolean,
  styles: ReturnType<typeof makeStyles>,
  lineCounter: { count: number },
  maxLines: number,
): React.ReactNode {
  if (lineCounter.count >= maxLines) {
    if (lineCounter.count === maxLines) {
      lineCounter.count++;
      return <Text style={styles.truncated}>…[max lines reached]</Text>;
    }
    return null;
  }
  lineCounter.count++;

  if (value === null) return renderLeaf(key, "null", styles.null);
  if (value === undefined) return renderLeaf(key, "undefined", styles.undefined);

  if (typeof value === "string") {
    const preview = value.length > 100 ? value.slice(0, 100) + "…" : undefined;
    return renderLeaf(key, `"${value}"`, styles.string, preview);
  }
  if (typeof value === "number") return renderLeaf(key, String(value), styles.number);
  if (typeof value === "boolean") return renderLeaf(key, String(value), styles.boolean);
  if (typeof value === "bigint") return renderLeaf(key, `${value}n`, styles.number);

  if (Array.isArray(value)) {
    return renderCollapsible(
      key,
      `Array(${value.length})`,
      value,
      depth,
      defaultExpanded,
      styles,
      lineCounter,
      maxLines,
      true,
    );
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return renderCollapsible(
      key,
      `Object {${keys.length}}`,
      value,
      depth,
      defaultExpanded,
      styles,
      lineCounter,
      maxLines,
      false,
    );
  }

  return renderLeaf(key, String(value), styles.other);
}

function renderLeaf(key: string, value: string, style: object, preview?: string): React.ReactNode {
  return (
    <View style={leafRowStyle}>
      {key ? <Text style={[leafKeyStyle, { color: "#88a" }]}>{key}: </Text> : null}
      <Text style={style} numberOfLines={preview ? 1 : undefined}>
        {value}
      </Text>
    </View>
  );
}

const leafRowStyle = {
  flexDirection: "row" as const,
  flexWrap: "wrap" as const,
  alignItems: "flex-start" as const,
};
const leafKeyStyle = { fontFamily: "Menlo" as const, fontSize: 12 };

function renderCollapsible(
  key: string,
  summary: string,
  value: unknown,
  depth: number,
  defaultExpanded: boolean,
  styles: ReturnType<typeof makeStyles>,
  lineCounter: { count: number },
  maxLines: number,
  isArray: boolean,
): React.ReactNode {
  return (
    <CollapsibleNode
      key={key || summary}
      k={key}
      summary={summary}
      value={value}
      depth={depth}
      defaultExpanded={defaultExpanded}
      styles={styles}
      lineCounter={lineCounter}
      maxLines={maxLines}
      isArray={isArray}
    />
  );
}

interface CollapsibleNodeProps {
  k: string;
  summary: string;
  value: unknown;
  depth: number;
  defaultExpanded: boolean;
  styles: ReturnType<typeof makeStyles>;
  lineCounter: { count: number };
  maxLines: number;
  isArray: boolean;
}

function CollapsibleNode({
  k,
  summary,
  value,
  depth,
  defaultExpanded,
  styles,
  lineCounter,
  maxLines,
  isArray,
}: CollapsibleNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded && depth < 2);

  const children: React.ReactNode[] = [];
  if (expanded) {
    if (isArray) {
      (value as unknown[]).forEach((item, i) => {
        children.push(
          renderValue(item, String(i), depth + 1, false, styles, lineCounter, maxLines),
        );
      });
    } else {
      const obj = value as Record<string, unknown>;
      for (const childKey of Object.keys(obj)) {
        children.push(
          renderValue(obj[childKey], childKey, depth + 1, false, styles, lineCounter, maxLines),
        );
      }
    }
  }

  return (
    <View style={styles.node}>
      <TouchableOpacity onPress={() => setExpanded((e) => !e)} style={styles.toggleRow}>
        <Text style={styles.toggle}>{expanded ? "▼" : "▶"}</Text>
        {k ? <Text style={styles.key}>{k}: </Text> : null}
        <Text style={styles.summary}>{summary}</Text>
      </TouchableOpacity>
      {expanded ? <View style={styles.children}>{children}</View> : null}
    </View>
  );
}

function makeStyles(theme: Theme, monoFamily: string) {
  return StyleSheet.create({
    container: { paddingVertical: 4 },
    node: { paddingVertical: 1 },
    toggleRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 1 },
    toggle: {
      fontFamily: monoFamily,
      fontSize: 10,
      color: theme.colors.textTertiary,
      marginRight: 4,
      marginTop: 2,
    },
    key: { fontFamily: monoFamily, fontSize: 12, color: theme.colors.textSecondary },
    summary: { fontFamily: monoFamily, fontSize: 12, color: theme.colors.textTertiary },
    children: {
      marginLeft: 16,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.separator,
      paddingLeft: 8,
    },
    string: { fontFamily: monoFamily, fontSize: 12, color: "#6b8e4e" },
    number: { fontFamily: monoFamily, fontSize: 12, color: "#c76e29" },
    boolean: { fontFamily: monoFamily, fontSize: 12, color: "#b07cf0" },
    null: {
      fontFamily: monoFamily,
      fontSize: 12,
      color: theme.colors.textTertiary,
      fontStyle: "italic",
    },
    undefined: {
      fontFamily: monoFamily,
      fontSize: 12,
      color: theme.colors.textTertiary,
      fontStyle: "italic",
    },
    other: { fontFamily: monoFamily, fontSize: 12, color: theme.colors.text },
    truncated: {
      fontFamily: monoFamily,
      fontSize: 11,
      color: theme.colors.textTertiary,
      fontStyle: "italic",
      marginTop: 4,
    },
  });
}
