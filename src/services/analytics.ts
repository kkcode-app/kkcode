/**
 * [INPUT]: 无外部依赖（社区版已移除 Firebase，全部 no-op）
 * [OUTPUT]: 对外提供 AnalyticsEvents 常量对象（事件名单一真理源）、trackEvent / setUserId / setUserProperty 三个 no-op 函数
 * [POS]: src/services/ 的分析适配层桩，保留事件名常量与函数签名供业务侧无感调用，未来接入其他监控只需改此文件
 * [PROTOCOL]: 变更时更新此头部，然后检查 src/services/CLAUDE.md
 */
// Analytics stub. 社区版已移除 Firebase 依赖，所有调用静默 no-op。
// 保留 AnalyticsEvents 常量与函数签名，业务侧调用方无需改动。

export const AnalyticsEvents = {
  // ── App lifecycle ───────────────────────────────────
  AppStart: "app_start",
  AppActiveFromBackground: "app_active_from_background",

  // ── Server / Connection ─────────────────────────────
  ServerSwitch: "server_switch",
  ServerAdd: "server_add",
  ServerRemove: "server_remove",
  ServerHealthCheckFail: "server_health_check_fail",
  ConnectionStateChange: "connection_state_change",
  SseFatalRecovered: "sse_fatal_recovered",

  // ── Session lifecycle ───────────────────────────────
  SessionCreate: "session_create",
  SessionDelete: "session_delete",
  SessionRename: "session_rename",
  SessionOpen: "session_open",
  SessionEditModeEnter: "session_edit_mode_enter",
  SessionEditModeExit: "session_edit_mode_exit",
  SessionBulkDeleteResult: "session_bulk_delete_result",
  ProjectGroupExpand: "project_group_expand",
  ProjectGroupLoadFail: "project_group_load_fail",
  SessionGroupByProjectToggle: "session_group_by_project_toggle",

  // ── Directory ───────────────────────────────────────
  DirectorySwitch: "directory_switch",

  // ── Onboarding ───────────────────────────────────────
  OnboardingCompleted: "onboarding_completed",
  OnboardingViewed: "onboarding_viewed",

  // ── Chat core ────────────────────────────────────────
  ChatScreenOpen: "chat_screen_open",
  ChatHistoryLoadFail: "chat_history_load_fail",
  ChatFirstToken: "chat_first_token",
  NoServerCtaTap: "no_server_cta_tap",
  MessageSend: "message_send",
  MessageCopy: "message_copy",
  MessageOpenSelectText: "message_open_select_text",
  ImageAttach: "image_attach",
  ImagePickFail: "image_pick_fail",
  ImageViewFull: "image_view_full",
  CodeCopy: "code_copy",
  ReasoningExpand: "reasoning_expand",
  ScrollToLatestTap: "scroll_to_latest_tap",

  // ── Streaming / abort ──────────────────────────────
  MessageAbortAttempt: "message_abort_attempt",
  SessionAbort: "session_abort",

  // ── Slash commands ─────────────────────────────────
  SlashPickerOpen: "slash_picker_open",
  SlashPickerPick: "slash_picker_pick",
  CommandExecuted: "command_executed",

  // ── Agent / Model picker ──────────────────────────
  AgentSelect: "agent_select",
  AgentSheetOpen: "agent_sheet_open",
  ModelSelect: "model_select",
  ModelSheetOpen: "model_sheet_open",

  // ── Tool detail ─────────────────────────────────────
  ToolDetailOpen: "tool_detail_open",
  ToolDetailNavigateSubSession: "tool_detail_navigate_sub_session",

  // ── Permission / Question ──────────────────────────
  PermissionResponse: "permission_response",
  QuestionReplySubmit: "question_reply_submit",
  QuestionReject: "question_reject",

  // ── Chat errors ─────────────────────────────────────
  ChatLoadFailRetry: "chat_load_fail_retry",

  // ── Settings / Personalization ──────────────────────
  ThemeModeChange: "theme_mode_change",
  LanguageChange: "language_change",
  HapticsToggle: "haptics_toggle",
  BiometricToggle: "biometric_toggle",
  WebLinkOpen: "web_link_open",

  // ── Errors ──────────────────────────────────────────
  AppError: "app_error",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export type EventParams = Record<string, string | number | boolean | null | undefined>;

export async function trackEvent(
  _name: AnalyticsEventName | string,
  _params?: EventParams,
): Promise<void> {
  // no-op (社区版已移除 Firebase Analytics)
}

export async function setUserId(_id: string | null): Promise<void> {
  // no-op
}

export async function setUserProperty(_name: string, _value: string | null): Promise<void> {
  // no-op
}
