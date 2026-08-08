/**
 * [INPUT]: 依赖 services/dev-logger 的 startDevLogger/stopDevLogger/isDevLoggerActive + getDevLogs/subscribeDevLogs/clearDevLogs/setPaused/isPaused/exportDevLogs，依赖 dev-panel/DevInspectModal，依赖 theme
 * [OUTPUT]: DevLogs 组件，展示 console.* 拦截的日志，含拦截开关
 * [POS]: components/dev-panel/ 的 Tab4 日志页，被 app/dev-panel 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import * as Clipboard from "expo-clipboard";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import {
  type DevLogEntry,
  type LogLevel,
  clearDevLogs,
  exportDevLogs,
  getDevLogs,
  isDevLoggerActive,
  isPaused,
  setPaused,
  startDevLogger,
  stopDevLogger,
  subscribeDevLogs,
} from "../../services/dev-logger";
import { useTheme, type Theme } from "../../theme";
import { DevInspectModal } from "./DevInspectModal";

const LEVEL_COLORS: Record<LogLevel, string> = {
  log: "#888",
  warn: "#c0a020",
  error: "#d04040",
  info: "#4080d0",
  debug: "#8060a0",
};

const ALL_LEVELS: LogLevel[] = ["log", "warn", "error", "info", "debug"];

export function DevLogs() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const logs = useSyncExternalStore(subscribeDevLogs, getDevLogs, getDevLogs);
  const [capturing, setCapturing] = useState(isDevLoggerActive());
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [query, setQuery] = useState("");
  const [paused, setPausedState] = useState(isPaused());
  const [inspect, setInspect] = useState<DevLogEntry | null>(null);

  const toggleCapture = (v: boolean) => {
    if (v) {
      startDevLogger();
    } else {
      stopDevLogger();
    }
    setCapturing(v);
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return logs.filter((e) => {
      if (!enabledLevels.has(e.level)) return false;
      if (!q) return true;
      return e.args.some((a) => {
        if (typeof a === "string") return a.toLowerCase().includes(q);
        try {
          return JSON.stringify(a).toLowerCase().includes(q);
        } catch {
          return false;
        }
      });
    });
  }, [logs, enabledLevels, query]);

  const toggleLevel = (lvl: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    setPausedState(next);
  };

  const handleExport = async () => {
    await Clipboard.setStringAsync(exportDevLogs());
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number, l = 2) => String(n).padStart(l, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  };

  const formatArgs = (args: unknown[]): string => {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
  };

  return (
    <View style={styles.container}>
      <View style={styles.captureRow}>
        <Text style={styles.captureLabel}>{t("dev.captureLogs")}</Text>
        <Switch
          value={capturing}
          onValueChange={toggleCapture}
          trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={theme.colors.border}
        />
      </View>

      {!capturing ? <Text style={styles.hint}>{t("dev.captureOffHint")}</Text> : null}

      <View style={styles.toolbar}>
        <View style={styles.levels}>
          {ALL_LEVELS.map((lvl) => (
            <TouchableOpacity
              key={lvl}
              style={[
                styles.levelBadge,
                {
                  backgroundColor: enabledLevels.has(lvl)
                    ? LEVEL_COLORS[lvl]
                    : theme.colors.surface,
                  borderColor: LEVEL_COLORS[lvl],
                },
              ]}
              onPress={() => toggleLevel(lvl)}
            >
              <Text
                style={[
                  styles.levelText,
                  { color: enabledLevels.has(lvl) ? "#fff" : LEVEL_COLORS[lvl] },
                ]}
              >
                {t(`dev.logLevel.${lvl}` as const)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={togglePause} style={styles.actionBtn}>
            <Text style={styles.actionText}>{paused ? t("dev.resume") : t("dev.pause")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => clearDevLogs()} style={styles.actionBtn}>
            <Text style={styles.actionText}>{t("dev.clear")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void handleExport()} style={styles.actionBtn}>
            <Text style={styles.actionText}>{t("dev.export")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t("dev.search")}
          placeholderTextColor={theme.colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <Text style={styles.empty}>{t("dev.noData")}</Text>
        ) : (
          filtered
            .slice()
            .reverse()
            .map((e) => (
              <TouchableOpacity
                key={e.id}
                style={styles.logRow}
                onPress={() => setInspect(e)}
                onLongPress={() => void Clipboard.setStringAsync(formatArgs(e.args))}
              >
                <Text style={styles.time}>{formatTime(e.ts)}</Text>
                <Text style={[styles.level, { color: LEVEL_COLORS[e.level] }]}>
                  {e.level.toUpperCase()}
                </Text>
                <Text style={styles.content} numberOfLines={3}>
                  {formatArgs(e.args)}
                </Text>
              </TouchableOpacity>
            ))
        )}
      </ScrollView>

      {paused ? <Text style={styles.pausedBadge}>{t("dev.paused")}</Text> : null}

      <DevInspectModal
        visible={inspect != null}
        onClose={() => setInspect(null)}
        title={`Log #${inspect?.id ?? ""}`}
        value={inspect ? JSON.stringify({ ...inspect, args: inspect.args }, null, 2) : ""}
      />
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: { flex: 1, paddingBottom: spacing.xxl },
    captureRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    captureLabel: { ...typography.body, color: colors.text, fontWeight: "500" },
    hint: {
      ...typography.footnote,
      color: colors.textTertiary,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
    },
    toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
    levels: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
    levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
    levelText: { fontSize: 10, fontWeight: "700", fontFamily: "Menlo" },
    actions: { flexDirection: "row", gap: spacing.md },
    actionBtn: { paddingVertical: 4 },
    actionText: { ...typography.body, color: colors.accent, fontWeight: "500" },
    searchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
    search: {
      ...typography.body,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: radius.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    list: { flex: 1, marginTop: spacing.sm },
    listContent: { paddingHorizontal: spacing.lg, gap: 2 },
    logRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 3, alignItems: "flex-start" },
    time: { fontFamily: "Menlo", fontSize: 10, color: colors.textTertiary, minWidth: 90 },
    level: { fontFamily: "Menlo", fontSize: 10, fontWeight: "700", minWidth: 44 },
    content: { fontFamily: "Menlo", fontSize: 11, color: colors.text, flex: 1 },
    empty: {
      ...typography.body,
      color: colors.textTertiary,
      textAlign: "center",
      paddingTop: spacing.xxl,
    },
    pausedBadge: {
      position: "absolute",
      bottom: spacing.lg,
      alignSelf: "center",
      backgroundColor: colors.warning,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
      color: "#fff",
      fontSize: 12,
      fontWeight: "600",
      overflow: "hidden",
    },
  });
}
