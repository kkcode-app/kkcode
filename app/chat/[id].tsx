/**
 * [INPUT]: 依赖 expo-router 路由 id、active server 与 OpenCode ChatScreen
 * [OUTPUT]: 对外提供 chat/[id] 路由壳，将 id 传给 OpenCode session UI
 * [POS]: app/chat 的单栏入口；无 active server 时保留 deep link 引导空态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { ChatScreen } from "../../src/components/ChatScreen";
import { useConnectionStore } from "../../src/store/connection";
import { useTheme } from "../../src/theme";
import { trackEvent, AnalyticsEvents as Ev } from "../../src/services/analytics";

export default function ChatRoute() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const active = useConnectionStore((s) => s.active);

  // Deep link 唤起（如 Bark 点击通知跳转 kkcode-community://chat/<id>）时，App 可能
  // 直接落到本路由。若用户尚未配置任何服务器，ChatScreen 会因 !active 渲染
  // null，体验是白屏。这里兜底成引导空态，让用户去配置服务器。
  if (!active) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
        <View
          style={[
            styles.iconRing,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Ionicons name="server-outline" size={32} color={theme.colors.textTertiary} />
        </View>
        <Text style={[styles.title, { color: theme.colors.text }]}>{t("chat.noServerTitle")}</Text>
        <Text style={[styles.desc, { color: theme.colors.textSecondary }]}>
          {t("chat.noServerDesc")}
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: theme.colors.accent }]}
          onPress={() => {
            trackEvent(Ev.NoServerCtaTap, { source: "chat_route_empty" });
            router.replace("/servers");
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.btnText}>{t("chat.noServerBtn")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <ChatScreen sessionID={id ?? ""} />;
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  desc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  btnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
