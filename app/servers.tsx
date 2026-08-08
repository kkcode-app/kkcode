// 服务器管理页 — 多服务器支持
// 列表展示已保存的服务器；点击行设为当前活跃；"+ 新增"跳转独立页面。

/**
 * [INPUT]: 依赖 @/store/connection 管理 OpenCode 服务器；提供地址输入与 Beta 隧道扫码入口
 * [INPUT]: 依赖 expo-router 的 useRouter（push/replace）
 * [INPUT]: 依赖 react-native 的 ActionSheetIO/Alert/Platform（长按菜单）
 * [INPUT]: 依赖 @/utils/haptics 的 haptic（点击/长按/成功/错误反馈）
 * [INPUT]: 依赖 expo-clipboard 的命令一键复制
 * [INPUT]: 依赖 @/theme 的 useTheme 与 type Theme
 * [INPUT]: 依赖 react-i18next 的 useTranslation
 * [INPUT]: 依赖 @/components/Skeleton 的 SkeletonList（hydrate 加载占位）
 * [OUTPUT]: 导出默认页面组件 ServersScreen（路由 /servers）
 * [OUTPUT]: 内部 ServerRow 子组件，渲染单行（图标+主标题+副标题+active徽章+编辑按钮+长按菜单）
 * [OUTPUT]: 内部 EmptyState 子组件，无服务器时的引导空态（含隧道命令复制胶囊）
 * [POS]: app/ 的服务器列表页，被 settings/sessions/index/onboarding 等多处间接路由（入口）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useRef } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "react-i18next";

import { useConnectionStore, type OpenCodeServer } from "../src/store/connection";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";
import { haptic } from "../src/utils/haptics";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { SkeletonList } from "../src/components/Skeleton";

const ACTION_WIDTH = 76;

export default function ServersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const hydrated = useConnectionStore((s) => s.hydrated);
  const servers = useConnectionStore((s) => s.servers);
  const order = useConnectionStore((s) => s.order);
  const activeId = useConnectionStore((s) => s.activeId);
  const setActive = useConnectionStore((s) => s.setActive);
  const removeServer = useConnectionStore((s) => s.removeServer);
  const clear = useConnectionStore((s) => s.clear);

  const list = useMemo(
    () =>
      order.map((id) => servers[id]).filter((server): server is OpenCodeServer => Boolean(server)),
    [order, servers],
  );

  const onPick = async (server: OpenCodeServer) => {
    if (server.id === activeId) return;
    haptic.selection();
    await setActive(server.id);
    haptic.success();
  };

  const onDelete = (server: OpenCodeServer) => {
    const label = server.nickname?.trim() || displayHost(server.baseUrl);
    Alert.alert(t("servers.deleteTitle", { name: label }), t("servers.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("servers.deleteBtn"),
        style: "destructive",
        onPress: async () => {
          try {
            await removeServer(server.id);
            haptic.success();
            trackEvent(Ev.ServerRemove, { server_id: server.id });
          } catch (err) {
            haptic.error();
            Alert.alert(
              t("servers.deleteFailed"),
              err instanceof Error ? err.message : String(err),
            );
          }
        },
      },
    ]);
  };

  const onClearAll = () => {
    Alert.alert(t("servers.removeAllTitle"), t("servers.removeAllMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("servers.removeAllBtn"),
        style: "destructive",
        onPress: async () => {
          haptic.warning();
          const count = order.length;
          await clear();
          trackEvent(Ev.ServerRemove, { count, source: "clear_all" });
          router.replace("/servers");
        },
      },
    ]);
  };

  const onAdd = () => router.push("/server-edit");
  const onEdit = (server: OpenCodeServer) =>
    router.push({ pathname: "/server-edit", params: { id: server.id } });

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <SkeletonList count={5} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      {list.length === 0 ? (
        <EmptyState theme={theme} styles={styles} onAdd={onAdd} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>{t("servers.sectionList")}</Text>
          <View style={styles.listCard}>
            {list.map((server, idx) => (
              <View key={server.id}>
                <ServerRow
                  theme={theme}
                  styles={styles}
                  server={server}
                  isActive={server.id === activeId}
                  isLast={idx === list.length - 1}
                  onPick={() => onPick(server)}
                  onEdit={() => onEdit(server)}
                  onDelete={() => onDelete(server)}
                />
                {idx < list.length - 1 ? <View style={styles.rowSep} /> : null}
              </View>
            ))}
          </View>

          <ConnectionMethodOptions theme={theme} styles={styles} onAdd={onAdd} />

          <Text style={styles.footNote}>{t("servers.hint")}</Text>

          <TouchableOpacity style={styles.removeAllBtn} onPress={onClearAll} activeOpacity={0.8}>
            <Ionicons name="trash-outline" size={16} color={theme.colors.destructive} />
            <Text style={styles.removeAllBtnText}>{t("servers.removeAllBtn")}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 单行 ─────────────────────────────────────────────────

function ServerRow({
  theme,
  styles,
  server,
  isActive,
  isLast,
  onPick,
  onEdit,
  onDelete,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  server: OpenCodeServer;
  isActive: boolean;
  isLast: boolean;
  onPick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const label = server.nickname?.trim() || displayHost(server.baseUrl);
  const sub = server.nickname?.trim() ? displayHost(server.baseUrl) : server.username;

  const swipeRef = useRef<SwipeableMethods>(null);

  const renderRightActions = () => (
    <View style={styles.actionsWrap}>
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionEdit]}
        onPress={() => {
          swipeRef.current?.close();
          onEdit();
        }}
      >
        <Ionicons name="pencil-outline" size={16} color="#fff" />
        <Text style={styles.actionLabel}>{t("servers.actionEdit")}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionDelete]}
        onPress={() => {
          swipeRef.current?.close();
          onDelete();
        }}
      >
        <Ionicons name="trash-outline" size={16} color="#fff" />
        <Text style={styles.actionLabel}>{t("servers.deleteBtn")}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={styles.swipeableRow}>
        <ReanimatedSwipeable
          ref={swipeRef}
          friction={2}
          rightThreshold={ACTION_WIDTH}
          renderRightActions={renderRightActions}
          overshootRight={false}
        >
          <Pressable
            style={({ pressed }) => [
              styles.rowMain,
              pressed && { backgroundColor: theme.colors.surfaceHover },
            ]}
            onPress={onPick}
          >
            <View
              style={[
                styles.rowIcon,
                isActive && {
                  backgroundColor: theme.colors.accentMuted,
                },
              ]}
            >
              <Ionicons
                name={isActive ? "server" : "server-outline"}
                size={17}
                color={isActive ? theme.colors.accent : theme.colors.textSecondary}
              />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {sub}
              </Text>
            </View>
            {isActive ? (
              <View style={styles.activeBadge}>
                <Ionicons name="checkmark" size={12} color={theme.colors.accent} />
                <Text style={styles.activeBadgeText}>{t("servers.badgeCurrent")}</Text>
              </View>
            ) : null}
          </Pressable>
        </ReanimatedSwipeable>
      </View>
    </View>
  );
}

// ── 连接方式 ───────────────────────────────────────────────

function ConnectionMethodOptions({
  theme,
  styles,
  onAdd,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onAdd: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.connectionMethodsCard}>
      <TouchableOpacity style={styles.connectionMethodRow} onPress={onAdd} activeOpacity={0.7}>
        <View style={styles.connectionMethodIcon}>
          <Ionicons name="add-outline" size={18} color={theme.colors.accent} />
        </View>
        <Text style={styles.connectionMethodLabel} numberOfLines={1}>
          {t("servers.addTitle")}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

// ── 空态 ─────────────────────────────────────────────────

function EmptyState({
  theme,
  styles,
  onAdd,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onAdd: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIconRing}>
        <Ionicons name="server-outline" size={32} color={theme.colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>{t("servers.emptyTitle")}</Text>
      <Text style={styles.emptyDesc}>{t("servers.emptyDesc")}</Text>
      <View style={styles.emptyMethodsWrap}>
        <ConnectionMethodOptions theme={theme} styles={styles} onAdd={onAdd} />
      </View>
    </View>
  );
}

// ── 工具 ─────────────────────────────────────────────────

function displayHost(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  // 去掉 scheme 显示
  return trimmed.replace(/^https?:\/\//, "");
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    listContent: {
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxxl,
      width: "100%",
      maxWidth: breakpoints.contentMaxWidth,
      alignSelf: "center",
    },

    sectionLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: "500",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },

    // 列表卡片
    listCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "stretch",
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    rowMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    swipeableRow: { flex: 1 },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: colors.backgroundSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    rowContent: { flex: 1, gap: 2 },
    rowLabel: {
      ...typography.subheadlineEmphasized,
      color: colors.text,
    },
    rowSub: {
      ...typography.caption1,
      color: colors.textTertiary,
    },
    activeBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: colors.accentMuted,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    activeBadgeText: {
      ...typography.caption2,
      color: colors.accent,
      fontWeight: "600",
    },
    actionsWrap: {
      width: ACTION_WIDTH * 2,
      flexDirection: "row",
    },
    actionBtn: {
      width: ACTION_WIDTH,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
    },
    actionEdit: { backgroundColor: colors.accent },
    actionDelete: { backgroundColor: colors.destructive },
    actionLabel: { ...typography.caption1, color: colors.textInverse, fontWeight: "600" },
    rowSep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
    },

    connectionMethodsCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    connectionMethodRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 56,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    connectionMethodIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: colors.backgroundSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    connectionMethodLabel: {
      ...typography.body,
      color: colors.text,
      flex: 1,
      flexShrink: 1,
    },
    connectionMethodSep: {
      height: StyleSheet.hairlineWidth,
      marginLeft: spacing.md + 32 + spacing.sm,
      backgroundColor: colors.separator,
    },
    footNote: {
      ...typography.caption1,
      color: colors.textTertiary,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      lineHeight: 16,
    },

    removeAllBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xxxl,
      paddingVertical: 14,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    removeAllBtnText: {
      ...typography.bodyEmphasized,
      color: colors.destructive,
    },

    // 空态
    emptyBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    emptyMethodsWrap: {
      width: "100%",
      maxWidth: 360,
      alignSelf: "stretch",
    },
    emptyIconRing: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    emptyTitle: {
      ...typography.headline,
      color: colors.text,
    },
    emptyDesc: {
      ...typography.subheadline,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
    },
  });
}
