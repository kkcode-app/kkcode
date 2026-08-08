/**
 * [INPUT]: 接收 OpenCode /vcs/diff/raw 返回的多文件 unified diff 文本
 * [OUTPUT]: 按文件索引 patch，并将单个文本 patch 转为 DiffViewer 所需的旧/新文本
 * [POS]: utils 的纯 diff 适配层，被工作区变更页与单元测试复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type WorkspacePatch = {
  file: string;
  patch: string;
  binary: boolean;
};

type WorkspaceFileLike = { file: string };

export type WorkspaceDiffTreeDirectory<T extends WorkspaceFileLike> = {
  type: "directory";
  name: string;
  path: string;
  fileCount: number;
  children: WorkspaceDiffTreeNode<T>[];
};

export type WorkspaceDiffTreeNode<T extends WorkspaceFileLike> =
  WorkspaceDiffTreeDirectory<T> | { type: "file"; file: T };

export type WorkspaceDiffTreeRow<T extends WorkspaceFileLike> = {
  node: WorkspaceDiffTreeNode<T>;
  depth: number;
};

type MutableDirectory<T extends WorkspaceFileLike> = {
  name: string;
  path: string;
  fileCount: number;
  directories: Map<string, MutableDirectory<T>>;
  files: T[];
};

/** Groups workspace-relative files into an alphabetically sorted directory tree. */
export function buildWorkspaceDiffTree<T extends WorkspaceFileLike>(
  files: readonly T[],
): WorkspaceDiffTreeNode<T>[] {
  const root = createDirectory<T>("", "");

  for (const file of files) {
    const parts = file.file.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    root.fileCount += 1;
    let directory = root;
    const directoryParts: string[] = [];
    for (const part of parts.slice(0, -1)) {
      directoryParts.push(part);
      const path = directoryParts.join("/");
      let child = directory.directories.get(part);
      if (!child) {
        child = createDirectory(part, path);
        directory.directories.set(part, child);
      }
      child.fileCount += 1;
      directory = child;
    }
    directory.files.push(file);
  }

  return freezeDirectory(root);
}

/** Flattens only expanded directories into FlatList-friendly display rows. */
export function flattenWorkspaceDiffTree<T extends WorkspaceFileLike>(
  nodes: readonly WorkspaceDiffTreeNode<T>[],
  expandedDirectories: ReadonlySet<string>,
  depth = 0,
): WorkspaceDiffTreeRow<T>[] {
  const rows: WorkspaceDiffTreeRow<T>[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.type === "directory" && expandedDirectories.has(node.path)) {
      rows.push(...flattenWorkspaceDiffTree(node.children, expandedDirectories, depth + 1));
    }
  }
  return rows;
}

/** Lists every directory path in display order for expand-all controls. */
export function listWorkspaceDiffDirectoryPaths<T extends WorkspaceFileLike>(
  nodes: readonly WorkspaceDiffTreeNode<T>[],
): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type !== "directory") continue;
    paths.push(node.path, ...listWorkspaceDiffDirectoryPaths(node.children));
  }
  return paths;
}

/** Splits a standard `git diff` stream into file-scoped patches. */
export function indexWorkspacePatches(raw: string): Map<string, WorkspacePatch> {
  const patches = new Map<string, WorkspacePatch>();
  const sections = raw.replace(/\r\n/g, "\n").split(/(?=^diff --git )/mu);

  for (const patch of sections) {
    if (!patch.startsWith("diff --git ")) continue;
    const file = patchFilePath(patch);
    if (!file) continue;
    patches.set(file, {
      file,
      patch,
      binary: /^(?:Binary files |GIT binary patch$)/mu.test(patch),
    });
  }
  return patches;
}

/**
 * Produces comparable snippets from a unified patch. Hunk line numbers are
 * intentionally delegated to DiffViewer, which computes the visible change
 * rows and folds long sections for the mobile viewport.
 */
export function patchToTexts(patch: string): { oldText: string; newText: string } | null {
  if (/^(?:Binary files |GIT binary patch$)/mu.test(patch)) return null;

  const oldLines: string[] = [];
  const newLines: string[] = [];
  let inHunk = false;

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line === "\\ No newline at end of file") continue;
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      const text = line.slice(1);
      oldLines.push(text);
      newLines.push(text);
    }
  }

  if (oldLines.length === 0 && newLines.length === 0) return null;
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
}

function patchFilePath(patch: string): string | null {
  // `+++` identifies the destination for adds/modifications; deleted files
  // have `/dev/null` there, so fall back to the source marker.
  const destination = patch.match(/^\+\+\+ b\/(.+)$/mu)?.[1];
  if (destination) return destination;
  const source = patch.match(/^--- a\/(.+)$/mu)?.[1];
  if (source) return source;

  // Binary changes have neither `---` nor `+++` markers. Their first line
  // remains the only portable filename source in a standard Git patch.
  return patch.match(/^diff --git a\/(.+?) b\/(.+)$/mu)?.[2] ?? null;
}

function createDirectory<T extends WorkspaceFileLike>(
  name: string,
  path: string,
): MutableDirectory<T> {
  return { name, path, fileCount: 0, directories: new Map(), files: [] };
}

function freezeDirectory<T extends WorkspaceFileLike>(
  directory: MutableDirectory<T>,
): WorkspaceDiffTreeNode<T>[] {
  const directories: WorkspaceDiffTreeNode<T>[] = [...directory.directories.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      type: "directory",
      name: child.name,
      path: child.path,
      fileCount: child.fileCount,
      children: freezeDirectory(child),
    }));
  const files = directory.files
    .slice()
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((file) => ({ type: "file" as const, file }));
  return [...directories, ...files];
}
