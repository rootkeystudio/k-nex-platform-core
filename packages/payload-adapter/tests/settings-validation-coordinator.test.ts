import { describe, expect, it, vi } from "vitest";

import { SettingsValidationCoordinator } from "../src/settings-validation-coordinator.js";

const identity = {
  applicationId: "customer-alpha",
  environment: "production",
  descriptorId: "weather.settings.runtime",
  descriptorSchemaVersion: 2,
  owner: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.weather", generation: 3 }
} as const;
const authority = { schemaVersion: 1, applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 8 } as const;
const pending = {
  schemaVersion: 1,
  operationId: "settings-operation-weather",
  identity,
  pendingDocument: {
    schemaVersion: 1, state: "pending-generation-validation", identity,
    documentRevision: 1, settingsRevision: 1, values: { region: "eu-west" }
  },
  expectedDocumentRevision: 0,
  expectedSettingsRevision: 0,
  state: "pending-validation",
  attempts: 0,
  requestedBy: { kind: "user", id: "admin" },
  idempotencyKey: "weather-settings-1",
  revision: 1,
  updatedAt: "2026-09-02T00:00:00.000Z"
} as const;

function promoted() {
  return {
    schemaVersion: 1, receiptId: "settings-receipt-weather", operationId: pending.operationId, identity,
    requestedBy: pending.requestedBy, idempotencyKey: pending.idempotencyKey, occurredAt: "2026-09-02T00:00:01.000Z",
    outcome: "promoted", documentRevision: 1, settingsRevision: 1, changedFields: ["region"],
    invalidationId: "settings-invalidation-weather"
  } as const;
}

describe("SettingsValidationCoordinator", () => {
  it("leases, validates, and promotes only the exact staged runtime generation", async () => {
    const terminal = promoted();
    const claimed = { ...pending, state: "validating", attempts: 1, revision: 2,
      leaseOwner: "settings-worker-one", leaseExpiresAt: "2026-09-02T00:01:00.000Z" } as const;
    const store = {
      readGenerationValidated: vi.fn(async () => pending),
      claimGenerationValidated: vi.fn(async () => ({ operation: claimed, runtimeGenerationId: "weather-runtime-3" })),
      read: vi.fn(async () => ({ state: { schemaVersion: 1, applicationId: identity.applicationId, environment: identity.environment, settingsRevision: 0 } })),
      promoteGenerationValidated: vi.fn(async () => terminal),
      failGenerationValidated: vi.fn()
    };
    const validator = { validate: vi.fn(async () => ({ ready: true as const })) };
    const times = [new Date("2026-09-02T00:00:00.000Z"), new Date("2026-09-02T00:00:01.000Z")];
    const coordinator = new SettingsValidationCoordinator({
      store: store as never, validator, readAuthority: async () => authority,
      leaseOwner: "settings-worker-one", now: () => times.shift()!
    });

    await expect(coordinator.run({ identity, operationId: pending.operationId })).resolves.toEqual(terminal);
    expect(validator.validate).toHaveBeenCalledWith(expect.objectContaining({ runtimeGenerationId: "weather-runtime-3", candidate: pending.pendingDocument }));
    expect(store.promoteGenerationValidated).toHaveBeenCalledWith(expect.objectContaining({ expectedOperationRevision: 2, leaseOwner: "settings-worker-one" }));
    expect(store.failGenerationValidated).not.toHaveBeenCalled();
  });

  it("returns the immutable terminal receipt after response loss without validation", async () => {
    const terminal = promoted();
    const store = { readGenerationValidated: vi.fn(async () => terminal) };
    const validator = { validate: vi.fn() };
    const coordinator = new SettingsValidationCoordinator({
      store: store as never, validator: validator as never, readAuthority: vi.fn(), leaseOwner: "settings-worker-one"
    });
    await expect(coordinator.run({ identity, operationId: pending.operationId })).resolves.toEqual(terminal);
    expect(validator.validate).not.toHaveBeenCalled();
  });
});
