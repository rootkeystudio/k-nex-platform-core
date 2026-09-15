import { describe, expect, it } from "vitest";

import { ApplicationReportingTimezoneResolver, canonicalIana } from "../src/application-reporting-timezone.js";

const document = (timezone: unknown, revision = 4) => ({ settingsRevision: revision, values: { reportingTimezone: timezone } });

describe("ApplicationReportingTimezoneResolver", () => {
  it("returns only a canonical application setting and its revision", async () => {
    const resolver = new ApplicationReportingTimezoneResolver({ read: async () => document("America/New_York") } as never);
    await expect(resolver.resolve({ applicationId: "customer-a", environment: "production" })).resolves.toEqual({ timezone: "America/New_York", revision: 4 });
    expect(canonicalIana("UTC")).toBe(true);
    expect(canonicalIana("US/Eastern")).toBe(false);
  });

  it("fails closed for missing, invalid, alias, or stale settings", async () => {
    for (const value of [undefined, "Invalid/Zone", "US/Eastern", "\0UTC"]) {
      const resolver = new ApplicationReportingTimezoneResolver({ read: async () => document(value) } as never);
      await expect(resolver.resolve({ applicationId: "customer-a", environment: "production" })).resolves.toBeUndefined();
    }
    const stale = new ApplicationReportingTimezoneResolver({ read: async () => document("UTC", 0) } as never);
    await expect(stale.resolve({ applicationId: "customer-a", environment: "production" })).resolves.toBeUndefined();
  });
});
