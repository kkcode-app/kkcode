/**
 * [INPUT]: 依赖 react-native-network-logger 的 NetworkLogger 组件 + startNetworkLogging/stopNetworkLogging，依赖 theme
 * [OUTPUT]: DevNetwork 组件，渲染 network-logger 内置 UI，含拦截开关
 * [POS]: components/dev-panel/ 的 Tab5 网络页，被 app/dev-panel 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useMemo, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import NetworkLogger, { startNetworkLogging } from "react-native-network-logger";

import { useTheme, type Theme } from "../../theme";

// react-native-network-logger 没有导出 stop 函数，startNetworkLogging 内部有守卫，
// 重复调用是 no-op。开关仅控制 UI 提示，实际拦截一旦开启就持续到进程结束。
let captureStarted = false;

export function DevNetwork() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [capturing, setCapturing] = useState(captureStarted);

  const toggleCapture = (v: boolean) => {
    if (v) {
      startNetworkLogging({ maxRequests: 500 });
      captureStarted = true;
    }
    // network-logger 不支持 stop，关闭只做 UI 标记
    setCapturing(v);
  };

  return (
    <View style={styles.container}>
      <View style={styles.captureRow}>
        <Text style={styles.captureLabel}>{t("dev.captureNetwork")}</Text>
        <Switch
          value={capturing}
          onValueChange={toggleCapture}
          trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={theme.colors.border}
        />
      </View>

      {!capturing ? (
        <Text style={styles.hint}>{t("dev.captureOffHint")}</Text>
      ) : (
        <View style={styles.loggerWrap}>
          <NetworkLogger theme={theme.isDark ? "dark" : "light"} />
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, typography } = theme;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    captureRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    captureLabel: { ...typography.body, color: colors.text, fontWeight: "500" },
    hint: {
      ...typography.footnote,
      color: colors.textTertiary,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    loggerWrap: { flex: 1 },
  });
}
