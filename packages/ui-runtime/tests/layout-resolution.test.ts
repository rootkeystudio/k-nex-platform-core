import { describe, expect, it } from "vitest";

import { resolveWorkspaceLayout, type LayoutAssignment, type PublishedLayoutSnapshot } from "../src/index.js";

const document = (id = "workspace.default") => ({ schemaVersion: 1 as const, id, version: 1, profile: "workspace" as const, regions: { main: [
  { id: "alpha", type: "workspace.card", version: 1, props: { title: "Alpha" }, layout: { tokens: { width: "size.medium" } } },
  { id: "beta", type: "workspace.card", version: 1, props: { title: "Beta" } }
] } });
const snapshot = (layoutRevisionId: string): PublishedLayoutSnapshot => ({
  layoutRevisionId, revisionNumber: 1, document: document(`workspace.${layoutRevisionId}`),
  personalization: { movableNodeIds: ["beta"], hideableNodeIds: ["beta"], resizableNodeIds: ["alpha"], editableProps: { alpha: ["title"] } }
});
const assignment = (assignmentId: string, subject: LayoutAssignment["subject"], priority: number, layoutRevisionId = assignmentId): LayoutAssignment => ({ assignmentId, subject, priority, layoutRevisionId, reason: "policy", source: "admin", activeFrom: "2026-01-01T00:00:00.000Z" });

describe("workspace layout resolution", () => {
  it("selects one explainable winner for multiple groups by priority, specificity, then ID", () => {
    const assignments = [assignment("group-z", { kind: "group", groupId: "ops" }, 10), assignment("group-a", { kind: "group", groupId: "sales" }, 10), assignment("permission", { kind: "permission", permission: "dashboard" }, 10)];
    const result = resolveWorkspaceLayout({ userId: "u1", groupIds: ["ops", "sales"], permissions: ["dashboard"], at: "2026-08-27T00:00:00.000Z", assignments, snapshots: assignments.map(({ layoutRevisionId }) => snapshot(layoutRevisionId)) });
    expect(result.status).toBe("resolved");
    expect(result.selectedAssignmentId).toBe("group-a");
    expect(result.explanation).toEqual(expect.arrayContaining([expect.stringContaining("selected:group-a"), expect.stringContaining("superseded:permission")]));
  });

  it("honors active intervals and applies only explicitly allowed patches without mutating the snapshot", () => {
    const selected = { ...assignment("personal", { kind: "user", userId: "u1" }, 20), activeUntil: "2026-09-01T00:00:00.000Z" };
    const source = snapshot("personal");
    const result = resolveWorkspaceLayout({ userId: "u1", groupIds: [], permissions: [], at: "2026-08-27T00:00:00.000Z", assignments: [selected], snapshots: [source], patches: [
      { kind: "move", nodeId: "beta", beforeNodeId: "alpha" }, { kind: "resize", nodeId: "alpha", widthToken: "size.large" }, { kind: "set-prop", nodeId: "alpha", prop: "title", value: "Mine" }
    ] });
    expect(result.document.regions.main.map((node) => node.id)).toEqual(["beta", "alpha"]);
    expect(result.document.regions.main[1]?.props.title).toBe("Mine");
    expect(source.document.regions.main[0]?.props.title).toBe("Alpha");
  });

  it("retains the last valid snapshot after a denied patch, conflict, or migration failure", () => {
    const selected = assignment("group", { kind: "group", groupId: "ops" }, 1);
    const lastValid = document("workspace.last-valid");
    const denied = resolveWorkspaceLayout({ userId: "u1", groupIds: ["ops"], permissions: [], at: "2026-08-27T00:00:00.000Z", assignments: [selected], snapshots: [snapshot("group")], patches: [{ kind: "hide", nodeId: "alpha" }], lastValid });
    const migration = resolveWorkspaceLayout({ userId: "u1", groupIds: ["ops"], permissions: [], at: "2026-08-27T00:00:00.000Z", assignments: [selected], snapshots: [snapshot("group")], lastValid, migrate: () => { throw new Error("migration failed"); } });
    expect(denied.status).toBe("last-valid");
    expect(migration.status).toBe("last-valid");
    expect(denied.document.id).toBe("workspace.last-valid");
    expect(migration.explanation.at(-1)).toContain("migration failed");
  });
});
