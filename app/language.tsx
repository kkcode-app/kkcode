/**
 * [INPUT]: 依赖 i18n 的语言选项/偏好管理与当前语言状态
 * [OUTPUT]: 对外提供可搜索、首项为跟随系统的语言选择设置页
 * [POS]: app/ 的语言二级设置页，由 settings 导航进入，替代长列表 BottomSheet
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import { useDeferredValue, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import {
  SYSTEM_LANGUAGE,
  SUPPORTED_LANGUAGES,
  followSystemLanguage,
  getLanguagePreference,
  setLanguage,
  subscribeToLanguagePreference,
  type LanguageCode,
} from "../src/i18n";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";
import { haptic } from "../src/utils/haptics";

export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [languagePreference, setLanguagePreference] = useState(getLanguagePreference);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const languageOptions: { code: LanguageCode | typeof SYSTEM_LANGUAGE; label: string }[] = [
    { code: SYSTEM_LANGUAGE, label: t("settings.followSystem") },
    ...SUPPORTED_LANGUAGES,
  ];
  const languages = languageOptions.filter(
    (language) =>
      !deferredQuery ||
      language.label.toLocaleLowerCase().includes(deferredQuery) ||
      language.code.toLocaleLowerCase().includes(deferredQuery),
  );

  useEffect(
    () => subscribeToLanguagePreference(() => setLanguagePreference(getLanguagePreference())),
    [],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.safe, { paddingLeft: insets.left, paddingRight: insets.right }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={styles.searchWrap}>
        <View style={styles.searchField}>
          <Ionicons name="search" size={18} color={theme.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("settings.labelLanguage")}
            placeholderTextColor={theme.colors.textTertiary}
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.searchInput}
          />
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.card} accessibilityRole="radiogroup">
          {languages.map((language, index) => {
            const followsSystem = language.code === SYSTEM_LANGUAGE;
            const selected = followsSystem
              ? languagePreference === SYSTEM_LANGUAGE
              : languagePreference === language.code;
            return (
              <View key={language.code}>
                <TouchableOpacity
                  style={styles.row}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={async () => {
                    haptic.selection();
                    const from = i18n.language;
                    if (language.code === SYSTEM_LANGUAGE) await followSystemLanguage();
                    else await setLanguage(language.code);
                    trackEvent(Ev.LanguageChange, { from, to: language.code });
                  }}
                >
                  <Text style={[styles.languageLabel, selected && styles.selectedText]}>
                    {language.label}
                  </Text>
                  {followsSystem ? null : <Text style={styles.languageCode}>{language.code}</Text>}
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} />
                  ) : (
                    <View style={styles.checkPlaceholder} />
                  )}
                </TouchableOpacity>
                {index < languages.length - 1 ? <View style={styles.separator} /> : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    searchWrap: {
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    searchField: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.inputBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.inputBorder,
    },
    searchInput: { ...typography.body, color: colors.text, flex: 1, paddingVertical: 0 },
    container: {
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
      paddingTop: spacing.sm,
    },
    card: {
      marginHorizontal: spacing.lg,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      minHeight: 56,
      paddingHorizontal: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    languageLabel: { ...typography.body, color: colors.text, flex: 1 },
    languageCode: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
    },
    selectedText: { color: colors.accent, fontWeight: "600" },
    checkPlaceholder: { width: 22, height: 22 },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginLeft: spacing.lg,
    },
  });
}
