# Contributing to KKCode Community

感谢你的兴趣！本项目欢迎各种形式的贡献。

## 行为准则

参与前请阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。违反行为准则的 PR / issue 将被关闭。

## 提 issue 之前

1. 搜索现有 issues 看看是否已经有相关讨论
2. 确认 issue 描述清楚、有可复现的步骤或清晰的动机
3. Bug 报告请附上：复现步骤、期望 / 实际行为、设备型号、系统版本、OpenCode serve 版本

## 开发流程

### 1. Fork 并 clone

```bash
git clone https://github.com/<your-fork>/kkcode.git
cd kkcode
```

### 2. 安装依赖

```bash
npm install --legacy-peer-deps
```

### 3. 跑测试

```bash
npm test                  # 单元测试（mock）
npm run typecheck         # tsc --noEmit
```

### 4. 启动 Metro

```bash
npm start
```

- Expo Go 扫码
- `i` 起 iOS 模拟器
- `a` 起 Android 模拟器

## 修改规范

### 代码

- 严格遵循仓库的 ESLint + Prettier 配置（pre-commit hook 会自动跑）
- 公共组件 / 工具函数 / Store 修改前先读对应目录的 `CLAUDE.md` 成员清单
- 新增 Store 时同步在 `src/store/CLAUDE.md` 加一行
- 新增 utils 时同步在 `src/utils/CLAUDE.md` 加一行
- 修改 `app/chat/[id].tsx` / `src/hooks/useStickToBottom.ts` / `src/api/dispatch.ts` 前先读 `src/components/ChatScreen.tsx` 头部注释 + `src/hooks/useStickToBottom.ts` 状态机

### i18n

- **只改 `src/i18n/locales/en.ts` 和 `src/i18n/locales/zh-CN.ts`**
- 其余 19 个语言暂不要求同步（社区版 release 前人工补齐）
- 新增 key 放在对应 namespace 末尾，保持 1:1 结构
- 复数 key 只在 en.ts 定义 `_one` + `_other`
- 改完对照 `en.ts` 与 `zh-CN.ts` 手动核对新增 / 改动的 key 已正确落到这两个文件

### 提交信息

- 遵循 [Conventional Commits](https://www.conventionalcommits.org/)
- 格式：`<type>(<scope>): <中文描述>`
- type 仅允许：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore` / `build` / `ci` / `revert`
- 描述一句话讲清楚"改了什么"，不超过 50 字
- 详细说明放正文 `-` 列要点

### Pull Request

1. Fork → 创建 feature branch（不要直接改 main）
2. 提交前确保 `npm test` / `npm run typecheck` 全部通过
3. 用 `.github/PULL_REQUEST_TEMPLATE.md` 模板填写 PR 描述
4. 在 PR 描述中关联对应 issue（`Fixes #123` / `Closes #456`）
5. 等待 CI 通过 + 维护者 review
6. 维护者会按仓库 git 习惯（squash / rebase）合入

## 不在范围内

本社区版**已删除**以下功能，PR 不会合入这些方向：

- 通知 / 中继 / App 图标切换 / 自定义字体 / 聊天背景 / 主题色等"已删功能"还原
- 服务端 / 隧道中继 / 账户系统等"商业功能"重引入
- 蒲公英 / App Store Connect 发布流（请用 Pro 版仓库）

## 报告安全漏洞

请按 [SECURITY.md](SECURITY.md) **私下**报告，不要在公开 issue 中披露。

## 许可

贡献本项目即表示你同意按 [LICENSE](LICENSE)（AGPL-3.0）授权你的贡献。这意味着：

- 你的贡献将以 AGPL-3.0 公开
- 任何基于本项目（含你的贡献）的网络服务都必须向其用户公开完整源码
- 你需要确保你有权贡献你提交的代码（自己写的，或所属公司允许开源）
