# src/services/

> L2 | 父级: /CLAUDE.md

成员清单
analytics.ts: 分析适配层 no-op 桩，导出 AnalyticsEvents 常量（事件名单一真理源，按业务域分组 + L3 头部）、trackEvent / setUserId / setUserProperty no-op 函数，社区版已移除 Firebase，保留签名供业务侧无感调用
crashlytics.ts: Crashlytics 适配层 no-op 桩，导出 installCrashlytics / recordError / setCrashlyticsUserId no-op 函数，社区版已移除 Firebase，保留签名供 ErrorBoundary 与业务 catch 无感调用
dev-logger.ts: 开发面板日志服务，patch console.log/warn/error/info/debug 到环形缓冲（1000 条 FIFO），导出 startDevLogger/stopDevLogger/isDevLoggerActive/getDevLogs/clearDevLogs/setPaused/subscribeDevLogs/exportDevLogs

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
