import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspaceNavigationStore } from "../src/index.js";

const scope = { applicationId: "customer-alpha", environment: "production" };
const actor = { kind: "user", id: "user:owner" };
const fence = { ...scope, authorizationRevision: 4, lifecycleRevision: 2 };
const salesRoot = { id: "sales.navigation.root", owner: { kind: "platform-plugin" }, kind: "folder", label: "Sales", icon: "sales", order: 100 } as const;
const catalog = { staticNodes: [{ ...salesRoot, owner: { kind: "platform-plugin", pluginId: "module.sales" } }, { id: "system.navigation.root", owner: { kind: "platform" }, kind: "folder", label: "System", icon: "system", order: 1_000_000 }], staticParentIds: [salesRoot.id] } as const;
const salesTasksNavigation = { id: "sales.navigation.tasks", owner: { kind: "platform-plugin", pluginId: "module.sales" }, kind: "link", parentId: salesRoot.id, label: "Tasks", order: 20, target: { class: "platform-plugin", ownerPluginId: "module.sales", routeId: "sales.route.tasks" } } as const;
const folder = { id: "customer.folder.reports", owner: { kind: "customer" }, kind: "folder", parentId: salesRoot.id, label: "Reports", icon: "folder", order: 20 } as const;

function transaction(...rows: readonly unknown[]) {
  const query = vi.fn();
  for (const value of rows) query.mockResolvedValueOnce(value);
  return { query, release: vi.fn() };
}

