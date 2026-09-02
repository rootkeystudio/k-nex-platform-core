import { describe, expect, it, vi } from "vitest";

import { EffectiveSettingsProvider } from "../src/effective-settings-provider.js";

const identity = { applicationId: "customer-alpha", environment: "production", descriptorId: "system.general", descriptorSchemaVersion: 1, owner: { kind: "platform" as const, namespace: "system" } };
const descriptor = { schemaVersion: 1 as const, id: identity.descriptorId, publisher: identity.owner, descriptorSchemaVersion: 1, validation: "immediate" as const, fields: { enabled: { type: "boolean" as const, required: true } }, readPermission: "system.settings.read", changePermission: "system.settings.manage" };
const document = { schemaVersion: 1 as const, identity, documentRevision: 1, settingsRevision: 2, state: "effective" as const, values: { enabled: true } };
const state = { schemaVersion: 1 as const, applicationId: identity.applicationId, environment: identity.environment, settingsRevision: 2 };

describe("EffectiveSettingsProvider", () => {
  it("re-resolves the active exact owner around the authoritative document read", async () => {
    const source = { list: vi.fn(async () => [{ descriptor, identity, lifecycle: "active" as const }]) };
    const store = { read: vi.fn(async () => ({ state, document })) };
    await expect(new EffectiveSettingsProvider(source, store).read({ applicationId: identity.applicationId, environment: identity.environment, settingsId: identity.descriptorId })).resolves.toEqual(document);
    expect(source.list).toHaveBeenCalledTimes(2);
    expect(store.read).toHaveBeenCalledWith(identity);
  });

  it("never returns pending, disabled, retired, stale-owner, or invalid values", async () => {
    for (const record of [
      { descriptor, identity, lifecycle: "pending-configuration" as const },
      { descriptor, identity, lifecycle: "disabled" as const },
      { descriptor, identity, lifecycle: "retired" as const }
    ]) {
      const store = { read: vi.fn() };
      await expect(new EffectiveSettingsProvider({ list: async () => [record] }, store).read({ applicationId: identity.applicationId, environment: identity.environment, settingsId: identity.descriptorId })).resolves.toBeUndefined();
      expect(store.read).not.toHaveBeenCalled();
    }
    const pending = { ...document, state: "pending-generation-validation" };
    await expect(new EffectiveSettingsProvider({ list: async () => [{ descriptor, identity, lifecycle: "active" }] }, { read: async () => ({ state, document: pending as never }) }).read({ applicationId: identity.applicationId, environment: identity.environment, settingsId: identity.descriptorId })).resolves.toBeUndefined();
    await expect(new EffectiveSettingsProvider({ list: async () => [{ descriptor, identity, lifecycle: "active" }] }, { read: async () => ({ state, document: { ...document, values: { enabled: "yes" } } as never }) }).read({ applicationId: identity.applicationId, environment: identity.environment, settingsId: identity.descriptorId })).resolves.toBeUndefined();
  });

  it("fails closed when the descriptor owner changes during the read", async () => {
    const changed = { descriptor: { ...descriptor, descriptorSchemaVersion: 2 }, identity: { ...identity, descriptorSchemaVersion: 2 }, lifecycle: "active" as const };
    const source = { list: vi.fn().mockResolvedValueOnce([{ descriptor, identity, lifecycle: "active" }]).mockResolvedValueOnce([changed]) };
    await expect(new EffectiveSettingsProvider(source, { read: async () => ({ state, document }) }).read({ applicationId: identity.applicationId, environment: identity.environment, settingsId: identity.descriptorId })).resolves.toBeUndefined();
  });
});
