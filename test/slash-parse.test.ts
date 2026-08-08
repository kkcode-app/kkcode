import { strict as assert } from "node:assert";

import {
  filterSlashCommandSuggestions,
  getSlashCommandQuery,
  parseSlashCommandText,
} from "../src/utils/slash-parse.ts";
import { test } from "./harness.ts";

export async function slashParseSuite() {
  console.log("\n== slash command parser ==");

  await test("non-slash text returns null (falls through to sendPrompt)", () => {
    assert.equal(parseSlashCommandText("hello"), null);
    assert.equal(
      parseSlashCommandText("  /foo"),
      null,
      "leading whitespace is not a slash command",
    );
    assert.equal(parseSlashCommandText(""), null);
    assert.equal(parseSlashCommandText("foo/bar"), null, "only leading `/` triggers parsing");
  });

  await test("autocomplete opens only for a leading slash command token", () => {
    assert.equal(getSlashCommandQuery("/"), "");
    assert.equal(getSlashCommandQuery("/init"), "init");
    assert.equal(getSlashCommandQuery("/review-pr"), "review-pr");
    assert.equal(getSlashCommandQuery("hello /init"), null);
    assert.equal(getSlashCommandQuery(" /init"), null);
    assert.equal(getSlashCommandQuery(""), null);
  });

  await test("autocomplete closes as soon as command arguments begin", () => {
    assert.equal(getSlashCommandQuery("/init "), null);
    assert.equal(getSlashCommandQuery("/review\tHEAD"), null);
    assert.equal(getSlashCommandQuery("/review\ncontext"), null);
    assert.equal(getSlashCommandQuery("/init\r\ncontext"), null);
  });

  await test("autocomplete filtering is case-insensitive and relevance-ranked", () => {
    const commands = [
      { name: "review", description: "Review current changes" },
      { name: "init", description: "Initialize a project" },
      { name: "review-pr", description: "Review a pull request" },
      { name: "audit", description: "Run a REVIEW checklist" },
      { name: "preview", description: "Preview output" },
    ];

    assert.deepEqual(
      filterSlashCommandSuggestions(commands, "").map((command) => command.name),
      commands.map((command) => command.name),
      "bare slash keeps the server order",
    );
    assert.deepEqual(
      filterSlashCommandSuggestions(commands, "REVIEW").map((command) => command.name),
      ["review", "review-pr", "preview", "audit"],
      "exact, prefix, substring and description matches are ranked in that order",
    );
    assert.deepEqual(filterSlashCommandSuggestions(commands, "missing"), []);
  });

  await test("bare `/<name>` with no args", () => {
    const out = parseSlashCommandText("/init");
    assert.deepEqual(out, { name: "init", arguments: "" });
  });

  await test("`/<name> <args...>` flattens args on a single space join", () => {
    const out = parseSlashCommandText("/review main..feature");
    assert.deepEqual(out, { name: "review", arguments: "main..feature" });
    const multi = parseSlashCommandText("/cmd one two three");
    assert.deepEqual(multi, { name: "cmd", arguments: "one two three" });
  });

  await test("subsequent lines go verbatim into arguments, joined with newline", () => {
    const text = "/review HEAD~3..HEAD\nDetailed context:\n- bullet 1\n- bullet 2";
    const out = parseSlashCommandText(text);
    assert.ok(out, "should parse");
    assert.equal(out!.name, "review");
    assert.equal(out!.arguments, "HEAD~3..HEAD\nDetailed context:\n- bullet 1\n- bullet 2");
  });

  await test("single-line with trailing newline: rest is empty string", () => {
    const out = parseSlashCommandText("/init\n");
    assert.ok(out);
    assert.equal(out!.name, "init");
    assert.equal(out!.arguments, "");
  });

  await test("tabs and CRLF separate the command name without corrupting it", () => {
    assert.deepEqual(parseSlashCommandText("/review\tmain..feature"), {
      name: "review",
      arguments: "main..feature",
    });
    assert.deepEqual(parseSlashCommandText("/init\r\ncontext"), {
      name: "init",
      arguments: "\ncontext",
    });
  });

  await test("leading `/` only (empty name) still parses, downstream byName misses and falls back", () => {
    const out = parseSlashCommandText("/");
    assert.deepEqual(out, { name: "", arguments: "" });
  });

  await test("`/<name>` followed by whitespace-only args: split preserves empty tokens", () => {
    // split(" ") on "init   " yields ["init", "", "", ""]. Joining with " "
    // gives "  ". This is intentional — trimming/collapsing whitespace
    // would lose information for commands that care about argument shape
    // (e.g. intentional spacing in template hints). Downstream server
    // treats the raw string opaquely.
    const out = parseSlashCommandText("/init   ");
    assert.ok(out);
    assert.equal(out!.name, "init");
    assert.equal(out!.arguments, "  ");
  });
}
