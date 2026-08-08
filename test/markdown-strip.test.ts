/**
 * [INPUT]: 依赖 src/utils/markdown-strip 的 stripMarkdown
 * [OUTPUT]: 提供 markdownStripSuite，测试 stripMarkdown 各类剥离规则
 * [POS]: test 的 markdown 剥离工具单元测试套件
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { test } from "./harness.ts";
import { stripMarkdown } from "../src/utils/markdown-strip.ts";

export async function markdownStripSuite() {
  console.log("\n─── markdown-strip ───");

  await test("empty string returns empty", () => {
    assert.equal(stripMarkdown(""), "");
  });

  await test("plain text is unchanged", () => {
    assert.equal(stripMarkdown("Hello world"), "Hello world");
  });

  await test("heading hashes are stripped", () => {
    assert.equal(stripMarkdown("# Title"), "Title");
    assert.equal(stripMarkdown("### Subtitle"), "Subtitle");
    assert.equal(stripMarkdown("###### Deep heading"), "Deep heading");
  });

  await test("bold markers are stripped", () => {
    assert.equal(stripMarkdown("**bold text**"), "bold text");
    assert.equal(stripMarkdown("__bold text__"), "bold text");
  });

  await test("italic markers are stripped", () => {
    assert.equal(stripMarkdown("*italic text*"), "italic text");
    assert.equal(stripMarkdown("_italic text_"), "italic text");
  });

  await test("inline code backticks are stripped", () => {
    assert.equal(stripMarkdown("use `console.log` for debugging"), "use console.log for debugging");
  });

  await test("code block fences are removed, content kept", () => {
    const src = "```js\nconst x = 1;\nconsole.log(x);\n```";
    const result = stripMarkdown(src);
    assert.ok(result.includes("const x = 1;"));
    assert.ok(!result.includes("```"));
  });

  await test("code block with language hint", () => {
    const src = "```typescript\nconst x: number = 1;\n```";
    const result = stripMarkdown(src);
    assert.ok(result.includes("const x: number = 1;"));
    assert.ok(!result.includes("```typescript"));
  });

  await test("images become alt text", () => {
    assert.equal(stripMarkdown("![alt text](https://example.com/img.png)"), "alt text");
    assert.equal(stripMarkdown("![](https://example.com/img.png)"), "");
  });

  await test("links become link text", () => {
    assert.equal(stripMarkdown("[click here](https://example.com)"), "click here");
  });

  await test("unordered list markers are stripped", () => {
    assert.equal(stripMarkdown("- item one\n- item two"), "item one\nitem two");
    assert.equal(stripMarkdown("* item one\n* item two"), "item one\nitem two");
    assert.equal(stripMarkdown("+ item one\n+ item two"), "item one\nitem two");
  });

  await test("ordered list markers are stripped", () => {
    assert.equal(stripMarkdown("1. first\n2. second"), "first\nsecond");
    assert.equal(stripMarkdown("10. tenth"), "tenth");
  });

  await test("blockquote markers are stripped", () => {
    assert.equal(stripMarkdown("> quoted text"), "quoted text");
    assert.equal(stripMarkdown("> line one\n> line two"), "line one\nline two");
  });

  await test("horizontal rules are removed", () => {
    assert.equal(stripMarkdown("---"), "");
    assert.equal(stripMarkdown("***"), "");
    assert.equal(stripMarkdown("___"), "");
    assert.equal(stripMarkdown("text before\n---\ntext after"), "text before\n\ntext after");
  });

  await test("strikethrough is stripped", () => {
    assert.equal(stripMarkdown("~~deleted~~"), "deleted");
  });

  await test("excessive blank lines are compressed", () => {
    const src = "para1\n\n\n\n\npara2";
    const result = stripMarkdown(src);
    assert.equal(result, "para1\n\npara2");
  });

  await test("mixed markdown is fully stripped", () => {
    const src = [
      "# Title",
      "",
      "This is **bold** and *italic* text.",
      "",
      "- List item",
      "",
      "> Quote",
      "",
      "[link](http://example.com)",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    const result = stripMarkdown(src);
    assert.ok(result.startsWith("Title"));
    assert.ok(result.includes("This is bold and italic text."));
    assert.ok(result.includes("List item"));
    assert.ok(result.includes("Quote"));
    assert.ok(result.includes("link"));
    assert.ok(result.includes("const x = 1;"));
    assert.ok(!result.includes("#"));
    assert.ok(!result.includes("**"));
    assert.ok(!result.includes("```"));
    assert.ok(!result.includes("[link]"));
  });

  await test("underscore inside words is not treated as italic", () => {
    assert.equal(stripMarkdown("snake_case_var"), "snake_case_var");
    assert.equal(stripMarkdown("my_variable_name"), "my_variable_name");
  });

  await test("result is trimmed", () => {
    assert.equal(stripMarkdown("  hello  "), "hello");
    assert.equal(stripMarkdown("\n\nhello\n\n"), "hello");
  });
}
