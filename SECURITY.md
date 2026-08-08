# Security Policy

## Supported Versions

KKCode Community 是社区维护的 LAN-only OpenCode 移动端遥控客户端。我们仅维护最新发布的主分支。

| 版本      | 支持状态          |
| --------- | ----------------- |
| 最新 main | ✅ 接收安全报告   |
| 旧版本    | ❌ 不接收，请升级 |

## Reporting a Vulnerability

发现安全漏洞请**私下**报告，不要在公开 issue / PR 中披露。

**首选方式**：通过 GitHub Security Advisories 提交：  
<https://github.com/kkcode-app/kkcode/security/advisories/new>

**备选方式**：邮件至仓库维护者（联系方式见 GitHub profile）

### 报告内容请包含

- 漏洞类型与影响范围
- 复现步骤或 PoC
- 受影响的 commit / 版本
- 你的联系方式（可选）

### 响应承诺

- 48 小时内确认收到
- 7 天内评估严重性并给出修复计划
- 修复完成后公开致谢（除非你要求匿名）

## 安全设计说明

KKCode Community 是 **纯 LAN 客户端**，安全模型基于以下前提：

- **传输**：HTTP Basic Auth over LAN。**不要**在公共网络上使用本应用。
- **凭证**：用户名 / 密码通过 iOS Keychain / Android Keystore 加密存储（`expo-secure-store`），不会明文落盘。
- **无遥测**：社区版已完全移除 Firebase Analytics / Crashlytics / Perf，不采集任何用户数据。
- **无服务端**：本项目**不包含**任何服务端代码、隧道中继、推送通知或账户系统。删除了原版中的 Go 后端 / Node CLI / 通知 worker。
- **依赖**：所有 npm 依赖通过 `npm audit` + 定期升级管控；本项目不发布任何 PII / 私钥。

## 不在范围内

- 第三方依赖（Expo、React Native）的漏洞 → 请向各自维护者报告
- 局域网内 OpenCode server 自身的安全 → 与本项目无关
- 用户设备（iOS / Android）系统级安全 → 与本项目无关

## 合规说明

本项目按 [AGPL-3.0](LICENSE) 发布。AGPL 本身**不限制**安全研究、漏洞复现和负责任披露，但**要求**：

- 基于本项目代码修改后的网络服务，必须向其用户公开完整源码（AGPL §13）
- 任何 fork 都需要沿用 AGPL 或兼容协议

合规问题（"我部署这个服务是否需要开源"）属于法律咨询范畴，**不在本安全报告渠道内**。请联系项目维护者或专业律师。
