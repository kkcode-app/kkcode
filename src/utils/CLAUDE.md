# src/utils/

> L2 | 父级: /CLAUDE.md

成员清单
auth.ts: Basic Auth 头生成与凭据类型定义，供 src/api/client 的所有 HTTP 请求与 src/api/sse 的 SSE 订阅消费
ansi.ts: 零依赖 SGR 转义码解析器（parseAnsi/hasAnsi/ansiColorToHex）与 ANSI_NAMED_*_LIGHT/DARK 16 色 hex 调色板，纯字符串扫描不依赖 RN，被 components/ToolDetailModal 的 AnsiText 消费以在 bash 工具输出中渲染彩色 ANSI 文本
bottom-sheet-layout.ts: BottomSheet 统一高度纯计算器，以视口/键盘/安全区/固定区/完整内容实测值返回精确 Sheet 高度、body viewport 与 1px 容差溢出判定
chat-initial-anchor.ts: 聊天首屏贴底判定纯函数（isInitialChatViewportAtBottom / shouldRevealInitialChatList / hasInitialChatAnchorFailed）与稳定、等待、故障超时常量，被 ChatScreen 与 test/chat-initial-anchor 复用
image-layout.ts: 全屏图片预览等比适配视口的纯函数 fitImageWithinViewport，被 PartView 与 test/image-layout 复用
file-preview.ts: 主流编程语言、脚本、构建配置（含 plist）、Markdown 与常见图片文件名/扩展名判定规则，被 file-browser/file-preview 路由共同消费
workspace-diff.ts: OpenCode 多文件 raw unified diff 的按文件索引、目录树构建/展开路径提取与文本 patch 转换纯函数，被 workspace-diff 路由与 test/workspace-diff 复用
workspace-diff-preview.ts: 有容量上限的内存预览缓存，用 opaque key 把当前已解析的单文件 diff 交给全屏详情路由，不持久化且不触发网络请求
haptics.ts: 触感反馈封装，基于 react-native-haptic-feedback（iOS Core Haptics + Android Composition API），按设置 store enabled 开关触发强弱/成功/警告/错误反馈
image-attach.ts: 相册选图 + 相机拍照 + base64 data URL 编码工具，把 expo-image-picker 结果封装成服务端 FilePartInput，供 chat 页发送图片
install-guard.ts: 应用首启动标志位工具，区分首次安装与升级路径
markdown-styles.tsx: react-native-markdown-display 主题化样式与自定义渲染规则共享层，makeMarkdownStyles/makeMarkdownRules 被 PartView 与 file-preview 消费；可按调用方启用原生手势横向滚动及独立底色透明度，确保聊天长代码行可完整查看、背景可透出且文字不随底色变淡
markdown-strip.ts: markdown 源码剥离工具，正则剥离标题井号/加粗/斜体/行内代码/链接等符号转纯文本，被 ChatScreen 长按菜单「复制」项消费
message-text.ts: 消息纯文本提取工具，从 MessageWithParts 拼接 text/reasoning part 的 markdown 源码，被 ChatScreen 长按菜单与 message-text 选择页消费
lan-host.ts: LAN host 判定工具，识别 IPv4 RFC1918/169.254/16、IPv6 ULA 与 link-local，给预热本地网络权限判断用
lan-permission.ts: iOS 14+ 本地网络访问权限预热工具，在正式连接前发一次无害 HEAD 触发系统弹窗
secure-store.ts: SecureStore 跨平台封装，iOS 用 Keychain、Android 用 Keystore，附带 web fallback 检测
secure-store.web.ts: SecureStore 在 web 端的退化实现，提示用户不支持
server-url.ts: baseUrl 拆分/拼接工具，连接表单三段化 host/port/protocol 的解析与校验
session-status.ts: 会话流式状态工具，从消息 parts 派生当前是否仍在生成中
project-sessions.ts: 项目/会话分组工具，优先 projectID、再按最长 worktree 路径前缀兼容旧会话，并从会话派生最近对话时间
slash-parse.ts: slash command 文本解析纯函数 parseSlashCommandText（首行拆 name/args，CRLF 归一化，多行 args 保留），被 ChatScreen.onSend 与 test/slash-parse 消费
time.ts: 时间分隔符工具，5 分钟阈值判定 shouldShowTimeSeparator + 今天/昨天/日期格式化 formatTimeSeparator，被 ChatScreen 消息列表消费
dev-secure-keys.ts: 开发面板辅助文件，硬编码项目所有 SecureStore key 清单（expo-secure-store 无 getAllKeys API），被 dev-panel/DevStorage 消费

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
