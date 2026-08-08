/**
 * CommandPicker — shared slash command results for palette and autocomplete.
 *
 * `CommandAutocomplete` is the chat input's inline suggestion surface: typing
 * `/` at the start of an otherwise whitespace-free draft filters commands and
 * choosing one inserts `/<name> `. `CommandPicker` keeps the BottomSheet
 * presentation available for a future global command palette. Both use the
 * same store, refresh policy and row renderer.
 *
 * Reads `useCommandStore` for the cached server-registered
 * `CommandV2Info[]`. The list is server/workspace scoped, so opening it loads
 * the current chat session's directory and never reuses another workspace's
 * snapshot.
 */

import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { ClientConfig, CommandV2Info } from "../api/client";
import { BottomSheet } from "./BottomSheet";
import { commandScopeKey, useCommandStore } from "../store/commands";
import { toClientConfig, useConnectionStore } from "../store/connection";
import { useTheme, type Theme } from "../theme";
import { filterSlashCommandSuggestions } from "../utils/slash-parse";

export type CommandPickerMode = "palette" | "slash";

export type CommandPickerProps = {
  visible: boolean;
  onClose: () => void;
  /** Called with the picked command. Caller is responsible for closing. */
  onSelect: (cmd: CommandV2Info) => void;
  mode: CommandPickerMode;
  /** Commands are registered per workspace, matching the displayed session. */
  directory?: string;
};

export type CommandAutocompleteProps = {
  visible: boolean;
  /** Current token without the leading slash. */
  query: string;
  onSelect: (cmd: CommandV2Info) => void;
  directory?: string;
};

function useCommandPickerData(visible: boolean, directory?: string) {
  // Subscribed slices — narrow to avoid re-rendering on unrelated store
  // changes. `commands` triggers a re-render only when the array identity
  // changes (load/setAll always replaces the array).
  const commands = useCommandStore((s) => s.commands);
  const loading = useCommandStore((s) => s.loading);
  const error = useCommandStore((s) => s.error);
  const loadedAt = useCommandStore((s) => s.loadedAt);
  const scopeKey = useCommandStore((s) => s.scopeKey);
  const load = useCommandStore((s) => s.load);

  // Open-driven refresh. A result from another directory is explicitly not
  // reusable, while a same-scope snapshot is refreshed in the background once
  // it is 30s old. Same-scope load() preserves cached commands, so suggestions
  // never flash empty while that refresh is in flight.
  //   - never loaded yet (`idle`): always kick.
  //   - last load failed (`error`): always retry on open.
  //   - last load succeeded (`ready`): retry only after 30s, whether the
  //     snapshot is empty or populated. This catches server config hot reloads
  //     without issuing a request on every slash keystroke/open.
  useEffect(() => {
    if (!visible) return;
    const active = useConnectionStore.getState().active;
    if (!active) return; // no server: stay empty until user connects
    const config = toClientConfig(active, directory);
    const expectedScope = commandScopeKey(config);

    if (scopeKey !== expectedScope) {
      void load(config);
      return;
    }

    const stale = loading === "ready" && loadedAt !== undefined && Date.now() - loadedAt > 30_000;

    if (loading === "idle" || loading === "error" || stale) {
      void load(config);
    }
  }, [visible, directory, scopeKey, loading, commands.length, loadedAt, load]);

  const active = useConnectionStore((s) => s.active);
  const retry = () => {
    const current = useConnectionStore.getState().active;
    if (current) void load(toClientConfig(current, directory));
  };

  return {
    commands,
    loading,
    error,
    noServer: !active,
    retry,
  };
}

