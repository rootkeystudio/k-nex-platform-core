import { describe, expect, it, vi } from "vitest";

import { RuntimeStoreRunnerQuarantineAdapter } from "../src/runner-quarantine-adapter.js";

const identity = {
  applicationId: "customer-alpha",
  environment: "production",
  appId: "app.sales-assistant",
  generationId: "sales-generation-one"
};
const leaseId = "lease-00000000-0000-4000-8000-000000000000";

describe("runtime runner admission", () => {
  it("admits only an exact live generation lease", async () => {
    const store = { inventory: vi.fn(), hasLiveGenerationLease: vi.fn(async () => true), quarantineRunnerGeneration: vi.fn() };
    const adapter = new RuntimeStoreRunnerQuarantineAdapter(store as never);

    await expect(adapter.admit(identity, leaseId)).resolves.toBe(true);
    expect(store.inventory).not.toHaveBeenCalled();
    expect(store.hasLiveGenerationLease).toHaveBeenCalledWith({
      applicationId: identity.applicationId,
      environment: identity.environment,
      extension: { deliveryClass: "hot-application", id: identity.appId },
      generationId: identity.generationId,
      leaseId
    });
  });

  it("denies a missing, expired, or other-owner lease when the exact lookup fails", async () => {
    const store = { inventory: vi.fn(), hasLiveGenerationLease: vi.fn(async () => false), quarantineRunnerGeneration: vi.fn() };
    const adapter = new RuntimeStoreRunnerQuarantineAdapter(store as never);

    await expect(adapter.admit(identity, leaseId)).resolves.toBe(false);
    expect(store.inventory).not.toHaveBeenCalled();
  });
});
