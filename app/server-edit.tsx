/**
 * [INPUT]: 依赖 connection store、OpenCode health client、server-url 与 LAN permission 工具
 * [OUTPUT]: 对外提供 OpenCode 手动服务器新增/编辑页
 * [POS]: app 路由层的 OpenCode 连接表单
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 添加 / 编辑服务器 — 独立页面（取代原 BottomSheet 弹层）
//
// 路由参数：
//   id?: string  传入即编辑模式；不传为新增模式。
//
// LAN 预热：iOS 14+ 在第一次访问 LAN IP 时会系统弹"本地网络"授权，必须先于
// "测试并连接"触发，否则 fetch 会先抛 TypeError "Network request failed"。
// see src/utils/lan-permission.ts。

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "react-i18next";

import { checkHealth } from "../src/api/client";
import { trackEvent, AnalyticsEvents as Ev } from "../src/services/analytics";
import { haptic } from "../src/utils/haptics";
import { prewarmLocalNetwork } from "../src/utils/lan-permission";
import { useConnectionStore, toClientConfig, type Server } from "../src/store/connection";
import {
  composeBaseUrl,
  DEFAULT_PORT,
  DEFAULT_PROTOCOL,
  parseBaseUrl,
  PROTOCOL_OPTIONS,
  validateAddress,
  type Protocol,
} from "../src/utils/server-url";
import { useTheme, type Theme } from "../src/theme";
import { breakpoints } from "../src/theme/breakpoints";

type StatusKind = "info" | "success" | "error";

type FormState = {
  protocol: Protocol;
  host: string;
  port: string;
  username: string;
  password: string;
  nickname: string;
};

const EMPTY_FORM: FormState = {
  protocol: DEFAULT_PROTOCOL,
  host: "",
  port: DEFAULT_PORT,
  username: "opencode",
  password: "",
  nickname: "",
};

function formFromServer(server: Server): FormState {
  const parts = parseBaseUrl(server.baseUrl);
  return {
    protocol: parts?.protocol ?? DEFAULT_PROTOCOL,
    host: parts?.host ?? "",
    port: parts?.port ?? DEFAULT_PORT,
    username: server.username,
    password: server.password,
    nickname: server.nickname ?? "",
  };
}

export default function ServerEditScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const { id } = useLocalSearchParams<{ id?: string }>();
  const servers = useConnectionStore((s) => s.servers);
  const addServer = useConnectionStore((s) => s.addServer);
  const updateServer = useConnectionStore((s) => s.updateServer);

  const editing: Server | null = id ? (servers[id] ?? null) : null;
  const isEdit = editing !== null;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: isEdit ? t("servers.editTitle") : t("servers.addTitle"),
    });
  }, [navigation, isEdit, t]);

  const [form, setForm] = useState<FormState>(() =>
    editing ? formFromServer(editing) : EMPTY_FORM,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{
    text: string;
    kind: StatusKind;
  } | null>(null);
  const statusOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status) {
      Animated.spring(statusOpacity, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    } else {
      statusOpacity.setValue(0);
    }
  }, [status, statusOpacity]);

  const addressError = validateAddress(form);
  const isValid = addressError === null && form.username.trim().length > 0;

  const handleProtocolChange = (p: Protocol) => {
    setForm((f) => ({
      ...f,
      protocol: p,
      port: p === "https" ? "443" : f.port === "443" ? "4096" : f.port,
    }));
    setStatus(null);
  };

  const onTestAndSave = async () => {
    if (addressError === "host_empty") {
      haptic.warning();
      Alert.alert(t("connect.validationIncomplete"), t("servers.errorHostEmpty"));
      return;
    }
    if (addressError === "port_invalid") {
      haptic.warning();
      Alert.alert(t("connect.validationIncomplete"), t("servers.errorPortInvalid"));
      return;
    }
    if (form.username.trim().length === 0) {
      haptic.warning();
      Alert.alert(t("connect.validationIncomplete"), t("connect.validationMessage"));
      return;
    }
    const baseUrl = composeBaseUrl(form);
    setTesting(true);
    setStatus({ text: t("connect.statusVerifying"), kind: "info" });
    await prewarmLocalNetwork(baseUrl);
    try {
      const config = toClientConfig({
        id: "probe",
        backend: "opencode",
        baseUrl,
        username: form.username.trim(),
        password: form.password,
      });
      await checkHealth(config);
      haptic.success();
      const trimmedNickname = form.nickname.trim() || undefined;
      if (isEdit && editing) {
        await updateServer(editing.id, {
          baseUrl,
          username: form.username.trim(),
          password: form.password,
          nickname: trimmedNickname,
        });
        if (router.canGoBack()) router.back();
        else router.replace("/servers");
      } else {
        const newId = await addServer({
          baseUrl,
          username: form.username.trim(),
          password: form.password,
          nickname: trimmedNickname,
        });
        void trackEvent(Ev.ServerAdd, { server_id: newId });
        router.dismissAll();
        router.replace("/sessions");
      }
    } catch (err) {
      haptic.error();
      const m = err instanceof Error ? err.message : String(err);
      trackEvent(Ev.ServerHealthCheckFail, {
        is_edit: isEdit ? "1" : "0",
        error: m.slice(0, 120),
      });
      setStatus({
        text: t("connect.statusFailed", { message: m }),
        kind: "error",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <KeyboardAwareScrollView
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── 启动命令 ── */}
          <View style={styles.cmdSection}>
            <Text style={styles.cmdHintText}>{t("servers.startHint")}</Text>
            <StartCmdRow cmd={t("servers.startCmd")} theme={theme} styles={styles} t={t} />
          </View>

          {/* ── 协议 ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t("servers.labelProtocol")}</Text>
            <View style={styles.segmented}>
              {PROTOCOL_OPTIONS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.segmentBtn, form.protocol === p && styles.segmentBtnActive]}
                  onPress={() => handleProtocolChange(p)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: form.protocol === p }}
                >
                  <Text
                    style={[styles.segmentText, form.protocol === p && styles.segmentTextActive]}
                  >
                    {p}://
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Host ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t("servers.labelHost")}</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.inputField}
                value={form.host}
                onChangeText={(v) => {
                  setForm((f) => ({ ...f, host: v }));
                  setStatus(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                placeholder={t("servers.placeholderHost")}
                placeholderTextColor={theme.colors.textTertiary}
                keyboardAppearance={theme.isDark ? "dark" : "light"}
              />
            </View>
          </View>

          {/* ── Port ── */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{t("servers.labelPort")}</Text>
            <View style={[styles.inputBox, styles.portBox]}>
              <TextInput
                style={styles.inputField}
                value={form.port}
                onChangeText={(v) => {
                  const digits = v.replace(/[^0-9]/g, "").slice(0, 5);
                  setForm((f) => ({ ...f, port: digits }));
                  setStatus(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                returnKeyType="next"
                maxLength={5}
                placeholder={t("servers.placeholderPort")}
                placeholderTextColor={theme.colors.textTertiary}
                keyboardAppearance={theme.isDark ? "dark" : "light"}
              />
            </View>
          </View>

          {/* ── 认证 ── */}
          <>
            <Text style={styles.sectionTitle}>{t("servers.sectionAuth")}</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t("servers.labelUsername")}</Text>
              <View style={styles.inputBox}>
                <TextInput
                  style={styles.inputField}
                  value={form.username}
                  onChangeText={(v) => {
                    setForm((f) => ({ ...f, username: v }));
                    setStatus(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  placeholder="opencode"
                  placeholderTextColor={theme.colors.textTertiary}
                  keyboardAppearance={theme.isDark ? "dark" : "light"}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t("servers.labelPassword")}</Text>
              <View style={[styles.inputBox, styles.inputRow]}>
                <TextInput
                  style={[styles.inputField, { flex: 1 }]}
                  value={form.password}
                  onChangeText={(v) => {
                    setForm((f) => ({ ...f, password: v }));
                    setStatus(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={isValid ? onTestAndSave : undefined}
                  placeholder={t("connect.placeholderPassword")}
                  placeholderTextColor={theme.colors.textTertiary}
                  keyboardAppearance={theme.isDark ? "dark" : "light"}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={theme.hitSlop}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? "eye-outline" : "eye-off-outline"}
                    size={18}
                    color={theme.colors.textTertiary}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </>

          {/* ── 昵称（可选）── */}
          <Text style={styles.sectionTitle}>{t("servers.labelNickname")}</Text>
          <View style={styles.inputGroup}>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.inputField}
                value={form.nickname}
                onChangeText={(v) => {
                  setForm((f) => ({ ...f, nickname: v }));
                  setStatus(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                placeholder={t("servers.placeholderNickname")}
                placeholderTextColor={theme.colors.textTertiary}
                keyboardAppearance={theme.isDark ? "dark" : "light"}
              />
            </View>
          </View>

          {/* ── 状态 ── */}
          {status ? (
            <Animated.View style={[styles.statusCard, { opacity: statusOpacity }]}>
              <StatusIcon kind={status.kind} theme={theme} />
              <Text
                style={[
                  styles.statusText,
                  status.kind === "success" && {
                    color: theme.colors.success,
                  },
                  status.kind === "error" && {
                    color: theme.colors.destructive,
                  },
                ]}
                numberOfLines={3}
              >
                {status.text}
              </Text>
            </Animated.View>
          ) : null}

          {/* ── 连接按钮 ── */}
          <TouchableOpacity
            style={[styles.primaryBtn, (!isValid || testing) && styles.primaryBtnDisabled]}
            onPress={onTestAndSave}
            disabled={!isValid || testing}
            activeOpacity={0.85}
          >
            {testing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Ionicons name="flash-outline" size={16} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>{t("connect.btnConnect")}</Text>
              </>
            )}
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StartCmdRow({
  cmd,
  theme,
  styles,
  t,
}: {
  cmd: string;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(cmd);
    haptic.selection();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <TouchableOpacity
      style={styles.startCmdBox}
      onPress={handleCopy}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t("common.copy")}
    >
      <Text style={styles.startCmdText} numberOfLines={1} ellipsizeMode="tail">
        {cmd}
      </Text>
      <Ionicons
        name={copied ? "checkmark" : "copy-outline"}
        size={14}
        color={copied ? theme.colors.success : theme.colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

function StatusIcon({ kind, theme }: { kind: StatusKind; theme: Theme }) {
  if (kind === "success")
    return <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />;
  if (kind === "error")
    return <Ionicons name="close-circle" size={16} color={theme.colors.destructive} />;
  return <ActivityIndicator size="small" color={theme.colors.textSecondary} />;
}

// ── 样式 ─────────────────────────────────────────────────

function makeStyles(theme: Theme) {
  const { colors, spacing, radius, typography } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.groupedBackground },
    flex: { flex: 1 },

    formContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxxl,
      width: "100%",
      maxWidth: breakpoints.formMaxWidth,
      alignSelf: "center",
    },

    // ── 启动命令 ──
    cmdSection: {
      marginBottom: spacing.xs,
    },

    cmdHintText: {
      ...typography.caption1,
      color: colors.textTertiary,
      marginBottom: spacing.xs,
    },
    startCmdBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 9,
      paddingHorizontal: spacing.md,
      borderRadius: radius.card,
      backgroundColor: colors.separator,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    startCmdText: {
      ...typography.caption1,
      color: colors.textSecondary,
      flex: 1,
    },

    // ── 区块标题 ──
    sectionTitle: {
      ...typography.caption1,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      fontWeight: "500",
      marginTop: spacing.xl,
      marginBottom: spacing.xs,
    },

    // ── 输入块 ──
    inputGroup: {
      marginTop: spacing.sm,
    },
    inputLabel: {
      ...typography.caption1,
      color: colors.textTertiary,
      marginBottom: 6,
    },
    inputBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    inputField: {
      ...typography.body,
      color: colors.text,
      padding: 0,
      margin: 0,
    },
    portBox: {
      alignSelf: "flex-start",
      minWidth: 120,
    },
    eyeBtn: {
      padding: spacing.xs,
      marginLeft: spacing.sm,
    },

    // ── Segmented Control ──
    segmented: {
      flexDirection: "row",
      backgroundColor: colors.separator,
      borderRadius: radius.card,
      padding: 3,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 9,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Math.max(radius.card - 3, 4),
    },
    segmentBtnActive: {
      backgroundColor: colors.surface,
      shadowColor: "#000",
      shadowOpacity: theme.isDark ? 0 : 0.1,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 3,
      elevation: 2,
    },
    segmentText: {
      ...typography.subheadline,
      color: colors.textSecondary,
    },
    segmentTextActive: {
      ...typography.subheadline,
      color: colors.text,
      fontWeight: "600",
    },

    // ── 状态卡片 ──
    statusCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      marginTop: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    statusText: {
      ...typography.footnote,
      color: colors.textSecondary,
      flex: 1,
      lineHeight: 18,
    },

    // ── 主按钮 ──
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.card,
      paddingVertical: 15,
      marginTop: spacing.lg,
      shadowColor: colors.accent,
      shadowOpacity: theme.isDark ? 0.4 : 0.25,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      elevation: 4,
    },
    primaryBtnDisabled: {
      opacity: 0.4,
      shadowOpacity: 0,
      elevation: 0,
    },
    primaryBtnText: {
      ...typography.bodyEmphasized,
      color: "#FFFFFF",
    },
  });
}
