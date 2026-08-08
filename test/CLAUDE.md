# test/

> L2 | 父级: /CLAUDE.md

成员清单
auth.test.ts: 认证头与基础认证行为测试
biometric.test.ts: 生物识别锁屏开关偏好持久化测试
bottom-sheet-layout.test.ts: BottomSheet 精确高度纯逻辑测试，覆盖短内容完整展示、90% 封顶滚动、键盘压缩与 1px 临界容差
chat-initial-anchor.test.ts: 聊天首屏贴底/稳定/等待/可重试故障超时回归测试
image-layout.test.ts: 全屏图片横图/竖图/无效尺寸的等比视口适配回归测试
client.test.ts: OpenCode HTTP 客户端测试，覆盖认证、目录路由、Prompt/Command 顶层 variant、文件内容、会话消息与 workspace diff 响应解析
workspace-diff.test.ts: 工作区多文件 raw diff 解析与内存预览交接测试，覆盖按文件切分、目录树构建/展开路径、文本 patch 转换、二进制文件识别及全屏预览数据读取
ansi.test.ts: ANSI SGR 解析器单元测试
commands.test.ts: slash command store 缓存与状态测试
connection.test.ts: 多服务器连接状态测试
directory-prefs.test.ts: 目录偏好持久化测试
dispatch-delta.test.ts: SSE delta 最小 32ms+rAF 节流、跨会话原子提交、message 完成时消息壳与早到 pending delta 原子合并、part 完成前 flush 与 v2 删除字段 pending discard 测试
draft.test.ts: 会话草稿状态测试
events.test.ts: OpenCode 事件解析测试
file-preview.test.ts: 文件扩展名分类（文本/图片/Markdown）判定测试
haptics-prefs.test.ts: 触感偏好测试
harness.ts: 轻量测试运行基座，提供 test/skip/summary
image-attach.test.ts: 图片附件选择与发送测试
i18n.test.ts: 设备语言解析、21 语键覆盖、插值、CLDR 复数与原生权限本地化回归测试
integration.test.ts: 真实 OpenCode 服务集成测试
lan-host.test.ts: 局域网 host 识别测试
lan-permission.test.ts: 本地网络权限预热判定（shouldPrewarmLocalNetwork）测试
markdown-strip.test.ts: markdown 源码剥离为纯文本的正则规则测试
message-text.test.ts: 从 MessageWithParts 提取可复制纯文本测试
messages-delta.test.ts: appendDeltas 帧内批量 delta、尾项快速路径/非尾项回退与跨 session 引用稳定性测试
model.test.ts: 模型选择与状态测试，覆盖会话模型 > 全局最近主动选择 > Server 配置模型的初始化优先级及 variant 合法化、持久化与空会话恢复
onboarding.test.ts: 首次引导状态测试
pending-open.test.ts: iPad 双栏会话 id 桥接 store 测试
project-sessions.test.ts: 项目会话分组测试
question-refetch.test.ts: 问题工具 refetch 测试
questions.test.ts: question store add/remove/reset 与去重测试
register-mocks.ts: Node 测试环境 React Native/Expo mock 与字体/图片静态资源注册入口，支持可控 RN 尺寸/配色状态
responsive.test.ts: useResponsive hook 响应式布局判断测试
run-integration.ts: 集成测试统一执行入口
run.ts: npm test 单元测试统一执行入口
server-url.test.ts: 服务器 URL 规范化测试
session-prefs.test.ts: 会话列表子会话显隐偏好持久化测试
session-status.test.ts: 会话运行状态测试
slash-parse.test.ts: slash command 输入解析测试
sse.test.ts: SSE 协议解析测试
stick-to-bottom.test.ts: 聊天置底状态机测试，覆盖稳定控制器引用、Android touchCancel 原生接管竞态、drag/momentum 实时落点解锁与 iOS 慢拖到底
stores.test.ts: Zustand stores 聚合测试，覆盖消息 parent-child 乱序竞态、parts 保留、快照合并及权限/会话行为
theme.test.ts: 主题 store 持久化迁移与 useTheme 聚合对象引用稳定性测试
time.test.ts: 时间分隔与日期格式测试
typography.test.ts: makeTypography 字号阶梯构建与缩放测试

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
