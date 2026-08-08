// 通用 WebView 路由页
// 用法：router.push({ pathname: "/webview", params: { url, title } })
//   - url:   必填，要打开的网址
//   - title: 选填，初始标题（加载完成后会被网页 document.title 覆盖）
//
// 安全：
//   只允许 https,且 host 必须命中下方白名单。否则展示 "URL 不允许打开"。
//   防止恶意 deeplink (kkcode-community://webview?url=evil.com) 把任意外网页面塞进 WebView。
//   要新增可信域,只改 ALLOWED_HOSTS 即可。
//
// 标题栏由 expo-router Stack 提供（自带返回按钮 + 居中标题）。

import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { AppWebView } from "../src/components/AppWebView";
import { useTheme } from "../src/theme";

// 白名单 host(只允许这些域名 + 它们的子域名)。新增域名时同步更新本数组。
const ALLOWED_HOSTS = ["github.com", "raw.githubusercontent.com", "kkcode.app"];

function isUrlAllowed(raw: string): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.host.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export default function WebViewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ url?: string; title?: string }>();
  const navigation = useNavigation();

  const url = params.url ?? "";
  const initialTitle = params.title ?? "";
  const allowed = useMemo(() => isUrlAllowed(url), [url]);

  const [pageTitle, setPageTitle] = useState(initialTitle);

  useLayoutEffect(() => {
    navigation.setOptions({ title: pageTitle });
  }, [navigation, pageTitle]);

  const onTitle = useCallback((title: string) => {
    if (title && title.trim()) setPageTitle(title.trim());
  }, []);

  if (!allowed) {
    return (
      <View style={[styles.blocked, { backgroundColor: theme.colors.background }]}>
        <Ionicons name="shield-outline" size={48} color={theme.colors.textTertiary} />
        <Text style={[styles.blockedTitle, { color: theme.colors.text }]}>
          {t("webview.blockedTitle")}
        </Text>
        <Text style={[styles.blockedDesc, { color: theme.colors.textSecondary }]} numberOfLines={3}>
          {url || "—"}
        </Text>
      </View>
    );
  }

  return <AppWebView url={url} onTitle={onTitle} />;
}

const styles = StyleSheet.create({
  blocked: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  blockedTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  blockedDesc: {
    fontSize: 13,
    textAlign: "center",
  },
});
