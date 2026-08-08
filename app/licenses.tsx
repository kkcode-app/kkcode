/**
 * [INPUT]: 依赖 react-native-legal 的 ReactNativeLegal.getLibrariesAsync() 读取原生 Settings.bundle 中的 LicensePlist，依赖 expo-router 的 router.push 跳详情页
 * [OUTPUT]: 对外提供 LicensesScreen 列表页，过滤直接依赖、按协议名展示，点击跳转 /license/[id] 详情页
 * [POS]: app/licenses 是开源许可证列表入口，被 app/settings 导航；详情展示由 app/license/[id] 承担
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 开源许可证页 — 仅展示 package.json 直接依赖的开源许可信息
// 使用 react-native-legal 的 ReactNativeLegal.getLibrariesAsync() 获取数据
// iOS 原生端不返回 License.name，需要从 licenseContent 文本推断协议简称

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReactNativeLegal } from "react-native-legal";
import type { Library } from "react-native-legal/src/NativeReactNativeLegal";
import { useTranslation } from "react-i18next";

import { useTheme, type Theme } from "../src/theme";

// 直接依赖白名单（来自 package.json dependencies）
const DIRECT_DEPS = new Set([
  "@expo/metro-runtime",
  "@expo/vector-icons",
  "@opencode-ai/sdk",
  "@react-native-async-storage/async-storage",
  "expo",
  "expo-alternate-app-icons",
  "expo-build-properties",
  "expo-clipboard",
  "expo-constants",
  "expo-haptics",
  "expo-linking",
  "expo-local-authentication",
  "expo-localization",
  "expo-router",
  "expo-secure-store",
  "expo-status-bar",
  "i18next",
  "punycode",
  "react",
  "react-dom",
  "react-i18next",
  "react-native",
  "react-native-gesture-handler",
  "react-native-legal",
  "react-native-markdown-display",
  "react-native-reanimated",
  "react-native-safe-area-context",
  "react-native-screens",
  "react-native-sse",
  "react-native-web",
  "react-native-webview",
  "react-native-worklets",
  "zustand",
]);

// iOS 原生端不返回 License.name。从 licenseContent 中按常见 SPDX 关键字匹配，回退到第一行非空标题。
// 匹配按特异性从高到低，避免短词误命中。
const LICENSE_PATTERNS: [RegExp, string][] = [
  [/Apache License,\s*Version\s*2\.0/i, "Apache-2.0"],
  [/GNU GENERAL PUBLIC LICENSE\s*Version\s*3/i, "GPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE\s*Version\s*2/i, "GPL-2.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE\s*Version\s*3/i, "LGPL-3.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE\s*Version\s*2\.1/i, "LGPL-2.1"],
  [/Mozilla Public License,\s*v\.\s*2\.0/i, "MPL-2.0"],
  [/Creative Commons Attribution\s*4\.0/i, "CC-BY-4.0"],
  [/Creative Commons Attribution-ShareAlike\s*4\.0/i, "CC-BY-SA-4.0"],
  [/Creative Commons Attribution\s*3\.0/i, "CC-BY-3.0"],
  [/BSD 3-Clause License/i, "BSD-3-Clause"],
  [/BSD 2-Clause License/i, "BSD-2-Clause"],
  [/ISC License/i, "ISC"],
  [/The MIT License/i, "MIT"],
  [/Permission is hereby granted, free of charge/i, "MIT"],
  [/The Unlicense/i, "Unlicense"],
  [/WTFPL/i, "WTFPL"],
  [/BlueOak Model License/i, "BlueOak-1.0.0"],
];

export function inferLicenseName(content: string | undefined): string | null {
  if (!content) return null;
  for (const [re, name] of LICENSE_PATTERNS) {
    if (re.test(content)) return name;
  }
  // fallback: 第一行非空，且不要太长
  const firstLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine && firstLine.length <= 60) return firstLine;
  return null;
}

function licenseDisplayName(lic: { name?: string; licenseContent?: string }): string {
  return lic.name ?? inferLicenseName(lic.licenseContent) ?? "Unknown";
}

export default function LicensesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();

  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ReactNativeLegal.getLibrariesAsync()
      .then((res) => {
        const direct = res.data
          .filter((lib) => DIRECT_DEPS.has(lib.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        setLibraries(direct);
      })
      .catch(() => {
        setLibraries([]);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.summary}>
          <View style={styles.summaryIcon}>
            <Ionicons name="document-text-outline" size={20} color={theme.colors.accent} />
          </View>
          <Text style={styles.count}>{t("licenses.count", { count: libraries.length })}</Text>
        </View>

        <View style={styles.card}>
          {libraries.map((lib, idx) => {
            const isLast = idx === libraries.length - 1;
            const licenseLabel = lib.licenses.map(licenseDisplayName).join(", ");
            return (
              <View key={lib.id}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => router.push(`/license/${encodeURIComponent(lib.id)}`)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {lib.name}
                    </Text>
                    <Text style={styles.rowLicense} numberOfLines={1}>
                      {licenseLabel}
                      {lib.version ? `  ·  v${lib.version}` : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
                </TouchableOpacity>
                {!isLast && <View style={styles.sep} />}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    container: {
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxxl,
    },
    count: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "500",
    },
    summary: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.sm,
    },
    summaryIcon: {
      alignItems: "center",
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.sm,
      height: 32,
      justifyContent: "center",
      width: 32,
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
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      minHeight: 58,
      paddingVertical: spacing.sm,
      gap: spacing.md,
    },
    rowBody: { flex: 1, gap: 2 },
    rowName: {
      ...typography.body,
      color: colors.text,
    },
    rowLicense: {
      ...typography.caption1,
      color: colors.textTertiary,
    },
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginLeft: spacing.lg,
    },
  });
}
