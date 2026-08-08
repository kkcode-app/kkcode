/**
 * [INPUT]: 依赖 OpenCode sessions API、stores 与 ChatScreen
 * [OUTPUT]: 对外提供 OpenCode 会话列表路由（默认按项目分组，可由 session-prefs 切到扁平）
 * [POS]: app 的 OpenCode 会话入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 会话列表页 — 默认按项目分组（设置页可切换为扁平）
// 设计语言：扁平项目分组为一级结构，缩进会话行为二级内容。
// 关闭"按项目分组"后，列表退化为按 updatedAt 倒序的扁平会话行，
// 不渲染项目头、不再使用展开状态，row 与导轨样式一并简化。
//
// 项目 worktree 只在分组标题展示一次；会话根据 projectID 或目录前缀归属。
// "新建会话" → /select-directory?intent=new → 在该页确认目录后建会话并跳转。
// 右下角 FAB：点按走选目录流程；长按跳过选目录，用 workspace 根目录直接
// 建会话并进聊天页，方便快速开启新对话。

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import {
  createSession,
  deleteSession,
  listPath,
  listProjects,
  listSessions,
  type Project,
  updateSessionTitle,
  type FileNode,
  type Session,
} from "../src/api/client";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { useConnectionStore, toClientConfig } from "../src/store/connection";
import { useResponsive } from "../src/hooks/useResponsive";
import { ChatScreen } from "../src/components/ChatScreen";
import { Skeleton } from "../src/components/Skeleton";
import { usePendingOpenStore } from "../src/store/pending-open";
import { useDirectoryPrefsStore } from "../src/store/directory-prefs";
import { useMessagesStore } from "../src/store/messages";
import { usePermissionStore } from "../src/store/permissions";
import { useQuestionStore } from "../src/store/questions";
import { useSessionPrefsStore } from "../src/store/session-prefs";
import { useSessionsStore } from "../src/store/sessions";
import { useStatusStore } from "../src/store/status";
import { useTheme, type Theme } from "../src/theme";
import { useTranslation } from "react-i18next";
import { haptic } from "../src/utils/haptics";
import { isSessionStreaming } from "../src/utils/session-status";
import {
  groupSessionsByProject,
  projectDisplayName,
  type ProjectSessionGroup,
} from "../src/utils/project-sessions";

type SessionExtras = {
  title?: string;
  slug?: string;
  agent?: string | null;
  model?: { id?: string; providerID?: string } | null;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  time?: { created?: number; updated?: number; archived?: number | null };
  projectID?: string;
};

const asExtras = (s: Session) => s as unknown as SessionExtras;

// web 端 Alert.alert 不弹出，用 window.confirm 降级
const crossPlatformConfirm = (
  title: string,
  message: string,
  onConfirm: () => void,
  confirmText: string,
  cancelText: string,
) => {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: cancelText, style: "cancel" },
      { text: confirmText, style: "destructive", onPress: onConfirm },
    ]);
  }
};

const ACTION_WIDTH = 76;
const SESSION_RAIL_WIDTH = 2;
type SessionListItem =
  | { kind: "project"; group: ProjectSessionGroup; index: number }
  | {
      kind: "session";
      group: ProjectSessionGroup | null;
      session: Session;
      isFirst: boolean;
      isLast: boolean;
    };

export default function SessionsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { splitView, sidebarWidth } = useResponsive();

  // 双栏（iPad 横屏）下右侧栏当前打开的会话；单栏下不使用（走路由 push）。
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const active = useConnectionStore((s) => s.active);
  const activeID = active?.id;
  const sessions = useSessionsStore((s) => s.sessions);
  const loading = useSessionsStore((s) => s.loading);
  const error = useSessionsStore((s) => s.error);
  const setSessions = useSessionsStore((s) => s.setSessions);
  const setLoading = useSessionsStore((s) => s.setLoading);
  const setError = useSessionsStore((s) => s.setError);
  const removeSession = useSessionsStore((s) => s.removeSession);
  const upsertSession = useSessionsStore((s) => s.upsertSession);
  const recordDir = useDirectoryPrefsStore((s) => s.recordDir);
  const showSubSessions = useSessionPrefsStore((s) => s.showSubSessions);
  const groupByProject = useSessionPrefsStore((s) => s.groupByProject);
  // SSE 连续失败/明确 401 后会进入 fatal,把它浮起一个永久 banner,提示用户去检查服务器。
  const connStatus = useStatusStore((s) => s.status);
  const connErrorMsg = useStatusStore((s) => s.errorMessage);

  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [quickCreating, setQuickCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string> | null>(null);

  // 批量删除状态
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const visibleSessions = useMemo(
    () => (showSubSessions ? sessions : sessions.filter((s) => !s.parentID)),
    [sessions, showSubSessions],
  );

  const allSelected = visibleSessions.length > 0 && selectedIds.size === visibleSessions.length;

  const projectGroups = useMemo(
    () =>
      groupSessionsByProject(projects, visibleSessions).filter(
        (group) => group.sessions.length > 0,
      ),
    [projects, visibleSessions],
  );
  const defaultExpandedProjectIds = useMemo(
    () => new Set(projectGroups.slice(0, 1).map((group) => group.id)),
    [projectGroups],
  );
  const activeExpandedProjectIds = expandedProjectIds ?? defaultExpandedProjectIds;
  const listItems = useMemo<SessionListItem[]>(() => {
    if (!groupByProject) {
      // 扁平模式：按 updatedAt 已排序的 visibleSessions 直接展平，跳过项目头与展开状态。
      return visibleSessions.map((session, index) => ({
        kind: "session" as const,
        group: null,
        session,
        isFirst: index === 0,
        isLast: index === visibleSessions.length - 1,
      }));
    }
    const items: SessionListItem[] = [];
    projectGroups.forEach((group, index) => {
      items.push({ kind: "project", group, index });
      if (!activeExpandedProjectIds.has(group.id)) return;
      group.sessions.forEach((session, sessionIndex) => {
        items.push({
          kind: "session",
          group,
          session,
          isFirst: sessionIndex === 0,
          isLast: sessionIndex === group.sessions.length - 1,
        });
      });
    });
    return items;
  }, [groupByProject, visibleSessions, projectGroups, activeExpandedProjectIds]);

  const toggleProjectExpanded = useCallback(
    (projectID: string) => {
      const current = expandedProjectIds ?? defaultExpandedProjectIds;
      const willExpand = !current.has(projectID);
      const next = new Set(current);
      if (next.has(projectID)) next.delete(projectID);
      else next.add(projectID);
      setExpandedProjectIds(next);
      haptic.selection();
      trackEvent(Ev.ProjectGroupExpand, {
        expanded: willExpand ? "1" : "0",
      });
    },
    [defaultExpandedProjectIds, expandedProjectIds],
  );

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleSessions.map((s) => s.id)));
    }
  }, [allSelected, visibleSessions]);

  const toggleProjectSelection = useCallback((group: ProjectSessionGroup) => {
    const ids = group.sessions.map((session) => session.id);
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (everySelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, []);

  const onBulkDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    crossPlatformConfirm(
      t("sessions.bulkDeleteTitle", { count }),
      t("sessions.bulkDeleteMessage"),
      async () => {
        if (!active) return;
        setBulkDeleting(true);
        const ids = Array.from(selectedIds);
        const results = await Promise.allSettled(
          ids.map((id) => deleteSession(toClientConfig(active), id)),
        );
        results.forEach((r, i) => {
          if (r.status === "fulfilled") removeSession(ids[i]);
        });
        const failed = results.filter((r) => r.status === "rejected").length;
        const succeeded = ids.length - failed;
        trackEvent(Ev.SessionBulkDeleteResult, {
          total: ids.length,
          succeeded,
          failed,
        });
        setBulkDeleting(false);
        exitEditMode();
        if (failed === 0) {
          haptic.success();
        } else {
          haptic.warning();
          Alert.alert(
            t("sessions.deleteFailed"),
            t("sessions.bulkDeletePartialFailed", { count: failed }),
          );
        }
      },
      t("sessions.deleteBtn"),
      t("common.cancel"),
    );
  };

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const [sessionsResult, projectsResult] = await Promise.allSettled([
        listSessions(toClientConfig(active)),
        listProjects(toClientConfig(active)),
      ]);
      if (sessionsResult.status === "fulfilled") {
        setSessions(sortByRecent(Array.isArray(sessionsResult.value) ? sessionsResult.value : []));
      } else {
        setError(
          sessionsResult.reason instanceof Error
            ? sessionsResult.reason.message
            : String(sessionsResult.reason),
        );
      }
      // A failed project request must not hide usable conversations. The
      // grouping utility falls back to directory groups until the next refresh.
      if (projectsResult.status === "fulfilled" && Array.isArray(projectsResult.value)) {
        setProjects(projectsResult.value);
      } else {
        setProjects([]);
        trackEvent(Ev.ProjectGroupLoadFail, {
          error:
            projectsResult.status === "rejected" && projectsResult.reason instanceof Error
              ? projectsResult.reason.message.slice(0, 120)
              : "unknown",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [active, setSessions, setLoading, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  // 切换服务器时恢复默认：按最近会话排序的第一个项目展开，其余收起。
  useEffect(() => {
    setExpandedProjectIds(null);
  }, [activeID]);

  // 双栏：从 select-directory 创建新会话返回后，消费待打开 id 切到右侧栏。
  useFocusEffect(
    useCallback(() => {
      if (!splitView) return;
      const id = usePendingOpenStore.getState().consume();
      if (id) setSelectedId(id);
    }, [splitView]),
  );

  const onCreate = () => {
    // 不直接调 createSession —— 新会话必须先选工作目录。
    // 跳到 /select-directory?intent=new，确认后那边会建会话并跳 chat。
    router.push({ pathname: "/select-directory", params: { intent: "new" } });
  };

  // 打开会话：双栏（iPad 横屏）就地切换右侧栏，单栏走路由 push。
  const openSession = useCallback(
    (id: string) => {
      trackEvent(Ev.SessionOpen, {
        source: splitView ? "split_pane" : "sessions_list",
      });
      if (splitView) {
        setSelectedId(id);
      } else {
        router.push(`/chat/${id}`);
      }
    },
    [splitView, router],
  );

  // 长按 FAB：跳过选目录窗口，用 workspace 根目录直接建会话并进聊天页，
  // 方便快速开启新对话。
  //
  // 为什么要先拿 workspace 根的绝对路径，而不是直接 createSession 不带
  // directory：client.ts::createSession 注释指出，directory 缺省时服务端
  // 会 fallback 到 process.cwd()，把会话钉在错误目录上（后续 loadMessages /
  // sendPrompt / SSE 全部携带错目录）。所以这里先 listPath("") 拿到第一条
  // entry，从它的 absolute 反推出 workspace 根，再把根目录显式传给服务端。
  const onQuickCreate = async () => {
    if (!active || quickCreating) return;
    setQuickCreating(true);
    haptic.impactHeavy();
    try {
      const list = await listPath(toClientConfig(active), "");
      const root = inferWorkspaceRoot(Array.isArray(list) ? list : []);
      const session = await createSession(toClientConfig(active, root ?? undefined), {});
      if (!session?.id) throw new Error("Server returned an invalid session");
      void trackEvent(Ev.SessionCreate, {
        quick: "1",
        directory: root ?? "cwd",
      });
      if (root) void recordDir(active.id, root);
      useMessagesStore.getState().reset();
      useQuestionStore.getState().reset();
      usePermissionStore.getState().reset();
      haptic.success();
      openSession(session.id);
    } catch (err) {
      haptic.error();
      Alert.alert(
        t("selectDirectory.createFailed"),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setQuickCreating(false);
    }
  };

  const onDelete = (session: Session) => {
    const x = asExtras(session);
    const label = (x.title && x.title.trim()) || x.slug || session.id.slice(0, 8);
    crossPlatformConfirm(
      t("sessions.deleteTitle", { title: label }),
      t("sessions.deleteMessage"),
      async () => {
        if (!active) return;
        try {
          await deleteSession(toClientConfig(active), session.id);
          removeSession(session.id);
          haptic.success();
          void trackEvent(Ev.SessionDelete, { source: "single" });
        } catch (err) {
          haptic.error();
          Alert.alert(t("sessions.deleteFailed"), err instanceof Error ? err.message : String(err));
        }
      },
      t("sessions.deleteBtn"),
      t("common.cancel"),
    );
  };

  const onRename = (session: Session) => {
    setRenameTarget(session);
  };

  const submitRename = async (session: Session, newTitle: string) => {
    const trimmed = newTitle.trim();
    const x = asExtras(session);
    if (!trimmed || trimmed === (x.title ?? "") || !active) return;
    try {
      const updated = await updateSessionTitle(toClientConfig(active), session.id, trimmed);
      if (updated?.id) upsertSession(updated);
      haptic.success();
      trackEvent(Ev.SessionRename, { length_chars: trimmed.length });
    } catch (err) {
      haptic.error();
      Alert.alert(t("sessions.renameFailed"), err instanceof Error ? err.message : String(err));
    }
  };

  if (!active) return null;

  const listPane = (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <FlatList
        data={listItems}
        keyExtractor={(item) =>
          item.kind === "project" ? `project:${item.group.id}` : `session:${item.session.id}`
        }
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={listItems.length === 0 ? styles.emptyContainer : styles.listContent}
        ListHeaderComponent={
          listItems.length > 0 ? (
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderCount}>
                {groupByProject
                  ? t("sessions.projectSummary", {
                      projects: projectGroups.length,
                      sessions: visibleSessions.length,
                    })
                  : t("sessions.sessionCount", { count: visibleSessions.length })}
              </Text>
              <TouchableOpacity
                onPress={
                  editMode
                    ? () => {
                        trackEvent(Ev.SessionEditModeExit);
                        exitEditMode();
                      }
                    : () => {
                        trackEvent(Ev.SessionEditModeEnter);
                        setEditMode(true);
                      }
                }
                hitSlop={theme.hitSlop}
                activeOpacity={0.7}
              >
                <Text style={[styles.listHeaderAction, { color: theme.colors.accent }]}>
                  {editMode ? t("sessions.doneBtn") : t("sessions.editBtn")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === "project") {
            const selectedCount = item.group.sessions.filter((session) =>
              selectedIds.has(session.id),
            ).length;
            return (
              <ProjectHeader
                theme={theme}
                styles={styles}
                group={item.group}
                isFirst={item.index === 0}
                expanded={activeExpandedProjectIds.has(item.group.id)}
                editMode={editMode}
                selectedCount={selectedCount}
                onToggleExpanded={() => toggleProjectExpanded(item.group.id)}
                onToggleSelection={() => toggleProjectSelection(item.group)}
              />
            );
          }
          return (
            <SessionRow
              theme={theme}
              styles={styles}
              item={item.session}
              isFirst={item.isFirst}
              isLast={item.isLast}
              flat={!groupByProject}
              onOpen={() => {
                if (editMode) {
                  toggleSelect(item.session.id);
                } else {
                  openSession(item.session.id);
                }
              }}
              onDelete={() => onDelete(item.session)}
              onRename={() => onRename(item.session)}
              editMode={editMode}
              selected={selectedIds.has(item.session.id)}
              onToggleSelect={() => toggleSelect(item.session.id)}
              active={splitView && selectedId === item.session.id}
            />
          );
        }}
        ListEmptyComponent={
          loading ? (
            <SessionsLoadingSkeleton styles={styles} />
          ) : (
            <EmptyState theme={theme} styles={styles} onCreate={onCreate} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={loading && sessions.length > 0}
            onRefresh={() => {
              haptic.selection();
              void load();
            }}
            tintColor={theme.colors.textTertiary}
          />
        }
      />

      {error ? (
        <View style={styles.errorToast}>
          <Ionicons name="wifi-outline" size={14} color={theme.colors.destructive} />
          <Text style={styles.errorToastText} numberOfLines={1}>
            {error}
          </Text>
          <TouchableOpacity onPress={load} hitSlop={theme.hitSlop}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      ) : connStatus === "fatal" ? (
        <View style={styles.errorToast}>
          <Ionicons name="alert-circle-outline" size={14} color={theme.colors.destructive} />
          <Text style={styles.errorToastText} numberOfLines={2}>
            {connErrorMsg ?? t("sessions.connectionFailed")}
          </Text>
          <TouchableOpacity onPress={() => router.push("/servers")} hitSlop={theme.hitSlop}>
            <Text style={styles.retryText}>{t("sessions.checkServer")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 编辑模式底部操作栏 */}
      {editMode ? (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
          ]}
        >
          <TouchableOpacity style={styles.bulkBarBtn} onPress={toggleSelectAll} activeOpacity={0.7}>
            <View
              style={[
                styles.checkbox,
                { borderColor: allSelected ? theme.colors.accent : theme.colors.border },
                allSelected && { backgroundColor: theme.colors.accent },
              ]}
            >
              {allSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
            </View>
            <Text style={[styles.bulkBarLabel, { color: theme.colors.text }]}>
              {t("sessions.selectAll")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.bulkDeleteBtn,
              {
                backgroundColor:
                  selectedIds.size > 0 ? theme.colors.destructive : theme.colors.surfaceElevated,
              },
            ]}
            onPress={onBulkDelete}
            disabled={selectedIds.size === 0 || bulkDeleting}
            activeOpacity={0.8}
          >
            {bulkDeleting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text
                style={[
                  styles.bulkDeleteText,
                  { color: selectedIds.size > 0 ? "#fff" : theme.colors.textTertiary },
                ]}
              >
                {t("sessions.deleteSelected", { count: selectedIds.size })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : listItems.length > 0 ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={onCreate}
          onLongPress={onQuickCreate}
          delayLongPress={400}
          disabled={quickCreating}
          activeOpacity={0.85}
        >
          {quickCreating ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="add" size={28} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      ) : null}

      <RenameModal
        theme={theme}
        styles={styles}
        session={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={submitRename}
      />
    </SafeAreaView>
  );

  // 单栏（iPhone / iPad 竖屏）：直接返回列表，点会话走路由 push。
  if (!splitView) return listPane;

  // 双栏（iPad 横屏）：左列表 + 右聊天详情。
  return (
    <View style={styles.splitRoot}>
      <View
        style={[
          styles.splitSidebar,
          { width: sidebarWidth, borderRightColor: theme.colors.separator },
        ]}
      >
        {listPane}
      </View>
      <View style={styles.splitDetail}>
        {selectedId ? (
          <ChatScreen key={selectedId} sessionID={selectedId} embedded />
        ) : (
          <SplitEmptyDetail theme={theme} styles={styles} />
        )}
      </View>
    </View>
  );
}

