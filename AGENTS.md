# KKCode — Agent 必读

OpenCode 移动端遥控客户端（Expo SDK 56 + React Native 0.85 + React 19.2 + TypeScript）。iOS + Android / iPad / Android 平板。Mac 端 `opencode serve` 当后端，手机当客户端。

更多上下文：

- 常用命令 + 环境变量：[CLAUDE.md](CLAUDE.md)
- 代码结构导览：各子目录的 CLAUDE.md（`app/`、`src/`、`test/`、`plugins/`）

## 关键约定（少踩的坑）

- **安装**：`npm install --legacy-peer-deps`（SDK 与 RN 之间有 peer 警告，普通 install 会失败）。
- **原生工程是 prebuild 产物**：`ios/` 和 `android/` 已 gitignored，不要手动改；改完跑 `npx expo prebuild --platform <ios|android>`。
- **typecheck 覆盖主包**：`npm run typecheck` 跑 `tsc --noEmit`。
- **测试是自写 harness，不是 Jest**：`npm test` 实际跑 `tsx --import ./test/register-mocks.ts test/run.ts`；新套件必须在 [test/run.ts](test/run.ts) 顶部 import 并在 `main()` 末尾 `await` 才会被执行。
- **集成测试 SKIP 行为**：`npm run test:integration` 在真实 `opencode serve`（默认 127.0.0.1:4096）不可达时整套 SKIP 并 exit 0，适合串在 pre-release 脚本里；目标地址可经 `OPENCODE_BASE_URL` 覆盖。
- **路由 vs 业务**：`app/` 是 Expo Router 路由壳（每个 .tsx = 一个路由，不要放组件/工具/类型），`src/` 是与路由解耦的业务核心，可被多个路由复用。
- **i18n 21 语**：只有 `src/i18n/locales/en.ts` 是 source of truth，`zh-CN.ts` 是语义锚点——开发期只改这两个，其余 19 个语言文件由发布前人工/翻译工具补齐（详见下文章节）。

## Expo HAS CHANGED

写代码前查 https://docs.expo.dev/versions/v56.0.0/ 确认 API 形态。本地记忆容易过时。

# 项目规范

## Android 键盘适配（KeyboardAvoidingView）

> 这是项目**唯一权威**的 KAV 规范。`CLAUDE.md` 不再保留 KAV 章节，避免双写走样。
>
> 历史背景：Android `behavior="height"` 关闭键盘后底部留 10-30px padding（RN #52596），暂不修复。

### 统一写法

含 `TextInput` 的页面必须在外层包 `KeyboardAvoidingView`。**两个端都必须显式给 `behavior`，不能用 `undefined`**。

```tsx
<KeyboardAvoidingView
  style={{ flex: 1 }}
  behavior={Platform.OS === "ios" ? "padding" : "height"}
  keyboardVerticalOffset={0}
>
  <ScrollView keyboardShouldPersistTaps="handled">{/* 表单内容 */}</ScrollView>
</KeyboardAvoidingView>
```

### 平台差异

- **iOS**：`behavior="padding"` 让 KAV 接管，**不要**叠加 `automaticallyAdjustKeyboardInsets`（两个一起开会把页面顶两次）。
- **Android**：`behavior="height"` 压缩容器高度，**不要**用 `"padding"`（会和 `app.json` 的 `softwareKeyboardLayoutMode: "resize"` 打架）。

### 绝对禁止

- `behavior={undefined}` / `behavior={null}` —— 任一端不传都会出现"键盘弹起后界面上不来"。
- `behavior="padding" + automaticallyAdjustKeyboardInsets` 叠加 —— iOS 顶部跳两次。
- 硬编码 `keyboardVerticalOffset={64}` 等数字 —— 导航栏高度因机型和路由嵌套层级而异，会偏。统一传 `0`。
- 反复切换 `behavior` 值（mounted 后改） —— KAV 是布局组件，运行时切换会引发整页重新 layout。

### 例外

