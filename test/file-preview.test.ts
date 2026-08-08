/**
 * [INPUT]: 依赖 src/utils/file-preview 的 isTextPreviewableFile/isMarkdownFile/isImagePreviewableFile
 * [OUTPUT]: 提供 filePreviewSuite，测试文件扩展名分类逻辑
 * [POS]: test 的文件预览分类单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import {
  isTextPreviewableFile,
  isMarkdownFile,
  isImagePreviewableFile,
} from "../src/utils/file-preview.ts";

export async function filePreviewSuite() {
  console.log("\n─── file-preview ───");

  // ── isTextPreviewableFile ──

  await test("common source extensions are text-previewable", () => {
    const files = [
      "main.ts",
      "app.tsx",
      "index.js",
      "component.jsx",
      "style.css",
      "main.py",
      "main.rs",
      "main.go",
      "main.java",
    ];
    for (const f of files) {
      assert.equal(isTextPreviewableFile(f), true, `expected ${f} to be text-previewable`);
    }
  });

  await test("config files are text-previewable", () => {
    assert.equal(isTextPreviewableFile("package.json"), true);
    assert.equal(isTextPreviewableFile("tsconfig.json"), true);
    assert.equal(isTextPreviewableFile(".gitignore"), true);
    assert.equal(isTextPreviewableFile("Dockerfile"), true);
    assert.equal(isTextPreviewableFile("Makefile"), true);
    assert.equal(isTextPreviewableFile("README"), true);
    assert.equal(isTextPreviewableFile("LICENSE"), true);
  });

  await test("plist files are text-previewable", () => {
    assert.equal(isTextPreviewableFile("Info.plist"), true);
    assert.equal(isTextPreviewableFile("settings.plist"), true);
  });

  await test("binary files are not text-previewable", () => {
    assert.equal(isTextPreviewableFile("photo.jpg"), false);
    assert.equal(isTextPreviewableFile("video.mp4"), false);
    assert.equal(isTextPreviewableFile("archive.zip"), false);
    assert.equal(isTextPreviewableFile("data.bin"), false);
  });

  await test("case insensitive extension matching", () => {
    assert.equal(isTextPreviewableFile("MAIN.TS"), true);
    assert.equal(isTextPreviewableFile("App.TSX"), true);
    assert.equal(isTextPreviewableFile("README.MD"), true);
  });

  await test("dotfiles starting with .env are text-previewable", () => {
    assert.equal(isTextPreviewableFile(".env"), true);
    assert.equal(isTextPreviewableFile(".env.local"), true);
    assert.equal(isTextPreviewableFile(".env.production"), true);
  });

  await test("files with no extension but known names", () => {
    assert.equal(isTextPreviewableFile("Dockerfile"), true);
    assert.equal(isTextPreviewableFile("Gemfile"), true);
    assert.equal(isTextPreviewableFile("Rakefile"), true);
    assert.equal(isTextPreviewableFile("CMakeLists.txt"), true);
  });

  await test("unknown files with no extension", () => {
    assert.equal(isTextPreviewableFile("randomfile"), false);
  });

  // ── isMarkdownFile ──

  await test("markdown extensions are detected", () => {
    assert.equal(isMarkdownFile("README.md"), true);
    assert.equal(isMarkdownFile("guide.mdx"), true);
    assert.equal(isMarkdownFile("old.markdown"), true);
  });

  await test("non-markdown extensions", () => {
    assert.equal(isMarkdownFile("index.html"), false);
    assert.equal(isMarkdownFile("script.ts"), false);
    assert.equal(isMarkdownFile("data.json"), false);
  });

  await test("markdown detection is case insensitive", () => {
    assert.equal(isMarkdownFile("README.MD"), true);
    assert.equal(isMarkdownFile("guide.MDX"), true);
    assert.equal(isMarkdownFile("doc.MARKDOWN"), true);
  });

  // ── isImagePreviewableFile ──

  await test("common image extensions are detected", () => {
    const files = [
      "photo.png",
      "image.jpg",
      "pic.jpeg",
      "avatar.gif",
      "icon.ico",
      "shot.webp",
      "raw.heic",
    ];
    for (const f of files) {
      assert.equal(isImagePreviewableFile(f), true, `expected ${f} to be image-previewable`);
    }
  });

  await test("non-image extensions", () => {
    assert.equal(isImagePreviewableFile("document.pdf"), false);
    assert.equal(isImagePreviewableFile("code.ts"), false);
    assert.equal(isImagePreviewableFile("video.mp4"), false);
  });

  await test("image detection is case insensitive", () => {
    assert.equal(isImagePreviewableFile("PHOTO.PNG"), true);
    assert.equal(isImagePreviewableFile("Image.JPG"), true);
  });

  await test("tiff variants", () => {
    assert.equal(isImagePreviewableFile("scan.tiff"), true);
    assert.equal(isImagePreviewableFile("scan.tif"), true);
  });
}
