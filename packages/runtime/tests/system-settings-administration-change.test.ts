import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision, AuthorizationState, EffectiveSettingsDocument, SettingsDocumentIdentity, SystemSettingsDescriptor } from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { SystemSettingsAdministrationService } from "../src/system-settings-administration.js";

const expected = Object.freeze({ applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 7 });
const session = createTrustedAuthorizationSession({
  schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, correlationId: "settings-change-test",
  principal: { kind: "user", id: "admin" }, effectiveActor: { kind: "user", id: "admin" }
});
type Context = Readonly<Record<never, never>>;

function descriptor(validation: "immediate" | "generation-validated" = "immediate"): SystemSettingsDescriptor {
  return {
    schemaVersion: 1, id: "sales.settings.workspace", publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
    descriptorSchemaVersion: 1, validation,
    fields: { pageSize: { type: "integer", required: true, default: 25, minimum: 1, maximum: 100 }, apiToken: { type: "secret-reference", required: false } },
    readPermission: "sales.settings.read", changePermission: "sales.settings.write"
  };
}

function identity(d: SystemSettingsDescriptor): SettingsDocumentIdentity {
  return {
    applicationId: expected.applicationId, environment: expected.environment, descriptorId: d.id, descriptorSchemaVersion: d.descriptorSchemaVersion,
    owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 }
  };
}

function document(d: SystemSettingsDescriptor): EffectiveSettingsDocument {
  return {
    schemaVersion: 1, state: "effective", identity: identity(d), documentRevision: 3, settingsRevision: 8,
    values: { pageSize: 50, apiToken: { kind: "secret-reference", provider: "environment", key: "SALES_API_TOKEN" } }
  };
}

function state(): AuthorizationState { return { schemaVersion: 1, ...expected }; }

function decision(request: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny", revisions = expected): AuthorizationDecision {
  return {
    schemaVersion: 1, decisionId: request.decisionId, correlationId: current.correlationId, applicationId: current.applicationId, environment: current.environment,
    permissionId: request.permissionId, owner: request.permissionId.startsWith("system.") ? { kind: "platform", namespace: "system" }
      : { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 },
    principal: current.principal, effectiveActor: current.effectiveActor, scope: request.scope,
    authorizationRevision: revisions.authorizationRevision, lifecycleRevision: revisions.lifecycleRevision, outcome,
    reason: outcome === "allow" ? "granted" : "permission-not-granted", approval: "not-required", reauthentication: "not-required"
  };
}

function change(values: Record<string, unknown> = { pageSize: 60 }) {
  return { expectedDocumentRevision: 3, expectedSettingsRevision: 8, idempotencyKey: "settings-change-1", values };
}

