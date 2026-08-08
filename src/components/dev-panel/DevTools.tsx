/**
 * [INPUT]: 依赖 AsyncStorage + 各 store + expo-clipboard + expo-file-system + expo-sharing，依赖 theme
 * [OUTPUT]: DevTools 组件，提供通知 Beta 标记、清存储/重置 store/复制/导出/导航等快捷动作
 * [POS]: components/dev-panel/ 的 Tab6 工具页，被 app/dev-panel 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useMemo } from "react";
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useThemeStore } from "../../store/theme";
import { useConnectionStore } from "../../store/connection";
import { useSessionsStore } from "../../store/sessions";
import { useMessagesStore } from "../../store/messages";
import { useStatusStore } from "../../store/status";
import { useCommandStore } from "../../store/commands";
import { usePermissionStore } from "../../store/permissions";
import { useQuestionStore } from "../../store/questions";
import { useDevAccessStore } from "../../store/dev-access";
import { exportDevLogs } from "../../services/dev-logger";
import { haptic } from "../../utils/haptics";
import { useTheme, type Theme } from "../../theme";

const INSTALL_GUARD_KEY = "@kkcode/installed";

export function DevTools() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const confirm = (title: string, msg: string, onConfirm: () => void) => {
    Alert.alert(title, msg, [
      { text: t("dev.cancel"), style: "cancel" },
      { text: t("dev.confirm"), style: "destructive", onPress: onConfirm },
    ]);
  };

  const toast = (msg: string) => Alert.alert(t("dev.done"), msg);

  // ── 开发者入口 ────────────────────────────
  const devAccessUnlocked = useDevAccessStore((s) => s.unlocked);
  const setDevAccessUnlocked = useDevAccessStore((s) => s.setUnlocked);

  const handleToggleDevAccess = async (v: boolean) => {
    haptic.impact();
    await setDevAccessUnlocked(v);
    Alert.alert(v ? "开发者入口已开启" : "开发者入口已关闭");
  };

  // ── 存储类 ────────────────────────────────
  const handleClearAllAsync = () => {
    confirm(t("dev.clearAllAsyncStorage"), t("dev.deleteWarning"), async () => {
      const keys = await AsyncStorage.getAllKeys();
      const toRemove = (keys as string[]).filter((k) => k !== INSTALL_GUARD_KEY);
      await AsyncStorage.multiRemove(toRemove);
      toast(t("dev.storageCleared"));
    });
  };

  const handleClearSpecificKey = () => {
    void AsyncStorage.getAllKeys().then((keys) => {
      const arr = (keys as string[]).sort();
      Alert.alert(t("dev.clearSpecificKey"), undefined, [
        ...arr.map((k) => ({
          text: k.length > 30 ? "…" + k.slice(-28) : k,
          onPress: () => {
            void AsyncStorage.removeItem(k).then(() => toast(t("dev.storageCleared")));
          },
        })),
        { text: t("dev.cancel"), style: "cancel" },
      ]);
    });
  };

  const handleResetStores = () => {
    confirm(t("dev.resetAllStores"), t("dev.deleteWarning"), () => {
      try {
        useSessionsStore.getState().reset();
        useMessagesStore.getState().reset();
        useCommandStore.getState().reset();
        usePermissionStore.getState().reset();
        useQuestionStore.getState().reset();
        useStatusStore.getState().set("idle");
        toast(t("dev.done"));
      } catch (e) {
        toast(String(e));
      }
    });
  };

  // ── 复制类 ────────────────────────────────
  const handleCopyTheme = async () => {
    const { mode } = useThemeStore.getState();
    await Clipboard.setStringAsync(JSON.stringify({ mode }, null, 2));
    toast(t("dev.copied"));
  };

  const handleCopyConnection = async () => {
    const { servers, order, activeId } = useConnectionStore.getState();
    const safe = {
      servers: order.map((id) => {
        const s = servers[id];
        return s
          ? {
              id: s.id,
              backend: s.backend,
              nickname: s.nickname,
              baseUrl: s.baseUrl,
              username: s.backend === "opencode" ? s.username : undefined,
            }
          : null;
      }),
      order,
      activeId,
    };
    await Clipboard.setStringAsync(JSON.stringify(safe, null, 2));
    toast(t("dev.copied"));
  };

  // ── 导出类 ────────────────────────────────
  const handleExportStorage = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const entries = await AsyncStorage.multiGet(keys as string[]);
      const obj: Record<string, string | null> = {};
      entries.forEach(([k, v]) => {
        if (k) obj[k] = v;
      });
      const json = JSON.stringify(obj, null, 2);
      const file = new File(Paths.cache, `kkcode-storage-${Date.now()}.json`);
      file.write(json);
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "AsyncStorage Export",
      });
    } catch (e) {
      toast(String(e));
    }
  };

  const handleExportLogs = async () => {
    try {
      const text = exportDevLogs();
      const file = new File(Paths.cache, `kkcode-logs-${Date.now()}.txt`);
      file.write(text);
      await Sharing.shareAsync(file.uri, { mimeType: "text/plain", dialogTitle: "Logs Export" });
    } catch (e) {
      toast(String(e));
    }
  };

  // ── 导航类 ────────────────────────────────
  const handleGotoOnboarding = () => {
    router.push("/onboarding");
  };

  const handleTriggerCrash = () => {
    confirm(t("dev.triggerCrash"), t("dev.deleteWarning"), () => {
      toast(t("dev.crashTriggered"));
      setTimeout(() => {
        throw new Error("[DevTools] Test crash triggered by developer");
      }, 500);
    });
  };

  return (
    <View style={styles.container}>
      <Section title={t("dev.experimentalTools")} styles={styles}>
        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>{t("dev.devAccess")}</Text>
          <Switch
            value={devAccessUnlocked}
            onValueChange={(v) => void handleToggleDevAccess(v)}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={theme.colors.border}
          />
        </View>
      </Section>

      <Section title={t("dev.storageTools")} styles={styles}>
        <ActionRow
          label={t("dev.clearAllAsyncStorage")}
          onPress={handleClearAllAsync}
          destructive
          styles={styles}
        />
        <ActionRow
          label={t("dev.clearSpecificKey")}
          onPress={handleClearSpecificKey}
          styles={styles}
        />
        <ActionRow
          label={t("dev.resetAllStores")}
          onPress={handleResetStores}
          destructive
          styles={styles}
        />
      </Section>

      <Section title={t("dev.copyTools")} styles={styles}>
        <ActionRow
          label={t("dev.copyThemeJson")}
          onPress={() => void handleCopyTheme()}
          styles={styles}
        />
        <ActionRow
          label={t("dev.copyConnectionConfig")}
          onPress={() => void handleCopyConnection()}
          styles={styles}
        />
      </Section>

      <Section title={t("dev.exportTools")} styles={styles}>
        <ActionRow
          label={t("dev.exportAllStorage")}
          onPress={() => void handleExportStorage()}
          styles={styles}
        />
        <ActionRow
          label={t("dev.exportLogsText")}
          onPress={() => void handleExportLogs()}
          styles={styles}
        />
      </Section>

      <Section title={t("dev.navigationTools")} styles={styles}>
        <ActionRow label={t("dev.gotoOnboarding")} onPress={handleGotoOnboarding} styles={styles} />
        <ActionRow
          label={t("dev.triggerCrash")}
          onPress={handleTriggerCrash}
          destructive
          styles={styles}
        />
      </Section>
    </View>
  );
}

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function ActionRow({
  label,
  onPress,
  destructive,
  styles,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.rowLabel, destructive && styles.destructiveText]}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: { paddingBottom: spacing.xxl },
    section: { marginTop: spacing.lg },
    sectionLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "500",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginLeft: spacing.lg,
    },
    rowLabel: { ...typography.body, color: colors.text },
    destructiveText: { color: colors.destructive },
  });
}
