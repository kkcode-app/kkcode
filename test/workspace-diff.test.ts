/**
 * [INPUT]: 依赖 workspace-diff 纯函数与 harness 断言运行器
 * [OUTPUT]: 验证多文件 raw diff 切分、文本 patch 转换和二进制文件识别
 * [POS]: test 的工作区变更解析回归测试，被 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";

import {
  buildWorkspaceDiffTree,
  flattenWorkspaceDiffTree,
  indexWorkspacePatches,
  listWorkspaceDiffDirectoryPaths,
  patchToTexts,
} from "../src/utils/workspace-diff.ts";
import {
  cacheWorkspaceDiffPreview,
  getWorkspaceDiffPreview,
} from "../src/utils/workspace-diff-preview.ts";
import { test } from "./harness.ts";

const RAW_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 const value = 1;
-export default value;
+export { value };
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..3333333
Binary files /dev/null and b/assets/logo.png differ
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
index 444..0000000
--- a/src/deleted.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const removed = true;
`;

export async function workspaceDiffSuite() {
  console.log("\n--- workspace diff parser ---");

  await test("indexes text, binary, and deleted file patches by workspace-relative path", () => {
    const patches = indexWorkspacePatches(RAW_DIFF);
    assert.equal(patches.size, 3);
    assert.equal(patches.get("src/a.ts")?.binary, false);
    assert.equal(patches.get("assets/logo.png")?.binary, true);
    assert.equal(patches.get("src/deleted.ts")?.binary, false);
  });

  await test("converts a unified text patch into DiffViewer old/new snippets", () => {
    const patch = indexWorkspacePatches(RAW_DIFF).get("src/a.ts")?.patch;
    assert.ok(patch);
    assert.deepEqual(patchToTexts(patch), {
      oldText: "const value = 1;\nexport default value;",
      newText: "const value = 1;\nexport { value };",
    });
  });

  await test("does not attempt to render a binary patch as text", () => {
    const patch = indexWorkspacePatches(RAW_DIFF).get("assets/logo.png")?.patch;
    assert.ok(patch);
    assert.equal(patchToTexts(patch), null);
  });

  await test("hands an already-parsed file diff to the full-screen route without a refetch", () => {
    const preview = {
      file: "src/a.ts",
      oldText: "const value = 1;",
      newText: "export { value };",
      additions: 1,
      deletions: 1,
    };
    const key = cacheWorkspaceDiffPreview(preview);
    assert.deepEqual(getWorkspaceDiffPreview(key), preview);
    assert.equal(getWorkspaceDiffPreview("missing"), undefined);
  });

  await test("groups changed files into sorted directories and flattens only expanded branches", () => {
    const tree = buildWorkspaceDiffTree([
      { file: "src/components/Button.tsx" },
      { file: "README.md" },
      { file: "assets/icon.png" },
      { file: "src/api/client.ts" },
    ]);
    assert.deepEqual(
      tree.map((node) =>
        node.type === "directory" ? `${node.path}:${node.fileCount}` : node.file.file,
      ),
      ["assets:1", "src:2", "README.md"],
    );

    const rows = flattenWorkspaceDiffTree(tree, new Set(["src"]));
    assert.deepEqual(
      rows.map(({ node, depth }) => [
        node.type === "directory" ? node.path : node.file.file,
        depth,
      ]),
      [
        ["assets", 0],
        ["src", 0],
        ["src/api", 1],
        ["src/components", 1],
        ["README.md", 0],
      ],
    );
    assert.deepEqual(listWorkspaceDiffDirectoryPaths(tree), [
      "assets",
      "src",
      "src/api",
      "src/components",
    ]);
  });
}
