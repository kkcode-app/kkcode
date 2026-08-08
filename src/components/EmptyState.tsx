/**
 * [INPUT]: 依赖 @expo/vector-icons 的 Ionicons（图标）、react-i18next 的 useTranslation（i18n）、
 *          依赖 src/theme 的 useTheme（颜色/间距/字号）
 * [OUTPUT]: 对外提供 EmptyState 组件（图环 + 标题 + 描述 + CTA 按钮），
 *          替代 sessions/servers/select-directory 里各自重复定义的 EmptyState 函数
 * [POS]: src/components 的通用空态基础组件，被所有数据列表的"无数据"展示位消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme, type Theme } from "../theme";

type EmptyStateProps = {
  /** Ionicons 名字，如 "chatbubbles-outline" / "server-outline" / "folder-open-outline" */
  icon: keyof typeof Ionicons.glyphMap;
  /** 主标题（支持 i18n key 或纯文本） */
  title: string;
  /** 副标题（描述） */
  description?: string;
  /** CTA 按钮文案；不传则不渲染按钮 */
  ctaLabel?: string;
  /** CTA 按钮图标（默认 "add"） */
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  /** CTA 回调 */
  onCta?: () => void;
  /** 紧凑模式（减小内边距，用于嵌入式空态而非全屏） */
  compact?: boolean;
};

/**
 * 通用空态：圆环图标 + 标题 + 描述 + 可选 CTA。
 *
 * 用法：
 *   <EmptyState
 *     icon="chatbubbles-outline"
 *     title={t("sessions.emptyTitle")}
 *     description={t("sessions.emptyDesc")}
 *     ctaLabel={t("sessions.btnNew")}
 *     onCta={onCreate}
 *   />
 */
export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaIcon = "add",
  onCta,
  compact = false,
}: EmptyStateProps) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={[styles.box, compact && styles.boxCompact]}>
      <View style={styles.iconRing}>
        <Ionicons name={icon} size={compact ? 26 : 32} color={theme.colors.textTertiary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.desc}>{description}</Text> : null}
      {ctaLabel && onCta ? (
        <TouchableOpacity style={styles.btn} onPress={onCta} activeOpacity={0.85}>
          <Ionicons name={ctaIcon} size={16} color="#FFFFFF" />
          <Text style={styles.btnText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    box: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.xxxl,
      paddingTop: 40,
      paddingBottom: theme.spacing.xxl,
    },
    boxCompact: {
      flex: 0,
      paddingTop: theme.spacing.xl,
      paddingBottom: theme.spacing.xl,
    },
    iconRing: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.colors.surfaceHover,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.sm,
    },
    title: {
      ...theme.typography.headline,
      color: theme.colors.text,
      textAlign: "center",
    },
    desc: {
      ...theme.typography.subheadline,
      color: theme.colors.textSecondary,
      textAlign: "center",
      maxWidth: 320,
    },
    btn: {
      marginTop: theme.spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    btnText: {
      ...theme.typography.subheadline,
      color: "#FFFFFF",
      fontWeight: "600",
    },
  });
}