function harness(options: Readonly<{
  validation?: "immediate" | "generation-validated";
  descriptor?: SystemSettingsDescriptor;
  permissions?: Partial<Record<string, "allow" | "deny">>;
  lifecycle?: "active" | "disabled" | "retired";
  snapshot?: unknown;
  states?: readonly AuthorizationState[];
  immediate?: unknown;
  generation?: unknown;
}> = {}) {
  const d = options.descriptor ?? descriptor(options.validation);
  const current = document(d);
  const resolver = { authorize: vi.fn(async (trusted: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) =>
    decision(request, trusted, options.permissions?.[request.permissionId] ?? "allow")) };
  const authority = new CurrentAuthorityAdapter({ current: async () => session }, resolver as never);
  const descriptorSource = { list: vi.fn(async () => [{ descriptor: d, identity: identity(d), lifecycle: options.lifecycle ?? "active" }]) };
  const states = [...(options.states ?? [state()])];
  const stateSource = { readState: vi.fn(async () => states.shift() ?? state()) };
  const receipt = (write: any) => ({
    schemaVersion: 1, outcome: "promoted", receiptId: write.receipt.receiptId, operationId: write.operation.operationId,
    identity: write.identity, requestedBy: write.actor, idempotencyKey: write.operation.idempotencyKey, occurredAt: write.receipt.occurredAt,
    documentRevision: write.document.expectedDocumentRevision + 1, settingsRevision: write.document.expectedSettingsRevision + 1,
    changedFields: write.changedFields, invalidationId: write.receipt.invalidationId
  });
  const operation = (write: any) => ({
    schemaVersion: 1, operationId: write.operation.operationId, identity: write.identity,
    pendingDocument: { schemaVersion: 1, state: "pending-generation-validation", identity: write.identity, documentRevision: 4, settingsRevision: 9, values: write.document.values },
    expectedDocumentRevision: write.document.expectedDocumentRevision, expectedSettingsRevision: write.document.expectedSettingsRevision,
    state: "pending-validation", attempts: 0, requestedBy: write.actor, idempotencyKey: write.operation.idempotencyKey, revision: 1, updatedAt: write.receipt.occurredAt
  });
  const store = {
    read: vi.fn(async () => options.snapshot === undefined ? { state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 8 }, document: current } : options.snapshot),
    writeImmediate: vi.fn(async (write: any) => options.immediate ?? receipt(write)),
    beginGenerationValidated: vi.fn(async (write: any) => options.generation ?? operation(write))
  };
  const metadata = { id: vi.fn((kind: string) => `${kind}-settings-change-1`), now: vi.fn(() => new Date("2026-09-02T10:00:00.000Z")) };
  return { d, current, resolver, descriptorSource, stateSource, store, metadata, service: new SystemSettingsAdministrationService<Context>({ authority, descriptorSource, state: stateSource, store, metadata }) };
}

