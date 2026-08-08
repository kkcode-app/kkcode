# 聊天模型默认选择规则

> 本文是聊天页模型下拉框初始化行为的权威约束。修改 `model.ts` 或 `ChatScreen.tsx` 的模型初始化逻辑前必须先阅读。

## 唯一优先级

聊天页每次进入一个会话时，模型只能按以下顺序初始化：

1. **已有聊天记录**：使用当前会话最后一条消息携带的模型与 `variant`；user 读取 `message.model`，assistant 读取其顶层 `providerID/modelID/variant`。
2. **新会话且用户主动选择过**：使用全局 `recent[0]`，即用户最近一次在模型下拉框中主动确认的模型与思考档位。
3. **首次安装且从未选过模型**：使用 OpenCode Server `GET /config` 返回的顶级 `model`。
4. **异常兜底**：前三项不存在或已被 Server 下线时，才使用首个 Provider 的 Server 默认模型，再退到该 Provider 的首个模型。

空会话只检查 `recent[0]`，禁止向后遍历更旧的主动选择；非空会话只检查最后一条消息，禁止回退到全局 `recent`。分支候选无效后都进入 Server 默认链。每个候选都必须通过当前 `providers` 列表校验；历史 `variant` 不在当前模型的 `variants` 中时保留模型并清除档位。

## 思考档位约束

- `variant: undefined` 表示使用 Server / Agent 默认设置，请求体省略顶层 `variant`。
- `variant: "none"` 是模型可声明的真实档位，必须原样发送，不能当作默认值清除。
- Server 内部可能返回的 `"default"` 统一规范化为 `undefined`，Mobile 不发送 `"default"`。
- `variant` 只有在当前模型的 `variants` 中是自有属性时才合法；未知值会被清除，避免 Server 静默 no-op。
- `recent` 按 Provider + Model 去重，但保存该模型最近一次主动选择的合法档位；空会话由它恢复模型与思考强度。

## 异步门闩

“消息数组暂时为空”不等于“新会话”，“`recent` 暂时为空”也不等于“首次安装”。初始化前必须同时满足：

- 当前会话的首屏聊天记录请求已经结束，包括失败结束。
- `recentHydrated === true`，AsyncStorage 中的全局最近选择已经恢复。
- `GET /config` 与 `GET /config/providers` 均已结束，包括失败结束。

缺少任一门闩时不得提前选择兜底模型，否则网络和本地存储的返回顺序会改变最终结果。

## 生命周期约束

- 每个会话只自动初始化一次。后续 SSE 消息、Provider 刷新或 `recent` 更新不得覆盖用户刚刚主动选择的模型。
- 切换会话时必须先清除上一个会话的全局 `selectedModel`，禁止把它作为新会话的候选。
- `sessionSelections` 可以记录当前 UI 状态，但不能高于聊天记录、全局最近选择和 Server 配置参与默认值决策。
- 只有用户在模型下拉框中主动确认时才能调用 `addRecent`。自动初始化不得写入 `recent`，否则首次安装语义会被永久污染。
- 用户主动选择后必须立即锁定本会话的初始化状态，异步返回不得反向覆盖。

## 代码边界

- 最后一条消息的模型提取统一由 `resolveMessageModel` 实现，默认优先级与候选有效性统一由 `resolveInitialModel` 实现，档位合法性统一由 `normalizeModelSelection` 实现。
- `ChatScreen` 只负责传入消息数组末项并管理异步门闩与一次性初始化。
- 调整规则时必须同步修改 `test/model.test.ts`，至少覆盖已有会话、新会话、首次安装和无效候选四种场景。

## 禁止改法

- 禁止因为 `selectedModel` 当前合法就直接保留，它可能来自上一个会话。
- 禁止把 Server `config.model` 放到 `recent[0]` 前面。
- 禁止空会话遍历 `recent.slice(1)`，也禁止非空会话回退到全局 `recent`。
- 禁止在消息请求完成前根据空数组判定新会话。
- 禁止在 `recentHydrated` 前根据空 `recent` 判定首次安装。
- 禁止在 effect 每次依赖变化时重复初始化模型。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
