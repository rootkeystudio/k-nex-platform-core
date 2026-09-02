import { describe, expect, it, vi } from "vitest";

import { CurrentAuthorityThemeProfileAuthorizer, PostgresThemeProfileStore } from "../src/theme-profile-store.js";

const clock = { now: () => new Date("2026-09-01T00:00:00.000Z") };
const validator = { validate: vi.fn() };

describe("Theme Profile current authority", () => {
  it("denies before opening a database operation", async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const store = new PostgresThemeProfileStore(pool as never, clock, { authorize: () => false }, validator);

    await expect(store.read({ applicationId: "customer-alpha", environment: "production", profileId: "workspace.default" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("uses read/manage permissions and requires server reauthentication for publish and rollback", async () => {
    const authority = { authorize: vi.fn(async (_context, target) => ({
      outcome: "allow", permissionId: target.permissionId, applicationId: "customer-alpha", environment: "production"
    })) };
    const reauthentication = { verify: vi.fn(async () => true) };
    const authorizer = new CurrentAuthorityThemeProfileAuthorizer(authority as never, () => ({ session: "owner" }), reauthentication as never);
    const owner = { applicationId: "customer-alpha", environment: "production", profileId: "workspace.default" };

    await expect(authorizer.authorize({ operation: "read", owner })).resolves.toBe(true);
    await expect(authorizer.authorize({ operation: "stage", owner })).resolves.toBe(true);
    await expect(authorizer.authorize({ operation: "publish", owner })).resolves.toBe(true);
    await expect(authorizer.authorize({ operation: "rollback", owner })).resolves.toBe(true);
    expect(authority.authorize.mock.calls.map(([, target]) => target.permissionId)).toEqual([
      "system.themes.read", "system.themes.manage", "system.themes.manage", "system.themes.manage"
    ]);
    expect(reauthentication.verify.mock.calls.map(([input]) => input.operation)).toEqual(["publish", "rollback"]);

    reauthentication.verify.mockResolvedValueOnce(false);
    await expect(authorizer.authorize({ operation: "publish", owner })).resolves.toBe(false);
  });

  it("rechecks read authority after PostgreSQL before releasing a profile", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const pool = { query: vi.fn(async () => ({ rows: [{ revision: 0, active_revision_id: null, active_profile: null, previous_revision_id: null, previous_profile: null, draft_revision_id: null, draft_profile: null, state_digest: null }] })) };
    const store = new PostgresThemeProfileStore(pool as never, clock, { authorize }, validator);
    await expect(store.read({ applicationId: "customer-alpha", environment: "production", profileId: "workspace.default" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(pool.query).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects a failed preview without writing profile state", async () => {
    const queries: string[] = [];
    const session = { query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("from runtime_theme_profile_publications")) return { rows: [] };
      return { rows: [] };
    }), release: vi.fn() };
    const pool = { connect: vi.fn(async () => session) };
    const previewValidator = { validate: vi.fn(async () => { throw new Error("insufficient contrast"); }) };
    const store = new PostgresThemeProfileStore(pool as never, clock, { authorize: () => true }, previewValidator);
    const profile = { schemaVersion: 1, id: "workspace.default", surface: "admin", themeId: "theme.minimal", themeVersion: "1.0.0", palette: "light", mode: "light", values: {}, revision: { id: "workspace.revision-1", number: 1, createdAt: "2026-09-01T00:00:00.000Z", state: "draft" } };
    await expect(store.preview({ applicationId: "customer-alpha", environment: "production", expectedRevision: 0, profile })).rejects.toMatchObject({ code: "PROFILE_INVALID" });
    expect(queries.some((sql) => /^\s*(?:update|insert)/iu.test(sql))).toBe(false);
    expect(queries).toContain("rollback");
  });
});
