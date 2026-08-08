// Integration test runner — 对真实 opencode 服务器跑端到端验证。
//
// 用法:
//   npm run test:integration                                      # 默认 127.0.0.1:4096
//   OPENCODE_BASE_URL=http://192.168.1.10:4096 npm run test:integration
//
// 服务器不可达时整套 SKIP,exit 0,适合在 pre-release 脚本里串起来跑。

import { integrationSuite } from "./integration.test.ts";
import { summary } from "./harness.ts";

async function main() {
  await integrationSuite();

  const { passed, failed, skipped } = summary();
  console.log("\n--------");
  const skippedSuffix = skipped > 0 ? ", " + skipped + " skipped" : "";
  console.log(passed + " passed, " + failed + " failed" + skippedSuffix);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
