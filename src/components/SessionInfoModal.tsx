/**
 * [INPUT]: 依赖会话 SDK 类型、client 的改名与 diff API、connection/sessions store、BottomSheet 与主题/i18n
 * [OUTPUT]: 对外提供 memo 化 SessionInfoModal，会话元数据编辑与按需加载的工作区文件差异展示
 * [POS]: components 的会话工作台，由 ChatScreen 顶部信息入口打开，不参与消息列表滚动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// SessionInfoModal — 聊天会话详细信息底部弹窗

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { Session } from "@opencode-ai/sdk/v2";
import { getSessionDiff, updateSessionTitle, type SessionFileDiff } from "../api/client";
import { useConnectionStore, toClientConfig } from "../store/connection";
import { useSessionsStore } from "../store/sessions";
import { useTheme, type Theme } from "../theme";
import { BottomSheet } from "./BottomSheet";
import { useTranslation } from "react-i18next";

interface SessionInfoModalProps {
  visible: boolean;
  session: Session;
  onClose: () => void;
}

export const SessionInfoModal = memo(function SessionInfoModal({
  visible,
  session,
  onClose,
}: SessionInfoModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const active = useConnectionStore((s) => s.active);
  const upsertSession = useSessionsStore((s) => s.upsertSession);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title ?? "");
  const [diffs, setDiffs] = useState<SessionFileDiff[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const titleInputRef = useRef<TextInput>(null);
  const diffRequestInFlightRef = useRef(false);

  useEffect(() => {
    setTitleDraft(session.title ?? "");
  }, [session.title]);

  const loadDiff = useCallback(async () => {
    if (!active || diffRequestInFlightRef.current) return;
    diffRequestInFlightRef.current = true;
    setLoadingDiff(true);
    setDiffError(null);
    try {
      setDiffs(await getSessionDiff(toClientConfig(active, session.directory), session.id));
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
    } finally {
      diffRequestInFlightRef.current = false;
      setLoadingDiff(false);
    }
  }, [active, session.directory, session.id]);

  useEffect(() => {
    if (!visible) return;
    setExpandedFile(null);
    void loadDiff();
  }, [loadDiff, visible]);

  const commitTitle = useCallback(async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === session.title || !active) return;
    try {
      const updated = await updateSessionTitle(
        toClientConfig(active, session.directory),
        session.id,
        trimmed,
      );
      upsertSession(updated, active.id);
    } catch (err) {
      Alert.alert(t("sessionInfo.renameFailed"), err instanceof Error ? err.message : String(err));
      setTitleDraft(session.title ?? "");
    }
  }, [titleDraft, session, active, upsertSession, t]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      contentContainerStyle={styles.scrollContent}
      header={
        <View style={styles.header}>
          {editingTitle ? (
            <TextInput
              ref={titleInputRef}
              style={styles.headerTitleInput}
              value={titleDraft}
              onChangeText={setTitleDraft}
              onBlur={commitTitle}
              onSubmitEditing={commitTitle}
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
              keyboardAppearance={theme.isDark ? "dark" : "light"}
              cursorColor={theme.colors.accent}
              selectionColor={`${theme.colors.accent}44`}
            />
          ) : (
            <Text style={styles.headerTitle} numberOfLines={2}>
              {headerLabel(session)}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => {
              if (editingTitle) return;
              setTitleDraft(session.title ?? "");
              setEditingTitle(true);
              setTimeout(() => titleInputRef.current?.focus(), 50);
            }}
            hitSlop={theme.hitSlop}
            style={styles.editBtn}
          >
            <Ionicons name="pencil-outline" size={20} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>
      }
    >
      <BasicSection session={session} theme={theme} styles={styles} />
      <ModelSection session={session} theme={theme} styles={styles} />
      <TokenSection session={session} theme={theme} styles={styles} />
      <ChangedFilesSection
        diffs={diffs}
        loading={loadingDiff}
        error={diffError}
        expandedFile={expandedFile}
        onToggleFile={setExpandedFile}
        onRetry={() => void loadDiff()}
        theme={theme}
        styles={styles}
      />
    </BottomSheet>
  );
});

// ── 基本信息 ──────────────────────────────────────────────

function BasicSection({ session, theme, styles }: SectionProps) {
  const { t } = useTranslation();
  const created = new Date(session.time.created).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const updated = new Date(session.time.updated).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card
      title={t("sessionInfo.cardBasic")}
      icon="information-circle-outline"
      theme={theme}
      styles={styles}
    >
      <Row label="ID" value={session.id} mono styles={styles} />
      {/* v2 server 的 Session.Info 没有 slug 字段，SDK 类型是 v1 残留 —
          实际响应里始终是空串，留着只会展示一个空白行。空值直接不渲染。 */}
      {session.slug ? <Row label="Slug" value={session.slug} mono styles={styles} /> : null}
      <Row
        label={t("sessionInfo.labelDir")}
        value={session.directory || "—"}
        mono
        styles={styles}
      />
      {session.parentID ? (
        <Row label={t("sessionInfo.labelParent")} value={session.parentID} mono styles={styles} />
      ) : null}
      <Row label={t("sessionInfo.labelCreated")} value={created} styles={styles} />
      <Row label={t("sessionInfo.labelUpdated")} value={updated} styles={styles} />
      {session.version ? (
        <Row label={t("sessionInfo.labelVersion")} value={session.version} mono styles={styles} />
      ) : null}
    </Card>
  );
}

