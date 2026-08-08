/**
 * [INPUT]: 依赖 react-native 的 View/Text/TextInput/TouchableOpacity，依赖 components/BottomSheet，依赖 dev-panel/JsonView，依赖 theme
 * [OUTPUT]: DevInspectModal 组件，查看/编辑任意存储值的弹层
 * [POS]: components/dev-panel/ 的通用查看+编辑弹层，被 DevStorage/DevLogs/DevNetwork 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../BottomSheet";
import { JsonView } from "./JsonView";
import { useTheme, type Theme } from "../../theme";

interface DevInspectModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  value: string;
  /** 提供时显示编辑按钮；保存时调用，传入新值 */
  onSave?: (newValue: string) => Promise<void> | void;
  /** 额外警告提示（如"敏感数据"） */
  warning?: string;
}

export function DevInspectModal({
  visible,
  onClose,
  title,
  value,
  onSave,
  warning,
}: DevInspectModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [parsed, setParsed] = useState<unknown>(undefined);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDraft(value);
      setEditing(false);
      setParseError(null);
      try {
        setParsed(JSON.parse(value));
      } catch {
        setParsed(undefined);
      }
    }
  }, [visible, value]);

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDraftChange = (text: string) => {
    setDraft(text);
    try {
      setParsed(JSON.parse(text));
      setParseError(null);
    } catch (e) {
      setParsed(undefined);
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {warning ? <Text style={styles.warning}>{warning}</Text> : null}
          <View style={styles.headerActions}>
            {onSave ? (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => (editing ? handleSave() : setEditing(true))}
                disabled={saving}
              >
                <Text style={styles.actionText}>
                  {saving ? "…" : editing ? t("dev.save") : t("dev.edit")}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.actionBtn} onPress={onClose}>
              <Text style={styles.actionText}>{t("dev.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      {editing ? (
        <View>
          <TextInput
            style={styles.editor}
            value={draft}
            onChangeText={handleDraftChange}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
          {parseError ? <Text style={styles.parseError}>JSON: {parseError}</Text> : null}
        </View>
      ) : (
        <View style={styles.preview}>
          {parsed !== undefined ? (
            <JsonView value={parsed} />
          ) : (
            <Text style={styles.rawText}>{value || t("dev.noData")}</Text>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    title: { fontSize: 16, fontWeight: "600", color: theme.colors.text },
    warning: { fontSize: 12, color: theme.colors.warning, marginTop: 4 },
    headerActions: { flexDirection: "row", gap: 16, marginTop: 8 },
    actionBtn: { paddingVertical: 4 },
    actionText: { fontSize: 15, color: theme.colors.accent, fontWeight: "500" },
    preview: { paddingVertical: 8 },
    editor: {
      fontFamily: "Menlo",
      fontSize: 12,
      color: theme.colors.text,
      backgroundColor: theme.colors.groupedBackground,
      borderRadius: 8,
      padding: 12,
      minHeight: 200,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    parseError: { fontSize: 12, color: theme.colors.destructive, marginTop: 8 },
    rawText: { fontFamily: "Menlo", fontSize: 12, color: theme.colors.text },
  });
}
