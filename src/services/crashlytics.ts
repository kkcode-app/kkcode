/**
 * [INPUT]: 无外部依赖（社区版已移除 Firebase Crashlytics，全部 no-op）
 * [OUTPUT]: 对外提供 installCrashlytics、recordError、setCrashlyticsUserId 三个 no-op 函数
 * [POS]: src/services 的 Crashlytics 适配层桩，保留函数签名供业务侧 catch 与 ErrorBoundary 无感调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 src/services/CLAUDE.md
 */
// Crashlytics stub. 社区版已移除 Firebase 依赖，所有调用静默 no-op。

export async function installCrashlytics(): Promise<void> {
  // no-op (社区版不接管 RN ErrorUtils，使用默认行为)
}

export async function recordError(
  _err: unknown,
  _context?: Record<string, string | number | boolean>,
): Promise<void> {
  // no-op
}

export async function setCrashlyticsUserId(_id: string): Promise<void> {
  // no-op
}
