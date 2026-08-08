/**
 * [INPUT]: 依赖 test 目录各 suite 与 harness.summary
 * [OUTPUT]: 提供 npm test 的统一执行入口和进程退出码
 * [POS]: test 的主测试运行器，按顺序执行单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Polyfill window.localStorage for @react-native-async-storage/async-storage
// which uses the Web Storage API under the hood. In Node there is no `window`,
// so we provide a minimal in-memory shim.
import { authSuite } from "./auth.test.ts";
import { clientSuite } from "./client.test.ts";
import { commandStoreSuite } from "./commands.test.ts";
import { connectionSuite } from "./connection.test.ts";
import { eventsSuite } from "./events.test.ts";
import { questionRefetchSuite } from "./question-refetch.test.ts";
import { serverUrlSuite } from "./server-url.test.ts";
import { sessionStatusSuite } from "./session-status.test.ts";
import { storesSuite } from "./stores.test.ts";
import { themeSuite } from "./theme.test.ts";
import { draftSuite } from "./draft.test.ts";
import { modelSuite } from "./model.test.ts";
import { onboardingSuite } from "./onboarding.test.ts";
import { hapticsSuite } from "./haptics-prefs.test.ts";
import { directoryPrefsSuite } from "./directory-prefs.test.ts";
import { dispatchDeltaSuite } from "./dispatch-delta.test.ts";
import { lanHostSuite } from "./lan-host.test.ts";
import { timeSuite } from "./time.test.ts";
import { sseSuite } from "./sse.test.ts";
import { slashParseSuite } from "./slash-parse.test.ts";
import { imageAttachSuite } from "./image-attach.test.ts";
import { i18nSuite } from "./i18n.test.ts";
import { projectSessionsSuite } from "./project-sessions.test.ts";
import { stickToBottomSuite } from "./stick-to-bottom.test.ts";
import { chatInitialAnchorSuite } from "./chat-initial-anchor.test.ts";
import { imageLayoutSuite } from "./image-layout.test.ts";
import { markdownStripSuite } from "./markdown-strip.test.ts";
import { messageTextSuite } from "./message-text.test.ts";
import { filePreviewSuite } from "./file-preview.test.ts";
import { typographySuite } from "./typography.test.ts";
import { lanPermissionSuite } from "./lan-permission.test.ts";
import { pendingOpenSuite } from "./pending-open.test.ts";
import { biometricSuite } from "./biometric.test.ts";
import { sessionPrefsSuite } from "./session-prefs.test.ts";
import { questionsSuite } from "./questions.test.ts";
import { messagesDeltaSuite } from "./messages-delta.test.ts";
import { responsiveSuite } from "./responsive.test.ts";
import { workspaceDiffSuite } from "./workspace-diff.test.ts";
import { ansiSuite } from "./ansi.test.ts";
import { bottomSheetLayoutSuite } from "./bottom-sheet-layout.test.ts";
import { summary } from "./harness.ts";

if (typeof globalThis.window === "undefined") {
  const storage = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      get length() {
        return storage.size;
      },
      key: (i: number) => [...storage.keys()][i] ?? null,
    },
  };
}

async function main() {
  await authSuite();
  await storesSuite();
  await eventsSuite();
  await commandStoreSuite();
  await questionRefetchSuite();
  await sessionStatusSuite();
  await stickToBottomSuite();
  await chatInitialAnchorSuite();
  await imageLayoutSuite();
  await serverUrlSuite();
  await clientSuite();
  await connectionSuite();
  await themeSuite();
  await draftSuite();
  await modelSuite();
  await onboardingSuite();
  await hapticsSuite();
  await directoryPrefsSuite();
  await dispatchDeltaSuite();
  await lanHostSuite();
  await timeSuite();
  await sseSuite();
  await slashParseSuite();
  await imageAttachSuite();
  await i18nSuite();
  await projectSessionsSuite();

  // ── New suites ──
  await markdownStripSuite();
  await messageTextSuite();
  await filePreviewSuite();
  await typographySuite();
  await lanPermissionSuite();
  await pendingOpenSuite();
  await biometricSuite();
  await sessionPrefsSuite();
  await questionsSuite();
  await messagesDeltaSuite();
  await responsiveSuite();
  await workspaceDiffSuite();
  await ansiSuite();
  await bottomSheetLayoutSuite();

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