// ── 模型信息 ──────────────────────────────────────────────

function ModelSection({ session, theme, styles }: SectionProps) {
  const { t } = useTranslation();
  if (!session.model && !session.agent) return null;
  return (
    <Card
      title={t("sessionInfo.cardModel")}
      icon="hardware-chip-outline"
      theme={theme}
      styles={styles}
    >
      {session.model?.id ? (
        <Row label={t("sessionInfo.labelModelId")} value={session.model.id} mono styles={styles} />
      ) : null}
      {session.model?.providerID ? (
        <Row
          label={t("sessionInfo.labelProvider")}
          value={session.model.providerID}
          styles={styles}
        />
      ) : null}
      {session.model?.variant ? (
        <Row
          label={t("sessionInfo.labelVariant")}
          value={session.model.variant}
          mono
          styles={styles}
        />
      ) : null}
      {session.agent ? <Row label="Agent" value={session.agent} mono styles={styles} /> : null}
    </Card>
  );
}

// ── Token 用量 ────────────────────────────────────────────

function TokenSection({ session, theme, styles }: SectionProps) {
  const { t } = useTranslation();
  const tokens = session.tokens;
  if (!tokens) return null;

  // 老 schema/异常服务端可能不返回 cache 字段,任何字段都用 ?? 0 兜底,避免 crash
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;

  const total = input + output + reasoning;
  const cacheTotal = cacheRead + cacheWrite;

  return (
    <Card
      title={t("sessionInfo.cardTokens")}
      icon="analytics-outline"
      theme={theme}
      styles={styles}
    >
      <TokenBar
        items={[
          { label: t("sessionInfo.tokenInput"), value: input, color: theme.colors.accent },
          { label: t("sessionInfo.tokenOutput"), value: output, color: theme.colors.success },
          { label: t("sessionInfo.tokenReasoning"), value: reasoning, color: theme.colors.warning },
        ]}
        total={total}
        styles={styles}
        theme={theme}
      />
      <Row
        label={t("sessionInfo.tokenInput")}
        value={fmt(input)}
        valueColor={theme.colors.accent}
        styles={styles}
      />
      <Row
        label={t("sessionInfo.tokenOutput")}
        value={fmt(output)}
        valueColor={theme.colors.success}
        styles={styles}
      />
      {reasoning > 0 ? (
        <Row
          label={t("sessionInfo.tokenReasoning")}
          value={fmt(reasoning)}
          valueColor={theme.colors.warning}
          styles={styles}
        />
      ) : null}
      {cacheTotal > 0 ? (
        <Row label={t("sessionInfo.tokenCacheRead")} value={fmt(cacheRead)} styles={styles} />
      ) : null}
      {cacheWrite > 0 ? (
        <Row label={t("sessionInfo.tokenCacheWrite")} value={fmt(cacheWrite)} styles={styles} />
      ) : null}
      <View style={styles.divider} />
      <Row label={t("sessionInfo.tokenTotal")} value={fmt(total)} styles={styles} />
    </Card>
  );
}

