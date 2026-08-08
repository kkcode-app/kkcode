/**
 * [INPUT]: 依赖 expo-router 路由参数的文件绝对路径/会话 directory、api/client 的 getFileContent 与文本类型规则、utils/markdown-styles 的主题化 Markdown 样式
 * [OUTPUT]: 对外提供 file-preview 页面，显示常见文本文件内容、Markdown 渲染/源码切换或不支持预览提示
 * [POS]: app 的文件预览路由，由 file-browser 选择文件后打开，不承担目录导航
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import Markdown from "react-native-markdown-display";
import { Image } from "expo-image";

import { getFileContent, type FileContent } from "../src/api/client";
import { CodePreview } from "../src/components/DiffViewer";
import { toClientConfig, useConnectionStore } from "../src/store/connection";
import { useTheme, type Theme } from "../src/theme";
import { makeMarkdownStyles, makeMarkdownRules } from "../src/utils/markdown-styles";
import {
  isImagePreviewableFile,
  isMarkdownFile,
  isTextPreviewableFile,
} from "../src/utils/file-preview";

export default function FilePreviewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const mdStyles = useMemo(() => makeMarkdownStyles(theme), [theme]);
  const mdRules = useMemo(() => makeMarkdownRules(theme, { copyable: false }), [theme]);
  const { directory, path, name } = useLocalSearchParams<{
    directory?: string;
    path?: string;
    name?: string;
  }>();
  const active = useConnectionStore((s) => s.active);
  const filePath = typeof path === "string" ? path : "";
  const fileName = typeof name === "string" ? name : (filePath.split("/").pop() ?? "");
  const sessionDirectory = typeof directory === "string" ? directory : "";
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const requestRef = useRef(0);
  const supported = isTextPreviewableFile(fileName);
  const image = isImagePreviewableFile(fileName);
  const markdown = isMarkdownFile(fileName);

  useEffect(() => {
    if (!active || !filePath || !sessionDirectory || (!supported && !image)) return;
    const requestID = ++requestRef.current;
    setLoading(true);
    setError(null);
    void getFileContent(toClientConfig(active, sessionDirectory), filePath)
      .then((result) => {
        if (requestID === requestRef.current) setContent(result);
      })
      .catch((err) => {
        if (requestID === requestRef.current)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestID === requestRef.current) setLoading(false);
      });
  }, [active, filePath, image, sessionDirectory, supported]);

  const unavailable = (!supported && !image) || (!image && content?.type === "binary");
  const imageSource =
    content && image
      ? `data:${content.mimeType ?? imageMimeType(fileName)};base64,${content.content}`
      : null;
  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: fileName }} />
      {loading ? (
        <ActivityIndicator style={styles.loading} color={theme.colors.textTertiary} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {unavailable ? (
        <View style={styles.unavailable}>
          <Ionicons name="document-outline" size={30} color={theme.colors.textTertiary} />
          <Text style={styles.unavailableText}>{t("chat.filePreviewUnavailable")}</Text>
        </View>
      ) : imageSource ? (
        <Image source={imageSource} contentFit="contain" style={styles.imagePreview} />
      ) : content ? (
        markdown && !showRawMarkdown ? (
          <ScrollView style={styles.markdownPreview} contentContainerStyle={styles.markdownContent}>
            <Markdown style={mdStyles} rules={mdRules}>
              {content.content}
            </Markdown>
          </ScrollView>
        ) : (
          <CodePreview content={content.content} filePath={fileName} />
        )
      ) : null}
      {markdown && content?.type === "text" ? (
        <TouchableOpacity
          style={styles.modeButton}
          onPress={() => setShowRawMarkdown((raw) => !raw)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={showRawMarkdown ? "eye-outline" : "code-slash-outline"}
            size={18}
            color={theme.colors.accent}
          />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function imageMimeType(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "jpg") return "image/jpeg";
  if (extension === "tif") return "image/tiff";
  return `image/${extension ?? "png"}`;
}

function makeStyles(theme: Theme) {
  const { colors, spacing, typography } = theme;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.groupedBackground, padding: spacing.lg },
    loading: { marginVertical: spacing.md },
    error: { ...typography.footnote, color: colors.destructive },
    unavailable: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xxl },
    unavailableText: { ...typography.footnote, color: colors.textTertiary },
    markdownPreview: { flex: 1 },
    markdownContent: { paddingBottom: spacing.xxl },
    imagePreview: { flex: 1, width: "100%" },
    modeButton: {
      position: "absolute",
      right: spacing.lg,
      bottom: spacing.xl,
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  });
}
