import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { rejectQuestion, replyQuestion } from "../api/client";
import { toClientConfig, useConnectionStore } from "../store/connection";
import { useQuestionStore, type QuestionInfo, type QuestionRequest } from "../store/questions";
import { useSessionsStore } from "../store/sessions";
import { useTheme, type Theme } from "../theme";

export function QuestionBanner({ sessionID }: { sessionID: string }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const allPending = useQuestionStore((s) => s.pending);
  const remove = useQuestionStore((s) => s.remove);
  const active = useConnectionStore((s) => s.active);
  const session = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionID));
  const [busy, setBusy] = useState<string | null>(null);

  const pending = useMemo(
    () => allPending.filter((p) => p.sessionID === sessionID),
    [allPending, sessionID],
  );

  if (pending.length === 0) return null;

  const handleReply = async (req: QuestionRequest, answers: string[][]) => {
    if (!active) return;
    setBusy(req.id);
    try {
      await replyQuestion(
        toClientConfig(active, session?.directory),
        req.sessionID,
        req.id,
        answers,
      );
      remove(req.id);
    } catch (err) {
      console.warn("question reply failed", err);
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (req: QuestionRequest) => {
    if (!active) return;
    setBusy(req.id);
    try {
      await rejectQuestion(toClientConfig(active, session?.directory), req.sessionID, req.id);
      remove(req.id);
    } catch (err) {
      console.warn("question reject failed", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      {pending.map((req) => (
        <QuestionCard
          key={req.id}
          req={req}
          busy={busy === req.id}
          theme={theme}
          styles={styles}
          onReply={(answers) => handleReply(req, answers)}
          onReject={() => handleReject(req)}
        />
      ))}
    </View>
  );
}

function QuestionCard({
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
  onReply: (answers: string[][]) => void;
  onReject: () => void;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  // answers[questionIdx] = selected option labels
  const [answers, setAnswers] = useState<string[][]>(() => req.questions.map(() => []));
  const [customText, setCustomText] = useState<string[]>(() => req.questions.map(() => ""));
  const [customMode, setCustomMode] = useState<boolean[]>(() => req.questions.map(() => false));

  const question: QuestionInfo = req.questions[currentIdx];
  const isLast = currentIdx === req.questions.length - 1;
  const isMultiple = question.multiple ?? false;
  const allowCustom = question.custom !== false;
  const currentAnswers = answers[currentIdx];
  const isCustom = customMode[currentIdx];

  const toggleOption = (label: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      const cur = next[currentIdx];
      if (isMultiple) {
        next[currentIdx] = cur.includes(label) ? cur.filter((a) => a !== label) : [...cur, label];
      } else {
        next[currentIdx] = cur[0] === label ? [] : [label];
      }
      return next;
    });
    setCustomMode((prev) => {
      const next = [...prev];
      next[currentIdx] = false;
      return next;
    });
  };

  const enterCustom = () => {
    setCustomMode((prev) => {
      const next = [...prev];
      next[currentIdx] = true;
      return next;
    });
    setAnswers((prev) => {
      const next = [...prev];
      next[currentIdx] = [];
      return next;
    });
  };

  const setCustomValue = (text: string) => {
    setCustomText((prev) => {
      const next = [...prev];
      next[currentIdx] = text;
      return next;
    });
  };

  const currentIsAnswered = isCustom
    ? customText[currentIdx].trim().length > 0
    : currentAnswers.length > 0;

  const goNext = () => {
    // 如果是自定义模式，把 customText 写入 answers
    if (isCustom && customText[currentIdx].trim()) {
      setAnswers((prev) => {
        const next = [...prev];
        next[currentIdx] = [customText[currentIdx].trim()];
        return next;
      });
    }
    if (isLast) {
      // 最后一题，提交
      const finalAnswers = answers.map((a, i) => {
        if (customMode[i] && customText[i].trim()) return [customText[i].trim()];
        return a;
      });
      onReply(finalAnswers);
    } else {
      setCurrentIdx((i) => i + 1);
    }
  };

  return (
    <View style={styles.card}>
      {/* 标题栏 */}
      <View style={styles.titleRow}>
        <View style={styles.titleIcon}>
          <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.colors.accent} />
        </View>
        <Text style={styles.titleText}>AI 需要你的回答</Text>
        {req.questions.length > 1 && (
          <View style={styles.progressBadge}>
            <Text style={styles.progressText}>
              {currentIdx + 1} / {req.questions.length}
            </Text>
          </View>
        )}
      </View>

      {/* 问题文本 */}
      <Text style={styles.questionText}>{question.question}</Text>

      {/* 选项列表 */}
      {!isCustom && (
        <View style={styles.optionList}>
          {question.options.map((opt) => {
            const selected = currentAnswers.includes(opt.label);
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                onPress={() => toggleOption(opt.label)}
                activeOpacity={0.7}
              >
                <View style={[styles.optionCheck, selected && styles.optionCheckSelected]}>
                  {selected && (
                    <Ionicons name={isMultiple ? "checkmark" : "ellipse"} size={10} color="#fff" />
                  )}
                </View>
                <View style={styles.optionContent}>
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                    {opt.label}
                  </Text>
                  {opt.description ? (
                    <Text style={styles.optionDesc} numberOfLines={2}>
                      {opt.description}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}

          {allowCustom && (
            <TouchableOpacity style={styles.customBtn} onPress={enterCustom} activeOpacity={0.7}>
              <Ionicons name="pencil-outline" size={13} color={theme.colors.textTertiary} />
              <Text style={styles.customBtnText}>自定义回答…</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 自定义输入 */}
      {isCustom && (
        <View style={styles.customInputWrapper}>
          <TextInput
            style={styles.customInput}
            value={customText[currentIdx]}
            onChangeText={setCustomValue}
            placeholder="输入你的回答…"
            placeholderTextColor={theme.colors.textTertiary}
            keyboardAppearance={theme.isDark ? "dark" : "light"}
            multiline
            autoFocus
          />
          <TouchableOpacity
            style={styles.customBack}
            onPress={() => {
              setCustomMode((prev) => {
                const next = [...prev];
                next[currentIdx] = false;
                return next;
              });
            }}
          >
            <Text style={styles.customBackText}>返回选项</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 底部按钮 */}
      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.busyText}>处理中…</Text>
        </View>
      ) : (
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnReject]}
            onPress={onReject}
            activeOpacity={0.75}
          >
            <Ionicons name="close" size={13} color={theme.colors.destructive} />
            <Text style={[styles.btnText, styles.btnTextReject]}>跳过</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnConfirm, !currentIsAnswered && styles.btnDisabled]}
            onPress={currentIsAnswered ? goNext : undefined}
            activeOpacity={currentIsAnswered ? 0.75 : 1}
          >
            <Text style={[styles.btnText, styles.btnTextConfirm]}>
              {isLast ? "提交" : "下一题"}
            </Text>
            <Ionicons name={isLast ? "checkmark" : "arrow-forward"} size={13} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* 多问题进度点 */}
      {req.questions.length > 1 && (
        <View style={styles.dots}>
          {req.questions.map((_, i) => (
            <View key={i} style={[styles.dot, i === currentIdx && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    container: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      padding: spacing.md,
      gap: spacing.sm,
      shadowColor: colors.shadow,
      shadowOpacity: 0.5,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 8,
      elevation: 2,
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
      backgroundColor: colors.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
    },
    titleText: {
      ...typography.footnoteEmphasized,
      color: colors.text,
      flex: 1,
    },
    progressBadge: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    progressText: {
      ...typography.caption2,
      color: colors.textTertiary,
    },

    questionText: {
      ...typography.body,
      color: colors.text,
      lineHeight: 22,
    },

    optionList: {
      gap: spacing.xs,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    optionRowSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceElevated,
    },
    optionCheck: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    optionCheckSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    optionContent: {
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
    },

    customBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    customBtnText: {
      ...typography.footnote,
      color: colors.textTertiary,
    },

    customInputWrapper: {
      gap: spacing.xs,
    },
    customInput: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      borderRadius: radius.sm,
      padding: spacing.sm,
      minHeight: 80,
      ...typography.footnote,
      color: colors.text,
      textAlignVertical: "top",
    },
    customBack: {
      alignSelf: "flex-start",
    },
    customBackText: {
      ...typography.caption1,
      color: colors.textTertiary,
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
      borderRadius: radius.sm,
    },
    btnReject: {
      backgroundColor: "transparent",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.destructive,
    },
    btnConfirm: {
      backgroundColor: colors.accent,
    },
    btnDisabled: {
      opacity: 0.4,
    },
    btnText: {
      fontSize: 13,
      fontWeight: "600",
      letterSpacing: -0.1,
    },
    btnTextReject: { color: colors.destructive },
    btnTextConfirm: { color: "#fff" },

    dots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 5,
      marginTop: spacing.xs,
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.border,
    },
    dotActive: {
      backgroundColor: colors.accent,
    },
  });
}
