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
const resolvePatch = (nodeIds: readonly string[], patch: { kind: "move"; nodeId: string; beforeNodeId?: string }, nested = false) => {
  const nodes = nodeIds.map((id) => ({ id, type: "workspace.card", version: 1, props: { title: id } }));
  const movementSnapshot: PublishedLayoutSnapshot = {
    layoutRevisionId: "movement", revisionNumber: 1,
    document: { schemaVersion: 1, id: "workspace.movement", version: 1, profile: "workspace", regions: { main: nested ? [{ id: "container", type: "workspace.container", version: 1, props: {}, children: nodes }] : nodes } },
    personalization: { movableNodeIds: [...nodeIds], hideableNodeIds: [], resizableNodeIds: [], editableProps: {} }
  };
  return resolveWorkspaceLayout({ userId: "u1", groupIds: ["ops"], permissions: [], at: "2026-08-27T00:00:00.000Z", assignments: [assignment("movement", { kind: "group", groupId: "ops" }, 1)], snapshots: [movementSnapshot], patches: [patch] }).document;
};

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

  it("moves forward, backward, to the end, and onto itself with exact before semantics", () => {
    expect(resolvePatch(["alpha", "beta", "gamma"], { kind: "move", nodeId: "alpha", beforeNodeId: "gamma" }).regions.main.map(({ id }) => id)).toEqual(["beta", "alpha", "gamma"]);
    expect(resolvePatch(["alpha", "beta", "gamma"], { kind: "move", nodeId: "gamma", beforeNodeId: "alpha" }).regions.main.map(({ id }) => id)).toEqual(["gamma", "alpha", "beta"]);
    expect(resolvePatch(["alpha", "beta", "gamma"], { kind: "move", nodeId: "alpha" }).regions.main.map(({ id }) => id)).toEqual(["beta", "gamma", "alpha"]);
    expect(resolvePatch(["alpha", "beta", "gamma"], { kind: "move", nodeId: "beta", beforeNodeId: "beta" }).regions.main.map(({ id }) => id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("uses the same exact move semantics for nested siblings", () => {
    const resolved = resolvePatch(["nested-a", "nested-b", "nested-c"], { kind: "move", nodeId: "nested-a", beforeNodeId: "nested-c" }, true);
    expect(resolved.regions.main[0]?.children?.map(({ id }) => id)).toEqual(["nested-b", "nested-a", "nested-c"]);
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
