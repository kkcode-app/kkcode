# KKCode Community

**OpenCode 的移动端遥控客户端（iOS + Android / iPad / Android 平板）。社区维护版。**

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![中文](https://img.shields.io/badge/lang-中文-red)](README.zh-CN.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)]()
[![Expo SDK 56](https://img.shields.io/badge/Expo%20SDK-56-000020?logo=expo)]()
[![React Native 0.85](https://img.shields.io/badge/React%20Native-0.85-61DAFB?logo=react)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-~6.0-3178C6?logo=typescript)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

基于 Expo SDK 56 + React Native 0.85 + React 19.2 + TypeScript。
把 Mac 上的 `opencode serve` 当后端，手机当客户端，远程跟 AI 编码会话对话。
**不需要改 OpenCode 本体**，只是再加一个 HTTP + SSE 客户端。

仅供 LAN（同一局域网）使用：手机和 Mac 需要在同一 Wi-Fi 下。

> 📖 **新成员入口**：[CLAUDE.md](CLAUDE.md)（环境变量 / 常用命令 / 子目录约定）
> 🤝 **想贡献**：[CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
> 🔒 **安全漏洞**：[SECURITY.md](SECURITY.md)

## 5 分钟上手

```bash
npm install --legacy-peer-deps    # SDK 与 RN 之间有些 peer 警告
npx expo start                    # 启动 Metro
```

然后：

- 扫码 — Expo Go 打开（推荐）
- `i` — iOS 模拟器
- `a` — Android 模拟器

Mac 端启动 OpenCode 服务器：

```bash
OPENCODE_SERVER_PASSWORD='<32-char-random>' \
  opencode serve --hostname 0.0.0.0 --port 4096
```

手机与 Mac 在同一局域网即可访问。

## 架构与项目地图

> **新成员请先读 [CLAUDE.md](CLAUDE.md)** —— 那是项目唯一的入口文档（环境变量、常用命令、子目录约定）。
>
> 本 README 只负责"5 分钟了解项目"，不进细节。

## 规范与铁律

| 主题                | 入口                                                   |
| ------------------- | ------------------------------------------------------ |
| 键盘避让（KAV）     | [AGENTS.md](AGENTS.md) § Android 键盘适配 — 唯一权威源 |
| 聊天滚动铁律        | [AGENTS.md](AGENTS.md)                                 |
| 常用命令 + 环境变量 | [CLAUDE.md](CLAUDE.md)                                 |
| 代码结构导览        | [app/CLAUDE.md](app/CLAUDE.md) + 各子目录 CLAUDE.md    |

## 已实现的能力（v1 概览）

- 多服务器连接配置（baseUrl / 用户名 / 密码），凭证用 `expo-secure-store` 加密（schema v3）
- 项目目录列表与切换（`GET /project`）
- 会话列表 / 新建 / 删除 / 长按删除 / iPad 双栏 master-detail
- 对话页：流式渲染 `text` / `reasoning` / `tool` / `file` / `agent` parts
- 全局 SSE 订阅 `/global/event`，自动指数退避重连，rAF 节流 delta
- 权限审批弹层：拦截 `permission.asked` / `question.asked` 事件
- 模型 / Agent 选择，按会话独立记忆
- iPad 横屏 + 分屏视图，限宽居中
- 21 种语言 i18n，含 RTL 翻译（仅阿语待 UI 翻转）
- 离线草稿自动保存（按会话）
- 系统明暗主题切换（system/light/dark）

## 技术栈

| 层       | 选择                                                                      |
| -------- | ------------------------------------------------------------------------- |
| Runtime  | Expo SDK 56 + React Native 0.85 + React 19.2                              |
| 路由     | expo-router（文件路由）                                                   |
| 状态管理 | Zustand（18 个 store，详见 [src/store/CLAUDE.md](src/store/CLAUDE.md)）   |
| 安全存储 | expo-secure-store（Keychain / EncryptedSharedPrefs）                      |
| HTTP     | 自实现轻量 client（`src/api/client.ts`），对照 `@opencode-ai/sdk/v2` 类型 |
| SSE      | `react-native-sse`（XHR 实现，支持自定义 header）                         |
| 类型     | 直接 import 自 `@opencode-ai/sdk/v2`                                      |
| 主题     | 自写 token 体系（`src/theme/colors/spacing/typography/breakpoints`）      |

## 仓库目录速览

```
app/         Expo Router 路由壳（每个 .tsx = 一个路由；详见 app/CLAUDE.md）
src/         业务核心（与路由解耦，可被多个路由复用；详见 app/CLAUDE.md、src/CLAUDE.md 与各子目录 CLAUDE.md）
ios/ android/  prebuild 生成，git 忽略
test/        自写测试 harness（不是 Jest）
```

## 文档维护

- 主入口：`README.md`（5 分钟）→ `CLAUDE.md`（环境变量 / 常用命令）→ `app/CLAUDE.md` / `src/CLAUDE.md`（代码结构导览）

## Acknowledgements

本项目基于以下开源项目（按字母序）：

- [Expo](https://expo.dev) — SDK 56 / EAS / Router / Localization / SecureStore 等
- [OpenCode](https://opencode.ai) — 后端服务 `opencode serve`，本项目只消费其 HTTP / SSE 协议
- [React](https://react.dev) + [React Native](https://reactnative.dev) — 0.85 / 19.2
- [Zustand](https://github.com/pmndrs/zustand) — 状态管理
- [react-native-sse](https://github.com/binaryminds/react-native-sse) — EventSource 实现
- [lobehub/icons-rn](https://github.com/lobehub/lobe-icons) — 模型品牌图标

也感谢所有给本项目提 issue、PR、review、讨论的贡献者。

## License

[LICENSE](LICENSE) — AGPL-3.0 许可证。详见 [LICENSE](LICENSE) 与 [NOTICE](#notice) 段。

简言之：

- ✅ 可以**自由使用、修改、学习、私人部署**本应用
- ✅ 修改后的代码必须同样以 AGPL-3.0 开源
- ✅ 修改后通过**网络提供服务**（SaaS / 公开服务）时，必须向所有用户公开完整源代码
- ❌ **不可**作为闭源商业产品销售
- ❌ **不可**作为闭源 SaaS / 竞品服务运营
- ❌ **不可**用本项目源码做 KKCode 的竞品

如果你想绕过这些限制（闭源商业用途），请联系作者协商商业授权。

### Notice

- 本项目以 [GNU Affero General Public License v3](https://www.gnu.org/licenses/agpl-3.0.html) 发布，版权归 junbaor 所有。
- 基于 [Expo SDK 56](https://expo.dev)（MIT, 650 Industries, Inc.）构建。AGPL-3.0 仅约束本仓库的源码，**不会**对上游 MIT 依赖产生传染。
- 不包含来自 [OpenCode](https://opencode.ai) 的服务端代码（该部分为商业闭源）。
