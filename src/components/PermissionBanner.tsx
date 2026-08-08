/**
 * [INPUT]: 依赖权限/连接/会话 stores、client 的 replyPermission、主题/i18n 与 RN Modal
 * [OUTPUT]: 对外提供 memo 化 PermissionBanner，展示当前会话权限请求并提交 always/once/reject
 * [POS]: components/ 的会话级权限阻断层，由 ChatScreen 挂载且与消息列表滚动树隔离
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 权限授权弹窗 — 屏幕中央 Modal 居中卡片
// 设计原则：打断式呈现，醒目但不抢戏，三级授权选项直观易懂。
// 渲染走 RN Modal（portal 到原生 Window），不进入虚拟列表树，
// 因此对 useStickToBottom / maintainVisibleContentPosition 无任何影响。

import { Ionicons } from "@expo/vector-icons";
import { memo, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { replyPermission } from "../api/client";
import { trackEvent, AnalyticsEvents as Ev } from "../services/analytics";
import { useConnectionStore, toClientConfig } from "../store/connection";
import { usePermissionStore, type PermissionPrompt } from "../store/permissions";
import { useSessionsStore } from "../store/sessions";
import { useTheme, type Theme } from "../theme";
import { useTranslation } from "react-i18next";
import { haptic } from "../utils/haptics";

export const PermissionBanner = memo(function PermissionBanner({
  sessionID,
}: {
  sessionID: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const allPending = usePermissionStore((s) => s.pending);
  const remove = usePermissionStore((s) => s.remove);
  const active = useConnectionStore((s) => s.active);
  const session = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionID));
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);

  const pending = useMemo(
    () => allPending.filter((p) => p.sessionID === sessionID),
    [allPending, sessionID],
  );

  if (pending.length === 0) return null;

  const reply = async (prompt: PermissionPrompt, response: "always" | "once" | "reject") => {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    setBusy(prompt.id);
    try {
      await replyPermission(
        toClientConfig(active, session?.directory),
        prompt.sessionID,
        prompt.id,
        response,
      );
      remove(prompt.id);
      void trackEvent(Ev.PermissionResponse, {
        response,
        permission: prompt.permission ?? "unknown",
      });
    } catch (err) {
      haptic.error();
      console.warn("permission reply failed", err);
      Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        // Android 物理返回键：忽略，必须显式回复权限
      }}
    >
      <View style={styles.backdrop} accessibilityViewIsModal>
        <ScrollView
          style={styles.permissionScroll}
          contentContainerStyle={styles.cardWrap}
          showsVerticalScrollIndicator={false}
        >
          {pending.map((prompt) => (
            <PermissionCard
              key={prompt.id}
              prompt={prompt}
              busy={busy === prompt.id}
              disabled={busy !== null}
              theme={theme}
              styles={styles}
              onReply={(r) => reply(prompt, r)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
});

function PermissionCard({
  prompt,
  busy,
  disabled,
  theme,
  styles,
  onReply,
}: {
  prompt: PermissionPrompt;
  busy: boolean;
  disabled: boolean;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onReply: (r: "always" | "once" | "reject") => void;
}) {
  const { t } = useTranslation();
  const description = prompt.description ?? prompt.permission ?? t("permission.defaultDesc");

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Ionicons name="shield-outline" size={14} color={theme.colors.warning} />
        </View>
        <Text style={styles.titleText}>{t("permission.title")}</Text>
        <View style={styles.titleBadge}>
          <Text style={styles.titleBadgeText}>
            {prompt.permission ?? t("permission.defaultAction")}
          </Text>
        </View>
      </View>

      <Text style={styles.description} numberOfLines={3}>
        {description}
      </Text>

      {prompt.patterns && prompt.patterns.length > 0 ? (
        <View style={styles.patternsRow}>
          <Ionicons name="code-slash-outline" size={11} color={theme.colors.textTertiary} />
          <Text style={styles.patternsText} numberOfLines={1}>
            {prompt.patterns.join("  ·  ")}
          </Text>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.busyText}>{t("permission.processing")}</Text>
        </View>
      ) : (
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnReject, disabled && styles.btnDisabled]}
            onPress={() => onReply("reject")}
            disabled={disabled}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t("permission.btnReject")}
            accessibilityState={{ disabled }}
          >
            <Ionicons name="close" size={13} color={theme.colors.destructive} />
            <Text style={[styles.btnText, styles.btnTextReject]}>{t("permission.btnReject")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnOnce, disabled && styles.btnDisabled]}
            onPress={() => onReply("once")}
            disabled={disabled}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t("permission.btnOnce")}
            accessibilityState={{ disabled }}
          >
            <Ionicons name="checkmark" size={13} color={theme.colors.accent} />
            <Text style={[styles.btnText, styles.btnTextOnce]}>{t("permission.btnOnce")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnAlways, disabled && styles.btnDisabled]}
            onPress={() => onReply("always")}
            disabled={disabled}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t("permission.btnAlways")}
            accessibilityState={{ disabled }}
          >
            <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
            <Text style={[styles.btnText, styles.btnTextAlways]}>{t("permission.btnAlways")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    permissionScroll: {
      flex: 1,
    },
    cardWrap: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
      gap: spacing.md,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.warningMuted,
      borderLeftWidth: 3,
      borderLeftColor: colors.warning,
      padding: spacing.md,
      gap: spacing.sm,
      shadowColor: colors.shadow,
      shadowOpacity: 0.6,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 16,
      elevation: 8,
    },

    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    titleIcon: {
      width: 22,
      height: 22,
      borderRadius: radius.xs,
      backgroundColor: colors.warningMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    titleText: {
      ...typography.footnoteEmphasized,
      color: colors.text,
      flex: 1,
    },
    titleBadge: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    titleBadgeText: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontFamily: theme.typography.mono.fontFamily,
    },

    description: {
      ...typography.footnote,
      color: colors.textSecondary,
      lineHeight: 19,
    },

    patternsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: colors.codeBackground,
      borderRadius: radius.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    patternsText: {
      ...typography.monoSm,
      color: colors.textTertiary,
      flex: 1,
    },

    busyRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    busyText: {
      ...typography.footnote,
      color: colors.textTertiary,
    },

    btnRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    btn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      paddingVertical: 9,
      minHeight: 44,
      borderRadius: radius.sm,
    },
    btnDisabled: {
      opacity: 0.45,
    },
    btnReject: {
      backgroundColor: "transparent",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.destructive,
    },
    btnOnce: {
      backgroundColor: "transparent",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
    },
    btnAlways: {
      backgroundColor: colors.accent,
    },
    btnText: {
      fontSize: 13,
      fontWeight: "600",
      letterSpacing: -0.1,
    },
    btnTextReject: { color: colors.destructive },
    btnTextOnce: { color: colors.accent },
    btnTextAlways: { color: "#FFFFFF" },
  });
}