describe("P12.8 workspace navigation folder storage", () => {
  it("stores exact customer folders and uses a current-authority CAS transaction", async () => {
    const createSession = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] }, { rows: [] }, { rows: [] },
      { rows: [{ revision: 1, node_json: folder }] }, { rows: [] }
    );
    const updateSession = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] }, { rows: [{ revision: 1, node_json: folder }] }, { rows: [] },
      { rows: [{ revision: 2, node_json: { ...folder, order: 30 } }] }, { rows: [] }
    );
    const read = vi.fn().mockResolvedValue({ rows: [{ revision: 2, node_json: { ...folder, order: 30 } }] });
    const pool = { connect: vi.fn().mockResolvedValueOnce(createSession).mockResolvedValueOnce(updateSession), query: read };
    const store = new PostgresWorkspaceNavigationStore(pool as never, () => new Date("2026-09-03T08:00:00.000Z"));

    expect(await store.create(scope, folder, actor, fence, catalog)).toEqual({ node: folder, revision: 1 });
    expect(await store.update(scope, { ...folder, order: 30 }, 1, actor, fence, catalog)).toEqual({ node: { ...folder, order: 30 }, revision: 2 });
    expect(await store.read(scope, folder.id)).toEqual({ node: { ...folder, order: 30 }, revision: 2 });
    expect(createSession.query.mock.calls[2]?.[1]).toEqual([scope.applicationId]);
    expect(createSession.query.mock.calls[5]?.[1]).toEqual([scope.applicationId, scope.environment, folder.id, JSON.stringify(folder), JSON.stringify(actor), "2026-09-03T08:00:00.000Z"]);
    expect(createSession.query.mock.calls[6]?.[0]).toContain("insert into k_nex_workspace_navigation_outbox");
    expect(createSession.query.mock.calls[6]?.[1]).toEqual([expect.any(String), scope.applicationId, scope.environment, folder.id, "create", 1, fence.authorizationRevision, fence.lifecycleRevision, expect.any(String)]);
    expect(createSession.query.mock.calls[7]?.[0]).toBe("commit");
    expect(updateSession.query.mock.calls[5]?.[1]).toEqual([scope.applicationId, scope.environment, folder.id, JSON.stringify({ ...folder, order: 30 }), JSON.stringify(actor), "2026-09-03T08:00:00.000Z", 1]);
    expect(updateSession.query.mock.calls[6]?.[0]).toContain("insert into k_nex_workspace_navigation_outbox");
    expect(updateSession.query.mock.calls[6]?.[1]).toEqual([expect.any(String), scope.applicationId, scope.environment, folder.id, "update", 2, fence.authorizationRevision, fence.lifecycleRevision, expect.any(String)]);
    expect(updateSession.query.mock.calls[7]?.[0]).toBe("commit");
  });

  it("rejects stale authority, System/foreign parents, cycles, and shadows before SQL writes", async () => {
    const stale = transaction({ rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 5, lifecycle_revision: 2 }] }, { rows: [] });
    const invalid = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] },
      { rows: [{ revision: 1, node_json: { ...folder, id: "customer.folder.parent", parentId: "customer.folder.child" } }, { revision: 1, node_json: { ...folder, id: "customer.folder.child", parentId: salesRoot.id } }] },
      { rows: [] }, { rows: [] }
    );
    const systemParent = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] }, { rows: [] }, { rows: [] }, { rows: [] }
    );
    const shadow = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] }, { rows: [] }, { rows: [] }, { rows: [] }
    );
    const pluginCollision = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] }, { rows: [] }, { rows: [] }, { rows: [] }
    );
    const pool = { connect: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(invalid).mockResolvedValueOnce(systemParent).mockResolvedValueOnce(shadow).mockResolvedValueOnce(pluginCollision), query: vi.fn() };
    const store = new PostgresWorkspaceNavigationStore(pool as never);

    await expect(store.create(scope, folder, actor, fence, catalog)).rejects.toMatchObject({ code: "AUTHORITY_CONFLICT" });
    await expect(store.update(scope, { ...folder, id: "customer.folder.child", parentId: "customer.folder.parent" }, 1, actor, fence, catalog)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, { ...folder, parentId: "system.navigation.root" }, actor, fence, catalog)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, { ...folder, id: "system.navigation.root" }, actor, fence, catalog)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, { ...folder, id: salesTasksNavigation.id }, actor, fence, { ...catalog, staticNodes: [...catalog.staticNodes, salesTasksNavigation] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(stale.query.mock.calls.some(([sql]) => String(sql).startsWith("insert into") || String(sql).startsWith("update k_nex"))).toBe(false);
    expect(invalid.query.mock.calls.some(([sql]) => String(sql).startsWith("insert into") || String(sql).startsWith("update k_nex"))).toBe(false);
    expect(systemParent.query.mock.calls.some(([sql]) => String(sql).startsWith("insert into") || String(sql).startsWith("update k_nex"))).toBe(false);
    expect(shadow.query.mock.calls.some(([sql]) => String(sql).startsWith("insert into") || String(sql).startsWith("update k_nex"))).toBe(false);
    expect(pluginCollision.query.mock.calls.some(([sql]) => String(sql).startsWith("insert into") || String(sql).startsWith("update k_nex"))).toBe(false);
  });

  it("returns a revision conflict for a competing folder move", async () => {
    const race = transaction(
      { rows: [] }, { rows: [] }, { rows: [{ authorization_revision: 4, lifecycle_revision: 2 }] }, { rows: [{ revision: 2, node_json: folder }] }, { rows: [] }, { rows: [] }, { rows: [] }
    );
    const store = new PostgresWorkspaceNavigationStore({ connect: vi.fn().mockResolvedValue(race), query: vi.fn() } as never);

    await expect(store.update(scope, { ...folder, order: 30 }, 1, actor, fence, catalog)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(race.query.mock.calls.some(([sql]) => String(sql).startsWith("update k_nex"))).toBe(true);
  });

  it("rejects plugin-owned folders, links, invalid actors, and invalid scope before SQL", async () => {
    const query = vi.fn();
    const store = new PostgresWorkspaceNavigationStore({ connect: vi.fn(), query } as never);
    await expect(store.create(scope, { ...folder, owner: { kind: "platform-plugin", pluginId: "module.sales" } }, actor, fence, catalog)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, { ...folder, kind: "link", target: { class: "system", routeId: "system.route.workspace" } }, actor, fence, catalog)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, folder, { kind: "role", id: "bad" }, fence, catalog)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.list({ ...scope, environment: "PROD" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(query).not.toHaveBeenCalled();
  });
});
