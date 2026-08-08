/**
 * [INPUT]: 依赖 Expo Router Stack、OpenCode 事件流、主题/i18n（含跟随系统语言）/store hydrate、生物识别服务、回前台 SSE 状态重置与 foregroundEpoch
 * [OUTPUT]: 对外提供 RootLayout，注册应用路由、全局 Provider、启动状态、服务器切换时的模型/会话缓存清理与无 Liquid Glass 的 iOS 自绘导航栏
 * [POS]: app 的根路由布局，承载 chat、会话工作区浏览/预览等所有页面
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 根布局 - 精简配置，更精致的导航样式

import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter, type NativeStackHeaderProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import * as LocalAuthentication from "expo-local-authentication";
import { useLocales } from "expo-localization";

import { syncDeviceLanguage } from "../src/i18n";
import { useTranslation } from "react-i18next";

import { useEventStream } from "../src/api/events";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { NotchBranding } from "../src/components/NotchBranding";
import { useConnectionStore } from "../src/store/connection";
import { ensureFreshInstall } from "../src/utils/install-guard";
import { useDirectoryPrefsStore } from "../src/store/directory-prefs";
import { useHapticsPrefsStore } from "../src/store/haptics-prefs";
import { useModelStore } from "../src/store/model";
import { useSessionsStore } from "../src/store/sessions";
import { useOnboardingStore } from "../src/store/onboarding";
import { useThemeStore } from "../src/store/theme";
import { useTheme } from "../src/theme";
import { useBiometricStore } from "../src/store/biometric";
import { useSessionPrefsStore } from "../src/store/session-prefs";
import { useDevAccessStore } from "../src/store/dev-access";
import { useStatusStore } from "../src/store/status";
import {
  trackEvent,
  setUserId,
  setUserProperty,
  AnalyticsEvents as Ev,
} from "../src/services/analytics";

export default function RootLayout() {
  const { t } = useTranslation();
  const deviceLanguageTag = useLocales()[0]?.languageTag;
  const hydrated = useConnectionStore((s) => s.hydrated);
  const hydrate = useConnectionStore((s) => s.hydrate);
  const active = useConnectionStore((s) => s.active);
  const hydrateTheme = useThemeStore((s) => s.hydrate);
  const themeHydrated = useThemeStore((s) => s.hydrated);
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrate);
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const hydrateDirectoryPrefs = useDirectoryPrefsStore((s) => s.hydrate);
  const directoryPrefsHydrated = useDirectoryPrefsStore((s) => s.hydrated);
  const hydrateHapticsPrefs = useHapticsPrefsStore((s) => s.hydrate);
  const hapticsPrefsHydrated = useHapticsPrefsStore((s) => s.hydrated);
  const hydrateBiometric = useBiometricStore((s) => s.hydrate);
  const biometricEnabled = useBiometricStore((s) => s.enabled);
  const biometricHydrated = useBiometricStore((s) => s.hydrated);
  const hydrateSessionPrefs = useSessionPrefsStore((s) => s.hydrate);
  const sessionPrefsHydrated = useSessionPrefsStore((s) => s.hydrated);
  const hydrateDevAccess = useDevAccessStore((s) => s.hydrate);
  const devAccessHydrated = useDevAccessStore((s) => s.hydrated);
  const theme = useTheme();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);

  const appState = useRef(AppState.currentState);
  const [foregroundEpoch, setForegroundEpoch] = useState(0);

  const authenticate = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("biometric.prompt"),
        fallbackLabel: t("biometric.fallback"),
        cancelLabel: t("biometric.cancel"),
        disableDeviceFallback: false,
      });
      if (result.success) setUnlocked(true);
    } catch {
      setUnlocked(true);
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      await ensureFreshInstall();
      void hydrate();
      void hydrateTheme();
      void hydrateOnboarding();
      void hydrateDirectoryPrefs();
      void hydrateHapticsPrefs();
      void hydrateBiometric();
      void hydrateSessionPrefs();
      void hydrateDevAccess();
      void useModelStore.getState().hydrateRecent();
      void trackEvent(Ev.AppStart, { platform: Platform.OS });
    })();
  }, [
    hydrate,
    hydrateTheme,
    hydrateOnboarding,
    hydrateDirectoryPrefs,
    hydrateHapticsPrefs,
    hydrateBiometric,
    hydrateSessionPrefs,
    hydrateDevAccess,
  ]);

  useEffect(() => {
    void syncDeviceLanguage(deviceLanguageTag);
  }, [deviceLanguageTag]);

  useEffect(() => {
    if (!biometricHydrated) return;
    if (!biometricEnabled) {
      setUnlocked(true);
      return;
    }
    void authenticate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricHydrated, biometricEnabled]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const prev = appState.current;
      appState.current = nextState;
      if (prev !== "active" && nextState === "active") {
        trackEvent(Ev.AppActiveFromBackground, { prev });
        useStatusStore.getState().set("connecting");
        setForegroundEpoch((epoch) => epoch + 1);
        void syncDeviceLanguage();
      }
      if (prev === "background" && nextState === "active" && biometricEnabled) {
        setUnlocked(false);
        void authenticate();
      }
    });
    return () => sub.remove();
  }, [biometricEnabled, authenticate]);

  useEventStream(active, foregroundEpoch);

  useEffect(() => {
    useModelStore.getState().reset();
    useSessionsStore.getState().reset();
    if (!active?.id) return;
    void trackEvent(Ev.ServerSwitch, { server_id: active.id });
    void setUserId(active.id);
    void setUserProperty("backend", active.backend);
  }, [active?.id, active?.backend]);

  if (
    !hydrated ||
    !themeHydrated ||
    !onboardingHydrated ||
    !directoryPrefsHydrated ||
    !hapticsPrefsHydrated ||
    !biometricHydrated ||
    !sessionPrefsHydrated ||
    !devAccessHydrated
  )
    return null;

  if (!unlocked) return null;

  const { colors } = theme;
  const renderPlainHeader = (props: NativeStackHeaderProps) => (
    <PlainHeader
      {...props}
      backgroundColor={colors.background}
      borderColor={colors.headerBorder}
      tintColor={colors.headerTint}
      titleColor={colors.text}
      fontFamily={theme.fontFamily}
      backLabel={t("common.back")}
      serversLabel={t("nav.servers")}
      settingsLabel={t("nav.settings")}
      onOpenServers={() => router.push("/servers")}
      onOpenSettings={() => router.push("/settings")}
    />
  );

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <SafeAreaProvider>
            <StatusBar style={theme.isDark ? "light" : "dark"} />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: colors.groupedBackground },
                ...(Platform.OS === "ios"
                  ? { header: renderPlainHeader }
                  : {
                      headerStyle: { backgroundColor: colors.headerBackground },
                      headerLargeTitle: false,
                      headerShadowVisible: false,
                      headerTitleAlign: "center",
                      headerBackButtonDisplayMode: "minimal",
                      headerTintColor: colors.headerTint,
                      headerTitleStyle: {
                        color: colors.text,
                        fontSize: 17,
                        fontWeight: "600",
                      },
                    }),
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="servers" options={{ title: t("nav.servers") }} />
              <Stack.Screen name="server-edit" options={{ title: t("servers.addTitle") }} />
              <Stack.Screen name="select-directory" options={{ title: t("nav.directory") }} />
              <Stack.Screen
                name="sessions"
                options={{
                  title: t("nav.sessions"),
                  contentStyle: { backgroundColor: colors.background },
                  ...(Platform.OS === "ios"
                    ? {}
                    : {
                        headerLeft: () => (
                          <Pressable
                            onPress={() => router.push("/servers")}
                            accessibilityRole="button"
                            accessibilityLabel={t("nav.servers")}
                            style={styles.nativeHeaderButton}
                          >
                            <Ionicons name="server-outline" size={20} color={colors.headerTint} />
                          </Pressable>
                        ),
                        headerRight: () => (
                          <Pressable
                            onPress={() => router.push("/settings")}
                            accessibilityRole="button"
                            accessibilityLabel={t("nav.settings")}
                            style={styles.nativeHeaderButton}
                          >
                            <Ionicons name="settings-outline" size={20} color={colors.headerTint} />
                          </Pressable>
                        ),
                      }),
                }}
              />
              <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
              <Stack.Screen
                name="appearance"
                options={{ title: t("settings.sectionAppearance") }}
              />
              <Stack.Screen name="language" options={{ title: t("settings.labelLanguage") }} />
              <Stack.Screen name="about" options={{ title: t("nav.about") }} />
              <Stack.Screen name="dev-panel" options={{ title: t("nav.devPanel") }} />
              <Stack.Screen name="message-text" options={{ title: t("chat.selectText") }} />
              <Stack.Screen name="file-browser" options={{ title: t("chat.files") }} />
              <Stack.Screen name="file-preview" options={{ title: t("chat.files") }} />
              <Stack.Screen name="workspace-diff" options={{ title: t("workspaceDiff.title") }} />
              <Stack.Screen
                name="workspace-diff-file"
                options={{ title: t("workspaceDiff.title") }}
              />
              <Stack.Screen name="licenses" options={{ title: t("nav.licenses") }} />
              <Stack.Screen name="schema-url" options={{ title: t("nav.schemaUrl") }} />
              <Stack.Screen
                name="webview"
                options={{
                  title: "",
                  headerBackTitle: "",
                }}
              />
              <Stack.Screen
                name="onboarding"
                options={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                  animation: "fade",
                }}
              />
              <Stack.Screen
                name="chat/[id]"
                options={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              />
            </Stack>
            {Platform.OS === "ios" ? (
              <FullWindowOverlay>
                <NotchBranding />
              </FullWindowOverlay>
            ) : (
              <NotchBranding />
            )}
          </SafeAreaProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

type PlainHeaderProps = NativeStackHeaderProps & {
  backgroundColor: string;
  borderColor: string;
  tintColor: string;
  titleColor: string;
  fontFamily: string;
  backLabel: string;
  serversLabel: string;
  settingsLabel: string;
  onOpenServers: () => void;
  onOpenSettings: () => void;
};

function PlainHeader({
  back,
  navigation,
  options,
  route,
  backgroundColor,
  borderColor,
  tintColor,
  titleColor,
  fontFamily,
  backLabel,
  serversLabel,
  settingsLabel,
  onOpenServers,
  onOpenSettings,
}: PlainHeaderProps) {
  const title =
    typeof options.headerTitle === "string"
      ? options.headerTitle
      : options.title !== undefined
        ? options.title
        : route.name;
  const isSessions = route.name === "sessions";

  return (
    <SafeAreaView style={[styles.plainHeaderSafeArea, { backgroundColor }]} edges={["top"]}>
      <View style={[styles.plainHeaderBar, { borderBottomColor: borderColor }]}>
        <View style={styles.plainHeaderSide}>
          {isSessions ? (
            <HeaderIconButton
              accessibilityLabel={serversLabel}
              icon="server-outline"
              tintColor={tintColor}
              onPress={onOpenServers}
            />
          ) : back ? (
            <HeaderIconButton
              accessibilityLabel={backLabel}
              icon="chevron-back"
              tintColor={tintColor}
              onPress={() => navigation.goBack()}
            />
          ) : null}
        </View>

        <View pointerEvents="none" style={styles.plainHeaderTitleContainer}>
          <Text
            numberOfLines={1}
            style={[styles.plainHeaderTitle, { color: titleColor, fontFamily }]}
          >
            {title}
          </Text>
        </View>

        <View style={styles.plainHeaderSide}>
          {isSessions ? (
            <HeaderIconButton
              accessibilityLabel={settingsLabel}
              icon="settings-outline"
              tintColor={tintColor}
              onPress={onOpenSettings}
            />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

type HeaderIconButtonProps = {
  accessibilityLabel: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tintColor: string;
  onPress: () => void;
};

function HeaderIconButton({ accessibilityLabel, icon, tintColor, onPress }: HeaderIconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.plainHeaderButton,
        pressed && styles.plainHeaderButtonPressed,
      ]}
    >
      <Ionicons color={tintColor} name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nativeHeaderButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  plainHeaderSafeArea: {
    flexShrink: 0,
  },
  plainHeaderBar: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 44,
    justifyContent: "space-between",
  },
  plainHeaderSide: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 52,
    zIndex: 1,
  },
  plainHeaderButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  plainHeaderButtonPressed: {
    opacity: 0.5,
  },
  plainHeaderTitleContainer: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 52,
    position: "absolute",
    right: 52,
    top: 0,
  },
  plainHeaderTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
});
