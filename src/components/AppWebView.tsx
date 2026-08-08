/**
 * [INPUT]: 依赖 react-native-webview 的网页渲染与消息桥，依赖 React Native 平台判断和主题/i18n
 * [OUTPUT]: 对外提供 AppWebView 组件与 AppWebViewProps 类型，封装加载、错误、标题同步和 iOS 下拉刷新
 * [POS]: src/components 的通用网页容器，被 app/webview 路由消费并隔离 WebView 平台差异
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 通用 WebView 容器组件
// 用法：直接 push("/webview?url=...&title=...")，或通过 <AppWebView> 嵌入到自定义页面。
// 特性：
// - 顶部进度条
// - 加载失败兜底
// - 自动从页面拿到 document.title 后回调（路由页用来设置 navigation.title）
// - 支持下拉刷新 / pullToRefresh

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useTheme, type Theme } from "../theme";

// 注入的 JS：监听 title 变化（首次加载 + 动态 SPA 切换）
const INJECTED_TITLE_BRIDGE = `
(function() {
  function postTitle() {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'title',
        value: document.title || ''
      }));
    } catch (e) {}
  }
  postTitle();
  // SPA 路由切换时 title 可能变化
  var lastTitle = document.title;
  setInterval(function() {
    if (document.title !== lastTitle) {
      lastTitle = document.title;
      postTitle();
    }
  }, 600);
  true;
})();
`;

export type AppWebViewProps = {
  url: string;
  /** 网页 title 变化时回调（首次加载完成 + SPA 切换） */
  onTitle?: (title: string) => void;
};

export function AppWebView({ url, onTitle }: AppWebViewProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const webRef = useRef<WebView>(null);

  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 当 URL 变化时重置状态
  useEffect(() => {
    setProgress(0);
    setLoading(true);
    setError(null);
  }, [url]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data) as { type?: string; value?: string };
      if (data.type === "title" && typeof data.value === "string") {
        onTitle?.(data.value);
      }
    } catch {
      // ignore
    }
  };

  const reload = () => {
    setError(null);
    setLoading(true);
    setProgress(0);
    webRef.current?.reload();
  };

  return (
    <View style={styles.container}>
      {/* 顶部进度条 */}
      {loading && progress < 1 ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${Math.max(5, progress * 100)}%` }]} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={48} color={theme.colors.textTertiary} />
          <Text style={styles.errorTitle}>{t("webview.errorTitle")}</Text>
          <Text style={styles.errorDesc}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload} activeOpacity={0.8}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: url }}
          style={styles.web}
          // 这些属性仅受 iOS 支持；decelerationRate 字符串在 Android Fabric 下会触发原生类型转换崩溃。
          {...(Platform.OS === "ios"
            ? {
                allowsBackForwardNavigationGestures: true,
                decelerationRate: "normal" as const,
                pullToRefreshEnabled: true,
              }
            : {})}
          // 浅/深色背景跟随主题（避免白屏闪烁）
          containerStyle={{ backgroundColor: theme.colors.background }}
          // 注入 title 监听
          injectedJavaScript={INJECTED_TITLE_BRIDGE}
          onMessage={handleMessage}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onLoadStart={() => {
            setLoading(true);
            setProgress(0);
          }}
          onLoadEnd={() => {
            setLoading(false);
          }}
          onError={({ nativeEvent }) => {
            setError(nativeEvent.description || String(nativeEvent.code));
            setLoading(false);
          }}
          onHttpError={({ nativeEvent }) => {
            // 仅当非主框架的 4xx/5xx 时不处理；主文档错误才显示
            if (nativeEvent.url === url) {
              setError(`HTTP ${nativeEvent.statusCode}`);
              setLoading(false);
            }
          }}
          renderLoading={() => (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={theme.colors.textTertiary} />
            </View>
          )}
          startInLoadingState
        />
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    web: { flex: 1, backgroundColor: colors.background },

    progressTrack: {
      height: 2,
      backgroundColor: colors.surfaceHover,
    },
    progressBar: {
      height: 2,
      backgroundColor: colors.accent,
    },

    loadingBox: {
      ...(StyleSheet.absoluteFill as object),
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },

    errorBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.xxxl,
    },
    errorTitle: {
      ...typography.headline,
      color: colors.text,
    },
    errorDesc: {
      ...typography.subheadline,
      color: colors.textSecondary,
      textAlign: "center",
    },
    retryBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: 10,
      borderRadius: radius.full,
      backgroundColor: colors.accent,
    },
    retryText: {
      ...typography.subheadlineEmphasized,
      color: "#FFFFFF",
    },
  });
}
