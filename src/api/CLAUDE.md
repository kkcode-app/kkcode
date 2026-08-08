# src/api/

> L2 | 父级: /CLAUDE.md

成员清单
client.ts: opencode HTTP 客户端，Basic Auth + directory 路由（query 双编码 + x-opencode-directory header）+ 可选中继 capability header，Prompt/Command 顶层 variant 协议，导出 listPath/getFileContent/listProjects/listSessions/getSession（深链单条会话读取）/createSession/deleteSession/updateSessionTitle/getSessionMessages/getSessionDiff/getWorkspaceStatus/getWorkspaceRawDiff/getSessionMessagesPage/sendPrompt/abortSession/replyPermission/replyQuestion/listSessionQuestions/rejectQuestion/listAgents/listCommandsV2/executeCommand/listProviders/getConfig 与 HttpError、ClientConfig、ProviderInfo、Agent、Model 等类型
dispatch.ts: 纯函数事件分发器（无 React/RN 依赖），把 /global/event 的 SSE payload 路由到对应 Zustand store，含 rAF 对齐/最小 32ms 间隔的原子 delta 提交、message 完成时消息壳与 pending delta 原子合并、part 完成前 flush、删除事件 pending discard、text/reasoning 早到 delta 保留与 inflight 去重 refetchQuestions
events.ts: useEventStream React hook，订阅全局 SSE 流并派发到 store，含重连后 question resync 与 connection 状态上报，接收 foregroundEpoch 在 App 从后台回前台时强制 dispose 旧连接并重新 subscribe（避免用户回聊天页看到后台期间残留的 "连接出错"）
sse-types.ts: SSE 事件类型定义（EventPayload / GlobalEvent），独立于 sse.ts 以避免拉入 react-native-sse 的 XHR 依赖
sse.ts: SSE 订阅器，react-native-sse EventSource 封装，纯函数化的重连策略（createReconnectState/recordError/recordSuccess/isAuthError）+ setEventSourceFactory 注入测试 mock + 指数退避重连 + 连续失败阈值 onFatal

依赖
@opencode-ai/sdk/v2: 类型定义（Session/Message/Part/FileNode/PermissionRequest/CommandV2Info）
react-native-sse: EventSource 实现（基于 XHR）
../utils/auth: Basic Auth header 与 authToken 生成
../store/*: dispatch 的写入目标（sessions/messages/permissions/questions/status）
../services/analytics: connection_state_change 埋点

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
