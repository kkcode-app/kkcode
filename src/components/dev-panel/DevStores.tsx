/**
 * [INPUT]: 依赖全部 21 个 Zustand store 的 getState()，依赖 dev-panel/JsonView，依赖 theme
 * [OUTPUT]: DevStores 组件，展示所有 store 的内存态快照
 * [POS]: components/dev-panel/ 的 Tab3 状态页，被 app/dev-panel 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useBiometricStore } from "../../store/biometric";
import { useCommandStore } from "../../store/commands";
import { useConnectionStore } from "../../store/connection";
import { useDirectoryPrefsStore } from "../../store/directory-prefs";
import { useDraftStore } from "../../store/draft";
import { useHapticsPrefsStore } from "../../store/haptics-prefs";
import { useMessagesStore } from "../../store/messages";
import { useModelStore } from "../../store/model";
import { useOnboardingStore } from "../../store/onboarding";
import { usePendingOpenStore } from "../../store/pending-open";
import { usePermissionStore } from "../../store/permissions";
import { useQuestionStore } from "../../store/questions";
import { useSessionPrefsStore } from "../../store/session-prefs";
import { useSessionsStore } from "../../store/sessions";
import { useStatusStore } from "../../store/status";
import { useThemeStore } from "../../store/theme";
import { useTheme, type Theme } from "../../theme";
import { JsonView } from "./JsonView";

interface StoreDef {
  name: string;
  getState: () => unknown;
  group: "persisted" | "memory";
}

// 持久化组（有 hydrate 方法或部分字段持久化的 store）
const PERSISTED_STORES: StoreDef[] = [
  { name: "theme", getState: () => useThemeStore.getState(), group: "persisted" },
  { name: "biometric", getState: () => useBiometricStore.getState(), group: "persisted" },
  { name: "haptics-prefs", getState: () => useHapticsPrefsStore.getState(), group: "persisted" },
  { name: "onboarding", getState: () => useOnboardingStore.getState(), group: "persisted" },
  { name: "session-prefs", getState: () => useSessionPrefsStore.getState(), group: "persisted" },
  {
    name: "directory-prefs",
    getState: () => useDirectoryPrefsStore.getState(),
    group: "persisted",
  },
  { name: "connection", getState: () => useConnectionStore.getState(), group: "persisted" },
  { name: "model", getState: () => useModelStore.getState(), group: "persisted" },
];

// 内存态组（进程重启即丢失）
const MEMORY_STORES: StoreDef[] = [
  { name: "status", getState: () => useStatusStore.getState(), group: "memory" },
  { name: "sessions", getState: () => useSessionsStore.getState(), group: "memory" },
  { name: "messages", getState: () => useMessagesStore.getState(), group: "memory" },
  { name: "commands", getState: () => useCommandStore.getState(), group: "memory" },
  { name: "draft", getState: () => useDraftStore.getState(), group: "memory" },
  { name: "permissions", getState: () => usePermissionStore.getState(), group: "memory" },
  { name: "questions", getState: () => useQuestionStore.getState(), group: "memory" },
  { name: "pending-open", getState: () => usePendingOpenStore.getState(), group: "memory" },
];

export function DevStores() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = () => setVersion((v) => v + 1);

  const filterStore = (def: StoreDef): boolean => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    if (def.name.toLowerCase().includes(q)) return true;
    try {
      const state = def.getState() as Record<string, unknown>;
      return Object.keys(state).some((k) => k.toLowerCase().includes(q));
    } catch {
      return false;
    }
  };

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const renderStore = (def: StoreDef) => {
    const isExpanded = expanded.has(def.name);
    let state: unknown;
    let fieldCount = 0;
    let error: string | undefined;
    try {
      state = def.getState();
      fieldCount = state && typeof state === "object" ? Object.keys(state as object).length : 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    return (
      <View key={def.name} style={styles.storeCard}>
        <TouchableOpacity
          style={styles.storeHeader}
          onPress={() => toggle(def.name)}
          onLongPress={() => {
            try {
              void Clipboard.setStringAsync(JSON.stringify(state, null, 2));
              Alert.alert(t("dev.copied"));
            } catch {
              // 静默
            }
          }}
        >
          <Text style={styles.toggle}>{isExpanded ? "▼" : "▶"}</Text>
          <Text style={styles.storeName}>{def.name}</Text>
          <Text style={styles.fieldCount}>{fieldCount} fields</Text>
        </TouchableOpacity>
        {isExpanded ? (
          <View style={styles.storeBody}>
            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <JsonView value={state} defaultExpanded={false} maxLines={200} />
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const persisted = PERSISTED_STORES.filter(filterStore);
  const memory = MEMORY_STORES.filter(filterStore);

  return (
    <View style={styles.container} key={version}>
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
        <TouchableOpacity onPress={refresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>{t("dev.refresh")}</Text>
        </TouchableOpacity>
      </View>

      {persisted.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t("dev.persistedGroup")} ({persisted.length})
          </Text>
          {persisted.map(renderStore)}
        </View>
      ) : null}

      {memory.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t("dev.memoryGroup")} ({memory.length})
          </Text>
          {memory.map(renderStore)}
        </View>
      ) : null}

      {persisted.length === 0 && memory.length === 0 ? (
        <Text style={styles.empty}>{t("dev.noData")}</Text>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: { paddingBottom: spacing.xxl },
    searchWrap: {
      flexDirection: "row",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.sm,
      alignItems: "center",
    },
    search: {
      flex: 1,
      ...typography.body,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: radius.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    refreshBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    refreshText: { ...typography.body, color: colors.accent, fontWeight: "500" },
    section: { marginTop: spacing.lg },
    sectionLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "500",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    storeCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    storeHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    toggle: { fontFamily: "Menlo", fontSize: 10, color: colors.textTertiary },
    storeName: {
      fontFamily: "Menlo",
      fontSize: 13,
      color: colors.text,
      fontWeight: "600",
      flex: 1,
    },
    fieldCount: { ...typography.caption2, color: colors.textTertiary, fontFamily: "Menlo" },
    storeBody: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      paddingTop: spacing.sm,
    },
    errorText: { fontFamily: "Menlo", fontSize: 11, color: colors.destructive },
    empty: {
      ...typography.body,
      color: colors.textTertiary,
      textAlign: "center",
      paddingTop: spacing.xxl,
    },
  });
}
