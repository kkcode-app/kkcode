/**
 * [INPUT]: 依赖 connection/status/haptics/biometric/session-prefs store
 * [OUTPUT]: 设置首页 SettingsScreen，提供服务器、语言、外观、高频开关、支持与关于二级入口
 * [POS]: app/ 路由层的设置一级页，只承载导航和高频开关，复杂个性化配置下沉到二级页面
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useConnectionStore } from "../src/store/connection";
import { useHapticsPrefsStore } from "../src/store/haptics-prefs";
import { useStatusStore } from "../src/store/status";
import { useBiometricStore } from "../src/store/biometric";
import { useSessionPrefsStore } from "../src/store/session-prefs";
import { useDevAccessStore } from "../src/store/dev-access";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";
import {
  SYSTEM_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getLanguagePreference,
  subscribeToLanguagePreference,
} from "../src/i18n";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { haptic } from "../src/utils/haptics";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // ── Store ─────────────────────────────────────────────
  const active = useConnectionStore((s) => s.active);
  const order = useConnectionStore((s) => s.order);
  const status = useStatusStore((s) => s.status);
  const hapticsEnabled = useHapticsPrefsStore((s) => s.enabled);
  const setHapticsEnabled = useHapticsPrefsStore((s) => s.setEnabled);
  const biometricEnabled = useBiometricStore((s) => s.enabled);
  const setBiometricEnabled = useBiometricStore((s) => s.setEnabled);
  const showSubSessions = useSessionPrefsStore((s) => s.showSubSessions);
  const setShowSubSessions = useSessionPrefsStore((s) => s.setShowSubSessions);
  const groupByProject = useSessionPrefsStore((s) => s.groupByProject);
  const setGroupByProject = useSessionPrefsStore((s) => s.setGroupByProject);
  const devAccessUnlocked = useDevAccessStore((s) => s.unlocked);

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [languagePreference, setLanguagePreference] = useState(getLanguagePreference);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then((has) => {
      if (!has) return;
      LocalAuthentication.isEnrolledAsync().then(setBiometricSupported);
    });
  }, []);

  useEffect(
    () => subscribeToLanguagePreference(() => setLanguagePreference(getLanguagePreference())),
    [],
  );

  // ── Helpers ───────────────────────────────────────────
  const handleBiometricToggle = async (v: boolean) => {
    let authSuccess = true;
    if (v) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("biometric.promptEnable"),
        fallbackLabel: t("biometric.fallback"),
        cancelLabel: t("biometric.cancel"),
      });
      if (!result.success) {
        Alert.alert(t("biometric.enableFailed"));
        trackEvent(Ev.BiometricToggle, { enabled: "0", auth_success: "0" });
        return;
      }
      authSuccess = result.success;
    }
    haptic.impact();
    await setBiometricEnabled(v);
    trackEvent(Ev.BiometricToggle, {
      enabled: v ? "1" : "0",
      auth_success: authSuccess ? "1" : "0",
    });
  };

  const serverName = active ? active.nickname?.trim() || "—" : t("settings.serverNotSet");
  const currentLanguage =
    languagePreference === SYSTEM_LANGUAGE
      ? t("settings.followSystem")
      : (SUPPORTED_LANGUAGES.find((language) => language.code === i18n.language)?.label ??
        i18n.language);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {/* ── 服务器 ─────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.sectionServer")}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push("/servers")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="server-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{t("settings.sectionServer")}</Text>
              <Text style={styles.rowSubLabel} numberOfLines={1}>
                {serverName}
              </Text>
            </View>
            {active ? (
              <View style={[styles.statusDot, { backgroundColor: statusColor(status, theme) }]} />
            ) : null}
            {order.length > 0 ? (
              <Text style={styles.rowValue}>
                {t("settings.serverCount", { count: order.length })}
              </Text>
            ) : null}
            <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* ── 语言 ───────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.sectionLanguage")}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push("/language")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="language-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>{t("settings.labelLanguage")}</Text>
            <Text style={styles.rowValue}>{currentLanguage}</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* ── 个性化 ─────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.sectionPersonalization")}</Text>
        <View style={styles.card}>
          {/* 外观设置 */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push("/appearance")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="contrast-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>{t("settings.sectionAppearance")}</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
          </TouchableOpacity>

          {/* 显示子会话 */}
          <View style={styles.sep} />
          <View style={styles.row}>
            <Ionicons
              name="git-branch-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>{t("settings.labelShowSubSessions")}</Text>
            <Switch
              value={showSubSessions}
              onValueChange={(v) => {
                haptic.impact();
                void setShowSubSessions(v);
              }}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={theme.colors.border}
            />
          </View>

          {/* 按项目分组 */}
          <View style={styles.sep} />
          <View style={styles.row}>
            <Ionicons
              name="folder-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>{t("settings.labelGroupByProject")}</Text>
            <Switch
              value={groupByProject}
              onValueChange={(v) => {
                haptic.impact();
                void setGroupByProject(v);
                trackEvent(Ev.SessionGroupByProjectToggle, { enabled: v ? "1" : "0" });
              }}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={theme.colors.border}
            />
          </View>
        </View>

        {/* ── 安全（有生物识别硬件时才显示）─────────── */}
        {biometricSupported && (
          <>
            <Text style={styles.sectionLabel}>{t("settings.sectionSecurity")}</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <Ionicons
                  name="finger-print-outline"
                  size={17}
                  color={theme.colors.textSecondary}
                  style={styles.rowIcon}
                />
                <Text style={styles.rowLabel}>{t("settings.labelBiometric")}</Text>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={theme.colors.border}
                />
              </View>
            </View>
          </>
        )}

        {/* ── 通用 ───────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.sectionHaptics")}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons
              name="pulse-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>{t("settings.labelHaptics")}</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={(v) => {
                haptic.impact();
                void setHapticsEnabled(v);
                trackEvent(Ev.HapticsToggle, { enabled: v ? "1" : "0" });
              }}
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={theme.colors.border}
            />
          </View>
        </View>

        {/* ── 开发者（about 页 Logo 十连击解锁）────────── */}
        {devAccessUnlocked ? (
          <>
            <Text style={styles.sectionLabel}>{t("settings.sectionDev")}</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push("/dev-panel")}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="bug-outline"
                  size={17}
                  color={theme.colors.textSecondary}
                  style={styles.rowIcon}
                />
                <Text style={styles.rowLabel}>{t("settings.labelDevPanel")}</Text>
                <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {/* ── 关于 KKCode ────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t("settings.sectionAbout")}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push("/about")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="information-circle-outline"
              size={17}
              color={theme.colors.textSecondary}
              style={styles.rowIcon}
            />
            <Text style={styles.rowLabel}>{t("settings.labelAbout")}</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helpers ───────────────────────────────────────────────

function statusColor(s: "idle" | "connecting" | "open" | "error" | "fatal", theme: Theme): string {
  return {
    open: theme.colors.success,
    connecting: theme.colors.warning,
    error: theme.colors.destructive,
    fatal: theme.colors.destructive,
    idle: theme.colors.textTertiary,
  }[s];
}

// ── Styles ────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    container: {
      paddingTop: spacing.xs,
      paddingBottom: spacing.xxxxl,
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
    },

    sectionLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "500",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
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
      marginLeft: spacing.lg + 17 + spacing.md,
    },

    // ── 标准行 ────────────────────────────────────────
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      minHeight: 52,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    rowIcon: { width: 17 },
    rowLabel: { ...typography.body, color: colors.text, flex: 1 },
    rowLabelSelected: { color: colors.accent, fontWeight: "600" },
    rowValue: { ...typography.body, color: colors.textSecondary },
    rowBody: { flex: 1, gap: 2, paddingVertical: spacing.xs },
    rowSubLabel: { ...typography.footnote, color: colors.textTertiary },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
  });
}