function CommandResults({
  commands,
  hasCachedCommands,
  loading,
  error,
  noServer,
  retry,
  onSelect,
  compact = false,
}: {
  commands: CommandV2Info[];
  hasCachedCommands: boolean;
  loading: ReturnType<typeof useCommandPickerData>["loading"];
  error: string | undefined;
  noServer: boolean;
  retry: () => void;
  onSelect: (cmd: CommandV2Info) => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();
  const showList = commands.length > 0;

  // Decide what to render. Priority:
  //   1. no active server → "未连接" message
  //   2. error without a usable cache → retry block
  //   3. first-time loading (no cache at all) → spinner
  //   4. matching commands → list
  //   5. otherwise → empty/no matches
  if (noServer) {
    return (
      <View style={[styles.statusBlock, compact && styles.statusBlockCompact]}>
        <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.textTertiary} />
        <Text style={styles.statusText}>{t("command.noServer")}</Text>
      </View>
    );
  }

  if (loading === "error" && !hasCachedCommands) {
    return (
      <View style={[styles.statusBlock, compact && styles.statusBlockCompact]}>
        <Ionicons name="warning-outline" size={22} color={theme.colors.destructive} />
        <Text style={[styles.statusText, { color: theme.colors.destructive }]}>
          {t("command.errorLoad")}
          {error ? `\n${error}` : ""}
        </Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={retry}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("command.retry")}
        >
          <Text style={styles.retryBtnText}>{t("command.retry")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!hasCachedCommands && loading === "loading") {
    return (
      <View style={[styles.statusBlock, compact && styles.statusBlockCompact]}>
        <ActivityIndicator color={theme.colors.textTertiary} />
        <Text style={styles.statusText}>{t("command.loading")}</Text>
      </View>
    );
  }

  if (!showList) {
    return (
      <Text style={[styles.emptyText, compact && styles.emptyTextCompact]}>
        {t("command.empty")}
      </Text>
    );
  }

  return commands.map((cmd) => (
    <TouchableOpacity
      key={cmd.name}
      style={[styles.row, compact && styles.rowCompact]}
      activeOpacity={0.7}
      onPress={() => onSelect(cmd)}
      accessibilityRole="button"
      accessibilityLabel={`/${cmd.name}`}
      accessibilityHint={cmd.description}
    >
      <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
        <Ionicons name="terminal-outline" size={compact ? 16 : 18} color={theme.colors.accent} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          /{cmd.name}
        </Text>
        {cmd.description ? (
          <Text style={styles.rowDesc} numberOfLines={compact ? 1 : 2}>
            {cmd.description}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  ));
}

export function CommandPicker({ visible, onClose, onSelect, mode, directory }: CommandPickerProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();
  const data = useCommandPickerData(visible, directory);
  const headerTitle = mode === "palette" ? t("command.pickerTitle") : t("command.slashTitle");

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
        </View>
      }
    >
      <CommandResults {...data} hasCachedCommands={data.commands.length > 0} onSelect={onSelect} />
    </BottomSheet>
  );
}

/**
 * Keyboard-safe autocomplete surface. The caller positions this panel above
 * the chat composer; keeping it outside a Modal means typing and the first
 * command-row tap never dismiss or transfer TextInput focus.
 */
export function CommandAutocomplete({
  visible,
  query,
  onSelect,
  directory,
}: CommandAutocompleteProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const data = useCommandPickerData(visible, directory);
  const filteredCommands = useMemo(
    () => filterSlashCommandSuggestions(data.commands, query),
    [data.commands, query],
  );

  if (!visible) return null;

  return (
    <View style={styles.autocompleteSurface} accessibilityLabel={`/${query}`}>
      <ScrollView
        style={styles.autocompleteScroll}
        contentContainerStyle={styles.autocompleteContent}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        nestedScrollEnabled
        showsVerticalScrollIndicator={filteredCommands.length > 3}
      >
        <CommandResults
          {...data}
          commands={filteredCommands}
          hasCachedCommands={data.commands.length > 0}
          onSelect={onSelect}
          compact
        />
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { colors, spacing, radius } = theme;
  return StyleSheet.create({
    header: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.text,
    },
    statusBlock: {
      alignItems: "center",
      paddingVertical: spacing.xl,
      gap: spacing.sm,
    },
    statusBlockCompact: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
    },
    statusText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
    },
    retryBtn: {
      marginTop: spacing.sm,
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: colors.accentMuted,
    },
    retryBtnText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.accent,
    },
    emptyText: {
      color: colors.textTertiary,
      textAlign: "center",
      paddingVertical: spacing.xl,
      fontSize: 14,
    },
    emptyTextCompact: {
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      gap: spacing.md,
    },
    rowCompact: {
      minHeight: 52,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.accentMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    iconWrapCompact: {
      width: 30,
      height: 30,
      borderRadius: 15,
    },
    rowText: { flex: 1 },
    rowTitle: {
      fontSize: 15,
      fontWeight: "500",
      color: colors.text,
      fontFamily: "Menlo", // monospaced — matches TUI's `/name` look
    },
    rowDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    autocompleteSurface: {
      maxHeight: 220,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: colors.shadowElevated,
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 1,
      shadowRadius: 14,
      elevation: 10,
    },
    autocompleteScroll: {
      borderRadius: radius.lg,
    },
    autocompleteContent: {
      paddingVertical: spacing.xs,
    },
  });
}

// Re-export ClientConfig so step-5 callers can import the type alongside
// without round-tripping through ../api/client.
export type { ClientConfig };