// ── 已修改文件列表 ─────────────────────────────────────────

function ChangedFilesSection({
  diffs,
  loading,
  error,
  expandedFile,
  onToggleFile,
  onRetry,
  theme,
  styles,
}: {
  diffs: SessionFileDiff[] | null;
  loading: boolean;
  error: string | null;
  expandedFile: string | null;
  onToggleFile: (file: string | null) => void;
  onRetry: () => void;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  const STATUS_ICON = {
    added: { name: "add-circle-outline" as const, color: theme.colors.success },
    deleted: { name: "remove-circle-outline" as const, color: theme.colors.destructive },
    modified: { name: "create-outline" as const, color: theme.colors.warning },
  };

  if (!loading && !error && diffs?.length === 0) return null;

  return (
    <Card title={t("sessionInfo.cardFiles")} icon="documents-outline" theme={theme} styles={styles}>
      {loading ? <ActivityIndicator size="small" color={theme.colors.textTertiary} /> : null}
      {error ? (
        <TouchableOpacity style={styles.diffRetry} onPress={onRetry} activeOpacity={0.7}>
          <Ionicons name="refresh-outline" size={16} color={theme.colors.accent} />
          <Text style={[styles.diffRetryText, { color: theme.colors.accent }]}>
            {t("common.retry")}
          </Text>
        </TouchableOpacity>
      ) : null}
      {diffs?.map((d, i) => {
        const icon = STATUS_ICON[d.status ?? "modified"];
        const file = d.file || `diff-${i}`;
        const expanded = expandedFile === file;
        return (
          <View key={file}>
            <TouchableOpacity
              style={styles.fileRow}
              onPress={() => onToggleFile(expanded ? null : file)}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Ionicons name={icon.name} size={14} color={icon.color} style={styles.fileIcon} />
              <Text style={styles.fileName} numberOfLines={1}>
                {d.file ?? "—"}
              </Text>
              <View style={styles.fileStats}>
                {d.additions > 0 ? (
                  <Text style={[styles.fileStatText, { color: theme.colors.success }]}>
                    +{d.additions}
                  </Text>
                ) : null}
                {d.deletions > 0 ? (
                  <Text style={[styles.fileStatText, { color: theme.colors.destructive }]}>
                    −{d.deletions}
                  </Text>
                ) : null}
              </View>
              {d.patch ? (
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={theme.colors.textTertiary}
                />
              ) : null}
            </TouchableOpacity>
            {expanded && d.patch ? (
              <ScrollView horizontal style={styles.patchBox} showsHorizontalScrollIndicator={false}>
                <Text style={styles.patchText}>{d.patch}</Text>
              </ScrollView>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

// ── Token 进度条 ──────────────────────────────────────────

function TokenBar({
  items,
  total,
  styles,
  theme,
}: {
  items: { label: string; value: number; color: string }[];
  total: number;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  if (total === 0) return null;
  return (
    <View style={styles.tokenBarWrap}>
      {items.map((item) => {
        const pct = total > 0 ? (item.value / total) * 100 : 0;
        if (pct < 0.5) return null;
        return (
          <View
            key={item.label}
            style={[
              styles.tokenBarSegment,
              { width: `${pct}%` as unknown as number, backgroundColor: item.color },
            ]}
          />
        );
      })}
    </View>
  );
}

// ── 共用子组件 ────────────────────────────────────────────

type SectionProps = {
  session: Session;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
};

function Card({
  title,
  icon,
  children,
  theme,
  styles,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={13} color={theme.colors.textTertiary} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function Copyable({
  text,
  children,
  styles,
}: {
  text: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onLongPress = async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <TouchableOpacity
      style={styles.copyableFlex}
      activeOpacity={0.6}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityHint={t("sessionInfo.longPress")}
    >
      {children}
      {copied ? (
        <View style={styles.copiedBadge}>
          <Ionicons name="checkmark-circle" size={12} color={styles.copiedText.color as string} />
          <Text style={styles.copiedText}>{t("common.copied")}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function Row({
  label,
  value,
  mono = false,
  valueColor,
  styles,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Copyable text={value} styles={styles}>
        <Text
          style={[
            mono ? styles.rowValueMono : styles.rowValue,
            valueColor ? { color: valueColor } : undefined,
          ]}
          numberOfLines={3}
        >
          {value}
        </Text>
      </Copyable>
    </View>
  );
}

// ── 工具函数 ──────────────────────────────────────────────

// 头部标题兜底：title > slug(v1 残留) > 目录最后一段 > id 后 8 位 > "未命名"
// 实际数据里 slug 永远是空串，所以"目录最后一段"是最常见的兜底。
function headerLabel(session: Session): string {
  if (session.title?.trim()) return session.title.trim();
  if (session.slug?.trim()) return session.slug.trim();
  if (session.directory) {
    const parts = session.directory.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return session.id.slice(-8);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography, monoFontFamily } = theme;

  return StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    headerTitle: {
      ...typography.title3,
      color: colors.text,
      flex: 1,
    },
    headerTitleInput: {
      ...typography.title3,
      color: colors.text,
      flex: 1,
      minHeight: 28,
      padding: 0,
      margin: 0,
      borderBottomWidth: 1.5,
      borderBottomColor: colors.accent,
    },
    editBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
    },

    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },

    // Card
    card: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      backgroundColor: colors.groupedBackground,
    },
    cardTitle: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    cardBody: { padding: spacing.md, gap: spacing.sm },

    // Row
    row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    rowLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      width: 64,
      flexShrink: 0,
      paddingTop: 1,
    },
    rowValue: {
      ...typography.footnote,
      color: colors.text,
      flex: 1,
      lineHeight: 19,
    },
    rowValueMono: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      lineHeight: 18,
      color: colors.text,
      flex: 1,
    },

    // 长按复制
    copyableFlex: { flex: 1 },
    copiedBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      alignSelf: "flex-start",
      marginTop: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.full,
      backgroundColor: `${colors.success}18`,
    },
    copiedText: {
      ...typography.caption2,
      color: colors.success,
      fontWeight: "700",
    },

    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginVertical: 2,
    },

    // Token bar
    tokenBarWrap: {
      flexDirection: "row",
      height: 6,
      borderRadius: 3,
      overflow: "hidden",
      backgroundColor: colors.separator,
      marginBottom: spacing.sm,
    },
    tokenBarSegment: { height: 6 },

    // File list
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: 3,
    },
    fileIcon: { flexShrink: 0 },
    fileName: {
      ...typography.monoSm,
      color: colors.text,
      flex: 1,
    },
    fileStats: { flexDirection: "row", gap: 6, flexShrink: 0 },
    fileStatText: {
      fontFamily: monoFontFamily,
      fontSize: 11,
      fontWeight: "600",
    },
    diffRetry: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: spacing.xs,
      paddingVertical: 4,
    },
    diffRetryText: { ...typography.footnote, fontWeight: "600" },
    patchBox: {
      maxHeight: 260,
      marginBottom: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.codeBackground,
    },
    patchText: {
      ...typography.monoSm,
      color: colors.text,
      padding: spacing.sm,
    },
  });
}
