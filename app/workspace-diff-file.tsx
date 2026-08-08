/**
 * [INPUT]: 接收工作区变更页传入的内存预览 key，并读取已解析的单文件 diff
 * [OUTPUT]: 提供全屏单文件 diff 页面，不重复请求 OpenCode VCS 接口
 * [POS]: app 的工作区变更详情路由，由嵌入式 DiffViewer 的全屏按钮打开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DiffViewer } from "../src/components/DiffViewer";
import { useTheme, type Theme } from "../src/theme";
import { getWorkspaceDiffPreview } from "../src/utils/workspace-diff-preview";

export default function WorkspaceDiffFileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { previewKey } = useLocalSearchParams<{ previewKey?: string }>();
  const preview = getWorkspaceDiffPreview(typeof previewKey === "string" ? previewKey : "");
  const fileName = preview?.file.split("/").pop() ?? t("workspaceDiff.title");

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: fileName }} />
      {preview ? (
        <ScrollView contentContainerStyle={styles.content} nestedScrollEnabled>
          <DiffViewer
            oldText={preview.oldText}
            newText={preview.newText}
            filePath={preview.file}
            additions={preview.additions}
            deletions={preview.deletions}
            initiallyExpanded
          />
        </ScrollView>
      ) : (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>{t("workspaceDiff.detailUnavailable")}</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, typography } = theme;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.groupedBackground },
    content: { padding: spacing.sm, paddingBottom: spacing.xxl },
    unavailable: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xxl,
    },
    unavailableText: { ...typography.footnote, color: colors.textTertiary, textAlign: "center" },
  });
}
