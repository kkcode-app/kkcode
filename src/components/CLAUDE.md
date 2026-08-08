# src/components/

> L2 | 父级: /CLAUDE.md

成员清单
AppWebView.tsx: 应用内 WebView 组件，封装 react-native-webview 加载状态与导航处理，并隔离 iOS 专属属性以避免 Android Fabric 原生类型转换崩溃
BottomSheet.tsx: 项目级底部弹层唯一容器，实测固定区/完整内容/键盘可用区后精确自适应，统一封顶 90% 且仅内容真实溢出时开启滚动，保留下拉关闭手势
ChatScreen.tsx: 会话详情核心组件（接收 sessionID prop），按需读取未缓存会话元数据后按当前会话切片订阅消息，承载透明壁纸首屏遮罩/可重试首屏定位/无损重连补齐/可等待去重分页 VirtualizedList、窗口内惰性行派生与输入栏/隐藏 Sheet 隔离、useStickToBottom 平滑跟随与消息导航状态机、基于 @lobehub/icons-rn ModelIcon 模型品牌优先且 ProviderIcon 厂商回退的紧凑 Agent/模型/二级思考强度选择、输入栏短模型标签自然包裹且长标签在固定操作图标前安全省略、非空会话末项/空会话最近主动选择/Server 配置三级模型初始化、顶层 variant 安全透传、工作区文件/变更快捷入口、横竖屏自适应的平台隔离键盘避让、防并发发送、消息操作
CommandPicker.tsx: Slash 命令候选单实现源，共享 useCommandStore 缓存、刷新/过滤/行渲染与 loading/error/empty 三态；CommandAutocomplete 为聊天输入浮层，CommandPicker 保留 BottomSheet palette 形态
DiffViewer.tsx: 零依赖代码展示组件，DiffViewer 渲染文件改动与增删行、支持可选全屏入口，CodePreview 按扩展名做轻量源码高亮，被文件预览页复用
EmptyState.tsx: 通用空态组件，圆环图标 + 标题 + 描述 + 可选 CTA，被 sessions/servers/select-directory/ChatScreen 等"无数据"展示位消费
ErrorBoundary.tsx: React ErrorBoundary 组件，捕获渲染异常并展示降级 UI
NotchBranding.tsx: 刘海品牌水印 overlay 组件，仅 iOS 渲染（absolute 定位在灵动岛/刘海区域显示 App Logo + 名称），Android 无灵动岛返回 null，被 _layout.tsx 挂载在 Stack 之上；当前全局关闭（`NOTCH_BRANDING_ENABLED = false`）恒返回 null，代码完整保留供日后恢复
PartView.tsx: 消息 Part 渲染器，复用 MarkdownIt/renderer 静态配置，普通回答 Markdown 代码块用原生手势稳定横滑、按聊天背景透明联动并支持复制，reasoning 流式期自动展开、完成后由 Reanimated FadeIn/FadeOut 局部淡入淡出且点击显隐，工具详情、图片等比全屏与双端缩放拖动，question/todo 摘要通过 i18next CLDR 复数规则本地化
PermissionBanner.tsx: 会话级权限请求阻断层，展示当前请求并提交 always/once/reject
QuestionBanner.tsx: 会话级问题提示条，展示等待回答状态并唤起问题交互
QuestionPrompt.tsx: AI 提问交互组件，在输入区分步处理单选、多选与自定义文本
ResponsiveContainer.tsx: 宽屏单列页限宽并水平居中的通用布局容器
SessionInfoModal.tsx: 会话信息弹层，编辑元数据并按需展示工作区文件差异
Skeleton.tsx: 通用 shimmer 骨架屏与列表加载占位组件
TimeSeparator.tsx: 聊天消息列表的时间分隔组件
ToolDetailModal.tsx: 工具调用详情弹层，统一展示文本、差异与 ANSI 输出；Question 历史详情保留用户回答并完整展示当时可选项，以选中态区分原回答
dev-panel/: 开发者面板组件目录（仅 **DEV** 可见），含 JsonView/DevInspectModal/DevOverview/DevStorage/DevStores/DevLogs/DevNetwork/DevTools 八个组件，详见 dev-panel/CLAUDE.md

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
