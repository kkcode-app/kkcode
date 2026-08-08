/**
 * [INPUT]: 依赖 ToolPart/ToolState 工具数据、主题与国际化能力，以及 BottomSheet/DiffViewer 展示组件与 utils/ansi 的 SGR 解析器
 * [OUTPUT]: 对外提供 ToolDetailModal 工具详情弹层、getToolMeta 工具元数据查询函数，以及内置的 AnsiText ANSI 着色渲染器；Question 历史详情同时展示用户回答、原始可选项与已选状态
 * [POS]: components 的工具调用详情渲染器，由 PartView 打开并统一通过 BottomSheet 下拉关闭；AnsiText 被 ScrollableCode 与 CodeBox 全屏 Modal 复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type TextStyle,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import type { ToolPart, ToolState } from "@opencode-ai/sdk/v2";
import { useTheme, type Theme } from "../theme";
import { BottomSheet } from "./BottomSheet";
import { DiffViewer } from "./DiffViewer";
import { useTranslation } from "react-i18next";
import { ansiColorToHex, parseAnsi } from "../utils/ansi";

// ── 工具元数据 ────────────────────────────────────────────

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

type QuestionDetail = {
  question?: string;
  header?: string;
  options?: { label?: string; description?: string }[];
};

type ToolMeta = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  label: string;
  description: string;
};

const TOOL_COLORS: Record<string, string> = {
  bash: "#3178C6",
  read: "#10B981",
  edit: "#F59E0B",
  write: "#8B5CF6",
  glob: "#06B6D4",
  grep: "#EC4899",
  webfetch: "#6366F1",
  websearch: "#14B8A6",
  task: "#F97316",
  todowrite: "#84CC16",
  question: "#EAB308",
  lsp: "#0EA5E9",
  apply_patch: "#A78BFA",
  skill: "#34D399",
  plan_exit: "#FB7185",
  default: "#64748B",
};

const TOOL_META: Record<string, ToolMeta> = {
  bash: {
    icon: "terminal-outline",
    color: TOOL_COLORS.bash,
    label: "tool.labelShell",
    description: "tool.descShell",
  },
  read: {
    icon: "document-text-outline",
    color: TOOL_COLORS.read,
    label: "tool.labelRead",
    description: "tool.descRead",
  },
  edit: {
    icon: "create-outline",
    color: TOOL_COLORS.edit,
    label: "tool.labelEdit",
    description: "tool.descEdit",
  },
  write: {
    icon: "save-outline",
    color: TOOL_COLORS.write,
    label: "tool.labelWrite",
    description: "tool.descWrite",
  },
  glob: {
    icon: "search-circle-outline",
    color: TOOL_COLORS.glob,
    label: "tool.labelGlob",
    description: "tool.descGlob",
  },
  grep: {
    icon: "code-slash-outline",
    color: TOOL_COLORS.grep,
    label: "tool.labelGrep",
    description: "tool.descGrep",
  },
  webfetch: {
    icon: "globe-outline",
    color: TOOL_COLORS.webfetch,
    label: "tool.labelFetch",
    description: "tool.descFetch",
  },
  websearch: {
    icon: "search-outline",
    color: TOOL_COLORS.websearch,
    label: "tool.labelSearch",
    description: "tool.descSearch",
  },
  task: {
    icon: "git-branch-outline",
    color: TOOL_COLORS.task,
    label: "tool.labelAgent",
    description: "tool.descAgent",
  },
  todowrite: {
    icon: "checkbox-outline",
    color: TOOL_COLORS.todowrite,
    label: "tool.labelTodo",
    description: "tool.descTodo",
  },
  question: {
    icon: "chatbubble-ellipses-outline",
    color: TOOL_COLORS.question,
    label: "tool.labelQuestion",
    description: "tool.descQuestion",
  },
  lsp: {
    icon: "analytics-outline",
    color: TOOL_COLORS.lsp,
    label: "tool.labelLsp",
    description: "tool.descLsp",
  },
  apply_patch: {
    icon: "git-compare-outline",
    color: TOOL_COLORS.apply_patch,
    label: "tool.labelPatch",
    description: "tool.descPatch",
  },
  skill: {
    icon: "library-outline",
    color: TOOL_COLORS.skill,
    label: "tool.labelSkill",
    description: "tool.descSkill",
  },
  plan_exit: {
    icon: "exit-outline",
    color: TOOL_COLORS.plan_exit,
    label: "tool.labelPlan",
    description: "tool.descPlan",
  },
};

export function getToolMeta(toolName: string): ToolMeta {
  return (
    TOOL_META[toolName] ?? {
      icon: "cube-outline",
      color: TOOL_COLORS.default,
      label: toolName,
      description: "tool.descCustom",
    }
  );
}

// ── 弹窗入口 ──────────────────────────────────────────────

interface ToolDetailModalProps {
  visible: boolean;
  part: ToolPart;
  onClose: () => void;
  onNavigateToSession?: (sessionId: string) => void;
}

export function ToolDetailModal({
  visible,
  part,
  onClose,
  onNavigateToSession,
}: ToolDetailModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const meta = getToolMeta(part.tool);
  const state = part.state;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      contentContainerStyle={styles.scrollContent}
      header={
        <>
          {/* 头部 */}
          <View style={styles.header}>
            <View style={[styles.iconBox, { backgroundColor: `${meta.color}18` }]}>
              <Ionicons name={meta.icon} size={22} color={meta.color} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.toolLabel}>{t(meta.label)}</Text>
              <Text style={styles.toolId} numberOfLines={1}>
                {part.tool}
              </Text>
            </View>
            <StatusChip state={state} theme={theme} styles={styles} />
          </View>

          {/* 工具描述 */}
          <Text style={styles.toolDesc}>{t(meta.description)}</Text>
        </>
      }
    >
      <ToolDetailBody
        part={part}
        theme={theme}
        styles={styles}
        onNavigateToSession={onNavigateToSession}
      />
    </BottomSheet>
  );
}

