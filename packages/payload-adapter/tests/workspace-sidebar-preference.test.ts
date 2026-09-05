import { describe, expect, it, vi } from "vitest";

import { PostgresWorkspaceSidebarPreferenceStore, kNexWorkspaceSidebarPreferenceSchemaMigration } from "../src/index.js";

const scope = { applicationId: "customer-alpha", environment: "production", userId: "42" };

describe("P12.4 durable workspace sidebar preference", () => {
  it("reads the expanded default and scopes the persisted value to application, environment, and user", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ sidebar: "collapsed" }] });
    const store = new PostgresWorkspaceSidebarPreferenceStore({ query } as never, () => new Date("2026-09-04T12:00:00.000Z"));
    await expect(store.read(scope)).resolves.toBe("expanded");
    await expect(store.upsert(scope, "collapsed")).resolves.toBe("collapsed");
    expect(query.mock.calls[0]?.[1]).toEqual(["customer-alpha", "production", "42"]);
    expect(query.mock.calls[1]?.[1]).toEqual(["customer-alpha", "production", "42", "collapsed", "2026-09-04T12:00:00.000Z"]);
    expect(query.mock.calls[1]?.[0]).toContain("on conflict (application_id, environment, user_id)");
  });

  it("rejects browser-authoritative scope and malformed values before SQL", async () => {
    const query = vi.fn();
    const store = new PostgresWorkspaceSidebarPreferenceStore({ query } as never);
    await expect(store.read({ ...scope, userId: "" })).rejects.toThrow("scope is invalid");
    await expect(store.upsert(scope, "rail")).rejects.toThrow("preference is invalid");
    expect(query).not.toHaveBeenCalled();
  });

  it("creates a production table with an exact scope key and bounded sidebar state", () => {
    const source = String(kNexWorkspaceSidebarPreferenceSchemaMigration.up);
    for (const fragment of ["k_nex_workspace_sidebar_preferences", 'PRIMARY KEY ("application_id", "environment", "user_id")', "sidebar_check", "expanded","collapsed"]) expect(source).toContain(fragment);
  });
});
