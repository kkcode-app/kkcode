/**
 * [INPUT]: 依赖 expo-router 路由壳，依赖 expo-clipboard 复制 URL，依赖 src/i18n 文案，依赖 src/theme 主题，依赖 src/utils/haptics 触感
 * [OUTPUT]: 对外提供 SchemaUrlScreen 说明页，展示 scheme 前缀与可用 deep link 路由，点击行复制到剪贴板
 * [POS]: app/ 的信息展示页，被 app/settings 导航；展示本应用支持的 kkcode-community:// URL Scheme
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";
import { haptic } from "../src/utils/haptics";

type RouteEntry = {
  // 完整 URL（含 scheme）
  url: string;
  // i18n key 后缀，对应 settings.schemaUrl.routes.<key>.title / desc
  key: string;
};

const SCHEME = "kkcode-community";

const ROUTES: RouteEntry[] = [
  { url: "kkcode-community://", key: "root" },
  { url: "kkcode-community://sessions", key: "sessions" },
  { url: "kkcode-community://settings", key: "settings" },
  { url: "kkcode-community://servers", key: "servers" },
  { url: "kkcode-community://chat/<id>", key: "chat" },
];

export default function SchemaUrlScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (text: string) => {
    haptic.selection();
    try {
      await Clipboard.setStringAsync(text);
      setCopied(text);
      // 2s 后清除"已复制"标记
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 2000);
    } catch {
      // 静默
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 概述 ─────────────────────────────────── */}
        <View style={styles.introCard}>
          <View style={styles.introIconRing}>
            <Ionicons name="link-outline" size={26} color={theme.colors.accent} />
          </View>
          <Text style={styles.introTitle}>{t("settings.schemaUrl.introTitle")}</Text>
          <Text style={styles.introDesc}>{t("settings.schemaUrl.introDesc")}</Text>
        </View>

        {/* ── Scheme 前缀 ─────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.schemaUrl.sectionScheme")}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.schemeRow}
            onPress={() => handleCopy(SCHEME + "://")}
            activeOpacity={0.7}
          >
            <View style={styles.schemeBody}>
              <Text style={styles.schemeLabel}>{t("settings.schemaUrl.schemeLabel")}</Text>
              <Text style={styles.schemeValue}>{SCHEME}://</Text>
            </View>
            <Ionicons
              name={copied === SCHEME + "://" ? "checkmark" : "copy-outline"}
              size={18}
              color={copied === SCHEME + "://" ? theme.colors.success : theme.colors.accent}
            />
          </TouchableOpacity>
        </View>

        {/* ── 可用路由 ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.schemaUrl.sectionRoutes")}</Text>
        <View style={styles.card}>
          {ROUTES.map((r, idx) => {
            const isLast = idx === ROUTES.length - 1;
            const isCopied = copied === r.url;
            return (
              <View key={r.key}>
                <TouchableOpacity
                  style={styles.routeRow}
                  onPress={() => handleCopy(r.url)}
                  activeOpacity={0.7}
                >
                  <View style={styles.routeBody}>
                    <Text style={styles.routeTitle}>
                      {t(`settings.schemaUrl.routes.${r.key}.title`)}
                    </Text>
                    <Text style={styles.routeDesc}>
                      {t(`settings.schemaUrl.routes.${r.key}.desc`)}
                    </Text>
                    <Text style={styles.routeUrl} numberOfLines={1}>
                      {r.url}
                    </Text>
                  </View>
                  <Ionicons
                    name={isCopied ? "checkmark" : "copy-outline"}
                    size={18}
                    color={isCopied ? theme.colors.success : theme.colors.textTertiary}
                  />
                </TouchableOpacity>
                {!isLast && <View style={styles.sep} />}
              </View>
            );
          })}
        </View>

        {/* ── 使用提示 ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.schemaUrl.sectionTips")}</Text>
        <View style={styles.card}>
          <View style={styles.tipRow}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={theme.colors.textTertiary}
            />
            <Text style={styles.tipText}>{t("settings.schemaUrl.tip1")}</Text>
          </View>
          <View style={styles.sep} />
          <View style={styles.tipRow}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={16}
              color={theme.colors.textTertiary}
            />
            <Text style={styles.tipText}>{t("settings.schemaUrl.tip2")}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    container: {
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxxl,
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
    },

    // ── 概述卡片 ────────────────────────────────────
    introCard: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 10,
      marginHorizontal: spacing.lg,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
    },
    introIconRing: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSubtle,
    },
    introTitle: {
      ...typography.headline,
      color: colors.text,
      textAlign: "center",
    },
    introDesc: {
      ...typography.subheadline,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 21,
    },

    // ── 通用 ────────────────────────────────────────
    sectionLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "500",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
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
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginLeft: spacing.lg,
    },

    // ── Scheme 行 ──────────────────────────────────
    schemeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      minHeight: 60,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    schemeBody: { flex: 1, gap: 2 },
    schemeLabel: {
      ...typography.footnote,
      color: colors.textTertiary,
    },
    schemeValue: {
      ...typography.bodyEmphasized,
      color: colors.text,
      fontFamily: theme.monoFontFamily,
    },

    // ── 路由行 ──────────────────────────────────────
    routeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      minHeight: 72,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    routeBody: { flex: 1, gap: 3 },
    routeTitle: {
      ...typography.body,
      color: colors.text,
      fontWeight: "500",
    },
    routeDesc: {
      ...typography.footnote,
      color: colors.textTertiary,
    },
    routeUrl: {
      ...typography.monoSm,
      color: colors.accent,
      marginTop: 2,
    },

    // ── 提示行 ──────────────────────────────────────
    tipRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: spacing.lg,
      minHeight: 52,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    tipText: {
      ...typography.footnote,
      color: colors.textSecondary,
      flex: 1,
      lineHeight: 18,
    },
  });
}
