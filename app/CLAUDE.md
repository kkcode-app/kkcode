# app/

> L2 | 父级: /CLAUDE.md

成员清单
_layout.tsx: Expo Router 根布局，挂载主题、i18n（跟随系统时监听 locale/前台恢复）、OpenCode SSE 等状态启动逻辑与全局导航容器；非 Liquid Glass 的 iOS 自绘导航栏
about.tsx: 关于二级页，集中展示应用版本与法律入口（第三方 SDK / 开源许可），App Logo 每连续点击 10 次切换设置页开发者入口显隐（dev-access store）
dev-panel.tsx: 开发者面板二级页，通过 about 页 Logo 十连击进入，Tab 容器承载概览/存储/状态/日志/网络/工具六个调试 Tab；工具页可控制开发者入口标记，进入时初始化 console/fetch 拦截，按 AGENTS.md KAV 规范包裹 KeyboardAvoidingView
appearance.tsx: 外观二级设置页，固定顶部实时预览，仅提供系统/浅色/深色三档主题模式切换
chat/: 会话详情路由目录，承载聊天消息列表和输入交互
chat/[id].tsx: 聊天路由壳（iPad 双栏 detail 侧），绑定 sessionID prop
file-browser.tsx: 会话工作目录浏览页，复用 directory-prefs 隐藏文件开关，按绝对路径逐级列目录，顶部面包屑/返回上级，非文本非图片文件直接 toast，文本或图片跳转 file-preview
file-preview.tsx: 文件预览页，展示常见文本/plist、Markdown 渲染/源码切换及 base64 图片，其他二进制文件显示不可预览提示
workspace-diff.tsx: 工作区变更页，按会话 directory 并行读取 VCS 状态与多文件 raw diff，以可展开目录树组织改动文件，保留内嵌 patch 并可一键打开全屏单文件 diff
workspace-diff-file.tsx: 工作区单文件全屏 diff 页，通过短生命周期内存预览 key 复用上一页已解析的 patch，不重复请求 OpenCode VCS 接口
index.tsx: 入口路由，按连接/引导状态分流
language.tsx: 可搜索且按固定顺序展示的语言二级设置页，首项为跟随系统；手动语言偏好会持久化
license/: 单库许可证详情路由目录，按 id 展示协议全文
license/[id].tsx: 单库许可详情路由壳，绑定 id prop
licenses.tsx: 开源许可页，展示依赖许可证信息
message-text.tsx: 选择文本子页面路由，长按消息「选择文本」入口，以只读多行 TextInput 提供系统完整选择菜单与任意片段复制，避开 ChatScreen VirtualizedList 手势冲突
onboarding.tsx: 首次使用引导页，介绍服务器地址连接
select-directory.tsx: 新建会话目录选择页，浏览并选择工作目录；支持由项目分组页传入 worktree 作为初始目录
server-edit.tsx: OpenCode 手动服务器编辑页，新增或修改 Basic Auth 连接配置
servers.tsx: OpenCode 服务器列表页，提供服务器地址输入
sessions.tsx: OpenCode 会话入口，默认按项目分组（设置页 groupByProject 可切扁平），提供创建与聊天行为
settings.tsx: 设置一级页，承载服务器/语言/外观/个性化/关于入口，BottomSheet 用于打赏
schema-url.tsx: URL Scheme 说明页，展示 kkcode-community:// 协议前缀与可用 deep link 路由，点击复制
webview.tsx: WebView 承载页，展示外部或服务端页面

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