// ── 状态徽章 ─────────────────────────────────────────────

function StatusChip({
  state,
  theme,
  styles,
}: {
  state: ToolState;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  const STATUS_MAP = {
    completed: {
      icon: "checkmark-circle" as const,
      label: t("tool.statusCompleted"),
      color: theme.colors.success,
    },
    error: {
      icon: "close-circle" as const,
      label: t("tool.statusError"),
      color: theme.colors.destructive,
    },
    running: { icon: "time" as const, label: t("tool.statusRunning"), color: theme.colors.warning },
    pending: {
      icon: "ellipse" as const,
      label: t("tool.statusPending"),
      color: theme.colors.textTertiary,
    },
  };
  const s = STATUS_MAP[state.status] ?? STATUS_MAP.pending;

  return (
    <View style={[styles.statusChip, { borderColor: s.color }]}>
      <Ionicons name={s.icon} size={11} color={s.color} />
      <Text style={[styles.statusChipText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

// ── 按工具类型渲染详情 ────────────────────────────────────

function ToolDetailBody({
  part,
  theme,
  styles,
  onNavigateToSession,
}: {
  part: ToolPart;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  onNavigateToSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const state = part.state;
  const input = state.input ?? {};
  const toolName = part.tool;
  const output = "output" in state ? state.output : undefined;
  const metadata = (state as { metadata?: Record<string, unknown> }).metadata ?? {};

  const inputSection = renderToolInput(toolName, input, metadata, output, theme, styles, t);
  const timeSection = renderTimings(state, theme, styles, t);
  const outputSection = renderOutput(state, theme, styles, t, toolName, onNavigateToSession);

  return (
    <>
      {inputSection}
      {outputSection}
      {timeSection}
    </>
  );
}

// ── 工具专属输入渲染 ─────────────────────────────────────

function renderToolInput(
  tool: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  output: string | undefined,
  theme: Theme,
  styles: ReturnType<typeof makeStyles>,
  t: TFunc,
): React.ReactElement | null {
  switch (tool) {
    case "bash":
      return (
        <Section
          title={t("tool.sectionCommand")}
          icon="terminal-outline"
          theme={theme}
          styles={styles}
        >
          {input.description ? (
            <InfoRow
              label={t("tool.labelDescription")}
              value={String(input.description)}
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.workdir ? (
            <InfoRow
              label={t("tool.labelDir")}
              value={String(input.workdir)}
              mono
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.timeout ? (
            <InfoRow
              label={t("tool.labelTimeout")}
              value={`${Number(input.timeout) / 1000}s`}
              theme={theme}
              styles={styles}
            />
          ) : null}
          <CodeBox
            label="command"
            text={String(input.command ?? "")}
            theme={theme}
            styles={styles}
          />
        </Section>
      );

    case "read":
      return (
        <Section
          title={t("tool.sectionReadTarget")}
          icon="document-text-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelPath")}
            value={String(input.filePath ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
          {input.offset != null ? (
            <InfoRow
              label={t("tool.labelStartLine")}
              value={String(input.offset)}
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.limit != null ? (
            <InfoRow
              label={t("tool.labelMaxLines")}
              value={String(input.limit)}
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "edit": {
      // 后端 filediff 是整文件级统计，传给 DiffViewer 让 header 与外层徽章一致
      const fd = metadata.filediff as { additions?: number; deletions?: number } | undefined;
      return (
        <Section title={t("tool.sectionEdit")} icon="create-outline" theme={theme} styles={styles}>
          <InfoRow
            label={t("tool.labelFile")}
            value={String(input.filePath ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
          {input.replaceAll ? (
            <InfoRow
              label={t("tool.labelReplaceAll")}
              value={t("tool.yes")}
              theme={theme}
              styles={styles}
            />
          ) : null}
          <DiffViewer
            oldText={String(input.oldString ?? "")}
            newText={String(input.newString ?? "")}
            filePath={String(input.filePath ?? "")}
            additions={fd?.additions}
            deletions={fd?.deletions}
          />
        </Section>
      );
    }

    case "write":
      return (
        <Section title={t("tool.sectionWrite")} icon="save-outline" theme={theme} styles={styles}>
          <InfoRow
            label={t("tool.labelPath")}
            value={String(input.filePath ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
          <CodeBox
            label="content"
            text={String(input.content ?? "")}
            theme={theme}
            styles={styles}
          />
        </Section>
      );

    case "glob":
      return (
        <Section
          title={t("tool.sectionSearchParams")}
          icon="search-circle-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelPattern")}
            value={String(input.pattern ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
          {input.path ? (
            <InfoRow
              label={t("tool.labelDir")}
              value={String(input.path)}
              mono
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "grep":
      return (
        <Section
          title={t("tool.sectionSearchParams")}
          icon="code-slash-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelRegex")}
            value={String(input.pattern ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
          {input.path ? (
            <InfoRow
              label={t("tool.labelPath")}
              value={String(input.path)}
              mono
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.include ? (
            <InfoRow
              label={t("tool.labelInclude")}
              value={String(input.include)}
              mono
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "webfetch":
      return (
        <Section
          title={t("tool.sectionRequest")}
          icon="globe-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow label="URL" value={String(input.url ?? "")} mono theme={theme} styles={styles} />
          {input.format ? (
            <InfoRow
              label={t("tool.labelFormat")}
              value={String(input.format)}
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.timeout != null ? (
            <InfoRow
              label={t("tool.labelTimeout")}
              value={`${input.timeout}s`}
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "websearch":
      return (
        <Section
          title={t("tool.sectionSearchParams")}
          icon="search-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelQuery")}
            value={String(input.query ?? "")}
            theme={theme}
            styles={styles}
          />
          {input.numResults != null ? (
            <InfoRow
              label={t("tool.labelResults")}
              value={String(input.numResults)}
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.type ? (
            <InfoRow
              label={t("tool.labelDepth")}
              value={String(input.type)}
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "task":
      return (
        <Section
          title={t("tool.sectionSubtask")}
          icon="git-branch-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelDescription")}
            value={String(input.description ?? "")}
            theme={theme}
            styles={styles}
          />
          {input.subagent_type ? (
            <InfoRow
              label={t("tool.labelAgentType")}
              value={String(input.subagent_type)}
              mono
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.background ? (
            <InfoRow
              label={t("tool.labelBackground")}
              value={t("tool.yes")}
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.prompt ? (
            <CodeBox
              label="prompt"
              text={String(input.prompt ?? "")}
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "todowrite": {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return (
        <Section
          title={t("tool.sectionTodos")}
          icon="checkbox-outline"
          theme={theme}
          styles={styles}
        >
          {todos.map((todo: unknown, i: number) => {
            const td = todo as { content?: string; status?: string; priority?: string };
            return (
              <TodoRow
                key={i}
                content={String(td.content ?? "")}
                status={String(td.status ?? "pending")}
                priority={String(td.priority ?? "medium")}
                theme={theme}
                styles={styles}
              />
            );
          })}
          {todos.length === 0 ? <Text style={styles.emptyText}>{t("tool.noTodos")}</Text> : null}
        </Section>
      );
    }

    case "question": {
      const questions = Array.isArray(input.questions) ? input.questions : [];
      const answers = getQuestionAnswers(questions.length, metadata, output);
      return (
        <QuestionAnswersSection
          questions={questions}
          answers={answers}
          output={output}
          theme={theme}
          styles={styles}
          t={t}
        />
      );
    }

    case "lsp":
      return (
        <Section
          title={t("tool.sectionLsp")}
          icon="analytics-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelOperation")}
            value={String(input.operation ?? "")}
            theme={theme}
            styles={styles}
          />
          <InfoRow
            label={t("tool.labelFile")}
            value={String(input.filePath ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
          {input.line != null ? (
            <InfoRow
              label={t("tool.labelLineChar")}
              value={`${input.line}:${input.character ?? 1}`}
              theme={theme}
              styles={styles}
            />
          ) : null}
          {input.query ? (
            <InfoRow
              label={t("tool.labelQuery")}
              value={String(input.query)}
              theme={theme}
              styles={styles}
            />
          ) : null}
        </Section>
      );

    case "apply_patch":
      return (
        <Section
          title={t("tool.sectionPatch")}
          icon="git-compare-outline"
          theme={theme}
          styles={styles}
        >
          <CodeBox
            label="patch"
            text={String(input.patchText ?? "")}
            theme={theme}
            styles={styles}
          />
        </Section>
      );

    case "skill":
      return (
        <Section
          title={t("tool.sectionSkill")}
          icon="library-outline"
          theme={theme}
          styles={styles}
        >
          <InfoRow
            label={t("tool.labelSkillName")}
            value={String(input.name ?? "")}
            mono
            theme={theme}
            styles={styles}
          />
        </Section>
      );

    default:
      if (Object.keys(input).length === 0) return null;
      return (
        <Section title={t("tool.sectionInput")} icon="list-outline" theme={theme} styles={styles}>
          <CodeBox
            label="input"
            text={JSON.stringify(input, null, 2) ?? ""}
            theme={theme}
            styles={styles}
          />
        </Section>
      );
  }
}

function QuestionAnswersSection({
  questions,
  answers,
  output,
  theme,
  styles,
  t,
}: {
  questions: unknown[];
  answers: string[][];
  output?: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  t: TFunc;
}) {
  return (
    <Section
      title={t("tool.sectionQuestionAnswers")}
      icon="chatbubble-ellipses-outline"
      theme={theme}
      styles={styles}
    >
      {questions.map((rawQuestion, index) => {
        const item = toQuestionDetail(rawQuestion);
        const options = Array.isArray(item.options) ? item.options : [];
        const questionAnswers = answers[index] ?? [];
        const hasAnswer = questionAnswers.length > 0;

        return (
          <View key={index} style={styles.questionCard}>
            <View style={styles.questionCardHeader}>
              <View style={styles.questionIndex}>
                <Text style={styles.questionIndexText}>{index + 1}</Text>
              </View>
              <Text style={styles.questionEyebrow} numberOfLines={2}>
                {item.header || t("tool.questionLabel", { count: index + 1 })}
              </Text>
              <View
                style={[
                  styles.questionState,
                  hasAnswer ? styles.questionStateAnswered : styles.questionStatePending,
                ]}
              >
                <Ionicons
                  name={hasAnswer ? "checkmark-circle" : "ellipse-outline"}
                  size={13}
                  color={hasAnswer ? theme.colors.success : theme.colors.warning}
                />
                <Text
                  style={[
                    styles.questionStateText,
                    { color: hasAnswer ? theme.colors.success : theme.colors.warning },
                  ]}
                >
                  {hasAnswer ? t("tool.questionAnswered") : t("tool.questionPending")}
                </Text>
              </View>
            </View>

            <Text style={styles.questionText}>{item.question ?? String(rawQuestion)}</Text>

            <View
              style={[
                styles.answerBlock,
                hasAnswer ? styles.answerBlockAnswered : styles.answerBlockPending,
              ]}
            >
              <View style={styles.answerHeader}>
                <Ionicons
                  name={hasAnswer ? "person-outline" : "help-circle-outline"}
                  size={15}
                  color={hasAnswer ? theme.colors.success : theme.colors.warning}
                />
                <Text style={styles.answerLabel}>{t("tool.answerLabel")}</Text>
              </View>
              {hasAnswer ? (
                questionAnswers.map((answer, answerIndex) => (
                  <Text key={answerIndex} style={styles.answerText}>
                    {questionAnswers.length > 1 ? `• ${answer}` : answer}
                  </Text>
                ))
              ) : (
                <Text style={styles.answerPlaceholder}>{t("tool.answerPending")}</Text>
              )}
            </View>

            {options.length > 0 ? (
              <View style={styles.questionOptions}>
                <Text style={styles.questionOptionsLabel}>{t("tool.optionsLabel")}</Text>
                {options.map((option, optionIndex) => {
                  const label = option.label ?? "";
                  const isSelected =
                    hasAnswer && label.length > 0 && questionAnswers.includes(label);

                  return (
                    <View
                      key={`${label}-${optionIndex}`}
                      style={[
                        styles.questionOption,
                        isSelected ? styles.questionOptionSelected : null,
                      ]}
                    >
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={16}
                        color={isSelected ? theme.colors.success : theme.colors.textTertiary}
                      />
                      <View style={styles.questionOptionBody}>
                        {label ? (
                          <Text
                            style={[
                              styles.questionOptionLabel,
                              isSelected ? styles.questionOptionLabelSelected : null,
                            ]}
                          >
                            {label}
                          </Text>
                        ) : null}
                        {option.description ? (
                          <Text style={styles.questionOptionDescription}>{option.description}</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
      {questions.length === 0 ? (
        <CodeBox label="output" text={output ?? ""} theme={theme} styles={styles} />
      ) : null}
    </Section>
  );
}

function toQuestionDetail(value: unknown): QuestionDetail {
  if (value && typeof value === "object") return value as QuestionDetail;
  return { question: String(value ?? "") };
}

function normalizeQuestionAnswers(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item != null && String(item).length > 0).map(String);
  }
  if (value == null || String(value).length === 0) return [];
  return [String(value)];
}

function getQuestionAnswers(
  questionCount: number,
  metadata: Record<string, unknown>,
  output?: string,
): string[][] {
  const rawAnswers = metadata.answers;
  if (Array.isArray(rawAnswers)) {
    if (rawAnswers.length === questionCount) {
      return rawAnswers.map(normalizeQuestionAnswers);
    }
    if (questionCount === 1) return [normalizeQuestionAnswers(rawAnswers)];
  }

  const parsedAnswers = parseQuestionAnswers(output);
  return Array.from({ length: questionCount }, (_, index) => parsedAnswers[index] ?? []);
}

function parseQuestionAnswers(output?: string): string[][] {
  if (!output) return [];

  const pairPattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/g;
  const answers: string[][] = [];
  let match: RegExpExecArray | null;
  while ((match = pairPattern.exec(output)) !== null) {
    answers.push([decodeQuestionText(match[2])]);
  }
  return answers;
}

function decodeQuestionText(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

// ── 输出渲染 ─────────────────────────────────────────────

function renderOutput(
  state: ToolState,
  theme: Theme,
  styles: ReturnType<typeof makeStyles>,
  t: TFunc,
  toolName?: string,
  onNavigateToSession?: (sessionId: string) => void,
): React.ReactElement | null {
  if (state.status === "pending") return null;

  if (state.status === "error") {
    return (
      <Section
        title={t("tool.sectionError")}
        icon="close-circle-outline"
        theme={theme}
        styles={styles}
        isError
      >
        <ScrollableCode
          text={state.error ?? ""}
          theme={theme}
          styles={styles}
          textColor={theme.colors.destructive}
        />
      </Section>
    );
  }

  if (state.status === "completed") {
    const meta = state.metadata ?? {};
    const summary = renderOutputSummary(meta, theme, styles, t, onNavigateToSession);

    return (
      <>
        {summary}
        {state.output && toolName !== "question" ? (
          <Section
            title={t("tool.sectionOutput")}
            icon="log-out-outline"
            theme={theme}
            styles={styles}
          >
            <ScrollableCode
              text={clip(state.output)}
              fullText={state.output}
              theme={theme}
              styles={styles}
            />
          </Section>
        ) : null}
      </>
    );
  }

  if (state.status === "running") {
    const title = state.title;
    const meta = (state as { metadata?: Record<string, unknown> }).metadata ?? {};
    const summary = renderOutputSummary(meta, theme, styles, t, onNavigateToSession);
    return (
      <>
        {title ? (
          <Section
            title={t("tool.sectionProgress")}
            icon="time-outline"
            theme={theme}
            styles={styles}
          >
            <Text style={[styles.infoValue, { color: theme.colors.warning }]}>{title}</Text>
          </Section>
        ) : null}
        {summary}
      </>
    );
  }

  return null;
}

function renderOutputSummary(
  meta: Record<string, unknown>,
  theme: Theme,
  styles: ReturnType<typeof makeStyles>,
  t: TFunc,
  onNavigateToSession?: (sessionId: string) => void,
): React.ReactElement | null {
  if ("exit" in meta) {
    const exit = meta.exit as number | null;
    const exitOk = exit === 0 || exit === null;
    return (
      <Section
        title={t("tool.sectionSummary")}
        icon="stats-chart-outline"
        theme={theme}
        styles={styles}
      >
        <InfoRow
          label={t("tool.labelExitCode")}
          value={exit == null ? "N/A" : String(exit)}
          valueColor={exitOk ? theme.colors.success : theme.colors.destructive}
          theme={theme}
          styles={styles}
        />
        {meta.truncated ? (
          <InfoRow
            label={t("tool.labelOutputTruncated")}
            value={t("tool.yes")}
            theme={theme}
            styles={styles}
          />
        ) : null}
        {meta.outputPath ? (
          <InfoRow
            label={t("tool.labelFullOutput")}
            value={String(meta.outputPath)}
            mono
            theme={theme}
            styles={styles}
          />
        ) : null}
      </Section>
    );
  }

  if ("count" in meta && typeof meta.count === "number") {
    const isGrep = "matches" in meta;
    return (
      <Section
        title={t("tool.sectionSearchSummary")}
        icon="stats-chart-outline"
        theme={theme}
        styles={styles}
      >
        <InfoRow
          label={isGrep ? t("tool.labelMatches") : t("tool.labelFiles")}
          value={String(meta.count ?? meta.matches ?? 0)}
          theme={theme}
          styles={styles}
        />
        {meta.truncated ? (
          <InfoRow
            label={t("tool.labelResultTruncated")}
            value={t("tool.labelResultTruncatedLong")}
            theme={theme}
            styles={styles}
          />
        ) : null}
      </Section>
    );
  }
  if ("matches" in meta && typeof meta.matches === "number") {
    return (
      <Section
        title={t("tool.sectionSearchSummary")}
        icon="stats-chart-outline"
        theme={theme}
        styles={styles}
      >
        <InfoRow
          label={t("tool.labelMatches")}
          value={String(meta.matches)}
          theme={theme}
          styles={styles}
        />
        {meta.truncated ? (
          <InfoRow
            label={t("tool.labelResultTruncated")}
            value={t("tool.yes")}
            theme={theme}
            styles={styles}
          />
        ) : null}
      </Section>
    );
  }

  if ("filediff" in meta && meta.filediff) {
    const fd = meta.filediff as { file?: string; additions?: number; deletions?: number };
    return (
      <Section
        title={t("tool.sectionDiff")}
        icon="git-compare-outline"
        theme={theme}
        styles={styles}
      >
        {fd.file ? (
          <InfoRow label={t("tool.labelFile")} value={fd.file} mono theme={theme} styles={styles} />
        ) : null}
        <View style={styles.diffStatRow}>
          {fd.additions != null ? (
            <View style={styles.diffStatAdd}>
              <Text style={styles.diffStatAddText}>+{fd.additions}</Text>
            </View>
          ) : null}
          {fd.deletions != null ? (
            <View style={styles.diffStatDel}>
              <Text style={styles.diffStatDelText}>-{fd.deletions}</Text>
            </View>
          ) : null}
        </View>
      </Section>
    );
  }

  if ("sessionId" in meta) {
    const sessionId = String(meta.sessionId ?? "");
    const model = meta.model as { modelID?: string; providerID?: string } | undefined;
    return (
      <Section
        title={t("tool.sectionSubtaskSummary")}
        icon="git-branch-outline"
        theme={theme}
        styles={styles}
      >
        {/* sessionId 行：有回调时显示跳转按钮，否则降级为文本 */}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t("tool.labelSessionId")}</Text>
          {onNavigateToSession ? (
            <TouchableOpacity
              style={styles.sessionLinkBtn}
              onPress={() => onNavigateToSession(sessionId)}
              activeOpacity={0.7}
            >
              <Text style={styles.sessionLinkText} numberOfLines={1}>
                {sessionId}
              </Text>
              <Ionicons name="arrow-forward-circle-outline" size={15} color={theme.colors.accent} />
            </TouchableOpacity>
          ) : (
            <Text style={[styles.infoValueMono, { flex: 1 }]}>{sessionId}</Text>
          )}
        </View>
        {model?.modelID ? (
          <InfoRow
            label={t("tool.labelModel")}
            value={`${model.providerID ?? ""}/${model.modelID}`}
            theme={theme}
            styles={styles}
          />
        ) : null}
        {meta.background ? (
          <InfoRow
            label={t("tool.labelBackground")}
            value={t("tool.yes")}
            theme={theme}
            styles={styles}
          />
        ) : null}
      </Section>
    );
  }

  if ("todos" in meta && Array.isArray(meta.todos)) {
    const todos = meta.todos as { status?: string; priority?: string }[];
    const completed = todos.filter((td) => td.status === "completed").length;
    const total = todos.length;
    return (
      <Section
        title={t("tool.sectionTodoSummary")}
        icon="checkbox-outline"
        theme={theme}
        styles={styles}
      >
        <InfoRow label={t("tool.labelTotal")} value={String(total)} theme={theme} styles={styles} />
        <InfoRow
          label={t("tool.labelCompleted")}
          value={`${completed} / ${total}`}
          valueColor={completed === total ? theme.colors.success : theme.colors.text}
          theme={theme}
          styles={styles}
        />
      </Section>
    );
  }

  return null;
}

// ── 时间信息 ─────────────────────────────────────────────

function renderTimings(
  state: ToolState,
  theme: Theme,
  styles: ReturnType<typeof makeStyles>,
  t: TFunc,
): React.ReactElement | null {
  if (state.status === "pending") return null;
  const time = state.time;
  if (!time) return null;

  const start = time.start;
  const end = "end" in time ? (time as { end: number }).end : undefined;
  const duration = end != null ? end - start : undefined;

  return (
    <Section title={t("tool.sectionTime")} icon="time-outline" theme={theme} styles={styles}>
      <InfoRow
        label={t("tool.labelStart")}
        value={new Date(start).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
        theme={theme}
        styles={styles}
      />
      {duration != null ? (
        <InfoRow
          label={t("tool.labelElapsed")}
          value={duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </Section>
  );
}

// ── 子组件 ────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
  theme,
  styles,
  isError = false,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  children: React.ReactNode;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  isError?: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons
          name={icon}
          size={13}
          color={isError ? theme.colors.destructive : theme.colors.textTertiary}
        />
        <Text style={[styles.sectionTitle, isError && { color: theme.colors.destructive }]}>
          {title}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Copyable({
  text,
  children,
  theme,
  styles,
}: {
  text: string;
  children: React.ReactNode;
  theme: Theme;
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
      activeOpacity={0.6}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityHint={t("tool.longPress")}
      // 让外层 row 在 flex 容器中可收缩，长路径才能正确换行而不撑出屏幕
      style={styles.copyableWrap}
    >
      {children}
      {copied ? (
        <View style={styles.copiedBadge}>
          <Ionicons name="checkmark-circle" size={12} color={theme.colors.success} />
          <Text style={styles.copiedText}>{t("common.copied")}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// 把含 ANSI 转义码的文本拆为带样式 span，逐段渲染为嵌套 Text。
// · 无 ANSI（parseAnsi 只产一个无样式 span）时短路返回单 Text，开销可忽略；
// · fg/bg 调色板随主题 isDark 切换；
// · textColor 作为无 fg 的 span 的回退色（错误输出用 destructive 红）；
// · inverse 模式交换 fg/bg；
// · baseStyle 由调用方注入（ScrollableCode 走 styles.codeText，全屏走 codeFullStyles.codeText），
//   span 内层 Text 不会从父 RN Text 继承 fontFamily，必须显式叠加。
function AnsiText({
  text,
  textColor,
  baseStyle,
  theme,
  selectable = false,
}: {
  text: string;
  textColor?: string;
  baseStyle: TextStyle | TextStyle[];
  theme: Theme;
  selectable?: boolean;
}) {
  const spans = useMemo(() => parseAnsi(text), [text]);
  const isDark = theme.isDark;

  if (spans.length === 1 && !spans[0].fg && !spans[0].bg && !spans[0].style) {
    return (
      <Text
        style={textColor ? [baseStyle, { color: textColor }] : baseStyle}
        selectable={selectable}
      >
        {text}
      </Text>
    );
  }

  const outerStyle = textColor ? [baseStyle, { color: textColor }] : baseStyle;
  return (
    <Text style={outerStyle} selectable={selectable}>
      {spans.map((span, i) => {
        const s = span.style;
        const inverse = s?.inverse;
        let fg = span.fg ? ansiColorToHex(span.fg, isDark, false) : undefined;
        let bg = span.bg ? ansiColorToHex(span.bg, isDark, true) : undefined;
        if (inverse) {
          if (fg && bg) {
            const tmp = fg;
            fg = bg;
            bg = tmp;
          } else if (fg) {
            bg = fg;
            fg = theme.colors.codeBackground;
          } else if (bg) {
            fg = bg;
            bg = undefined;
          } else {
            fg = theme.colors.codeBackground;
            bg = textColor ?? theme.colors.text;
          }
        }
        const spanStyle: Record<string, unknown> = {};
        if (fg) spanStyle.color = fg;
        if (bg) spanStyle.backgroundColor = bg;
        if (s?.bold) spanStyle.fontWeight = "700";
        if (s?.dim) spanStyle.opacity = 0.7;
        if (s?.italic) spanStyle.fontStyle = "italic";
        if (s?.underline) spanStyle.textDecorationLine = "underline";
        return (
          <Text key={i} style={spanStyle}>
            {span.text}
          </Text>
        );
      })}
    </Text>
  );
}

// 工具输出/错误专用：水平滚动的代码块。
// · 不嵌套在 TouchableOpacity 内，避免和外层 BottomSheet 手势冲突；
// · 提供独立的复制按钮，不依赖长按；
// · `text` 是用于显示的内容（可能已截断），`fullText` 是复制时使用的原文。
function ScrollableCode({
  text,
  fullText,
  textColor,
  theme,
  styles,
}: {
  text: string;
  fullText?: string;
  textColor?: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const target = fullText ?? text;
    if (!target) return;
    await Clipboard.setStringAsync(target);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <View style={styles.outputBox}>
      <View style={styles.outputBoxHeader}>
        <TouchableOpacity onPress={onCopy} hitSlop={theme.hitSlop} style={styles.outputCopyBtn}>
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={13}
            color={copied ? theme.colors.success : theme.colors.textTertiary}
          />
        </TouchableOpacity>
      </View>
      <GHScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.outputScroll}
        contentContainerStyle={styles.outputScrollContent}
        // 让水平滚动手势优先于父级 BottomSheet 的垂直 pan
        directionalLockEnabled
        nestedScrollEnabled
      >
        {/* 注意：不要给 Text 设 selectable —— 原生选择手势会抢占
            ScrollView 的 pan，导致用户拖不动，只会变成"选择文字"。
            内容已通过顶部"复制"按钮整体复制。
            AnsiText 自动识别 ANSI 转义码并着色，无 ANSI 时短路。 */}
        <AnsiText text={text} textColor={textColor} baseStyle={styles.codeText} theme={theme} />
      </GHScrollView>
    </View>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  valueColor,
  theme,
  styles,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Copyable text={value} theme={theme} styles={styles}>
        <Text
          style={[
            mono ? styles.infoValueMono : styles.infoValue,
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

function CodeBox({
  label,
  text,
  theme,
  styles,
}: {
  label: string;
  text: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <View style={styles.codeBox}>
      {/* 标题行 + 复制 + 展开按钮 */}
      <View style={styles.codeBoxHeader}>
        <Text style={styles.codeBoxLabel}>{label}</Text>
        <View style={styles.codeBoxActions}>
          <TouchableOpacity
            onPress={onCopy}
            hitSlop={theme.hitSlop}
            style={styles.codeBoxActionBtn}
          >
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={13}
              color={copied ? theme.colors.success : theme.colors.textTertiary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFullscreen(true)}
            hitSlop={theme.hitSlop}
            style={styles.codeBoxExpandBtn}
          >
            <Ionicons name="expand-outline" size={13} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      <GHScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.codeBoxScroll}
        directionalLockEnabled
        nestedScrollEnabled
      >
        {/* 不设 selectable：原生选择手势会抢占水平 pan，导致滑不动 */}
        <Text style={styles.codeText}>{clip(text)}</Text>
      </GHScrollView>

      <Modal
        visible={fullscreen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFullscreen(false)}
      >
        <SafeAreaView
          style={[codeFullStyles.root, { backgroundColor: theme.colors.codeBackground }]}
        >
          <View
            style={[
              codeFullStyles.topBar,
              {
                borderBottomColor: theme.colors.separator,
                backgroundColor: theme.colors.groupedBackground,
              },
            ]}
          >
            <Text
              style={[
                codeFullStyles.topLabel,
                { color: theme.colors.textTertiary, fontFamily: theme.monoFontFamily },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
            <TouchableOpacity onPress={() => setFullscreen(false)} hitSlop={theme.hitSlop}>
              <Ionicons name="close" size={20} color={theme.colors.textTertiary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={codeFullStyles.vScroll} keyboardShouldPersistTaps="handled">
            <ScrollView horizontal showsHorizontalScrollIndicator style={codeFullStyles.hScroll}>
              {/* 全屏查看保留 selectable；AnsiText 自动识别 ANSI 转义码并着色，无 ANSI 时短路。 */}
              <AnsiText
                text={text}
                baseStyle={[
                  codeFullStyles.codeText,
                  { color: theme.colors.text, fontFamily: theme.monoFontFamily },
                ]}
                theme={theme}
                selectable
              />
            </ScrollView>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const codeFullStyles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topLabel: {
    fontFamily: "monospace",
    fontSize: 12,
    flex: 1,
    marginRight: 12,
  },
  vScroll: { flex: 1 },
  hScroll: { padding: 12 },
  codeText: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 12,
    lineHeight: 19,
  },
});

function TodoRow({
  content,
  status,
  priority,
  theme,
  styles,
}: {
  content: string;
  status: string;
  priority: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}) {
  const statusColor =
    {
      completed: theme.colors.success,
      in_progress: theme.colors.warning,
      cancelled: theme.colors.destructive,
      pending: theme.colors.textTertiary,
    }[status] ?? theme.colors.textTertiary;

  const priorityColor =
    {
      high: theme.colors.destructive,
      medium: theme.colors.warning,
      low: theme.colors.textTertiary,
    }[priority] ?? theme.colors.textTertiary;

  return (
    <View style={styles.todoRow}>
      <View style={[styles.todoDot, { backgroundColor: statusColor }]} />
      <Text style={styles.todoContent} numberOfLines={2}>
        {content}
      </Text>
      <Text style={[styles.todoPriority, { color: priorityColor }]}>{priority}</Text>
    </View>
  );
}

// ── 工具函数 ─────────────────────────────────────────────

function clip(text: string | undefined, max = 2000): string {
  if (text == null) return "";
  return text.length > max ? text.slice(0, max) + "\n…(已截断)" : text;
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;

  return StyleSheet.create({
    // 头部
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.xs,
    },
    iconBox: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    headerText: {
      flex: 1,
      gap: 1,
    },
    toolLabel: {
      ...typography.headline,
      color: colors.text,
    },
    toolId: {
      ...typography.monoSm,
      color: colors.textTertiary,
    },

    // 工具描述
    toolDesc: {
      ...typography.footnote,
      color: colors.textSecondary,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },

    // 状态徽章
    statusChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderWidth: 1,
      borderRadius: radius.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    statusChipText: {
      fontSize: 11,
      fontWeight: "600",
    },

    // 滚动区
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },

    // Section
    section: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      backgroundColor: colors.groupedBackground,
    },
    sectionTitle: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sectionBody: {
      padding: spacing.md,
      gap: spacing.sm,
    },

    // InfoRow
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    infoLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      width: 60,
      flexShrink: 0,
      paddingTop: 1,
    },
    infoValue: {
      ...typography.footnote,
      color: colors.text,
      flex: 1,
      lineHeight: 19,
    },
    infoValueMono: {
      ...typography.monoSm,
      color: colors.text,
      flex: 1,
      lineHeight: 18,
    },
    sessionLinkBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    sessionLinkText: {
      ...typography.monoSm,
      color: colors.accent,
      flex: 1,
      lineHeight: 18,
    },

    // CodeBox
    codeBox: {
      backgroundColor: colors.codeBackground,
      borderRadius: radius.sm,
      padding: spacing.sm,
      gap: 4,
    },
    codeBoxHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    codeBoxLabel: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    codeBoxExpandBtn: {
      padding: 2,
    },
    codeBoxActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    codeBoxActionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    codeBoxActionText: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "600",
    },
    codeBoxScroll: {},
    codeText: {
      ...typography.monoSm,
      color: colors.text,
      lineHeight: 17,
    },

    // 输出区水平滚动容器（不折行，超宽时水平滚动）
    outputScroll: {
      backgroundColor: colors.codeBackground,
      borderRadius: radius.sm,
    },
    outputScrollContent: {
      padding: spacing.sm,
    },
    outputBox: {
      gap: 6,
    },
    outputBoxHeader: {
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    outputCopyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    outputCopyText: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "600",
    },

    // 长按复制反馈
    copyableWrap: {
      flex: 1,
      minWidth: 0,
    },
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

    // Empty
    emptyText: {
      ...typography.footnote,
      color: colors.textTertiary,
      fontStyle: "italic",
    },

    // DiffStat
    diffStatRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: 2,
    },
    diffStatAdd: {
      backgroundColor: `${colors.success}18`,
      borderRadius: radius.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    diffStatAddText: {
      ...typography.monoSm,
      color: colors.success,
      fontWeight: "700",
    },
    diffStatDel: {
      backgroundColor: `${colors.destructive}18`,
      borderRadius: radius.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    diffStatDelText: {
      ...typography.monoSm,
      color: colors.destructive,
      fontWeight: "700",
    },

    // Todo
    todoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    todoDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      marginTop: 5,
      flexShrink: 0,
    },
    todoContent: {
      ...typography.footnote,
      color: colors.text,
      flex: 1,
      lineHeight: 18,
    },
    todoPriority: {
      ...typography.caption2,
      fontWeight: "600",
      textTransform: "uppercase",
    },

    // Question
    questionCard: {
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    questionCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    questionIndex: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.warningMuted,
      flexShrink: 0,
    },
    questionIndexText: {
      ...typography.caption1,
      color: colors.warning,
      fontWeight: "700",
    },
    questionEyebrow: {
      ...typography.footnoteEmphasized,
      color: colors.textSecondary,
      flex: 1,
    },
    questionState: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      flexShrink: 0,
    },
    questionStateAnswered: {
      backgroundColor: colors.successMuted,
    },
    questionStatePending: {
      backgroundColor: colors.warningMuted,
    },
    questionStateText: {
      ...typography.caption2,
      fontWeight: "700",
    },
    questionText: {
      ...typography.callout,
      color: colors.text,
      lineHeight: 21,
    },
    answerBlock: {
      gap: spacing.xs,
      padding: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
    },
    answerBlockAnswered: {
      backgroundColor: colors.successMuted,
      borderColor: `${colors.success}55`,
    },
    answerBlockPending: {
      backgroundColor: colors.groupedBackground,
      borderColor: colors.border,
    },
    answerHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    answerLabel: {
      ...typography.caption1,
      color: colors.textSecondary,
      fontWeight: "700",
    },
    answerText: {
      ...typography.subheadlineEmphasized,
      color: colors.text,
      lineHeight: 21,
    },
    answerPlaceholder: {
      ...typography.subheadline,
      color: colors.textTertiary,
      fontStyle: "italic",
    },
    questionOptions: {
      gap: spacing.xs,
      paddingTop: spacing.xs,
    },
    questionOptionsLabel: {
      ...typography.caption2,
      color: colors.textTertiary,
      fontWeight: "700",
    },
    questionOption: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.groupedBackground,
    },
    questionOptionSelected: {
      borderColor: `${colors.success}66`,
      backgroundColor: colors.successMuted,
    },
    questionOptionBody: {
      flex: 1,
      gap: 2,
    },
    questionOptionLabel: {
      ...typography.caption1,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    questionOptionLabelSelected: {
      color: colors.success,
      fontWeight: "700",
    },
    questionOptionDescription: {
      ...typography.caption2,
      color: colors.textTertiary,
      lineHeight: 16,
    },
  });
}
