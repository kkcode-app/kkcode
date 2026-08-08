/**
 * [INPUT]: 依赖 expo-constants/expo-device/expo-localization 的信息，依赖 Platform/useWindowDimensions，依赖 useNavigationState 获取路由栈，依赖 theme
 * [OUTPUT]: DevOverview 组件，展示 App/设备/运行时/路由栈信息
 * [POS]: components/dev-panel/ 的 Tab1 概览页，被 app/dev-panel 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Localization from "expo-localization";
import { useRootNavigationState } from "expo-router";
import { useMemo } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { useConnectionStore } from "../../store/connection";
import { useSessionsStore } from "../../store/sessions";
import { useMessagesStore } from "../../store/messages";
import { useThemeStore } from "../../store/theme";
import { useTheme, type Theme } from "../../theme";

export function DevOverview() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const win = useWindowDimensions();

  const active = useConnectionStore((s) => s.active);
  const sessions = useSessionsStore((s) => s.sessions);
  const bySession = useMessagesStore((s) => s.bySession);
  const themeMode = useThemeStore((s) => s.mode);

  const navState = useRootNavigationState();
  const routeStack: string[] = useMemo(() => {
    const names: string[] = [];
    const walk = (
      s:
        | { name?: string; routes?: { name?: string; state?: unknown }[]; index?: number }
        | undefined
        | null,
    ): void => {
      if (!s) return;
      if (s.name) names.push(s.name);
      if (s.routes && s.index != null) {
        const current = s.routes[s.index];
        if (current?.state) walk(current.state as typeof s);
        else if (current?.name) names.push(current.name);
      }
    };
    walk(navState);
    return names;
  }, [navState]);

  const expoConfig = Constants.expoConfig;
  const messageCount = Object.values(bySession).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);

  // Platform.constants.reactNativeVersion 是 {major, minor, patch} 对象
  const rnVer = Platform.constants?.reactNativeVersion;
  const rnVersionStr = rnVer
    ? `${rnVer.major ?? 0}.${rnVer.minor ?? 0}.${rnVer.patch ?? 0}` +
      (rnVer.prerelease ? `-${rnVer.prerelease}` : "")
    : Platform.Version;

  const appInfo: [string, string][] = [
    ["Name", expoConfig?.name ?? "—"],
    ["Bundle ID", expoConfig?.ios?.bundleIdentifier ?? expoConfig?.android?.package ?? "—"],
    ["Scheme", expoConfig?.scheme ? String(expoConfig.scheme) : "—"],
    ["Version", expoConfig?.version ?? "—"],
    ["Build", Constants.nativeBuildVersion ?? "—"],
    ["Expo SDK", String(expoConfig?.sdkVersion ?? "—")],
    ["RN", rnVersionStr],
    ["__DEV__", String(__DEV__)],
  ];

  const deviceInfo: [string, string][] = [
    ["Model", Device.modelName ?? "—"],
    ["Manufacturer", Device.manufacturer ?? "—"],
    ["Brand", Device.brand ?? "—"],
    ["OS", `${Platform.OS === "ios" ? "iOS" : "Android"} ${Device.osVersion ?? Platform.Version}`],
    ["OS Build", Device.osBuildId ?? "—"],
    ["Screen", `${Math.round(win.width)}×${Math.round(win.height)} @${win.scale}`],
    ["Locale", Localization.getLocales()[0]?.languageTag ?? "—"],
    ["Timezone", Localization.getCalendars()[0]?.timeZone ?? "—"],
  ];

  const runtimeInfo: [string, string][] = [
    ["Theme Mode", themeMode],
    ["Server", active ? `${active.nickname ?? "-"} (${active.id})` : "not connected"],
    ["Server URL", active?.baseUrl ?? "-"],
    ["Sessions", String(sessions.length)],
    ["Messages", String(messageCount)],
  ];

  return (
    <View style={styles.container}>
      <Section title={t("dev.appInfo")} styles={styles}>
        {appInfo.map(([k, v]) => (
          <Row key={k} k={k} v={v} styles={styles} />
        ))}
      </Section>

      <Section title={t("dev.deviceInfo")} styles={styles}>
        {deviceInfo.map(([k, v]) => (
          <Row key={k} k={k} v={v} styles={styles} />
        ))}
      </Section>

      <Section title={t("dev.runtimeInfo")} styles={styles}>
        {runtimeInfo.map(([k, v]) => (
          <Row key={k} k={k} v={v} styles={styles} />
        ))}
      </Section>

      <Section title={t("dev.routeStack")} styles={styles}>
        {routeStack.length === 0 ? (
          <Text style={styles.empty}>{t("dev.noData")}</Text>
        ) : (
          routeStack.map((name: string, i: number) => (
            <View key={`${name}-${i}`} style={styles.routeRow}>
              <Text style={styles.routeIndex}>{i}</Text>
              <Text style={styles.routeName}>{name}</Text>
            </View>
          ))
        )}
      </Section>
    </View>
  );
}

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ k, v, styles }: { k: string; v: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey} numberOfLines={1}>
        {k}
      </Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: { paddingBottom: spacing.xxl },
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
    card: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      gap: spacing.md,
    },
    rowKey: { ...typography.footnote, color: colors.textSecondary, flex: 0.4 },
    rowValue: {
      ...typography.footnote,
      color: colors.text,
      flex: 0.6,
      fontFamily: "Menlo",
      fontSize: 11,
    },
    routeRow: {
      flexDirection: "row",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      gap: spacing.md,
      alignItems: "center",
    },
    routeIndex: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontFamily: "Menlo",
      minWidth: 24,
    },
    routeName: { ...typography.footnote, color: colors.text, fontFamily: "Menlo" },
    empty: {
      ...typography.footnote,
      color: colors.textTertiary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
  });
}
