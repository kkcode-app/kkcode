/**
 * [INPUT]: 依赖 onboarding store 记录完成状态，展示正式开放的隧道与扫码介绍
 * [OUTPUT]: 对外提供 OnboardingScreen 横向分页介绍页
 * [POS]: app/ 的首次启动与关于页产品介绍路由，默认仅介绍手动服务器连接
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useOnboardingStore } from "../src/store/onboarding";
import { useTheme, type Theme } from "../src/theme";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";

type Slide = {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  bullets?: string[];
};

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ initial?: string }>();
  const isInitial = params.initial === "1";
  const markCompleted = useOnboardingStore((s) => s.markCompleted);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // useWindowDimensions 自动响应旋转/分屏/Foldable 展开变更
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  // 从设置进入看介绍（不是首次启动）打一次 viewed 事件
  useEffect(() => {
    if (!isInitial) trackEvent(Ev.OnboardingViewed, { from: "settings" });
  }, [isInitial]);

  const slides: Slide[] = useMemo(
    () => [
      {
        key: "welcome",
        icon: "sparkles",
        title: t("onboarding.welcomeTitle"),
        description: t("onboarding.welcomeDesc"),
      },
      {
        key: "connect",
        icon: "link",
        title: t("onboarding.connectTitle"),
        description: t("onboarding.connectDesc"),
        bullets: [t("onboarding.connectBullet2"), t("onboarding.connectBullet3")],
      },
      {
        key: "chat",
        icon: "chatbubbles",
        title: t("onboarding.chatTitle"),
        description: t("onboarding.chatDesc"),
        bullets: [
          t("onboarding.chatBullet1"),
          t("onboarding.chatBullet2"),
          t("onboarding.chatBullet3"),
        ],
      },
      {
        key: "ready",
        icon: "rocket",
        title: t("onboarding.readyTitle"),
        description: t("onboarding.readyDesc"),
      },
    ],
    [t],
  );

  const isLast = index === slides.length - 1;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const next = Math.round(x / width);
      if (next !== index) setIndex(next);
    },
    [index, width],
  );

  const goNext = useCallback(() => {
    if (isLast) {
      if (isInitial) {
        trackEvent(Ev.OnboardingCompleted, {
          method: "swipe",
          slides_seen: index + 1,
          initial: "1",
        });
        void markCompleted().then(() => router.replace("/servers"));
      } else {
        router.back();
      }
      return;
    }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  }, [index, isLast, isInitial, router, markCompleted]);

  const goSkip = useCallback(() => {
    if (isInitial) {
      trackEvent(Ev.OnboardingCompleted, {
        method: "skip",
        slides_seen: index + 1,
        initial: "1",
      });
      void markCompleted().then(() => router.replace("/servers"));
    } else {
      trackEvent(Ev.OnboardingViewed, {
        from: "settings",
        action: "close",
      });
      router.back();
    }
  }, [index, isInitial, router, markCompleted]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      {/* 顶部跳过按钮 */}
      <View style={styles.topBar}>
        {!isLast ? (
          <TouchableOpacity onPress={goSkip} hitSlop={theme.hitSlop} activeOpacity={0.7}>
            <Text style={styles.skipText}>
              {isInitial ? t("onboarding.skip") : t("common.close")}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ height: 1 }} />
        )}
      </View>

      <FlatList
        ref={listRef}
        data={slides}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <SlideView slide={item} width={width} theme={theme} styles={styles} />
        )}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />

      {/* 底部分页指示器 + CTA */}
      <View style={styles.bottomBar}>
        <View style={styles.dots}>
          {slides.map((s, i) => {
            const active = i === index;
            return (
              <Pressable
                key={s.key}
                onPress={() => listRef.current?.scrollToIndex({ index: i, animated: true })}
                hitSlop={8}
              >
                <View
                  style={[
                    styles.dot,
                    active && {
                      backgroundColor: theme.colors.accent,
                      width: 22,
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>

        <TouchableOpacity style={styles.cta} onPress={goNext} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{isLast ? t("onboarding.done") : t("onboarding.next")}</Text>
          <Ionicons name={isLast ? "checkmark" : "arrow-forward"} size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SlideView({
  slide,
  width,
  theme,
  styles,
}: {
  slide: Slide;
  width: number;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.iconRing}>
        <View style={styles.iconRingInner}>
          <Ionicons name={slide.icon} size={56} color={theme.colors.accent} />
        </View>
      </View>

      <Text style={styles.title}>{slide.title}</Text>
      <Text style={styles.description}>{slide.description}</Text>

      {slide.bullets && slide.bullets.length > 0 ? (
        <View style={styles.bullets}>
          {slide.bullets.map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={styles.bulletDot}>
                <Ionicons name="checkmark" size={12} color={theme.colors.accent} />
              </View>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },

    topBar: {
      flexDirection: "row",
      justifyContent: "flex-end",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      minHeight: 44,
      alignItems: "center",
    },
    skipText: {
      ...typography.subheadline,
      color: colors.textSecondary,
    },

    slide: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xxxl,
      paddingBottom: spacing.xxxxl,
    },

    iconRing: {
      width: 132,
      height: 132,
      borderRadius: 66,
      backgroundColor: colors.accentSubtle,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xxl,
    },
    iconRingInner: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.accent,
      shadowOpacity: theme.isDark ? 0.25 : 0.18,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 24,
      elevation: 6,
    },

    title: {
      ...typography.title2,
      color: colors.text,
      textAlign: "center",
      marginBottom: spacing.md,
    },
    description: {
      ...typography.callout,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 23,
      maxWidth: 320,
    },

    bullets: {
      marginTop: spacing.xxl,
      gap: spacing.md,
      width: "100%",
      maxWidth: 360,
    },
    bulletRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    bulletDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.accentMuted,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    bulletText: {
      ...typography.subheadline,
      color: colors.text,
      flex: 1,
      lineHeight: 21,
    },

    bottomBar: {
      paddingHorizontal: spacing.xl,
      paddingBottom: Platform.OS === "ios" ? spacing.md : spacing.lg,
      gap: spacing.lg,
    },
    dots: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 8,
      paddingVertical: spacing.sm,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    cta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.full,
      paddingVertical: 14,
      shadowColor: colors.accent,
      shadowOpacity: theme.isDark ? 0.4 : 0.28,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      elevation: 6,
    },
    ctaText: {
      ...typography.bodyEmphasized,
      color: "#FFFFFF",
    },
  });
}