describe("P11.3e system settings administration changes", () => {
  it("rejects forged top-level and change fields before authority", async () => {
    const value = harness();
    await expect(value.service.change({ context: {}, settingsId: value.d.id, change: change(), owner: "forged" } as never)).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    await expect(value.service.change({ context: {}, settingsId: value.d.id, change: { ...change(), receipt: "forged" } as never })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(value.resolver.authorize).not.toHaveBeenCalled();
    expect(value.descriptorSource.list).not.toHaveBeenCalled();
    expect(value.store.read).not.toHaveBeenCalled();
    expect(value.metadata.id).not.toHaveBeenCalled();
  });

  it("denies fixed or descriptor change authority without reading values or generating metadata", async () => {
    const fixed = harness({ permissions: { "system.settings.manage": "deny" } });
    await expect(fixed.service.change({ context: {}, settingsId: fixed.d.id, change: change() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fixed.descriptorSource.list).not.toHaveBeenCalled();
    expect(fixed.store.read).not.toHaveBeenCalled();
    expect(fixed.metadata.id).not.toHaveBeenCalled();

    const descriptorDenied = harness({ permissions: { "sales.settings.write": "deny" } });
    await expect(descriptorDenied.service.change({ context: {}, settingsId: descriptorDenied.d.id, change: change() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(descriptorDenied.store.read).not.toHaveBeenCalled();
    expect(descriptorDenied.metadata.id).not.toHaveBeenCalled();
  });

  it("checks snapshot revisions before server metadata and sends an exact immediate write", async () => {
    const stale = harness();
    await expect(stale.service.change({ context: {}, settingsId: stale.d.id, change: { ...change(), expectedDocumentRevision: 2 } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(stale.metadata.id).not.toHaveBeenCalled();

    const value = harness();
    const result = await value.service.change({ context: {}, settingsId: value.d.id, change: change({ pageSize: 60, apiToken: "browser-secret" }) });
    expect(result).toMatchObject({ outcome: "promoted" });
    expect(value.store.beginGenerationValidated).not.toHaveBeenCalled();
    expect(value.store.writeImmediate).toHaveBeenCalledTimes(1);
    const write = value.store.writeImmediate.mock.calls[0]![0];
    expect(write.identity).toEqual(identity(value.d));
    expect(write.actor).toEqual(session.effectiveActor);
    expect(write.authority).toEqual(expected);
    expect(write.document.values).toEqual({ pageSize: 60, apiToken: value.current.values.apiToken });
    expect(write.changedFields).toEqual(["pageSize"]);
    expect(JSON.stringify(write)).not.toContain("browser-secret");
    expect(JSON.stringify(result)).not.toContain("SALES_API_TOKEN");
  });

  it("uses the current global revision when another descriptor advanced settings state", async () => {
    const value = harness({ snapshot: {
      state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 9 },
      document: document(descriptor())
    } });
    await expect(value.service.detail({ context: {}, settingsId: value.d.id })).resolves.toMatchObject({
      documentRevision: 3,
      settingsRevision: 9
    });
    await expect(value.service.change({
      context: {},
      settingsId: value.d.id,
      change: { ...change(), expectedSettingsRevision: 9 }
    })).resolves.toMatchObject({ outcome: "promoted", settingsRevision: 10 });
    expect(value.store.writeImmediate.mock.calls[0]![0].document).toMatchObject({
      expectedDocumentRevision: 3,
      expectedSettingsRevision: 9
    });
  });

  it("uses generation-validated dispatch and rejects inactive or pending records", async () => {
    const generation = harness({ validation: "generation-validated" });
    await expect(generation.service.change({ context: {}, settingsId: generation.d.id, change: change() })).resolves.toMatchObject({ state: "pending-validation" });
    expect(generation.store.writeImmediate).not.toHaveBeenCalled();
    expect(generation.store.beginGenerationValidated).toHaveBeenCalledTimes(1);

    const inactive = harness({ lifecycle: "disabled" });
    await expect(inactive.service.change({ context: {}, settingsId: inactive.d.id, change: change() })).rejects.toMatchObject({ code: "STATE_INVALID" });
    expect(inactive.store.read).not.toHaveBeenCalled();
    const pending = harness({ snapshot: { state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 8 }, document: { ...document(descriptor()), state: "pending-generation-validation" } } });
    await expect(pending.service.change({ context: {}, settingsId: pending.d.id, change: change() })).rejects.toMatchObject({ code: "STATE_INVALID" });
  });

  it("rechecks current state before writing, maps actual store errors, and rejects malformed store results", async () => {
    const stale = harness({ states: [state(), state(), { ...state(), lifecycleRevision: 8 }] });
    await expect(stale.service.change({ context: {}, settingsId: stale.d.id, change: change() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(stale.store.writeImmediate).not.toHaveBeenCalled();
    expect(stale.metadata.id).not.toHaveBeenCalled();

    const revision = harness();
    revision.store.writeImmediate.mockRejectedValueOnce(Object.assign(new Error("private"), { code: "REVISION" }));
    await expect(revision.service.change({ context: {}, settingsId: revision.d.id, change: change() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const malformed = harness({ immediate: { receiptId: "forged" } });
    await expect(malformed.service.change({ context: {}, settingsId: malformed.d.id, change: change() })).rejects.toMatchObject({ code: "STATE_INVALID" });
  });

  it("rejects invalid candidates and maps each real store error class", async () => {
    const required = { ...descriptor(), fields: { requiredPageSize: { type: "integer", required: true, minimum: 1, maximum: 100 }, apiToken: { type: "secret-reference", required: false } } };
    const invalid = harness({ descriptor: required });
    await expect(invalid.service.change({ context: {}, settingsId: invalid.d.id, change: change({ requiredPageSize: 101 }) })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(invalid.metadata.id).not.toHaveBeenCalled();

    for (const [code, expectedCode] of [["IDEMPOTENCY", "REVISION_CONFLICT"], ["INVALID", "REQUEST_INVALID"], ["STATE", "STATE_INVALID"]] as const) {
      const value = harness();
      value.store.writeImmediate.mockRejectedValueOnce(Object.assign(new Error("private"), { code }));
      await expect(value.service.change({ context: {}, settingsId: value.d.id, change: change() })).rejects.toMatchObject({ code: expectedCode });
    }
  });
});
