/**
 * [INPUT]: 依赖 expo-router 的 useLocalSearchParams，依赖 store/messages 的 useMessagesStore，
 *          utils/message-text 的 getMessagePlainText、src/theme 的 useTheme 与 react-native 的只读多行 TextInput
 * [OUTPUT]: 对外提供 message-text 路由页，长按消息「选择文本」入口，用 TextInput(editable=false, multiline) 提供系统级完整选择菜单
 * [POS]: app 的选择文本子页面路由，被 ChatScreen MessageBubble 长按菜单通过 router.push 消费；独立路由避开 ChatScreen VirtualizedList 的手势冲突
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 选择文本子页面
//
// 为什么用独立路由而非就地 selectable：
//   1. react-native-markdown-display 不把 selectable 透传到所有子 Text，AI markdown 消息无法就地选择
//   2. selectable 在虚拟列表/横向 ScrollView 里会抢占 pan 手势（ToolDetailModal.tsx:1206 踩坑注释为证）
//
// 为什么用 TextInput 而非 Text selectable：
//   Text selectable 在 iOS 上长按只有 Copy 一项，且选区手柄体验差。
//   TextInput(editable=false, multiline) 是 RN 做"文本查看+选择"的标准做法：
//   长按弹出系统级完整菜单（Select/Select All/Copy/Share/Look Up），选区手柄可自由拖拽。
//   editable=false 禁止编辑，purely 用于查看与选择。

import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMessagesStore } from "../src/store/messages";
import { getMessagePlainText } from "../src/utils/message-text";
import { useTheme } from "../src/theme";

export default function MessageTextScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { spacing } = theme;
  const { sessionID, messageID } = useLocalSearchParams<{
    sessionID: string;
    messageID: string;
  }>();

  const styles = useMemo(() => makeStyles(theme), [theme]);

  const messages = useMessagesStore((s) => (sessionID ? s.bySession[sessionID] : undefined) ?? []);
  const item = useMemo(
    () => messages.find((m) => m.message.id === messageID),
    [messages, messageID],
  );

  const fullText = useMemo(() => (item ? getMessagePlainText(item) : ""), [item]);

  if (!item || !fullText) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
          {t("common.error")}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: spacing.xxxl + insets.bottom },
        ]}
      >
        {/* TextInput(editable=false, multiline) 提供系统级完整选择菜单：
            长按弹出 Select/Select All/Copy/Share/Look Up，选区手柄可自由拖拽。
            editable=false 保证只读但可选。 */}
        <TextInput
          value={fullText}
          editable={false}
          multiline
          style={[styles.text, { color: theme.colors.text }]}
          selectionColor={theme.colors.accent}
          scrollEnabled={false}
          textBreakStrategy="highQuality"
        />
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  const { spacing, typography } = theme;
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.lg,
      paddingBottom: spacing.xxxl,
    },
    text: {
      fontSize: typography.body.fontSize ?? 17,
      lineHeight: typography.body.lineHeight ?? 24,
      fontFamily: typography.body.fontFamily,
      // TextInput 默认有 padding，清零让外层 ScrollView 的 padding 统一控制
      paddingHorizontal: 0,
      paddingVertical: 0,
      // 关键：让 TextInput 按内容自适应高度，不抢占 ScrollView 的滚动
      flexGrow: 0,
    },
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      fontSize: 15,
    },
  });
}
