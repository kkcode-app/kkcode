/**
 * [INPUT]: 依赖 expo-router 的 useLocalSearchParams 读取路由 id，依赖 react-native-legal 的 getLibrariesAsync 重新拉取原生 LicensePlist，依赖 app/licenses 的 licenseDisplayName 复用协议名推断
 * [OUTPUT]: 对外提供 LicenseDetailScreen 详情页，展示指定库的协议名、版本与 licenseContent 全文
 * [POS]: app/license 的单库详情路由，被 app/licenses 列表 push 进入，与列表页共享 iOS 协议名推断逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 单个开源库许可证详情页 — 通过 id 在原生 LicensePlist 中检索
// iOS 原生端不返回 License.name，复用 licenses 页的 inferLicenseName 从内容推断

import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReactNativeLegal } from "react-native-legal";
import type { Library } from "react-native-legal/src/NativeReactNativeLegal";

import { useTheme, type Theme } from "../../src/theme";
import { inferLicenseName } from "../licenses";

function licenseDisplayName(lic: { name?: string; licenseContent?: string }): string {
  return lic.name ?? inferLicenseName(lic.licenseContent) ?? "Unknown";
}

export default function LicenseDetailScreen() {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();

  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    ReactNativeLegal.getLibrariesAsync()
      .then((res) => {
        if (cancelled) return;
        setLibrary(res.data.find((lib) => lib.id === id) ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setLibrary(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: library?.name ?? "" });
  }, [navigation, library?.name]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!library) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Not found</Text>
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
      >
        {library.version && (
          <View style={styles.metaCard}>
            <Text style={styles.meta}>v{library.version}</Text>
          </View>
        )}
        {library.licenses.map((lic, i) => (
          <View key={i} style={styles.licenseBlock}>
            <Text style={styles.licenseType}>{licenseDisplayName(lic)}</Text>
            <Text style={styles.licenseText}>{lic.licenseContent}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyText: {
      ...typography.body,
      color: colors.textSecondary,
    },
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxxl,
      gap: spacing.lg,
    },
    meta: {
      ...typography.caption1,
      color: colors.textTertiary,
    },
    metaCard: {
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    licenseBlock: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      gap: spacing.md,
      padding: spacing.lg,
    },
    licenseType: {
      ...typography.subheadlineEmphasized,
      color: colors.accent,
    },
    licenseText: {
      ...typography.footnote,
      color: colors.text,
      lineHeight: 18,
    },
  });
}
