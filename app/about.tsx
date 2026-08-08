/**
 * [INPUT]: 依赖 Expo 应用信息与 Router，依赖 dev-access store 提供 Logo 十连击切换开发者入口显隐
 * [OUTPUT]: 对外提供 AboutScreen，集中展示 KKCode Community 信息与入口，App Logo 每连续点击 10 次切换设置页开发者入口显隐
 * [POS]: app/ 路由层的关于二级页，被 app/settings 导航，并继续下钻 onboarding/schema-url/licenses/webview
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useRef } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Pressable,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";
import { useDevAccessStore } from "../src/store/dev-access";
import { haptic } from "../src/utils/haptics";

const LINKS = {
  sdks: "https://kkcode.app/third-party-sdks.html",
};

const EASTER_EGG_TAPS = 10;
const EASTER_EGG_TAP_TIMEOUT_MS = 1500;

export default function AboutScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const appName = Constants.expoConfig?.name ?? "KKCode Community";
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const buildNumber = Constants.nativeBuildVersion ?? null;
  const toggleDevAccess = useDevAccessStore((state) => state.toggleUnlocked);
  const logoTapRef = useRef({ count: 0, lastTapAt: 0 });
  const versionText = `${t("about.version")} ${version}${buildNumber ? ` (${buildNumber})` : ""}`;

  const openInWebView = (url: string, title: string, kind: string) => {
    trackEvent(Ev.WebLinkOpen, { link: kind });
    router.push({ pathname: "/webview", params: { url, title } });
  };

  const handleLogoPress = () => {
    const now = Date.now();
    const count =
      now - logoTapRef.current.lastTapAt > EASTER_EGG_TAP_TIMEOUT_MS
        ? 1
        : logoTapRef.current.count + 1;
    logoTapRef.current = { count, lastTapAt: now };
    if (count < EASTER_EGG_TAPS) return;
    logoTapRef.current = { count: 0, lastTapAt: 0 };
    void toggleDevAccess().then((enabled) => {
      if (enabled) haptic.success();
      else haptic.warning();
      Alert.alert(enabled ? "开发者模式已开启" : "开发者模式已关闭");
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <Pressable onPress={handleLogoPress} accessibilityRole="image">
            <Image
              source={require("../assets/icon.png")}
              style={styles.logo}
              contentFit="contain"
              transition={120}
              cachePolicy="memory-disk"
            />
          </Pressable>
          <Text style={styles.appName}>{appName}</Text>
          <Text style={styles.tagline}>{t("about.tagline")}</Text>
          <View style={styles.versionPill}>
            <Text style={styles.version}>{versionText}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t("about.sectionGuide")}</Text>
        <View style={styles.card}>
          <Row
            icon="sparkles-outline"
            label={t("about.appIntro")}
            onPress={() => router.push("/onboarding")}
            theme={theme}
            styles={styles}
          />
          <View style={styles.sep} />
          <Row
            icon="link-outline"
            label={t("settings.labelSchemaUrl")}
            onPress={() => router.push("/schema-url")}
            theme={theme}
            styles={styles}
          />
        </View>

        <Text style={styles.sectionLabel}>{t("about.sectionLegal")}</Text>
        <View style={styles.card}>
          <Row
            icon="shield-checkmark-outline"
            label={t("about.sdks")}
            onPress={() => openInWebView(LINKS.sdks, t("about.sdks"), "sdks")}
            theme={theme}
            styles={styles}
          />
          <View style={styles.sep} />
          <Row
            icon="document-outline"
            label={t("settings.labelLicenses")}
            onPress={() => router.push("/licenses")}
            theme={theme}
            styles={styles}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.copyright}>
            © {new Date().getFullYear()} {appName}
          </Text>
          <Text style={styles.builtWith}>{t("about.builtWith")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type RowProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  external?: boolean;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
};

function Row({ icon, label, onPress, external = false, theme, styles }: RowProps) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={theme.colors.textSecondary} style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons
        name={external ? "open-outline" : "chevron-forward"}
        size={external ? 14 : 15}
        color={theme.colors.textTertiary}
      />
    </TouchableOpacity>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    container: {
      alignSelf: "center",
      maxWidth: breakpoints.contentMaxWidth,
      paddingBottom: spacing.xxxxl,
      paddingTop: spacing.md,
      width: "100%",
    },
    identity: {
      alignItems: "center",
      paddingHorizontal: spacing.xxl,
      paddingBottom: spacing.lg,
      paddingTop: spacing.lg,
    },
    logo: { width: 72, height: 72, borderRadius: 18, marginBottom: spacing.md },
    appName: { ...typography.title2, color: colors.text, fontWeight: "700" },
    tagline: {
      ...typography.subheadline,
      color: colors.textSecondary,
      lineHeight: 21,
      marginTop: spacing.sm,
      maxWidth: 320,
      textAlign: "center",
    },
    versionPill: {
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.full,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    version: { ...typography.caption1, color: colors.accent, fontWeight: "600" },
    sectionLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      fontWeight: "500",
      letterSpacing: 0.6,
      paddingBottom: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      textTransform: "uppercase",
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      marginHorizontal: spacing.lg,
      overflow: "hidden",
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      minHeight: 52,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    rowIcon: { width: 18 },
    rowLabel: { ...typography.body, color: colors.text, flex: 1 },
    sep: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginLeft: spacing.lg + 18 + spacing.md,
    },
    footer: { alignItems: "center", gap: 4, marginBottom: spacing.lg, marginTop: spacing.xxl },
    copyright: { ...typography.caption1, color: colors.textTertiary },
    builtWith: { ...typography.caption2, color: colors.textTertiary },
  });
}
