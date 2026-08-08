/**
 * [INPUT]: 依赖 expo-router 路由参数的会话 directory、api/client 的 listPath、connection store 与主题/i18n
 * [OUTPUT]: 对外提供 file-browser 页面，在单页内逐级浏览工作目录、右对齐面包屑、持久化隐藏文件开关与不支持预览 toast
 * [POS]: app 的会话工作区目录路由，由 ChatScreen 输入栏的模型选择行入口打开，文件预览交给 file-preview
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { FileNode } from "@opencode-ai/sdk/v2";

import { listPath } from "../src/api/client";
import { toClientConfig, useConnectionStore } from "../src/store/connection";
import { useDirectoryPrefsStore } from "../src/store/directory-prefs";
import { useTheme, type Theme } from "../src/theme";
import { isImagePreviewableFile, isTextPreviewableFile } from "../src/utils/file-preview";

export default function FileBrowserScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { directory } = useLocalSearchParams<{ directory?: string }>();
  const rootPath = typeof directory === "string" ? directory : "";
  const [pathStack, setPathStack] = useState<string[]>([rootPath]);
  const currentPath = pathStack[pathStack.length - 1] ?? rootPath;
  const active = useConnectionStore((s) => s.active);
  const showHidden = useDirectoryPrefsStore((s) => s.showHidden);
  const setShowHidden = useDirectoryPrefsStore((s) => s.setShowHidden);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const requestRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDirectory = useCallback(
    async (path: string, isRefresh = false) => {
      if (!active || !rootPath) return;
      const requestID = ++requestRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await listPath(toClientConfig(active, rootPath), path);
        if (requestID !== requestRef.current) return;
        setEntries(
          result.sort(
            (a, b) =>
              Number(b.type === "directory") - Number(a.type === "directory") ||
              a.name.localeCompare(b.name),
          ),
        );
      } catch (err) {
        if (requestID === requestRef.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestID === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [active, rootPath],
  );

  useEffect(() => {
    setPathStack([rootPath]);
    if (currentPath) void loadDirectory(currentPath);
  }, [loadDirectory, rootPath]);

  const openEntry = (entry: FileNode) => {
    if (entry.type === "directory") {
      setPathStack((stack) => [...stack, entry.absolute]);
      void loadDirectory(entry.absolute);
      return;
    }
    if (!isTextPreviewableFile(entry.name) && !isImagePreviewableFile(entry.name)) {
      setToastVisible(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastVisible(false), 1800);
      return;
    }
    router.push({
      pathname: "/file-preview",
      params: { directory: rootPath, path: entry.absolute, name: entry.name },
    });
  };

  const jumpToPath = (path: string) => {
    const index = pathStack.lastIndexOf(path);
    if (index < 0 || index === pathStack.length - 1) return;
    setPathStack(pathStack.slice(0, index + 1));
    void loadDirectory(path);
  };

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const goUp = useCallback(() => {
    if (pathStack.length < 2) return;
    const next = pathStack.slice(0, -1);
    setPathStack(next);
    void loadDirectory(next[next.length - 1]!);
  }, [loadDirectory, pathStack]);

  const visibleEntries = useMemo(
    () => entries.filter((entry) => showHidden || !entry.name.startsWith(".")),
    [entries, showHidden],
  );

  return (
    <View style={styles.page}>
      <BreadcrumbBar
        currentPath={currentPath}
        pathStack={pathStack}
        onJump={jumpToPath}
        theme={theme}
        styles={styles}
        showHidden={showHidden}
        onToggleShowHidden={() => void setShowHidden(!showHidden)}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.directoryArea}>
        <FlatList
          data={visibleEntries}
          scrollEnabled={!loading}
          keyExtractor={(entry) => entry.absolute}
          renderItem={({ item, index }) => (
            <Pressable
              style={[
                styles.entry,
                index === 0 && pathStack.length <= 1 && styles.entryFirst,
                index === visibleEntries.length - 1 && styles.entryLast,
              ]}
              onPress={() => openEntry(item)}
            >
              <View
                style={[
                  styles.entryIcon,
                  item.type === "directory" ? styles.entryIconDir : styles.entryIconFile,
                ]}
              >
                <Ionicons
                  name={item.type === "directory" ? "folder" : "document-outline"}
                  size={18}
                  color={
                    item.type === "directory" ? theme.colors.accent : theme.colors.textTertiary
                  }
                />
              </View>
              <Text
                style={[styles.entryName, item.type === "file" && styles.entryNameFile]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {item.type === "directory" ? (
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
              ) : null}
              {index !== visibleEntries.length - 1 ? <View style={styles.entrySeparator} /> : null}
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            pathStack.length > 1 ? (
              <Pressable style={[styles.entry, styles.entryFirst]} onPress={goUp}>
                <View style={[styles.entryIcon, styles.entryIconDir]}>
                  <Ionicons name="arrow-up" size={16} color={theme.colors.accent} />
                </View>
                <Text style={styles.entryName}>..</Text>
                {visibleEntries.length > 0 ? <View style={styles.entrySeparator} /> : null}
              </Pressable>
            ) : null
          }
          onRefresh={() => void loadDirectory(currentPath, true)}
          refreshing={refreshing}
        />
      </View>
      {loading ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      ) : null}
      {toastVisible ? (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={theme.colors.textSecondary}
          />
          <Text style={styles.toastText}>{t("chat.filePreviewUnavailable")}</Text>
        </View>
      ) : null}
    </View>
  );
}

function BreadcrumbBar({
  currentPath,
  pathStack,
  onJump,
  theme,
  styles,
  showHidden,
  onToggleShowHidden,
}: {
  currentPath: string;
  pathStack: string[];
  onJump: (path: string) => void;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  showHidden: boolean;
  onToggleShowHidden: () => void;
}) {
  const crumbs = buildBreadcrumb(currentPath);
  const scrollRef = useRef<ScrollView>(null);
  const scrollToCurrent = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  }, []);

  useEffect(scrollToCurrent, [currentPath, scrollToCurrent]);

  return (
    <View style={styles.crumbBar}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.crumbContent}
        onContentSizeChange={scrollToCurrent}
      >
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const canJump = !isLast && pathStack.includes(crumb.full);
          return (
            <View key={crumb.full} style={styles.crumbWrap}>
              <TouchableOpacity
                disabled={!canJump}
                onPress={() => onJump(crumb.full)}
                activeOpacity={canJump ? 0.6 : 1}
              >
                <Text
                  style={[
                    styles.crumbText,
                    isLast && styles.crumbTextActive,
                    canJump && { color: theme.colors.accent },
                  ]}
                >
                  {crumb.label}
                </Text>
              </TouchableOpacity>
              {!isLast ? (
                <Ionicons name="chevron-forward" size={12} color={theme.colors.textTertiary} />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <TouchableOpacity
        style={styles.hiddenToggle}
        onPress={onToggleShowHidden}
        hitSlop={theme.hitSlop}
      >
        <Ionicons
          name={showHidden ? "eye-outline" : "eye-off-outline"}
          size={16}
          color={showHidden ? theme.colors.accent : theme.colors.textTertiary}
        />
      </TouchableOpacity>
    </View>
  );
}

function buildBreadcrumb(path: string): { label: string; full: string }[] {
  const segments = path.split("/").filter(Boolean);
  return segments.map((label, index) => ({
    label,
    full: `/${segments.slice(0, index + 1).join("/")}`,
  }));
}

function makeStyles(theme: Theme) {
  const { colors, spacing, typography, radius } = theme;
  return StyleSheet.create({
    page: { flex: 1, position: "relative", backgroundColor: colors.groupedBackground },
    crumbBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
    },
    crumbContent: { alignItems: "center", gap: spacing.xs },
    crumbWrap: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    crumbText: { ...typography.caption1, color: colors.textTertiary },
    crumbTextActive: { color: colors.text, fontWeight: "700" },
    hiddenToggle: { padding: 6, borderRadius: radius.full },
    error: { ...typography.footnote, color: colors.destructive, paddingHorizontal: spacing.lg },
    directoryArea: { flex: 1, position: "relative" },
    loadingOverlay: {
      position: "absolute",
      top: 44,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: `${colors.groupedBackground}B8`,
      zIndex: 10,
      elevation: 10,
    },
    listContent: {
      paddingBottom: spacing.xl,
      paddingTop: spacing.sm,
    },
    entry: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: 11,
      gap: spacing.md,
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      position: "relative",
    },
    entryName: { ...typography.body, color: colors.text, flex: 1 },
    entryNameFile: { color: colors.textSecondary },
    entryFirst: {
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    entryLast: {
      borderBottomLeftRadius: radius.card,
      borderBottomRightRadius: radius.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    entryIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    entryIconDir: { backgroundColor: colors.accentSubtle },
    entryIconFile: { backgroundColor: colors.backgroundSecondary },
    entrySeparator: {
      position: "absolute",
      left: spacing.lg,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
    },
    toast: {
      position: "absolute",
      bottom: spacing.xl,
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      maxWidth: "88%",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOpacity: 1,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      elevation: 4,
    },
    toastText: { ...typography.caption1, color: colors.textSecondary, flexShrink: 1 },
  });
}
