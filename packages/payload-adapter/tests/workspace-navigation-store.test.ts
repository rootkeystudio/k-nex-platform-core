import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspaceNavigationStore } from "../src/index.js";

const scope = { applicationId: "customer-alpha", environment: "production" };
const actor = { kind: "user", id: "user:owner" };
const folder = { id: "customer.folder.reports", owner: { kind: "customer" }, kind: "folder", parentId: "sales.navigation.root", label: "Reports", icon: "folder", order: 20 } as const;

describe("P12.8 workspace navigation folder storage", () => {
  it("stores exact customer folders and uses CAS for reorder", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ revision: 1, node_json: folder }] })
      .mockResolvedValueOnce({ rows: [{ revision: 2, node_json: { ...folder, order: 30 } }] })
      .mockResolvedValueOnce({ rows: [{ revision: 2, node_json: { ...folder, order: 30 } }] })
      .mockResolvedValueOnce({ rows: [] });
    const store = new PostgresWorkspaceNavigationStore({ query } as never, () => new Date("2026-09-03T08:00:00.000Z"));
    expect(await store.create(scope, folder, actor)).toEqual({ node: folder, revision: 1 });
    expect(await store.update(scope, { ...folder, order: 30 }, 1, actor)).toEqual({ node: { ...folder, order: 30 }, revision: 2 });
    expect(await store.read(scope, folder.id)).toEqual({ node: { ...folder, order: 30 }, revision: 2 });
    await expect(store.update(scope, { ...folder, order: 40 }, 1, actor)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(query.mock.calls[0]?.[1]).toEqual([scope.applicationId, scope.environment, folder.id, JSON.stringify(folder), JSON.stringify(actor), "2026-09-03T08:00:00.000Z"]);
  });

  it("rejects plugin-owned folders, links, invalid actors, and invalid scope before SQL", async () => {
    const query = vi.fn();
    const store = new PostgresWorkspaceNavigationStore({ query } as never);
    await expect(store.create(scope, { ...folder, owner: { kind: "platform-plugin", pluginId: "module.sales" } }, actor)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, { ...folder, kind: "link", target: { class: "system", routeId: "system.route.workspace" } }, actor)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.create(scope, folder, { kind: "role", id: "bad" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.list({ ...scope, environment: "PROD" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(query).not.toHaveBeenCalled();
  });
});
