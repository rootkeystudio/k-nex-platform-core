import { describe, expect, it, vi } from "vitest";

import { PostgresThemeProfileStore } from "../src/theme-profile-store.js";

describe("Theme Profile current authority", () => {
  it("denies before opening a database operation", async () => {
    const pool = { query: vi.fn(), connect: vi.fn() };
    const store = new PostgresThemeProfileStore(pool as never, { now: () => new Date("2026-09-01T00:00:00.000Z") }, { authorize: () => false });

    await expect(store.read({ applicationId: "customer-alpha", environment: "production", profileId: "workspace.default" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
