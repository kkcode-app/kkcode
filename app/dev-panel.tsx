/**
 * [INPUT]: 依赖所有 dev-panel/* Tab 组件，依赖 services/dev-logger 开关式拦截 + react-native-network-logger，依赖 theme，依赖 react-native KeyboardAvoidingView/Platform
 * [OUTPUT]: DevPanelScreen，开发者面板 Tab 容器，日志/网络拦截由各自 Tab 的开关控制
 * [POS]: app/ 路由层的开发者二级页，被 app/about 的 Logo 十连击解锁后在 app/settings 导航
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { DevOverview } from "../src/components/dev-panel/DevOverview";
import { DevStorage } from "../src/components/dev-panel/DevStorage";
import { DevStores } from "../src/components/dev-panel/DevStores";
import { DevLogs } from "../src/components/dev-panel/DevLogs";
import { DevNetwork } from "../src/components/dev-panel/DevNetwork";
import { DevTools } from "../src/components/dev-panel/DevTools";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";

type TabId = "overview" | "storage" | "stores" | "logs" | "network" | "tools";

export default function DevPanelScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [tab, setTab] = useState<TabId>("overview");

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: t("dev.tabOverview") },
    { id: "storage", label: t("dev.tabStorage") },
    { id: "stores", label: t("dev.tabStores") },
    { id: "logs", label: t("dev.tabLogs") },
    { id: "network", label: t("dev.tabNetwork") },
    { id: "tools", label: t("dev.tabTools") },
  ];

  // 日志和网络页需要占满高度（内部自己滚动），其他页用 ScrollView
  const isFullHeight = tab === "logs" || tab === "network";

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      {/* 按 AGENTS.md KAV 规范：含搜索框的页面外层包 KAV，两端都显式给 behavior */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Tab 栏 */}
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
          >
            {tabs.map((tb) => (
              <TouchableOpacity
                key={tb.id}
                style={[styles.tab, tab === tb.id && styles.tabActive]}
                onPress={() => setTab(tb.id)}
              >
                <Text style={[styles.tabText, tab === tb.id && styles.tabTextActive]}>
                  {tb.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 内容区 */}
        {isFullHeight ? (
          <View style={styles.flex}>
            {tab === "logs" ? <DevLogs /> : null}
            {tab === "network" ? <DevNetwork /> : null}
          </View>
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {tab === "overview" ? <DevOverview /> : null}
            {tab === "storage" ? <DevStorage /> : null}
            {tab === "stores" ? <DevStores /> : null}
            {tab === "tools" ? <DevTools /> : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    flex: { flex: 1 },
    tabBar: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      backgroundColor: colors.headerBackground,
    },
    tabBarContent: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingVertical: spacing.sm },
    tab: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
    },
    tabActive: { backgroundColor: colors.accentSubtle },
    tabText: { ...typography.footnote, color: colors.textSecondary, fontWeight: "500" },
    tabTextActive: { color: colors.accent, fontWeight: "600" },
    scrollContent: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxxxl,
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
      width: "100%",
    },
  });
}
