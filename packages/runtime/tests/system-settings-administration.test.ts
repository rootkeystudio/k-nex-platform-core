import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationDecision,
  AuthorizationState,
  EffectiveSettingsDocument,
  PendingSettingsCandidate,
  SettingsDocumentIdentity,
  SystemSettingsDescriptor
} from "@k-nex/contracts";

import { CurrentAuthorityAdapter } from "../src/current-authority-adapter.js";
import { createTrustedAuthorizationSession, type EffectiveAuthorizationRequest, type TrustedAuthorizationSession } from "../src/effective-authority.js";
import { SystemSettingsAdministrationService } from "../src/system-settings-administration.js";

const expected = Object.freeze({ applicationId: "customer-alpha", environment: "production", authorizationRevision: 4, lifecycleRevision: 7 });
const session = createTrustedAuthorizationSession({
  schemaVersion: 1,
  applicationId: expected.applicationId,
  environment: expected.environment,
  correlationId: "system-settings-test",
  principal: { kind: "user", id: "admin" },
  effectiveActor: { kind: "user", id: "admin" }
});
type Context = Readonly<Record<never, never>>;

function descriptor(id = "sales.settings.workspace"): SystemSettingsDescriptor {
  return {
    schemaVersion: 1,
    id,
    publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" },
    descriptorSchemaVersion: 1,
    validation: "immediate",
    fields: {
      pageSize: { type: "integer", required: true, default: 25, minimum: 1, maximum: 100 },
      apiToken: { type: "secret-reference", required: false }
    },
    readPermission: "sales.settings.read",
    changePermission: "sales.settings.write"
  };
}

function identity(value: SystemSettingsDescriptor): SettingsDocumentIdentity {
  return {
    applicationId: expected.applicationId,
    environment: expected.environment,
    descriptorId: value.id,
    descriptorSchemaVersion: value.descriptorSchemaVersion,
    owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 }
  };
}

function stored(value: SystemSettingsDescriptor, state: "effective" | "pending-generation-validation" = "effective"): EffectiveSettingsDocument | PendingSettingsCandidate {
  return {
    schemaVersion: 1,
    state,
    identity: identity(value),
    documentRevision: 3,
    settingsRevision: 8,
    values: {
      pageSize: 50,
      apiToken: { kind: "secret-reference", provider: "environment", key: "SALES_API_TOKEN" }
    }
  } as EffectiveSettingsDocument | PendingSettingsCandidate;
}

function state(): AuthorizationState { return { schemaVersion: 1, ...expected }; }

function decision(request: EffectiveAuthorizationRequest, current: TrustedAuthorizationSession, outcome: "allow" | "deny", revisions = expected): AuthorizationDecision {
  return {
    schemaVersion: 1,
    decisionId: request.decisionId,
    correlationId: current.correlationId,
    applicationId: current.applicationId,
    environment: current.environment,
    permissionId: request.permissionId,
    owner: request.permissionId.startsWith("system.")
      ? { kind: "platform", namespace: "system" }
      : { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales", generation: 2 },
    principal: current.principal,
    effectiveActor: current.effectiveActor,
    scope: request.scope,
    authorizationRevision: revisions.authorizationRevision,
    lifecycleRevision: revisions.lifecycleRevision,
    outcome,
    reason: outcome === "allow" ? "granted" : "permission-not-granted",
    approval: "not-required",
    reauthentication: "not-required"
  };
}

function harness(options: Readonly<{
  readonly permissions?: Partial<Record<string, "allow" | "deny">>;
  readonly records?: readonly unknown[];
  readonly snapshot?: unknown;
  readonly authorityState?: AuthorizationState | undefined;
  readonly authorityStates?: readonly AuthorizationState[];
  readonly descriptorRevisions?: Readonly<{ authorizationRevision: number; lifecycleRevision: number }>;
}> = {}) {
  const d = descriptor();
  const records = options.records ?? [{ descriptor: d, identity: identity(d), lifecycle: "active" }];
  const resolver = {
    authorize: vi.fn(async (current: TrustedAuthorizationSession, request: EffectiveAuthorizationRequest) => decision(
      request,
      current,
      options.permissions?.[request.permissionId] ?? "allow",
      !request.permissionId.startsWith("system.") && options.descriptorRevisions ? options.descriptorRevisions : expected
    ))
  };
  const authority = new CurrentAuthorityAdapter({ current: async () => session }, resolver as never);
  const descriptorSource = { list: vi.fn(async () => records) };
  const authorityStates = [...(options.authorityStates ?? [])];
  const stateSource = { readState: vi.fn(async () => authorityStates.shift() ?? (options.authorityState === undefined ? state() : options.authorityState)) };
  const store = { read: vi.fn(async () => options.snapshot === undefined ? { state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 8 }, document: stored(d) } : options.snapshot) };
  return {
    d,
    resolver,
    descriptorSource,
    stateSource,
    store,
    service: new SystemSettingsAdministrationService<Context>({ authority, descriptorSource, state: stateSource, store })
  };
}

