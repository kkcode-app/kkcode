/**
 * [INPUT]: 依赖 Node 控制台与异步测试函数
 * [OUTPUT]: 对外提供 test、skip、summary 测试运行辅助函数
 * [POS]: test 的轻量测试基座，被所有 suite 与 run.ts 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
let _passed = 0;
let _failed = 0;
let _skipped = 0;

export async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    _passed++;
    console.log("  PASS  " + name);
  } catch (err) {
    _failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  FAIL  " + name);
    console.error("        " + msg);
    if (err instanceof Error && err.stack) {
      const lines = err.stack.split("\n").slice(1, 4);
      for (const line of lines) console.error("        " + line.trim());
    }
  }
}

// Mark a single test as skipped — used by integration tests when a precondition
// (e.g. local opencode server unreachable) makes the assertion impossible.
// Skipped tests don't count toward pass/fail; run-integration.ts decides the
// exit code separately based on `_failed`.
export function skip(name: string, reason: string) {
  _skipped++;
  console.log("  SKIP  " + name + "  (" + reason + ")");
}

export function summary() {
  return { passed: _passed, failed: _failed, skipped: _skipped };
}
