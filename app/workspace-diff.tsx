/**
 * [INPUT]: 依赖路由传入的会话工作目录、OpenCode VCS status/raw diff API、DiffViewer 与主题/i18n
 * [OUTPUT]: 提供工作区变更页面，按目录列出文件、内嵌对应 patch，并可把已解析 diff 打开为全屏页
 * [POS]: app 的会话工作区变更路由，由 ChatScreen 输入栏的模型选择行入口打开，不参与聊天列表滚动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import {
  getWorkspaceRawDiff,
  getWorkspaceStatus,
  type WorkspaceFileStatus,
} from "../src/api/client";
import { DiffViewer } from "../src/components/DiffViewer";
import { toClientConfig, useConnectionStore } from "../src/store/connection";
import { useTheme, type Theme } from "../src/theme";
import {
  buildWorkspaceDiffTree,
  flattenWorkspaceDiffTree,
  indexWorkspacePatches,
  listWorkspaceDiffDirectoryPaths,
  patchToTexts,
  type WorkspaceDiffTreeDirectory,
  type WorkspacePatch,
} from "../src/utils/workspace-diff";
import { cacheWorkspaceDiffPreview } from "../src/utils/workspace-diff-preview";

const STATUS_ICON = {
  added: "add-circle-outline",
  deleted: "remove-circle-outline",
  modified: "create-outline",
} as const;

export default function WorkspaceDiffScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { directory } = useLocalSearchParams<{ directory?: string }>();
  const active = useConnectionStore((state) => state.active);
  const [files, setFiles] = useState<WorkspaceFileStatus[] | null>(null);
  const [rawDiff, setRawDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(new Set());
  const requestRef = useRef(0);
  const workspaceDirectory = typeof directory === "string" ? directory : "";

  const loadChanges = useCallback(async () => {
    if (!active || !workspaceDirectory) return;
    const requestID = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [nextFiles, nextRawDiff] = await Promise.all([
        getWorkspaceStatus(toClientConfig(active, workspaceDirectory)),
        getWorkspaceRawDiff(toClientConfig(active, workspaceDirectory)),
      ]);
      if (requestID !== requestRef.current) return;
      setFiles(nextFiles);
      setRawDiff(nextRawDiff);
      setExpandedFile(null);
      setExpandedDirectories(
        new Set(listWorkspaceDiffDirectoryPaths(buildWorkspaceDiffTree(nextFiles))),
      );
    } catch (cause) {
      if (requestID !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestID === requestRef.current) setLoading(false);
    }
  }, [active, workspaceDirectory]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  const patches = useMemo(() => indexWorkspacePatches(rawDiff), [rawDiff]);
  const tree = useMemo(() => buildWorkspaceDiffTree(files ?? []), [files]);
  const directoryPaths = useMemo(() => listWorkspaceDiffDirectoryPaths(tree), [tree]);
  const rows = useMemo(
    () => flattenWorkspaceDiffTree(tree, expandedDirectories),
    [expandedDirectories, tree],
  );
  const toggleDirectory = useCallback((path: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const allDirectoriesExpanded =
    directoryPaths.length > 0 && directoryPaths.every((path) => expandedDirectories.has(path));
  const toggleAllDirectories = useCallback(() => {
    setExpandedDirectories(allDirectoriesExpanded ? new Set() : new Set(directoryPaths));
  }, [allDirectoriesExpanded, directoryPaths]);

  return (
    <View style={styles.page}>
      <Stack.Screen
        options={{
          title: t("workspaceDiff.title"),
          headerRight: () => (
            <Pressable
              onPress={() => void loadChanges()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel={t("workspaceDiff.refresh")}
              style={[styles.headerButton, loading && styles.headerButtonDisabled]}
            >
              {loading ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : (
                <Ionicons name="refresh-outline" size={21} color={theme.colors.accent} />
              )}
            </Pressable>
          ),
        }}
      />
      {files === null && loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.textTertiary} />
          <Text style={styles.loadingText}>{t("workspaceDiff.loading")}</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.destructive} />
          <Text style={styles.error}>{t("workspaceDiff.loadFailed")}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadChanges()}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : files?.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={36} color={theme.colors.success} />
          <Text style={styles.emptyTitle}>{t("workspaceDiff.emptyTitle")}</Text>
          <Text style={styles.emptyDescription}>{t("workspaceDiff.emptyDescription")}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={({ node }) =>
            node.type === "directory" ? `dir:${node.path}` : node.file.file
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {t("workspaceDiff.changedFiles", { count: files?.length ?? 0 })}
              </Text>
              <Text style={styles.summaryHint}>{t("workspaceDiff.expandHint")}</Text>
              <View style={styles.batchActions}>
                <TouchableOpacity
                  onPress={toggleAllDirectories}
                  disabled={directoryPaths.length === 0}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    allDirectoriesExpanded
                      ? "workspaceDiff.collapseAll"
                      : "workspaceDiff.expandAll",
                  )}
                  style={[
                    styles.batchAction,
                    directoryPaths.length === 0 && styles.batchActionDisabled,
                  ]}
                >
                  <Ionicons
                    name={allDirectoriesExpanded ? "contract-outline" : "expand-outline"}
                    size={18}
                    color={theme.colors.accent}
                  />
                  <Text style={styles.batchActionText}>
                    {t(
                      allDirectoriesExpanded
                        ? "workspaceDiff.collapseAll"
                        : "workspaceDiff.expandAll",
                    )}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          renderItem={({ item, index }) => {
            const node = item.node;
            const first = index === 0;
            const last = index === rows.length - 1;
            if (node.type === "directory") {
              return (
                <WorkspaceDirectoryRow
                  directory={node}
                  depth={item.depth}
                  expanded={expandedDirectories.has(node.path)}
                  first={first}
                  last={last}
                  showSeparator={!last}
                  onToggle={() => toggleDirectory(node.path)}
                  theme={theme}
                  styles={styles}
                />
              );
            }
            const file = node.file;
            return (
              <WorkspaceFileRow
                file={file}
                depth={item.depth}
                expanded={file.file === expandedFile}
                patch={patches.get(file.file)}
                first={first}
                last={last}
                showSeparator={!last}
                onToggle={() =>
                  setExpandedFile((current) => (current === file.file ? null : file.file))
                }
                onOpenFullscreen={(preview) => {
                  const previewKey = cacheWorkspaceDiffPreview(preview);
                  router.push({ pathname: "/workspace-diff-file", params: { previewKey } });
                }}
                theme={theme}
                styles={styles}
              />
            );
          }}
        />
      )}
    </View>
  );
}

function WorkspaceDirectoryRow({
  directory,
  depth,
  expanded,
  first,
  last,
  showSeparator,
  onToggle,
  theme,
  styles,
}: {
  directory: WorkspaceDiffTreeDirectory<WorkspaceFileStatus>;
  depth: number;
  expanded: boolean;
  first: boolean;
  last: boolean;
  showSeparator: boolean;
  onToggle: () => void;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.rowFrame,
        styles.treeRow,
        first && styles.rowFirst,
        last && styles.rowLast,
        { paddingLeft: theme.spacing.lg + theme.spacing.lg * depth },
      ]}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={directory.name}
    >
      <View style={[styles.treeIcon, styles.directoryIcon]}>
        <Ionicons
          name={expanded ? "folder-open-outline" : "folder-outline"}
          size={18}
          color={theme.colors.accent}
        />
      </View>
      <Text style={styles.directoryName} numberOfLines={1}>
        {directory.name}
      </Text>
      <View style={styles.directoryCount}>
        <Text style={styles.directoryCountText}>{directory.fileCount}</Text>
      </View>
      <Ionicons
        name={expanded ? "chevron-down" : "chevron-forward"}
        size={17}
        color={theme.colors.textTertiary}
      />
      {showSeparator ? <View style={styles.rowSeparator} /> : null}
    </TouchableOpacity>
  );
}

function WorkspaceFileRow({
  file,
  depth,
  expanded,
  patch,
  first,
  last,
  showSeparator,
  onToggle,
  onOpenFullscreen,
  theme,
  styles,
}: {
  file: WorkspaceFileStatus;
  depth: number;
  expanded: boolean;
  patch?: WorkspacePatch;
  first: boolean;
  last: boolean;
  showSeparator: boolean;
  onToggle: () => void;
  onOpenFullscreen: (preview: {
    file: string;
    oldText: string;
    newText: string;
    additions: number;
    deletions: number;
  }) => void;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  const iconColor =
    file.status === "added"
      ? theme.colors.success
      : file.status === "deleted"
        ? theme.colors.destructive
        : theme.colors.warning;
  const texts = patch ? patchToTexts(patch.patch) : null;

  return (
    <View
      style={[
        styles.rowFrame,
        styles.fileContainer,
        first && styles.rowFirst,
        last && styles.rowLast,
      ]}
    >
      <TouchableOpacity
        style={[styles.treeRow, { paddingLeft: theme.spacing.lg + theme.spacing.lg * depth }]}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={file.file}
      >
        <View style={[styles.treeIcon, styles.fileIcon]}>
          <Ionicons name={STATUS_ICON[file.status]} size={17} color={iconColor} />
        </View>
        <Text style={styles.fileName} numberOfLines={1}>
          {file.file.split("/").pop()}
        </Text>
        <View style={styles.stats}>
          {file.additions > 0 ? <Text style={styles.additions}>+{file.additions}</Text> : null}
          {file.deletions > 0 ? <Text style={styles.deletions}>−{file.deletions}</Text> : null}
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={17}
          color={theme.colors.textTertiary}
        />
      </TouchableOpacity>
      {expanded ? (
        <View style={[styles.patchWrap, { marginLeft: theme.spacing.lg * depth }]}>
          {patch?.binary ? (
            <Text style={styles.patchMessage}>{t("workspaceDiff.binaryFile")}</Text>
          ) : texts ? (
            <DiffViewer
              oldText={texts.oldText}
              newText={texts.newText}
              filePath={file.file}
              additions={file.additions}
              deletions={file.deletions}
              onOpenFullscreen={() =>
                onOpenFullscreen({
                  file: file.file,
                  oldText: texts.oldText,
                  newText: texts.newText,
                  additions: file.additions,
                  deletions: file.deletions,
                })
              }
            />
          ) : (
            <Text style={styles.patchMessage}>{t("workspaceDiff.patchUnavailable")}</Text>
          )}
        </View>
      ) : null}
      {showSeparator ? <View style={styles.rowSeparator} /> : null}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.groupedBackground },
    headerButton: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
    headerButtonDisabled: { opacity: 0.35 },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.xxl,
    },
    loadingText: { ...typography.footnote, color: colors.textTertiary },
    error: { ...typography.body, color: colors.text, textAlign: "center" },
    retryButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
    retryText: { ...typography.body, color: colors.accent, fontWeight: "600" },
    emptyTitle: { ...typography.headline, color: colors.text },
    emptyDescription: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
    listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
    summary: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    summaryText: { ...typography.subheadline, color: colors.text, fontWeight: "600" },
    summaryHint: { ...typography.footnote, color: colors.textTertiary, marginTop: 2 },
    batchActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
    batchAction: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    batchActionDisabled: { opacity: 0.4 },
    batchActionText: { ...typography.footnote, color: colors.accent, fontWeight: "600" },
    rowFrame: {
      marginHorizontal: spacing.lg,
      position: "relative",
      backgroundColor: colors.surface,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowFirst: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
    },
    rowLast: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomLeftRadius: radius.card,
      borderBottomRightRadius: radius.card,
    },
    treeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 11,
      paddingRight: spacing.lg,
    },
    treeIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    directoryIcon: {
      backgroundColor: colors.accentSubtle,
    },
    fileIcon: {
      backgroundColor: colors.backgroundSecondary,
    },
    directoryName: { flex: 1, ...typography.footnote, color: colors.text, fontWeight: "600" },
    directoryCount: {
      minWidth: 22,
      paddingHorizontal: spacing.xs,
      paddingVertical: 1,
      borderRadius: radius.full,
      alignItems: "center",
      backgroundColor: colors.groupedBackground,
    },
    directoryCountText: { ...typography.caption2, color: colors.textTertiary, fontWeight: "600" },
    fileContainer: {
      overflow: "hidden",
    },
    rowSeparator: {
      position: "absolute",
      left: spacing.lg,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
    },
    fileName: { flex: 1, ...typography.body, color: colors.textSecondary },
    stats: { flexDirection: "row", gap: spacing.xs },
    additions: { ...typography.caption1, color: colors.success, fontWeight: "600" },
    deletions: { ...typography.caption1, color: colors.destructive, fontWeight: "600" },
    patchWrap: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
    patchMessage: { ...typography.footnote, color: colors.textTertiary, padding: spacing.sm },
  });
}
