/**
 * [INPUT]: 依赖 AsyncStorage + secure-store + dev-secure-keys，依赖 dev-panel/JsonView/DevInspectModal，依赖 theme
 * [OUTPUT]: DevStorage 组件，浏览/编辑/删除 AsyncStorage + SecureStore 的所有 key-value
 * [POS]: components/dev-panel/ 的 Tab2 存储页，被 app/dev-panel 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { getItemAsync, setItemAsync, deleteItemAsync } from "../../utils/secure-store";
import { SECURE_STORE_KEYS } from "../../utils/dev-secure-keys";
import { useTheme, type Theme } from "../../theme";
import { JsonView } from "./JsonView";
import { DevInspectModal } from "./DevInspectModal";

interface StorageItem {
  key: string;
  value: string | null;
  source: "async" | "secure";
  size: number;
}

export function DevStorage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [items, setItems] = useState<StorageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [inspect, setInspect] = useState<{
    key: string;
    value: string;
    source: "async" | "secure";
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const asyncKeys = await AsyncStorage.getAllKeys();
      const asyncEntries = await AsyncStorage.multiGet(asyncKeys as string[]);
      const asyncItems: StorageItem[] = asyncEntries
        .filter((e): e is [string, string | null] => e[0] != null)
        .map(([k, v]) => ({
          key: k,
          value: v,
          source: "async" as const,
          size: v != null ? v.length : 0,
        }));

      const secureItems: StorageItem[] = [];
      for (const k of SECURE_STORE_KEYS) {
        const v = await getItemAsync(k);
        secureItems.push({ key: k, value: v, source: "secure", size: v != null ? v.length : 0 });
      }

      const all = [...asyncItems, ...secureItems].sort((a, b) => a.key.localeCompare(b.key));
      setItems(all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.key.toLowerCase().includes(q) || (i.value != null && i.value.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const asyncItems = filtered.filter((i) => i.source === "async");
  const secureItems = filtered.filter((i) => i.source === "secure");

  const handleCopy = async (text: string) => {
    await Clipboard.setStringAsync(text);
  };

  const handleDelete = (item: StorageItem) => {
    Alert.alert(t("dev.deleteConfirmTitle"), t("dev.deleteWarning"), [
      { text: t("dev.cancel"), style: "cancel" },
      {
        text: t("dev.confirm"),
        style: "destructive",
        onPress: async () => {
          if (item.source === "async") {
            await AsyncStorage.removeItem(item.key);
          } else {
            await deleteItemAsync(item.key);
          }
          await reload();
        },
      },
    ]);
  };

  const handleSave = async (newVal: string) => {
    if (!inspect) return;
    Alert.alert(t("dev.editConfirmTitle"), t("dev.editWarning"), [
      { text: t("dev.cancel"), style: "cancel" },
      {
        text: t("dev.confirm"),
        onPress: async () => {
          if (inspect.source === "async") {
            await AsyncStorage.setItem(inspect.key, newVal);
          } else {
            await setItemAsync(inspect.key, newVal);
          }
          setInspect(null);
          await reload();
        },
      },
    ]);
  };

  const renderItem = (item: StorageItem) => {
    const isSensitive = item.source === "secure";
    const previewValue =
      item.value == null
        ? "(null)"
        : item.value.length > 80
          ? item.value.slice(0, 80) + "…"
          : item.value;
    let parsed: unknown = undefined;
    if (item.value != null) {
      try {
        parsed = JSON.parse(item.value);
      } catch {
        parsed = undefined;
      }
    }

    return (
      <TouchableOpacity
        key={`${item.source}-${item.key}`}
        style={[styles.row, isSensitive && styles.sensitiveRow]}
        onPress={() => setInspect({ key: item.key, value: item.value ?? "", source: item.source })}
        onLongPress={() =>
          Alert.alert(item.key, undefined, [
            { text: t("dev.copy") + " key", onPress: () => void handleCopy(item.key) },
            {
              text: t("dev.copy") + " value",
              onPress: () => item.value != null && void handleCopy(item.value),
            },
            { text: t("dev.delete"), style: "destructive", onPress: () => handleDelete(item) },
            { text: t("dev.cancel"), style: "cancel" },
          ])
        }
      >
        <View style={styles.rowHeader}>
          <Text style={styles.rowKey} numberOfLines={1}>
            {item.key}
          </Text>
          <View style={styles.badges}>
            {isSensitive ? (
              <View style={[styles.badge, styles.secureBadge]}>
                <Text style={styles.badgeText}>SECURE</Text>
              </View>
            ) : null}
            <Text style={styles.sizeText}>
              {item.size} {t("dev.bytes")}
            </Text>
          </View>
        </View>
        {parsed !== undefined ? (
          <View style={styles.previewJson}>
            <JsonView value={parsed} defaultExpanded={false} maxLines={10} />
          </View>
        ) : (
          <Text style={styles.previewText} numberOfLines={2}>
            {previewValue}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
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
        <TouchableOpacity onPress={() => void reload()} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>{loading ? "…" : t("dev.refresh")}</Text>
        </TouchableOpacity>
      </View>

      {asyncItems.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t("dev.asyncStorage")} ({asyncItems.length})
          </Text>
          <View style={styles.card}>{asyncItems.map(renderItem)}</View>
        </View>
      ) : null}

      {secureItems.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t("dev.secureStorage")} ({secureItems.length})
          </Text>
          <Text style={styles.warningText}>{t("dev.secureWarning")}</Text>
          <View style={styles.card}>{secureItems.map(renderItem)}</View>
        </View>
      ) : null}

      {filtered.length === 0 && !loading ? (
        <Text style={styles.empty}>{t("dev.noData")}</Text>
      ) : null}

      <DevInspectModal
        visible={inspect != null}
        onClose={() => setInspect(null)}
        title={inspect?.key ?? ""}
        value={inspect?.value ?? ""}
        onSave={handleSave}
        warning={inspect?.source === "secure" ? t("dev.secureWarning") : undefined}
      />
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
      paddingBottom: spacing.xs,
    },
    warningText: {
      ...typography.caption2,
      color: colors.warning,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    sensitiveRow: { backgroundColor: colors.accentSubtle },
    rowHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.sm,
    },
    rowKey: { fontFamily: "Menlo", fontSize: 12, color: colors.text, flex: 1 },
    badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    secureBadge: { backgroundColor: colors.warning },
    badgeText: { fontSize: 9, fontWeight: "700", color: "#fff" },
    sizeText: { ...typography.caption2, color: colors.textTertiary, fontFamily: "Menlo" },
    previewText: { fontFamily: "Menlo", fontSize: 11, color: colors.textSecondary, marginTop: 4 },
    previewJson: { marginTop: 4 },
    empty: {
      ...typography.body,
      color: colors.textTertiary,
      textAlign: "center",
      paddingTop: spacing.xxl,
    },
  });
}
