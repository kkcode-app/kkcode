import { strict as assert } from "node:assert";

import { groupSessionsByProject, projectDisplayName } from "../src/utils/project-sessions.ts";
import { test } from "./harness.ts";

const session = (id: string, directory: string, projectID?: string, updated = 1) =>
  ({ id, directory, projectID, time: { updated } }) as any;

export async function projectSessionsSuite() {
  await test("project session grouping: projectID wins over path matching", () => {
    const groups = groupSessionsByProject(
      [
        { id: "global", worktree: "/" },
        { id: "app", worktree: "/work/app" },
      ],
      [session("s1", "/work/app/src", "global")],
    );
    assert.equal(groups.find((group) => group.id === "global")!.sessions[0]!.id, "s1");
  });

  await test("project session grouping: deepest matching worktree is used for old sessions", () => {
    const groups = groupSessionsByProject(
      [
        { id: "parent", worktree: "/work" },
        { id: "child", worktree: "/work/app" },
      ],
      [session("s1", "/work/app/src", undefined, 10)],
    );
    assert.equal(groups[0]!.id, "child");
    assert.equal(groups[0]!.sessions[0]!.id, "s1");
  });

  await test("project session grouping: most recently active project is first, including global", () => {
    const groups = groupSessionsByProject(
      [
        { id: "global", worktree: "/" },
        { id: "app", worktree: "/work/app" },
      ],
      [session("older", "/work/app", "app", 10), session("newer", "/", "global", 20)],
    );
    assert.equal(groups[0]!.id, "global");
  });

  await test("project session grouping: latest conversation ignores project metadata time", () => {
    const groups = groupSessionsByProject(
      [{ id: "app", worktree: "/work/app", time: { updated: 999 } }],
      [session("s1", "/work/app", "app", 10)],
    );
    assert.equal(groups[0]!.updatedAt, 10);
  });

  await test("project session grouping: a project outage falls back to directory groups", () => {
    const groups = groupSessionsByProject(
      [],
      [session("s1", "/work/app", undefined, 10), session("s2", "/work/app", undefined, 8)],
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.isFallback, true);
    assert.equal(groups[0]!.sessions.length, 2);
    assert.equal(projectDisplayName("/work/app/"), "app");
  });
}