// ── 双栏右侧空态（未选会话时） ──────────────────────────────

function SplitEmptyDetail({
  theme,
  styles,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.splitEmpty}>
      <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textTertiary} />
      <Text style={styles.splitEmptyText}>{t("sessions.splitSelectHint")}</Text>
    </View>
  );
}

// ── 项目分组头 ──────────────────────────────────────────

function ProjectHeader({
  theme,
  styles,
  group,
  isFirst,
  expanded,
  editMode,
  selectedCount,
  onToggleExpanded,
  onToggleSelection,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  group: ProjectSessionGroup;
  isFirst: boolean;
  expanded: boolean;
  editMode: boolean;
  selectedCount: number;
  onToggleExpanded: () => void;
  onToggleSelection: () => void;
}) {
  const { t } = useTranslation();
  const name = group.isGlobal
    ? t("sessions.globalWorkspace")
    : projectDisplayName(group.worktree) || t("sessions.unassignedSessions");
  const hasSessions = group.sessions.length > 0;
  const selectionComplete = hasSessions && selectedCount === group.sessions.length;
  const selectionPartial = selectedCount > 0 && !selectionComplete;
  const sessionCountLabel = hasSessions
    ? t("sessions.sessionCount", { count: group.sessions.length })
    : t("sessions.projectNoSessions");
  const lastActiveLabel = hasSessions ? formatRelative(group.updatedAt, t) : null;

  return (
    <View style={[styles.projectSection, isFirst && styles.projectSectionFirst]}>
      <View style={styles.projectHeaderRow}>
        <Pressable
          style={({ pressed }) => [styles.projectToggle, pressed && styles.projectTogglePressed]}
          onPress={onToggleExpanded}
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? t("sessions.projectCollapse", { name })
              : t("sessions.projectExpand", { name })
          }
          accessibilityState={{ expanded }}
        >
          <Ionicons name="folder-outline" size={18} color={theme.colors.accent} />
          <View style={styles.projectContent}>
            <View style={styles.projectBody}>
              <View style={styles.projectTitleRow}>
                <Text style={styles.projectName} numberOfLines={1}>
                  {name}
                </Text>
                <View style={styles.projectCountPill}>
                  <Text style={styles.projectMeta}>{sessionCountLabel}</Text>
                </View>
              </View>
              <View style={styles.projectDetailRow}>
                {group.worktree ? (
                  <Text style={styles.projectPath} numberOfLines={1}>
                    {group.worktree}
                  </Text>
                ) : null}
                {lastActiveLabel ? (
                  <Text style={styles.projectLastActive}>{lastActiveLabel}</Text>
                ) : null}
              </View>
            </View>
          </View>
          <View style={styles.projectDisclosure}>
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.colors.textTertiary}
            />
          </View>
        </Pressable>

        {editMode && hasSessions ? (
          <Pressable
            style={styles.projectAction}
            onPress={onToggleSelection}
            accessibilityRole="checkbox"
            accessibilityLabel={t("sessions.projectSelect", { name })}
            accessibilityState={{
              checked: selectionComplete ? true : selectionPartial ? "mixed" : false,
            }}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor:
                    selectionComplete || selectionPartial
                      ? theme.colors.accent
                      : theme.colors.border,
                },
                (selectionComplete || selectionPartial) && { backgroundColor: theme.colors.accent },
              ]}
            >
              {selectionComplete ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
              {selectionPartial ? <Ionicons name="remove" size={12} color="#fff" /> : null}
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ── 会话列表加载态 ────────────────────────────────────────

function SessionsLoadingSkeleton({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.sessionsSkeleton}>
      <View style={[styles.sessionsSkeletonProject, styles.sessionsSkeletonProjectFirst]}>
        <Skeleton width={18} height={18} radius={5} />
        <View style={styles.sessionsSkeletonProjectLines}>
          <Skeleton width="38%" height={15} radius={4} />
          <Skeleton width="58%" height={11} radius={4} />
        </View>
        <Skeleton width={20} height={20} radius={10} />
      </View>
      <SessionsSkeletonRows styles={styles} count={3} />

      <View style={styles.sessionsSkeletonProject}>
        <Skeleton width={18} height={18} radius={5} />
        <View style={styles.sessionsSkeletonProjectLines}>
          <Skeleton width="30%" height={15} radius={4} />
          <Skeleton width="46%" height={11} radius={4} />
        </View>
        <Skeleton width={20} height={20} radius={10} />
      </View>
      <SessionsSkeletonRows styles={styles} count={2} />
    </View>
  );
}

