/**
 * [INPUT]: 依赖 src/theme 的 Theme，依赖 src/utils/time 的 formatTimeSeparator，依赖 react-i18next 的 useTranslation
 * [OUTPUT]: 对外提供 TimeSeparator 组件，渲染一行居中浅灰时间胶囊
 * [POS]: components/ 的消息列表分隔符，被 ChatScreen 的 VirtualizedList renderItem 消费，
 *        相邻消息间隔 ≥5 分钟或跨日期时插入，连续问答内部不显示
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatTimeSeparator } from "../utils/time";
import { type Theme } from "../theme";

export function TimeSeparator({ ts, theme }: { ts: number; theme: Theme }) {
  const { t } = useTranslation();
  const label = formatTimeSeparator(ts, t("chat.timeYesterday"));

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text
        style={{
          ...theme.typography.caption2,
          color: theme.colors.textTertiary,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
});