| 文件                             | 例外原因                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/ChatScreen.tsx`  | 平台隔离处理：iOS 使用普通 `View`，手动过滤第三方语音输入法（讯飞/搜狗）上报的接近全屏异常高度；Android 使用等价于 `behavior="height"` 的自管容器并在 `keyboardDidHide` 时强制归零，与 `softwareKeyboardLayoutMode: "resize"` 协同，避免键盘遮挡及 RN KAV 关闭后的高度残值。详见 ChatScreen 注释。                                                                                         |
| `src/components/BottomSheet.tsx` | RN `Modal` 内 KAV 无效（Modal 在 Android 上不跟随 Activity 的 adjustResize）。Android 端不设 `behavior`，改用自管 `keyboardHeight`。iOS 端仍用 `"padding"` 把 sheet 整体上推；仅当 body 确实溢出时，Modal 内 ScrollView 才启用 `automaticallyAdjustKeyboardInsets`。与页面的"禁止叠加"不同：Modal 内 KAV 的 padding 影响 sheet 容器，ScrollView 的 insets 影响可滚动内容，两者分层不冲突。 |

新增含输入框的页面，按统一写法写，例外情况要写代码注释说明原因。

## BottomSheet 高度适配

`src/components/BottomSheet.tsx` 是项目所有底部 Sheet 的唯一高度与滚动规则源：

- 默认按 `固定 handle/header + 完整 body 内容 + 底部安全区` 的实测高度展示，调用侧禁止传固定高度或自行实现 fit-content。
- 最大高度统一为键盘可用视口的 90%，并同时保留顶部安全区与 12pt 间距。
- 仅当完整 body 内容比可用 body viewport 高超过 1px 时开启内部滚动；短内容禁止出现可滚动残量。
- Sheet 内部语义切页可传 `contentKey` 重置 ScrollView，不能用它参与高度计算。
- 新增 Sheet 必须复用公共 `BottomSheet`；确需独立原生 Modal 的非 Sheet 形态要写注释说明。

## Chat 页滚动铁律

**修改 `app/chat/[id].tsx` / `src/hooks/useStickToBottom.ts` / `src/api/dispatch.ts` 之前，必须先读 `src/components/ChatScreen.tsx` 的滚动实现 + `src/hooks/useStickToBottom.ts` 的状态机。**

核心约束：

- 流式输出时用户介入即锁，任何代码不得绕过 `useStickToBottom` 直接调 `scrollTo*`
- 列表必须正序 + `maintainVisibleContentPosition: { minIndexForVisible: 1 }`，禁止 `inverted`
- `onScroll` 永不修改 pinned 状态，只读派生 UI
- SSE delta 必须按 rAF 节流，不能每 chunk 立即派发
- 进入会话首屏必须用淡入策略遮蔽多次校准

文档里有 8 个真实踩过的坑（§三）和接入清单（§五）、新增功能检查清单（§六）。

## i18n 词条工作流

> 这是项目**唯一权威**的 i18n 工作流规范。21 种语言维护成本高，开发期与发布期分离。

### 角色分工

| 文件                        | 角色            | 谁来改                           |
| --------------------------- | --------------- | -------------------------------- |
| `src/i18n/locales/en.ts`    | source of truth | 开发功能时手动维护               |
| `src/i18n/locales/zh-CN.ts` | 语义锚点        | 开发功能时手动维护               |
| 其余 19 个语言文件          | 翻译产物        | **禁止开发期手动改**，发布前补齐 |

### 开发期：只动 en.ts + zh-CN.ts

新增 / 修改 / 删除 i18n key 时：

1. **只改 `en.ts` 和 `zh-CN.ts` 两个文件**，其余 19 个语言文件**不要碰**
2. i18next 已配 `fallbackLng: "en"`，切到日韩等语言时缺失 key 自动回退显示英文，不影响功能验证
3. 新增 key 放在对应 namespace 末尾，保持 `en.ts` 与 `zh-CN.ts` 结构 1:1
4. 复数 key（`_one`/`_other`/`_few`/`_many` 等）只在 `en.ts` 定义 `_one` + `_other`，其他复数变体在发布前按 CLDR 补

### 发布期：跑 `i18n:check` 检测缺失

功能稳定、准备发版前：

1. 先跑 `npm run i18n:check` 看缺失清单
2. 用本地 AI 翻译工具或人工翻译缺失的 key，逐语言写回到对应 locale 文件
3. 完成后**不要自动 commit**，人工 review 后再提交

### 绝对禁止

- 开发功能时同步修改 19 个语言文件 —— 浪费时间且未稳定文案会被反复重译
- 删除 `en.ts` / `zh-CN.ts` 的 key 时不同步删其他语言的对应 key —— 会导致 `extra` 残留
- 手动重写整个语言文件 —— 翻译工具只做增量补齐，重写会丢失人工校对过的翻译
- 修改 i18n 文件头部的 L3 契约注释（除非 INPUT/OUTPUT/POS 真的变了）
