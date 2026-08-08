# KKCode Community

React Native (Expo) 移动端项目，支持 iOS 和 Android。

## 环境变量

所有密钥已配置在 `~/.zshrc`，无需手动传入：

- `KEYCHAIN_PASSWORD` — Mac 登录密码，用于解锁 keychain
- `TEAM_ID` — Apple 开发者团队 ID（仅构建 IPA 时需要）
- `PGYER_API_KEY` / `PGYER_USER_KEY` — 蒲公英分发平台密钥

## 常用命令

### 测试

```bash
# 单元测试(mock,每次都跑)
npm test

# 集成测试(对真实 opencode serve 端到端,服务器不可达自动 SKIP)
npm run test:integration
```

### 开发

```bash
# 启动 Metro
npm start

# 运行 iOS 模拟器
npm run ios

# 运行 Android 模拟器
npm run android

# 类型检查
npm run typecheck

# 运行测试
npm test
```

BottomSheet 高度与滚动统一规范见 [AGENTS.md § BottomSheet 高度适配](./AGENTS.md#bottomsheet-高度适配)。

## 目录结构

- `assets/` — Expo 打包静态资源（应用图标等）
- `src/` — 业务代码（8 子目录：api/components/hooks/i18n/services/store/theme/utils）

- `api/` — opencode HTTP/SSE 客户端层（client/dispatch/events/sse，含 listCommandsV2/executeCommand）
- `components/` — React 组件（OpenCode ChatScreen、消息与通用界面组件）
- `hooks/` — 自定义 hook（useResponsive/useStickToBottom）
- `i18n/` — 国际化（i18next + 21 种语言 locales，en 为键源、zh-CN 为语义锚点，含 CLDR 复数与 command.* 命名空间）
- `services/` — 服务适配层（analytics/crashlytics no-op 桩 + dev-logger）
- `store/` — Zustand 状态管理（详见 [src/store/CLAUDE.md](src/store/CLAUDE.md)）
- `theme/` — 主题系统（colors/spacing/typography/breakpoints）
- `utils/` — 工具函数（auth/haptics/secure-store/time 等）
- `locales/` — Expo 原生 iOS 本地化资源（21 种语言，覆盖应用名及本地网络权限说明）
- `test/` — 自定义 TypeScript 单元测试套件（含 i18n 键覆盖、插值、CLDR 复数与原生权限回归）
- `plugins/` — Expo Config Plugin（构建兼容修正）
- `dist/` — 构建产物（IPA 输出目录）

## Slash Command 系统

设计/技术参考: 已删除（社区版不维护）

键盘避让规范见 [AGENTS.md § Android 键盘适配](./AGENTS.md#android-键盘适配keyboardavoidingview) —— 项目唯一的 KAV 规范源，本文件不再保留章节，避免双写走样。
