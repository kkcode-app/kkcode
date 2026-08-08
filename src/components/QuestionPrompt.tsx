// QuestionPrompt — AI 提问时替换输入框的交互组件
//
// 设计原则：
// 1. 占据 InputBar 的位置（替换，不叠加），让用户明确感知"AI 在等待我的回答"
// 2. 多问题时分步展示，进度可见
// 3. 单选/多选/自定义文本三种模式，对应 opencode question.v2 协议
// 4. 提交调用 /api/session/:id/question/:reqID/reply，跳过调用 /reject

import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

import { rejectQuestion, replyQuestion, HttpError } from "../api/client";
import { trackEvent, AnalyticsEvents as Ev } from "../services/analytics";
import { haptic } from "../utils/haptics";
import { toClientConfig, useConnectionStore } from "../store/connection";
import { useQuestionStore, type QuestionInfo, type QuestionRequest } from "../store/questions";
import { useSessionsStore } from "../store/sessions";
import { useTheme, type Theme } from "../theme";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ── 公开接口 ──────────────────────────────────────────────

export function useHasPendingQuestion(sessionID: string): boolean {
  const pending = useQuestionStore((s) => s.pending);
  return pending.some((p) => p.sessionID === sessionID);
}

export function QuestionPrompt({ sessionID }: { sessionID: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const pending = useQuestionStore((s) => s.pending);
  const remove = useQuestionStore((s) => s.remove);
  const active = useConnectionStore((s) => s.active);
  const sessions = useSessionsStore((s) => s.sessions);

  const req = pending.find((p) => p.sessionID === sessionID);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  if (!req) return null;

  const handleReply = async (answers: string[][]) => {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // Use the session's own directory so WorkspaceRoutingMiddleware routes
    // to the correct instance where the question is registered.
    const session = sessions.find((s) => s.id === req.sessionID);
    const config = toClientConfig(active, session?.directory);
    try {
      await replyQuestion(config, req.sessionID, req.id, answers);
      haptic.success();
      remove(req.id);
      trackEvent(Ev.QuestionReplySubmit, {
        count: req.questions.length,
        has_custom: req.questions.some((q) => q.custom !== false) ? "1" : "0",
      });
    } catch (err) {
      // 404 表示服务端问题已过期或被清除，直接移除本地记录
      if (err instanceof HttpError && err.status === 404) {
        remove(req.id);
      } else {
        haptic.error();
        console.warn("question reply failed", err);
        Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const session = sessions.find((s) => s.id === req.sessionID);
    const config = toClientConfig(active, session?.directory);
    try {
      await rejectQuestion(config, req.sessionID, req.id);
      remove(req.id);
      trackEvent(Ev.QuestionReject, { count: req.questions.length });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        remove(req.id);
      } else {
        haptic.error();
        console.warn("question reject failed", err);
        Alert.alert(t("common.error"), err instanceof Error ? err.message : String(err));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <QuestionForm
      key={req.id}
      req={req}
      busy={busy}
      theme={theme}
      styles={styles}
      onReply={handleReply}
      onReject={handleReject}
    />
  );
}

// ── 表单主体 ──────────────────────────────────────────────

type Answers = string[][]; // answers[questionIdx] = 选中的 label 数组

function QuestionForm({
  req,
  busy,
  theme,
  styles,
  onReply,
  onReject,
}: {
  req: QuestionRequest;
  busy: boolean;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onReply: (answers: Answers) => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const total = req.questions.length;
  const [idx, setIdx] = useState(0);

  // 每道题独立的状态
  const [selected, setSelected] = useState<string[][]>(() => req.questions.map(() => []));
  const [customText, setCustomText] = useState<string[]>(() => req.questions.map(() => ""));
  const [isCustom, setIsCustom] = useState<boolean[]>(() => req.questions.map(() => false));

  const inputRef = useRef<TextInput>(null);

  const q: QuestionInfo | undefined = req.questions[idx] ?? req.questions[0];
  if (!q) return null;
  const multiple = q.multiple ?? false;
  const allowCustom = q.custom !== false;
  const curSelected = selected[idx];
  const curCustom = isCustom[idx];
  const curCustomText = customText[idx];

  // 当前题是否已作答
  const answered = curCustom ? curCustomText.trim().length > 0 : curSelected.length > 0;

  // 切换选项（单选时选中即替换，多选时 toggle）
  const toggleOption = (label: string) => {
    setIsCustom((prev) => {
      const n = [...prev];
      n[idx] = false;
      return n;
    });
    setSelected((prev) => {
      const n = [...prev];
      if (multiple) {
        n[idx] = n[idx].includes(label) ? n[idx].filter((l) => l !== label) : [...n[idx], label];
      } else {
        n[idx] = n[idx][0] === label ? [] : [label];
      }
      return n;
    });
  };

  const enterCustom = () => {
    setSelected((prev) => {
      const n = [...prev];
      n[idx] = [];
      return n;
    });
    setIsCustom((prev) => {
      const n = [...prev];
      n[idx] = true;
      return n;
    });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const exitCustom = () => {
    setIsCustom((prev) => {
      const n = [...prev];
      n[idx] = false;
      return n;
    });
  };

  const setCustom = (text: string) => {
    setCustomText((prev) => {
      const n = [...prev];
      n[idx] = text;
      return n;
    });
  };

  // 把当前题的草稿同步进 answers，然后前进或提交
  const commit = (): Answers => {
    return selected.map((sel, i) => {
      if (isCustom[i] && customText[i].trim()) return [customText[i].trim()];
      return sel;
    });
  };

  const goNext = () => {
    // 把自定义文本写入 selected（方便后续 commit）
    if (curCustom && curCustomText.trim()) {
      setSelected((prev) => {
        const n = [...prev];
        n[idx] = [curCustomText.trim()];
        return n;
      });
    }
    if (idx < total - 1) {
      setIdx(idx + 1);
    } else {
      onReply(commit());
    }
  };

  const goBack = () => {
    if (idx > 0) setIdx(idx - 1);
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingLeft: theme.spacing.md + insets.left,
          paddingRight: theme.spacing.md + insets.right,
        },
      ]}
    >
      {/* 顶部：标题 + 进度 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name="chatbubble-ellipses" size={13} color={theme.colors.accent} />
          </View>
          <Text style={styles.headerTitle}>{t("question.headerTitle")}</Text>
        </View>
        {total > 1 && (
          <View style={styles.progressRow}>
            {req.questions.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i === idx && styles.progressDotActive,
                  i < idx && styles.progressDotDone,
                ]}
              />
            ))}
          </View>
        )}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onReject}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          accessibilityState={{ disabled: busy }}
        >
          <Ionicons name="close" size={18} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      </View>

      {/* 问题文本 */}
      <Text style={styles.question}>{q.question}</Text>

      {/* 选项区域 */}
      <ScrollView
        style={[styles.optionsScroll, { maxHeight: windowHeight * 0.4 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 预设选项 */}
        {!curCustom &&
          q.options.map((opt) => {
            const sel = curSelected.includes(opt.label);
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.option, sel && styles.optionSelected]}
                onPress={() => toggleOption(opt.label)}
                disabled={busy}
                activeOpacity={0.7}
                accessibilityRole={multiple ? "checkbox" : "radio"}
                accessibilityState={{ checked: sel, disabled: busy }}
              >
                <View style={[styles.optionIndicator, sel && styles.optionIndicatorSelected]}>
                  {sel && (
                    <Ionicons name={multiple ? "checkmark" : "ellipse"} size={9} color="#fff" />
                  )}
                </View>
                <View style={styles.optionBody}>
                  <Text style={[styles.optionLabel, sel && styles.optionLabelSelected]}>
                    {opt.label}
                  </Text>
                  {opt.description ? (
                    <Text style={styles.optionDesc}>{opt.description}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}

        {/* 自定义文本输入 */}
        {curCustom && (
          <View style={styles.customBox}>
            <TextInput
              ref={inputRef}
              style={styles.customInput}
              value={curCustomText}
              onChangeText={setCustom}
              placeholder={t("question.placeholder")}
              placeholderTextColor={theme.colors.textTertiary}
              keyboardAppearance={theme.isDark ? "dark" : "light"}
              multiline
              autoFocus
              editable={!busy}
            />
            <TouchableOpacity
              style={styles.customBackBtn}
              onPress={exitCustom}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t("question.backToOptions")}
              accessibilityState={{ disabled: busy }}
            >
              <Ionicons name="arrow-back" size={12} color={theme.colors.textTertiary} />
              <Text style={styles.customBackText}>{t("question.backToOptions")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 自定义输入入口 */}
        {!curCustom && allowCustom && (
          <TouchableOpacity
            style={styles.customEntry}
            onPress={enterCustom}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t("question.customAnswer")}
            accessibilityState={{ disabled: busy }}
          >
            <Ionicons name="pencil-outline" size={13} color={theme.colors.textTertiary} />
            <Text style={styles.customEntryText}>{t("question.customAnswer")}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 底部操作栏 */}
      <View style={styles.footer}>
        {idx > 0 ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={goBack}
            disabled={busy}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            accessibilityState={{ disabled: busy }}
          >
            <Ionicons name="chevron-back" size={15} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}

        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.accent} style={styles.spinner} />
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, !answered && styles.submitBtnDisabled]}
            onPress={answered ? goNext : undefined}
            activeOpacity={answered ? 0.8 : 1}
            accessibilityRole="button"
            accessibilityState={{ disabled: !answered }}
          >
            <Text style={styles.submitBtnText}>
              {idx < total - 1 ? t("question.nextQuestion") : t("question.submit")}
            </Text>
            <Ionicons
              name={idx < total - 1 ? "arrow-forward" : "checkmark"}
              size={14}
              color="#fff"
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── 样式 ──────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },

    // 顶部标题行
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flex: 1,
    },
    headerIcon: {
      width: 22,
      height: 22,
      borderRadius: radius.xs,
      backgroundColor: colors.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      ...typography.footnoteEmphasized,
      color: colors.text,
    },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    progressDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.border,
    },
    progressDotActive: {
      backgroundColor: colors.accent,
      width: 14,
      borderRadius: 3,
    },
    progressDotDone: {
      backgroundColor: colors.accent,
      opacity: 0.4,
    },
    closeBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      marginVertical: -11,
      marginRight: -11,
    },

    // 问题文本
    question: {
      ...typography.body,
      color: colors.text,
      lineHeight: 22,
    },

    // 选项滚动区：按屏幕高度自适应，给长选项/长描述留足展示空间
    optionsScroll: {
      flexGrow: 0,
    },

    // 选项行
    option: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: spacing.xs,
      backgroundColor: colors.background,
      minHeight: 44,
    },
    optionSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceElevated,
    },
    optionIndicator: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
      flexShrink: 0,
    },
    optionIndicatorSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    optionBody: {
      flex: 1,
      gap: 2,
    },
    optionLabel: {
      ...typography.footnoteEmphasized,
      color: colors.text,
    },
    optionLabelSelected: {
      color: colors.accent,
    },
    optionDesc: {
      ...typography.caption1,
      color: colors.textTertiary,
      lineHeight: 16,
    },

    // 自定义输入
    customBox: {
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
    customInput: {
      borderWidth: 1,
      borderColor: colors.accent,
      borderRadius: radius.sm,
      padding: spacing.sm,
      minHeight: 72,
      ...typography.footnote,
      color: colors.text,
      textAlignVertical: "top",
    },
    customBackBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      alignSelf: "flex-start",
      minHeight: 44,
    },
    customBackText: {
      ...typography.caption1,
      color: colors.textTertiary,
    },
    customEntry: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      marginTop: 2,
      minHeight: 44,
    },
    customEntryText: {
      ...typography.footnote,
      color: colors.textTertiary,
    },

    // 底部操作
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    backBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    submitBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      paddingVertical: 10,
      minHeight: 44,
    },
    submitBtnDisabled: {
      opacity: 0.35,
    },
    submitBtnText: {
      ...typography.footnoteEmphasized,
      color: "#fff",
    },
    spinner: {
      flex: 1,
    },
  });
}
