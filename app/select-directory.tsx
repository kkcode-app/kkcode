/**
 * [INPUT]: 依赖 OpenCode 文件/创建会话 API、连接与会话/目录偏好 stores、Expo Router 与主题/i18n
 * [OUTPUT]: 对外提供 SelectDirectoryScreen，浏览工作目录并创建会话后写入项目会话缓存
 * [POS]: app 的新建会话目录选择路由，被会话页及项目上下文入口消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 目录选择页 — 用于「新建会话」时挑选工作目录
//
// 流程：用户进入此页（可携带项目 worktree 作为初始目录）→ 浏览目录树 → 点底部「在此创建会话」→
// 服务端创建 session 并跳转到 /chat/[id]。整个工作目录跟随新会话走，不再
// 绑定到 server。
//
// 路径模型：
//   opencode 服务端要求 `GET /file?path=…` 的 path 是相对 workspace 根的
//   相对路径（绝对路径会触发 "Path escapes the location"），因此：
//     - `currentRel` — 发给服务端的相对路径（"" 表示 workspace 根）
//     - `currentAbs` — 当前列出目录的绝对路径（用于显示 + 「创建会话」CTA）
//     - `workspaceAbs`— workspace 根的绝对路径（首屏拿不到时从首条
//                       entry.absolute 推断）。当 entry 直接在 workspace 根
//                       目录下、切片结果为空时，兜底设为 "/"（允许 cwd=/ 的
//                       服务端把根作为合法工作目录）。
//
// 视图偏好：
//   - `showHidden`（目录选择页顶部开关）— 控制是否显示名称以 `.` 开头的
//     隐藏目录/文件。默认关闭，符合 macOS Finder / Windows Explorer 的
//     默认行为；用户偶尔要进 `.git` / `.expo` 时一键打开。
//
// 常用目录：
//   - 按服务器隔离存储在 directory-prefs store 中
//   - 新建会话成功后自动记录当前路径
//   - 点击条目直接跳转；长按弹出移除选项

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { createSession, listPath, type FileNode } from "../src/api/client";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { useConnectionStore, toClientConfig } from "../src/store/connection";
import { useDirectoryPrefsStore } from "../src/store/directory-prefs";
import { useMessagesStore } from "../src/store/messages";
import { usePermissionStore } from "../src/store/permissions";
import { useSessionsStore } from "../src/store/sessions";
import { useQuestionStore } from "../src/store/questions";
import { haptic } from "../src/utils/haptics";
import { usePendingOpenStore } from "../src/store/pending-open";
import { useResponsive } from "../src/hooks/useResponsive";
import { useTheme, type Theme } from "../src/theme";
import { SkeletonList } from "../src/components/Skeleton";

// ── 常用目录面板 ──────────────────────────────────────────

import type { RecentDirEntry } from "../src/store/directory-prefs";

export default function SelectDirectoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { splitView } = useResponsive();

  const { directory } = useLocalSearchParams<{
    /** 从项目分组页传入时，作为文件 API 的初始 workspace。 */
    directory?: string;
  }>();
  const initialDirectory =
    typeof directory === "string" && directory.startsWith("/") ? directory : undefined;

  const active = useConnectionStore((s) => s.active);
  const showHidden = useDirectoryPrefsStore((s) => s.showHidden);
  const setShowHidden = useDirectoryPrefsStore((s) => s.setShowHidden);
  const recentDirsCollapsed = useDirectoryPrefsStore((s) => s.recentDirsCollapsed);
  const setRecentDirsCollapsed = useDirectoryPrefsStore((s) => s.setRecentDirsCollapsed);
  const recentDirs = useDirectoryPrefsStore((s) => s.recentDirs);
  const recordDir = useDirectoryPrefsStore((s) => s.recordDir);
  const removeDirEntry = useDirectoryPrefsStore((s) => s.removeDirEntry);

  const serverRecentDirs = active ? (recentDirs[active.id] ?? []) : [];

  // ── 核心状态 ──────────────────────────────────────────
  const [currentRel, setCurrentRel] = useState<string>("");
  const [currentAbs, setCurrentAbs] = useState<string | null>(null);
  const [workspaceAbs, setWorkspaceAbs] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [navigating, setNavigating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadingRelRef = useRef<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  // Keep the request scope stable while `load` updates the display state.
  // Reading state directly in `load` would recreate the callback whenever the
  // inferred workspace changes and re-run the initial-load effect in a loop.
  const workspaceAbsRef = useRef<string | null>(null);

  const load = useCallback(
    async (rel: string, isRefresh = false) => {
      if (!active) return;
      loadingRelRef.current = rel;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setNavigating(true);
      }
      setError(null);
      try {
        // 项目入口会传入 worktree。文件接口将它作为 location directory，
        // 因而能从该项目根而不是服务器进程 cwd 开始浏览。
        const list = await listPath(
          toClientConfig(active, workspaceAbsRef.current ?? initialDirectory),
          rel,
        );
        if (loadingRelRef.current !== rel) return;
        const safeList = Array.isArray(list) ? list : [];
        setEntries(safeList);
        setCurrentRel(rel);

        if (safeList.length > 0) {
          const first = safeList[0]!;
          const tail = "/" + first.name;
          let parent: string | null = null;
          if (first.absolute.endsWith(tail)) {
            parent = first.absolute.slice(0, -tail.length);
          } else {
            const idx = first.absolute.lastIndexOf("/");
            if (idx > 0) parent = first.absolute.slice(0, idx);
          }
          // parent 切出空串表示 entry 直接在 workspace 根目录下（例：
          // first.absolute = "/Applications" 且 workspace = "/"）。把 "/" 作为
          // workspace 根标识，让用户能在此创建会话；createSession 会显式带
          // directory="/"，避免再 fallback 到 process.cwd()。
          const workspace = parent || "/";
          setCurrentAbs(workspace);
          setWorkspaceAbs((prev) => {
            const next = prev ?? workspace;
            workspaceAbsRef.current = next;
            return next;
          });
        } else if (rel === "") {
          // 后端返回空数组且在 workspace 根时，无法从 entry 推断绝对路径。
          // 用空字符串作哨兵标记"已知在根目录但路径未知"，使底部 CTA 可用，
          // createSession 会以 directory=undefined 调用，让服务端用 cwd 兜底。
          setCurrentAbs((prev) => prev ?? "");
          setWorkspaceAbs((prev) => {
            const next = prev ?? "";
            workspaceAbsRef.current = next;
            return next;
          });
        }
      } catch (err) {
        if (loadingRelRef.current !== rel) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setEntries([]);
      } finally {
        if (loadingRelRef.current === rel) {
          setNavigating(false);
          setRefreshing(false);
          loadingRelRef.current = null;
        }
      }
    },
    [active, initialDirectory],
  );

  useEffect(() => {
    if (!active) return;
    setCurrentRel("");
    setCurrentAbs(null);
    setWorkspaceAbs(initialDirectory ?? null);
    workspaceAbsRef.current = initialDirectory ?? null;
    void load("");
  }, [active, initialDirectory, load]);

  useEffect(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [currentRel]);

  // ── 导航 ──────────────────────────────────────────────

  const onEnter = (entry: FileNode) => {
    if (entry.type !== "directory") return;
    setCurrentAbs(entry.absolute);
    void load(entry.path);
  };

  const onUp = () => {
    if (!currentRel) return;
    const next = stripLastSegment(currentRel);
    void load(next);
  };

  const onJumpToAbs = (abs: string) => {
    if (!workspaceAbs) return;
    const rel = absToRel(abs, workspaceAbs);
    if (rel === null) return;
    setCurrentAbs(abs);
    void load(rel);
  };

  // ── 常用目录跳转 ──────────────────────────────────────

  const onRecentDirPress = (path: string) => {
    if (!workspaceAbs) return;
    const rel = absToRel(path, workspaceAbs);
    if (rel === null) {
      // 路径不在 workspace 内，直接设置绝对路径显示（服务端会报错，由用户感知）
      setCurrentAbs(path);
      return;
    }
    setCurrentAbs(path);
    void load(rel);
    haptic.selection();
  };

  const onRecentDirLongPress = (path: string) => {
    if (!active) return;
    haptic.warning();
    Alert.alert(t("selectDirectory.recentDirsRemove"), path, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void removeDirEntry(active.id, path),
      },
    ]);
  };

  // ── 确认（创建会话） ─────────────────────────────────

  const onCreate = async () => {
    if (!active || currentAbs === null) return;
    setCreating(true);
    try {
      // currentAbs 为空字符串时表示后端返回空列表、路径未知，省略 directory 让
      // 服务端用 process.cwd() 兜底。
      const dirArg = currentAbs || undefined;
      const session = await createSession(toClientConfig(active, dirArg), {});
      if (!session?.id) throw new Error("Server returned an invalid session");
      useSessionsStore.getState().upsertSession(session, active.id);
      void trackEvent(Ev.SessionCreate, {
        directory: currentAbs || "cwd",
        quick: "0",
      });
      // 路径未知（空字符串）时不记录常用目录
      if (currentAbs) void recordDir(active.id, currentAbs);

      useMessagesStore.getState().reset();
      useQuestionStore.getState().reset();
      usePermissionStore.getState().reset();
      haptic.success();
      if (splitView) {
        // iPad 双栏：回 sessions 并让右侧栏打开新会话，不进独立 chat 路由
        usePendingOpenStore.getState().requestOpen(session.id);
        router.back();
      } else {
        router.replace(`/chat/${session.id}`);
      }
    } catch (err) {
      haptic.error();
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert(t("selectDirectory.createFailed"), msg);
    } finally {
      setCreating(false);
    }
  };

  if (!active) return null;

  const breadcrumbAbs = currentAbs;
  const isHidden = (e: FileNode) => e.name.startsWith(".");
  const visible = (e: FileNode) => !e.ignored && (showHidden || !isHidden(e));
  const dirs = entries.filter((e) => e.type === "directory" && visible(e));
  const files = entries.filter((e) => e.type === "file" && visible(e));
  const allHidden = entries.length > 0 && dirs.length === 0 && files.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* 顶部：面包屑 + 隐藏文件开关（同一行，紧凑） */}
        <View style={styles.topBar}>
          <BreadcrumbBar
            theme={theme}
            styles={styles}
            absPath={breadcrumbAbs}
            workspaceAbs={workspaceAbs}
            onJumpToAbs={onJumpToAbs}
            showHidden={showHidden}
            onToggleShowHidden={(v) => void setShowHidden(v)}
          />
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.colors.destructive} />
            <Text style={styles.errorText} numberOfLines={3}>
              {error}
            </Text>
            <TouchableOpacity onPress={() => void load(currentRel, true)} hitSlop={theme.hitSlop}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.flex}>
          <FlatList
            ref={flatListRef}
            data={[...dirs, ...files]}
            keyExtractor={(e) => e.absolute}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load(currentRel, true)}
                tintColor={theme.colors.textTertiary}
              />
            }
            ListHeaderComponent={
              <>
                {/* 常用目录面板：有记录时才显示 */}
                {serverRecentDirs.length > 0 ? (
                  <RecentDirsPanel
                    theme={theme}
                    styles={styles}
                    dirs={serverRecentDirs}
                    collapsed={recentDirsCollapsed}
                    onToggleCollapse={() => void setRecentDirsCollapsed(!recentDirsCollapsed)}
                    onPress={onRecentDirPress}
                    onLongPress={onRecentDirLongPress}
                  />
                ) : null}

                {/* .. 返回上一级：始终在目录树最顶部，不受空态影响 */}
                {currentRel ? (
                  <UpRow
                    theme={theme}
                    styles={styles}
                    isLast={dirs.length === 0 && files.length === 0}
                    onPress={onUp}
                  />
                ) : null}

                {navigating && entries.length === 0 ? (
                  <SkeletonList count={8} hasAvatar={false} rowHeight={48} />
                ) : !error && entries.length === 0 ? (
                  <EmptyHint absPath={currentAbs} theme={theme} styles={styles} />
                ) : !error && allHidden ? (
                  <AllHiddenHint
                    theme={theme}
                    styles={styles}
                    onShow={() => void setShowHidden(true)}
                  />
                ) : null}
              </>
            }
            renderItem={({ item, index }) => {
              const isDir = item.type === "directory";
              const isFirst = index === 0 && !currentRel;
              const isLast = index === dirs.length + files.length - 1;
              return (
                <EntryRow
                  theme={theme}
                  styles={styles}
                  entry={item}
                  isFirst={isFirst}
                  isLast={isLast}
                  isFile={!isDir}
                  onPress={() => onEnter(item)}
                />
              );
            }}
          />
          {navigating && entries.length > 0 ? (
            <View style={styles.navOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color={theme.colors.accent} />
            </View>
          ) : null}
        </View>

        {/* 底部 CTA：在此创建会话 */}
        <View style={[styles.bottomBar, { borderTopColor: theme.colors.border }]}>
          <View style={styles.bottomBarInfo}>
            <Text style={styles.bottomBarLabel} numberOfLines={1}>
              {t("selectDirectory.willCreateAt")}
            </Text>
            <Text style={styles.bottomBarPath} numberOfLines={1}>
              {currentAbs || t("selectDirectory.unknownPath")}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.confirmBtn, currentAbs === null && styles.confirmBtnDisabled]}
            onPress={onCreate}
            disabled={currentAbs === null || creating}
            activeOpacity={0.85}
          >
            {creating ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="add" size={16} color="#FFFFFF" />
                <Text style={styles.confirmBtnText}>{t("selectDirectory.createHere")}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RecentDirsPanel({
  theme,
  styles,
  dirs,
  collapsed,
  onToggleCollapse,
  onPress,
  onLongPress,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  dirs: RecentDirEntry[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onPress: (path: string) => void;
  onLongPress: (path: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.recentPanel}>
      {/* 面板标题行 */}
      <TouchableOpacity style={styles.recentHeader} onPress={onToggleCollapse} activeOpacity={0.7}>
        <Ionicons name="time-outline" size={14} color={theme.colors.textTertiary} />
        <Text style={styles.recentTitle}>{t("selectDirectory.recentDirs")}</Text>
        <View style={styles.recentHeaderSpacer} />
        <Ionicons
          name={collapsed ? "chevron-down" : "chevron-up"}
          size={14}
          color={theme.colors.textTertiary}
        />
      </TouchableOpacity>

      {/* 目录条目列表 */}
      {!collapsed ? (
        <View style={styles.recentList}>
          {dirs.map((entry, index) => {
            const isFirst = index === 0;
            const isLast = index === dirs.length - 1;
            const name = entry.path.split("/").pop() ?? entry.path;
            return (
              <Pressable
                key={entry.path}
                onPress={() => onPress(entry.path)}
                onLongPress={() => onLongPress(entry.path)}
                delayLongPress={500}
                style={({ pressed }) => [
                  styles.recentRow,
                  isFirst && styles.recentRowFirst,
                  isLast && styles.recentRowLast,
                  pressed && { backgroundColor: theme.colors.surfaceHover },
                ]}
              >
                <View style={styles.recentRowIcon}>
                  <Ionicons name="folder" size={16} color={theme.colors.accent} />
                </View>
                <View style={styles.recentRowBody}>
                  <Text style={styles.recentRowName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.recentRowPath} numberOfLines={1}>
                    {entry.path}
                  </Text>
                </View>
                <View style={styles.recentRowMeta}>
                  <Text style={styles.recentRowCount}>{entry.count}×</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ── 面包屑 ───────────────────────────────────────────────

function BreadcrumbBar({
  theme,
  styles,
  absPath,
  workspaceAbs,
  onJumpToAbs,
  showHidden,
  onToggleShowHidden,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  absPath: string | null;
  workspaceAbs: string | null;
  onJumpToAbs: (abs: string) => void;
  showHidden: boolean;
  onToggleShowHidden: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const crumbs = useMemo(() => buildBreadcrumbFromAbs(absPath), [absPath]);

  return (
    <View style={styles.crumbBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ alignItems: "center" }}
      >
        {crumbs.length === 0 || !absPath ? (
          <Text
            style={[styles.crumbText, styles.crumbTextActive, styles.crumbHint]}
            numberOfLines={1}
          >
            {t("selectDirectory.rootHint")}
          </Text>
        ) : (
          crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            const canJump = !!workspaceAbs && !isLast;
            return (
              <View key={c.full} style={styles.crumbWrap}>
                <TouchableOpacity
                  onPress={() => canJump && onJumpToAbs(c.full)}
                  disabled={!canJump}
                  activeOpacity={canJump ? 0.6 : 1}
                  style={styles.crumbItem}
                >
                  <Text
                    style={[
                      styles.crumbText,
                      isLast && styles.crumbTextActive,
                      canJump && { color: theme.colors.accent },
                    ]}
                    numberOfLines={1}
                  >
                    {c.label}
                  </Text>
                </TouchableOpacity>
                {!isLast ? (
                  <Ionicons
                    name="chevron-forward"
                    size={12}
                    color={theme.colors.textTertiary}
                    style={styles.crumbSep}
                  />
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
      {/* 隐藏文件开关：紧凑图标形式，避免占用太多空间 */}
      <TouchableOpacity
        style={styles.hiddenToggle}
        onPress={() => onToggleShowHidden(!showHidden)}
        activeOpacity={0.7}
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

// ── 单行 ─────────────────────────────────────────────────

function EntryRow({
  theme,
  styles,
  entry,
  isFile,
  isFirst,
  isLast,
  onPress,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  entry: FileNode;
  isFile: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isFirst && styles.rowFirst,
        isLast && styles.rowLast,
        pressed && { backgroundColor: theme.colors.surfaceHover },
      ]}
    >
      <View style={[styles.rowIcon, isFile ? styles.rowIconFile : styles.rowIconDir]}>
        <Ionicons
          name={isFile ? "document-outline" : "folder"}
          size={18}
          color={isFile ? theme.colors.textTertiary : theme.colors.accent}
        />
      </View>
      <Text style={[styles.rowName, isFile && styles.rowNameFile]} numberOfLines={1}>
        {entry.name}
      </Text>
      {!isFile ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
      ) : null}
    </Pressable>
  );
}

function UpRow({
  theme,
  styles,
  isLast,
  onPress,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles.rowFirst,
        isLast && styles.rowLast,
        pressed && { backgroundColor: theme.colors.surfaceHover },
      ]}
    >
      <View style={[styles.rowIcon, styles.rowIconDir]}>
        <Ionicons name="arrow-up" size={16} color={theme.colors.accent} />
      </View>
      <Text style={styles.rowName}>..</Text>
      {/* 하단 separator — 아래 실제 항목과 시각적으로 이어지도록 */}
      {!isLast ? <View style={styles.rowSep} /> : null}
    </Pressable>
  );
}

function EmptyHint({
  absPath,
  theme,
  styles,
}: {
  absPath: string | null;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyBox}>
      <Ionicons name="folder-open-outline" size={28} color={theme.colors.textTertiary} />
      <Text style={styles.emptyText}>{t("selectDirectory.empty")}</Text>
      <Text style={styles.emptyPath} numberOfLines={1}>
        {absPath ?? t("selectDirectory.unknownPath")}
      </Text>
    </View>
  );
}

function AllHiddenHint({
  theme,
  styles,
  onShow,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onShow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyBox}>
      <Ionicons name="eye-off-outline" size={28} color={theme.colors.textTertiary} />
      <Text style={styles.emptyText}>{t("selectDirectory.allHiddenTitle")}</Text>
      <Text style={styles.emptyPath}>{t("selectDirectory.allHiddenDesc")}</Text>
      <TouchableOpacity onPress={onShow} activeOpacity={0.7} style={styles.allHiddenBtn}>
        <Ionicons name="eye-outline" size={14} color={theme.colors.accent} />
        <Text style={styles.allHiddenBtnText}>{t("selectDirectory.allHiddenAction")}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── 工具函数 ──────────────────────────────────────────────

type Crumb = { label: string; full: string };

function buildBreadcrumbFromAbs(abs: string | null): Crumb[] {
  if (!abs) return [];
  const cleaned = abs.replace(/\/+$/, "");
  if (!cleaned) return [];
  const parts = cleaned.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    crumbs.push({ label: p, full: acc });
  }
  return crumbs;
}

function absToRel(abs: string, workspace: string): string | null {
  const cleaned = abs.replace(/\/+$/, "");
  const wsClean = workspace.replace(/\/+$/, "");
  if (cleaned === wsClean) return "";
  if (cleaned.startsWith(wsClean + "/")) {
    return cleaned.slice(wsClean.length + 1);
  }
  return null;
}

function stripLastSegment(rel: string): string {
  const cleaned = rel.replace(/\/+$/, "");
  if (!cleaned) return "";
  const idx = cleaned.lastIndexOf("/");
  return idx < 0 ? "" : cleaned.slice(0, idx);
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    flex: { flex: 1 },

    // 顶部条（只剩面包屑行，更紧凑）
    topBar: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },

    // 隐藏文件开关：纯图标，圆形点击区
    hiddenToggle: {
      padding: 6,
      borderRadius: radius.full,
    },

    // 面包屑
    crumbBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs,
    },
    crumbWrap: {
      flexDirection: "row",
      alignItems: "center",
    },
    crumbItem: {
      paddingVertical: 4,
      paddingHorizontal: 2,
      maxWidth: 140,
    },
    crumbText: {
      ...typography.footnote,
      color: colors.textTertiary,
    },
    crumbTextActive: {
      ...typography.footnoteEmphasized,
      color: colors.text,
    },
    crumbHint: {
      marginLeft: spacing.sm,
      color: colors.textTertiary,
    },
    crumbSep: {
      marginHorizontal: 2,
    },

    // 错误条
    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.destructiveMuted,
      borderRadius: radius.card,
    },
    errorText: {
      ...typography.footnote,
      color: colors.destructive,
      flex: 1,
      lineHeight: 18,
    },
    retryText: {
      ...typography.footnoteEmphasized,
      color: colors.destructive,
    },

    // 常用目录面板
    recentPanel: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      marginTop: spacing.sm,
    },
    recentHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    recentTitle: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    recentHeaderSpacer: { flex: 1 },
    recentList: {
      borderRadius: radius.card,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    recentRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      gap: spacing.sm,
      backgroundColor: colors.surface,
    },
    recentRowFirst: {
      borderTopLeftRadius: radius.card - 1,
      borderTopRightRadius: radius.card - 1,
    },
    recentRowLast: {
      borderBottomLeftRadius: radius.card - 1,
      borderBottomRightRadius: radius.card - 1,
    },
    recentRowIcon: {
      width: 28,
      height: 28,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSubtle,
      alignItems: "center",
      justifyContent: "center",
    },
    recentRowBody: {
      flex: 1,
      gap: 2,
    },
    recentRowName: {
      ...typography.footnoteEmphasized,
      color: colors.text,
    },
    recentRowPath: {
      ...typography.caption2,
      color: colors.textTertiary,
    },
    recentRowMeta: {
      alignItems: "flex-end",
    },
    recentRowCount: {
      ...typography.caption2,
      color: colors.textTertiary,
    },

    // 列表
    listContent: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: 11,
      gap: spacing.md,
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      position: "relative",
    },
    rowFirst: {
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowLast: {
      borderBottomLeftRadius: radius.card,
      borderBottomRightRadius: radius.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    rowIconDir: {
      backgroundColor: colors.accentSubtle,
    },
    rowIconFile: {
      backgroundColor: colors.backgroundSecondary,
    },
    rowName: {
      ...typography.body,
      color: colors.text,
      flex: 1,
    },
    rowNameFile: {
      color: colors.textSecondary,
    },
    rowSep: {
      position: "absolute",
      bottom: 0,
      right: 0,
      left: spacing.lg,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
    },

    // 空态/loading
    loadingBox: {
      paddingTop: 60,
      alignItems: "center",
      gap: spacing.md,
    },
    navOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.groupedBackground + "cc",
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      ...typography.footnote,
      color: colors.textTertiary,
    },
    emptyBox: {
      paddingTop: 60,
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.xxxl,
    },
    emptyText: {
      ...typography.subheadline,
      color: colors.textSecondary,
    },
    emptyPath: {
      ...typography.caption1,
      color: colors.textTertiary,
      maxWidth: "100%",
    },
    allHiddenBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.full,
      backgroundColor: colors.accentSubtle,
    },
    allHiddenBtnText: {
      ...typography.footnoteEmphasized,
      color: colors.accent,
    },

    // 底部 CTA
    bottomBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      paddingBottom: spacing.lg,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: spacing.md,
    },
    bottomBarInfo: {
      flex: 1,
      gap: 2,
    },
    bottomBarLabel: {
      ...typography.caption2,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    bottomBarPath: {
      ...typography.footnoteEmphasized,
      color: colors.text,
    },
    confirmBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      borderRadius: radius.full,
      shadowColor: colors.accent,
      shadowOpacity: theme.isDark ? 0.4 : 0.25,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      elevation: 4,
    },
    confirmBtnDisabled: {
      opacity: 0.4,
      shadowOpacity: 0,
      elevation: 0,
    },
    confirmBtnText: {
      ...typography.subheadlineEmphasized,
      color: "#FFFFFF",
    },
  });
}
