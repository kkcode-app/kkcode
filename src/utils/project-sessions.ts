/**
 * [INPUT]: Project API records and global Session records
 * [OUTPUT]: Groups sessions into display-ready projects and derives the latest conversation time
 * [POS]: utils/ pure grouping layer used by app/sessions.tsx
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Session } from "@opencode-ai/sdk/v2";

import type { Project } from "../api/client";

type SessionProjectFields = {
  projectID?: string;
  directory?: string;
  time?: { created?: number; updated?: number };
};

export type ProjectSessionGroup = {
  id: string;
  project?: Project;
  worktree?: string;
  sessions: Session[];
  updatedAt: number;
  isGlobal: boolean;
  /** Created from a session directory when the project endpoint is unavailable. */
  isFallback: boolean;
};

function fields(session: Session): SessionProjectFields {
  return session as unknown as SessionProjectFields;
}

function updatedAt(session: Session): number {
  const time = fields(session).time;
  return time?.updated ?? time?.created ?? 0;
}

function isWithinWorktree(directory: string, worktree: string): boolean {
  if (worktree === "/") return directory.startsWith("/");
  const root = worktree.replace(/\/+$/, "");
  return directory === root || directory.startsWith(`${root}/`);
}

function fallbackGroup(directory: string): ProjectSessionGroup {
  return {
    id: `directory:${directory}`,
    worktree: directory,
    sessions: [],
    updatedAt: 0,
    isGlobal: false,
    isFallback: true,
  };
}

/**
 * Match by the server's project ID first. Old session records can omit it, so
 * use the deepest containing worktree as a deterministic fallback.
 */
export function groupSessionsByProject(
  projects: Project[],
  sessions: Session[],
): ProjectSessionGroup[] {
  const byProjectID = new Map(projects.map((project) => [project.id, project]));
  const groups = new Map<string, ProjectSessionGroup>();

  for (const project of projects) {
    groups.set(project.id, {
      id: project.id,
      project,
      worktree: project.worktree,
      sessions: [],
      // Project metadata updates are not conversations. The group timestamp is
      // derived only from its sessions, so the UI can label it accurately.
      updatedAt: 0,
      isGlobal: project.id === "global",
      isFallback: false,
    });
  }

  const worktreeProjects = [...projects]
    .filter((project) => project.worktree)
    .sort((a, b) => b.worktree.length - a.worktree.length);
  let unassigned: ProjectSessionGroup | undefined;

  for (const session of sessions) {
    const sessionFields = fields(session);
    let project = sessionFields.projectID ? byProjectID.get(sessionFields.projectID) : undefined;

    if (!project && sessionFields.directory) {
      project = worktreeProjects.find((candidate) =>
        isWithinWorktree(sessionFields.directory!, candidate.worktree),
      );
    }

    let group: ProjectSessionGroup | undefined;
    if (project) {
      group = groups.get(project.id);
    } else if (projects.length === 0 && sessionFields.directory) {
      const id = `directory:${sessionFields.directory}`;
      group = groups.get(id);
      if (!group) {
        group = fallbackGroup(sessionFields.directory);
        groups.set(id, group);
      }
    } else {
      group = groups.get("global");
      if (!group) {
        unassigned ??= {
          id: "unassigned",
          sessions: [],
          updatedAt: 0,
          isGlobal: true,
          isFallback: false,
        };
        groups.set(unassigned.id, unassigned);
        group = unassigned;
      }
    }

    group!.sessions.push(session);
    group!.updatedAt = Math.max(group!.updatedAt, updatedAt(session));
  }

  for (const group of groups.values()) {
    group.sessions.sort((a, b) => updatedAt(b) - updatedAt(a));
  }

  return [...groups.values()].sort((a, b) => {
    const aHasSessions = a.sessions.length > 0;
    const bHasSessions = b.sessions.length > 0;
    if (aHasSessions !== bHasSessions) return aHasSessions ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id.localeCompare(b.id);
  });
}

export function projectDisplayName(worktree: string | undefined): string {
  if (!worktree || worktree === "/") return "";
  const normalized = worktree.replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}
