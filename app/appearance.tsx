/**
 * [INPUT]: 依赖 theme store 的 mode/setMode，依赖 theme 与 haptics
 * [OUTPUT]: 对外提供外观设置页，支持主题模式（系统/浅色/深色）切换
 * [POS]: app/ 的外观二级设置页，由 settings 导航进入
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useThemeStore, type ThemeMode } from "../src/store/theme";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { haptic } from "../src/utils/haptics";

const MODE_ICONS: Record<ThemeMode, React.ComponentProps<typeof Ionicons>["name"]> = {
  system: "phone-portrait-outline",
  light: "sunny-outline",
  dark: "moon-outline",
};

export default function AppearanceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <View style={[styles.safe, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={styles.previewDock}>
        <View style={styles.preview}>
          <Text style={styles.previewIncomingText}>{`const theme = "KKCode";`}</Text>
          <View style={styles.previewOutgoing}>
            <Text style={styles.previewOutgoingText}>npm run start</Text>
          </View>
        </View>
      </View>

      <View style={[styles.container, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.sectionLabel}>{t("settings.sectionAppearance")}</Text>
        <View style={styles.card}>
          <View style={styles.segmented} accessibilityRole="radiogroup">
            {(["system", "light", "dark"] as ThemeMode[]).map((value) => {
              const selected = mode === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.segmentedItem, selected && styles.segmentedItemActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    haptic.selection();
                    void setMode(value);
                    trackEvent(Ev.ThemeModeChange, { mode: value });
                  }}
                >
                  <Ionicons
                    name={MODE_ICONS[value]}
                    size={18}
                    color={selected ? theme.colors.accent : theme.colors.textSecondary}
                  />
                  <Text style={[styles.segmentedLabel, selected && styles.selectedText]}>
                    {t(`settings.theme${value[0].toUpperCase()}${value.slice(1)}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    previewDock: {
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: colors.groupedBackground,
      zIndex: 1,
    },
    container: {
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
      gap: spacing.sm,
    },
    preview: {
      minHeight: 168,
      marginHorizontal: spacing.lg,
      padding: spacing.lg,
      borderRadius: radius.xl,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      justifyContent: "center",
      gap: spacing.md,
    },
    previewIncomingText: {
      alignSelf: "flex-start",
      maxWidth: "84%",
      ...typography.body,
      lineHeight: 25,
      color: colors.text,
    },
    previewOutgoing: {
      alignSelf: "flex-end",
      maxWidth: "84%",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.bubble,
      borderBottomRightRadius: 4,
      backgroundColor: colors.bubbleOutgoing,
    },
    previewOutgoingText: {
      ...typography.body,
      color: "rgba(255,255,255,0.95)",
    },
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
      marginHorizontal: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: spacing.md,
    },
    segmented: { flexDirection: "row", gap: spacing.xs },
    segmentedItem: {
      flex: 1,
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.inputBackground,
    },
    segmentedItemActive: { backgroundColor: colors.accentMuted },
    segmentedLabel: { ...typography.footnote, color: colors.textSecondary },
    selectedText: { color: colors.accent, fontWeight: "600" },
  });
}