describe("P11.3d system settings administration reads", () => {
  it("denies the fixed read target before descriptor source or store access", async () => {
    const value = harness({ permissions: { "system.settings.read": "deny" } });
    await expect(value.service.list({ context: {} })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(value.descriptorSource.list).not.toHaveBeenCalled();
    expect(value.store.read).not.toHaveBeenCalled();
  });

  it("rejects stale authority state before descriptor source or store access", async () => {
    const value = harness({ authorityState: { ...state(), authorizationRevision: 5 } });
    await expect(value.service.detail({ context: {}, settingsId: value.d.id })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.descriptorSource.list).not.toHaveBeenCalled();
    expect(value.store.read).not.toHaveBeenCalled();
  });

  it("fails closed when authorization or lifecycle changes while values are read", async () => {
    for (const changed of [{ ...state(), authorizationRevision: 5 }, { ...state(), lifecycleRevision: 8 }]) {
      const value = harness({ authorityStates: [state(), state(), changed] });
      await expect(value.service.detail({ context: {}, settingsId: value.d.id })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect(value.store.read).toHaveBeenCalledTimes(1);
      expect(value.stateSource.readState).toHaveBeenCalledTimes(3);
    }
  });

  it("rejects malformed detail IDs before authorization, source, or store access", async () => {
    const value = harness();
    await expect(value.service.detail({ context: {}, settingsId: "not a settings id" })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(value.resolver.authorize).not.toHaveBeenCalled();
    expect(value.descriptorSource.list).not.toHaveBeenCalled();
    expect(value.store.read).not.toHaveBeenCalled();
  });

  it("fails closed for inconsistent and duplicate trusted descriptor records", async () => {
    const d = descriptor();
    const duplicate = harness({ records: [{ descriptor: d, identity: identity(d), lifecycle: "active" }, { descriptor: d, identity: identity(d), lifecycle: "active" }] });
    await expect(duplicate.service.list({ context: {} })).rejects.toMatchObject({ code: "STATE_INVALID" });
    const inconsistent = harness({ records: [{ descriptor: d, identity: { ...identity(d), descriptorSchemaVersion: 2 }, lifecycle: "active" }] });
    await expect(inconsistent.service.list({ context: {} })).rejects.toMatchObject({ code: "STATE_INVALID" });
  });

  it("does not read the store for descriptor permission denial and sorts the permitted list", async () => {
    const alpha = descriptor("sales.settings.alpha");
    const beta = descriptor("sales.settings.beta");
    const value = harness({
      records: [{ descriptor: beta, identity: identity(beta), lifecycle: "active" }, { descriptor: alpha, identity: identity(alpha), lifecycle: "active" }],
      permissions: { "sales.settings.read": "deny" }
    });
    await expect(value.service.list({ context: {} })).resolves.toEqual([]);
    expect(value.store.read).not.toHaveBeenCalled();

    const allowed = harness({ records: [{ descriptor: beta, identity: identity(beta), lifecycle: "active" }, { descriptor: alpha, identity: identity(alpha), lifecycle: "active" }] });
    allowed.store.read.mockImplementation(async (recordIdentity: SettingsDocumentIdentity) => {
      const record = [alpha, beta].find((candidate) => candidate.id === recordIdentity.descriptorId)!;
      return { state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 8 }, document: stored(record) };
    });
    const views = await allowed.service.list({ context: {} });
    expect(views.map((view) => view.identity.descriptorId)).toEqual([alpha.id, beta.id]);
  });

  it("returns undefined for unknown or descriptor-denied details without reading values", async () => {
    const unknown = harness();
    await expect(unknown.service.detail({ context: {}, settingsId: "sales.settings.unknown" })).resolves.toBeUndefined();
    expect(unknown.store.read).not.toHaveBeenCalled();
    const denied = harness({ permissions: { "sales.settings.read": "deny" } });
    await expect(denied.service.detail({ context: {}, settingsId: denied.d.id })).resolves.toBeUndefined();
    expect(denied.store.read).not.toHaveBeenCalled();
  });

  it("rejects a descriptor decision that diverges from the fixed read decision before store access", async () => {
    const value = harness({ descriptorRevisions: { authorizationRevision: 5, lifecycleRevision: 7 } });
    await expect(value.service.detail({ context: {}, settingsId: value.d.id })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(value.store.read).not.toHaveBeenCalled();
  });

  it("builds defaults at exact zero revisions when no document or snapshot exists", async () => {
    const documentMissing = harness({ snapshot: { state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 0 } } });
    const view = await documentMissing.service.detail({ context: {}, settingsId: documentMissing.d.id });
    expect(view).toMatchObject({ state: "effective", documentRevision: 0, settingsRevision: 0, fields: { pageSize: { kind: "visible-value", value: 25 }, apiToken: { kind: "unset" } } });
    const snapshotMissing = harness({ snapshot: undefined });
    // The default harness snapshot is explicit; force the adapter's absent-snapshot case.
    snapshotMissing.store.read.mockResolvedValueOnce(undefined);
    await expect(snapshotMissing.service.detail({ context: {}, settingsId: snapshotMissing.d.id })).resolves.toMatchObject({ documentRevision: 0, settingsRevision: 0 });
  });

  it("projects active, pending, disabled, and retired records without secret references", async () => {
    const active = descriptor("sales.settings.active");
    const pending = descriptor("sales.settings.pending");
    const disabled = descriptor("sales.settings.disabled");
    const retired = descriptor("sales.settings.retired");
    const value = harness({ records: [
      { descriptor: active, identity: identity(active), lifecycle: "active" },
      { descriptor: pending, identity: identity(pending), lifecycle: "active" },
      { descriptor: disabled, identity: identity(disabled), lifecycle: "disabled" },
      { descriptor: retired, identity: identity(retired), lifecycle: "retired" }
    ] });
    value.store.read.mockImplementation(async (recordIdentity: SettingsDocumentIdentity) => {
      const d = [active, pending, disabled, retired].find((candidate) => candidate.id === recordIdentity.descriptorId)!;
      return { state: { schemaVersion: 1, applicationId: expected.applicationId, environment: expected.environment, settingsRevision: 8 }, document: stored(d, d.id === pending.id ? "pending-generation-validation" : "effective") };
    });
    const views = await value.service.list({ context: {} });
    expect(views.map((view) => view.state)).toEqual(["effective", "diagnostic-disabled", "pending-validation", "diagnostic-retired"]);
    expect(views[0]!.fields.apiToken).toEqual({ kind: "redacted-secret" });
    expect(JSON.stringify(views)).not.toContain("SALES_API_TOKEN");
  });
});