function SessionsSkeletonRows({
  styles,
  count,
}: {
  styles: ReturnType<typeof makeStyles>;
  count: number;
}) {
  return (
    <View style={styles.sessionsSkeletonRows}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[styles.sessionsSkeletonRow, index < count - 1 && styles.sessionsSkeletonRowGap]}
        >
          <View style={styles.sessionsSkeletonRail} />
          <View style={styles.sessionsSkeletonRowLines}>
            <View style={styles.sessionsSkeletonTitleRow}>
              <Skeleton width={index === 1 ? "42%" : "64%"} height={14} radius={4} />
              <Skeleton width={30} height={11} radius={4} />
            </View>
            <Skeleton width={index === 2 ? "36%" : "52%"} height={11} radius={4} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ── 会话行 ────────────────────────────────────────────────

function SessionRow({
  theme,
  styles,
  item,
  isFirst,
  isLast,
  flat,
  onOpen,
  onDelete,
  onRename,
  editMode,
  selected,
  onToggleSelect,
  active: activeRow,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  item: Session;
  isFirst: boolean;
  isLast: boolean;
  /** 扁平模式（设置页关闭"按项目分组"）：去掉左侧缩进与导轨，呈现与普通列表行一致 */
  flat?: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onRename: () => void;
  editMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** 双栏模式下当前是否为右侧栏打开的会话（高亮） */
  active?: boolean;
}) {
  const x = asExtras(item);
  const { t } = useTranslation();
  const title = (x.title && x.title.trim()) || x.slug || t("sessions.unnamed");
  const updated = getUpdatedAt(item);
  // 派生：当前 session 是否在生成回复。只读,跟随 messages store 实时更新,
  // 用户无需进入 chat 就能看到"还在跑"。selector 返回 boolean,只有当某行
  // 的 streaming 状态翻转时才触发该行 re-render,不会因为别的 session 变
  // 化而级联重渲。
  const isStreaming = useMessagesStore((s) => isSessionStreaming(s.bySession[item.id]));
  const totalTokens = (x.tokens?.input ?? 0) + (x.tokens?.output ?? 0) + (x.tokens?.reasoning ?? 0);
  const archived = x.time?.archived != null;

  const modelLabel = x.model?.id ?? x.model?.providerID ?? "";
  const subParts: string[] = [];
  if (x.agent) subParts.push(x.agent);
  if (modelLabel) subParts.push(modelLabel);
  const subtitle =
    subParts.length > 0
      ? subParts.join(" · ")
      : totalTokens > 0
        ? `${formatTokens(totalTokens)} tokens`
        : t("sessions.noMessages");

  const swipeRef = useRef<SwipeableMethods>(null);

  const renderRightActions = () => (
    <View style={styles.actionsWrap}>
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionRename]}
        onPress={() => {
          swipeRef.current?.close();
          onRename();
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="pencil-outline" size={16} color="#fff" />
        <Text style={styles.actionLabel}>{t("sessions.actionRename")}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionDelete]}
        onPress={() => {
          swipeRef.current?.close();
          onDelete();
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="trash-outline" size={16} color="#fff" />
        <Text style={styles.actionLabel}>{t("sessions.actionDelete")}</Text>
      </TouchableOpacity>
    </View>
  );

  const rowContent = (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.sessionRow,
        flat && styles.sessionRowFlat,
        activeRow && { backgroundColor: theme.colors.surfaceHover },
        pressed && { backgroundColor: theme.colors.surfaceHover },
      ]}
    >
      {/* 多选复选框 */}
      {editMode ? (
        <View
          style={[
            styles.checkbox,
            { borderColor: selected ? theme.colors.accent : theme.colors.border },
            selected && { backgroundColor: theme.colors.accent },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
        </View>
      ) : null}

      {/* 主体 */}
      <View style={styles.sessionBody}>
        <View style={styles.sessionTopRow}>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {title}
          </Text>
          {isStreaming ? (
            <View style={styles.runningPill}>
              <View style={styles.runningDot} />
              <Text style={styles.runningLabel}>{t("sessions.running")}</Text>
            </View>
          ) : (
            <Text style={styles.sessionTime}>{formatRelative(updated, t)}</Text>
          )}
        </View>

        <View style={styles.sessionBottomRow}>
          <Text style={styles.sessionSub} numberOfLines={1}>
            {subtitle}
          </Text>
          <View style={styles.sessionTags}>
            {archived ? (
              <Ionicons name="archive-outline" size={12} color={theme.colors.textTertiary} />
            ) : null}
            {x.cost && x.cost > 0 ? (
              <View style={styles.costBadge}>
                <Text style={styles.costText}>${x.cost.toFixed(3)}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {!isLast ? <View style={styles.rowSep} /> : null}
    </Pressable>
  );

  return (
    <View
      style={[
        styles.sessionRowOuter,
        flat && styles.sessionRowOuterFlat,
        isFirst && styles.sessionRowFirst,
        !isLast && styles.sessionRowGap,
      ]}
    >
      {editMode ? (
        rowContent
      ) : (
        <ReanimatedSwipeable
          ref={swipeRef}
          friction={2}
          rightThreshold={ACTION_WIDTH}
          renderRightActions={renderRightActions}
          overshootRight={false}
        >
          {rowContent}
        </ReanimatedSwipeable>
      )}
      {flat ? null : <View pointerEvents="none" style={styles.sessionRail} />}
    </View>
  );
}

// ── 重命名弹窗 ────────────────────────────────────────────

function RenameModal({
  theme,
  styles,
  session,
  onClose,
  onSubmit,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  session: Session | null;
  onClose: () => void;
  onSubmit: (session: Session, title: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const x = session ? asExtras(session) : null;
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (session) {
      setDraft((x?.title ?? "").trim());
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // 关闭时清空草稿,避免连续重命名两条 session 时,前一次未提交的草稿
      // 在新 session 弹窗里闪现一帧后才被新值覆盖。
      setDraft("");
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!session) return;
    onClose();
    await onSubmit(session, draft);
  };

  return (
    <Modal visible={!!session} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.renameKeyboardAvoiding}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.renameOverlay} onPress={onClose}>
          <Pressable
            style={[styles.renameBox, { backgroundColor: theme.colors.surface }]}
            onPress={() => {}}
          >
            <Text style={[styles.renameTitle, { color: theme.colors.text }]}>
              {t("sessions.renameTitle")}
            </Text>
            <TextInput
              ref={inputRef}
              style={[
                styles.renameInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.borderFocus,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
              value={draft}
              onChangeText={setDraft}
              placeholder={t("sessions.renamePlaceholder")}
              placeholderTextColor={theme.colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              keyboardAppearance={theme.isDark ? "dark" : "light"}
              cursorColor={theme.colors.accent}
              selectionColor={`${theme.colors.accent}44`}
            />
            <View style={styles.renameBtns}>
              <TouchableOpacity
                style={styles.renameBtnCancel}
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text style={[styles.renameBtnText, { color: theme.colors.textSecondary }]}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameBtnConfirm, { backgroundColor: theme.colors.accent }]}
                onPress={handleSubmit}
                activeOpacity={0.8}
              >
                <Text style={[styles.renameBtnText, { color: "#fff" }]}>{t("common.confirm")}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── 空态 ─────────────────────────────────────────────────

function EmptyState({
  theme,
  styles,
  onCreate,
}: {
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIconRing}>
        <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>{t("sessions.emptyTitle")}</Text>
      <Text style={styles.emptySubtitle}>{t("sessions.emptyDesc")}</Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onCreate} activeOpacity={0.85}>
        <Ionicons name="add" size={16} color="#FFFFFF" />
        <Text style={styles.emptyBtnText}>{t("sessions.btnNew")}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── 辅助函数 ──────────────────────────────────────────────

function sortByRecent(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));
}

// 从 listPath("") 返回的首条 entry 反推 workspace 根的绝对路径。
// entry.absolute 形如 "/workspace/root/<name>"，去掉末尾的 "/<name>"
// 即为根。与 select-directory.tsx::load 里的推断逻辑保持一致。
function inferWorkspaceRoot(entries: FileNode[]): string | null {
  if (entries.length === 0) return null;
  const first = entries[0]!;
  const tail = "/" + first.name;
  if (first.absolute.endsWith(tail)) {
    return first.absolute.slice(0, -tail.length) || null;
  }
  const idx = first.absolute.lastIndexOf("/");
  return idx > 0 ? first.absolute.slice(0, idx) : null;
}

function getUpdatedAt(session: Session): number {
  const t = asExtras(session).time;
  return t?.updated ?? t?.created ?? 0;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

function formatRelative(
  ts: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 0) return formatAbsolute(ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("sessions.timeJustNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("sessions.timeMinutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const day = Math.floor(hr / 24);
  if (day === 1) return t("sessions.timeYesterday");
  if (day < 7) return t("sessions.timeDaysAgo", { count: day });
  return formatAbsolute(ts);
}

function formatAbsolute(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}/${pad(d.getDate())}`
    : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    emptyContainer: { flex: 1 },
    listContent: { paddingBottom: 88 },

    // ── 双栏（iPad 横屏）布局 ──
    splitRoot: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
    splitSidebar: { borderRightWidth: StyleSheet.hairlineWidth },
    splitDetail: { flex: 1, backgroundColor: colors.background },
    splitEmpty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.xxl,
    },
    splitEmptyText: {
      ...typography.subheadline,
      color: colors.textTertiary,
      textAlign: "center",
    },

    // 项目为扁平一级分组；展开只插入会话，不改变项目标题的位置。
    projectSection: {
      marginTop: spacing.xs,
    },
    projectSectionFirst: {
      marginTop: spacing.lg,
    },
    projectHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: spacing.lg,
    },
    projectToggle: {
      flex: 1,
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
    },
    projectTogglePressed: {
      backgroundColor: colors.surfaceHover,
    },
    projectContent: { flex: 1, minHeight: 44, justifyContent: "center" },
    projectDisclosure: {
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    projectBody: { flex: 1, gap: 3 },
    projectTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    projectCountPill: {
      flexShrink: 0,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    projectDetailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    projectName: {
      ...typography.subheadlineEmphasized,
      color: colors.text,
      flex: 1,
    },
    projectMeta: {
      ...typography.caption1,
      color: colors.textTertiary,
      fontVariant: ["tabular-nums"],
    },
    projectPath: {
      ...typography.monoSm,
      color: colors.textTertiary,
      flex: 1,
    },
    projectLastActive: {
      ...typography.caption1,
      color: colors.textSecondary,
      flexShrink: 0,
      marginLeft: "auto",
    },
    projectAction: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      alignSelf: "center",
      marginRight: spacing.xs,
    },

    // 加载态复用真实列表的项目层级与会话导轨，避免通用骨架与实际内容跳变。
    sessionsSkeleton: { paddingBottom: spacing.xxl },
    sessionsSkeletonProject: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xs,
      minHeight: 64,
      paddingHorizontal: spacing.xs,
    },
    sessionsSkeletonProjectFirst: { marginTop: spacing.lg },
    sessionsSkeletonProjectLines: { flex: 1, gap: spacing.xs },
    sessionsSkeletonRows: {
      marginRight: spacing.lg,
    },
    sessionsSkeletonRow: {
      marginLeft: spacing.xxl,
      minHeight: 64,
      paddingLeft: spacing.lg + SESSION_RAIL_WIDTH,
      paddingRight: spacing.lg,
      paddingVertical: spacing.sm,
      position: "relative",
    },
    sessionsSkeletonRail: {
      backgroundColor: colors.border,
      bottom: spacing.sm,
      left: 0,
      position: "absolute",
      top: spacing.sm,
      width: SESSION_RAIL_WIDTH,
    },
    sessionsSkeletonRowGap: { marginBottom: spacing.xs },
    sessionsSkeletonRowLines: { flex: 1, gap: spacing.sm },
    sessionsSkeletonTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },

    // 会话列表行容器
    sessionRowOuter: {
      marginLeft: spacing.xxl,
      marginRight: spacing.lg,
      position: "relative",
    },
    // 扁平模式：去掉项目层级缩进与右侧 margin，与普通列表行一致
    sessionRowOuterFlat: {
      marginLeft: 0,
      marginRight: 0,
    },
    sessionRowFirst: {
      marginTop: spacing.sm,
    },
    // 将每条会话的导轨断开，保留层级而不形成一整根连续竖线。
    sessionRowGap: { marginBottom: spacing.xs },
    sessionRail: {
      backgroundColor: colors.border,
      bottom: spacing.sm,
      left: 0,
      position: "absolute",
      top: spacing.sm,
      width: SESSION_RAIL_WIDTH,
    },
    // 前景滑动行
    sessionRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radius.sm,
      overflow: "hidden",
      paddingLeft: spacing.lg + SESSION_RAIL_WIDTH,
      paddingRight: spacing.lg,
      minHeight: 64,
      paddingVertical: spacing.sm,
      gap: spacing.md,
      backgroundColor: colors.background,
      position: "relative",
    },
    // 扁平模式：去掉为左侧竖线预留的 paddingLeft
    sessionRowFlat: {
      paddingLeft: spacing.lg,
    },
    rowSep: {
      position: "absolute",
      height: StyleSheet.hairlineWidth,
      bottom: 0,
      left: spacing.md,
      right: 0,
      backgroundColor: colors.separator,
    },
    // 操作按钮层（跟随 Swipeable renderRightActions）
    actionsWrap: {
      flexDirection: "row",
      width: ACTION_WIDTH * 2,
    },
    actionBtn: {
      width: ACTION_WIDTH,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    actionRename: {
      backgroundColor: colors.accent,
    },
    actionDelete: {
      backgroundColor: colors.destructive,
    },
    actionLabel: {
      color: "#fff",
      fontSize: 11,
      fontWeight: "600",
    },

    // 会话正文
    sessionBody: { flex: 1, gap: 3 },
    sessionTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    sessionTitle: {
      ...typography.subheadline,
      color: colors.text,
      flex: 1,
    },
    sessionTime: {
      ...typography.caption1,
      color: colors.textTertiary,
      flexShrink: 0,
    },
    // 会话正在生成回复：绿色圆点 + 「生成中」文字，替换时间戳位置
    runningPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      flexShrink: 0,
    },
    runningDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    runningLabel: {
      ...typography.caption1,
      color: colors.success,
      fontWeight: "600",
    },
    sessionBottomRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    sessionSub: {
      ...typography.footnote,
      color: colors.textTertiary,
      flex: 1,
    },
    sessionTags: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    costBadge: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.xs,
      paddingHorizontal: spacing.xs,
      paddingVertical: 1,
    },
    costText: {
      ...typography.caption2,
      color: colors.textTertiary,
    },

    // 空态
    loadingBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingTop: 80,
    },
    loadingText: {
      ...typography.footnote,
      color: colors.textTertiary,
    },
    emptyBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.xxxl,
      paddingTop: 40,
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
    emptySubtitle: {
      ...typography.subheadline,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 22,
    },
    emptyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: colors.accent,
      borderRadius: radius.full,
      paddingVertical: 11,
      paddingHorizontal: spacing.xl,
      marginTop: spacing.sm,
    },
    emptyBtnText: {
      ...typography.subheadlineEmphasized,
      color: "#FFFFFF",
    },

    // 错误 Toast
    errorToast: {
      position: "absolute",
      bottom: 100,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.card,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.destructiveMuted,
      shadowColor: colors.shadow,
      shadowOpacity: 1,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      elevation: 4,
    },
    errorToastText: {
      ...typography.footnote,
      color: colors.destructive,
      flex: 1,
    },
    retryText: {
      ...typography.footnoteEmphasized,
      color: colors.accent,
    },

    // FAB
    fab: {
      position: "absolute",
      right: spacing.xl,
      bottom: spacing.xl + 4,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.accent,
      shadowOpacity: theme.isDark ? 0.5 : 0.35,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 16,
      elevation: 8,
    },

    // 列表头：会话计数 + 编辑按钮
    listHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    listHeaderCount: {
      ...typography.caption1,
      color: colors.textTertiary,
    },
    listHeaderAction: {
      ...typography.subheadlineEmphasized,
    },

    // 复选框
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center",
    },

    // 批量操作底部栏
    bulkBar: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      paddingBottom: spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: spacing.md,
    },
    bulkBarBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    bulkBarLabel: {
      ...typography.subheadline,
    },
    bulkDeleteBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      paddingVertical: 11,
    },
    bulkDeleteText: {
      ...typography.subheadlineEmphasized,
    },

    // 重命名弹窗
    renameKeyboardAvoiding: { flex: 1 },
    renameOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
    },
    renameBox: {
      width: "100%",
      borderRadius: radius.card,
      padding: spacing.lg,
      gap: spacing.md,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 24,
      elevation: 12,
    },
    renameTitle: {
      ...typography.headline,
    },
    renameInput: {
      ...typography.body,
      borderWidth: 1.5,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
    },
    renameBtns: {
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "flex-end",
    },
    renameBtnCancel: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 9,
      borderRadius: radius.full,
    },
    renameBtnConfirm: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 9,
      borderRadius: radius.full,
    },
    renameBtnText: {
      ...typography.subheadlineEmphasized,
    },
  });
}
