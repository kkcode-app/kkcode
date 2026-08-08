# src/store/

> L2 | 父级: /CLAUDE.md

成员清单
MODEL_SELECTION.md: 聊天模型与思考档位默认选择权威规则，约束非空会话末项 > 空会话最近主动选择 > Server 配置模型优先级、variant 合法性、异步门闩、一次性初始化与禁止改法
biometric.ts: useBiometricStore，生物识别锁屏开关状态与持久化
commands.ts: useCommandStore，server slash 命令（CommandV2Info[]）缓存与 load/reset，由 useEventStream 在 server.connected 时触发 load，含 useCommands/useCommandByName 派生 selector
connection.ts: useConnectionStore + OpenCode Server 类型 + toClientConfig，管理服务器连接、旧数据迁移、当前 active 与 OpenCode API 配置派生
directory-prefs.ts: useDirectoryPrefsStore，showHidden / recentDirs 等目录浏览偏好与持久化
dev-access.ts: useDevAccessStore，管理设置页开发者入口的显隐与持久化，被 app/about 的 Logo 十连击切换、被 app/settings 消费决定入口显隐、被 dev-panel/DevTools 提供关闭开关
draft.ts: useDraftStore，按 sessionID 隔离的草稿文字与图片附件（内存态）
haptics-prefs.ts: useHapticsPrefsStore，触感反馈开关偏好与持久化
messages.ts: useMessagesStore，会话消息与 parts 的规范化存储、assistant.parentID 因果顺序修复、最新页无损合并、可原子合并 pending delta 的 message upsert、流式末项 O(1) 命中、帧内批量 delta 与分页、upsertPart 对 text/reasoning 保留更长流式文本
model.ts: useModelStore + resolveMessageModel + normalizeModelSelection + resolveInitialModel，管理 Agent/Model/variant、按 sessionID 隔离的选择记忆、按模型去重且保留最近主动 variant 的持久化及非空会话末项/空会话最近主动选择/Server 配置默认模型优先级
onboarding.ts: useOnboardingStore，首次引导完成状态与持久化
pending-open.ts: usePendingOpenStore，iPad 双栏下 select-directory 创建新会话后回传 id 给 sessions 容器的桥接
permissions.ts: usePermissionStore，待处理工具权限请求队列
questions.ts: useQuestionStore，服务端 pending question 状态
sessions.ts: useSessionsStore，会话列表存储、增删改与排序
session-prefs.ts: useSessionPrefsStore，会话列表显示偏好（showSubSessions 子会话显隐、groupByProject 按项目分组开关，默认 true）与持久化（JSON 格式，兼容旧 "0"/"1" 字符串）
status.ts: useStatusStore，SSE 连接状态与错误信息
theme.ts: useThemeStore，明暗 mode（system/light/dark）及其持久化，兼容旧 opencode-mobile 迁移

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
