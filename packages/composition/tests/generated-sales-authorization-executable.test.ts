import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { workspacePageApplicationFiles } from "../src/workspace-page-application-files.js";

type Control = {
  authorityRevision: number;
  lifecycleRevision: number;
  scopeRevision: number;
  permissions: Set<string>;
  adapterCalls: string[];
  inFlight: number;
  maxInFlight: number;
  rejectNextScan: boolean;
  trace: string[];
  allocations?: unknown[];
  idempotency?: "new" | "replay" | "conflict";
  admissions: unknown[];
  hold?: { entered: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> };
  authorityReadCount?: number;
  driftAfterAuthorityReads?: number[];
};

const control = (): Control => ({
  authorityRevision: 1,
  lifecycleRevision: 1,
  scopeRevision: 1,
  permissions: new Set(["sales.accounts.read", "sales.contacts.read", "sales.contacts.write", "sales.contacts.channels.read"]),
  adapterCalls: [],
  inFlight: 0,
  maxInFlight: 0,
  rejectNextScan: false,
  trace: [],
  admissions: [], authorityReadCount: 0, driftAfterAuthorityReads: []
});

function stubs(): string {
  return `
import { createHash } from "node:crypto";

export const control = globalThis.__kNexGeneratedSalesAuthorization ??= ${JSON.stringify({
    authorityRevision: 1,
    lifecycleRevision: 1,
    scopeRevision: 1,
    permissions: ["sales.accounts.read", "sales.contacts.read", "sales.contacts.write", "sales.contacts.channels.read"],
    adapterCalls: [], inFlight: 0, maxInFlight: 0, rejectNextScan: false, trace: [], admissions: []
  })};
control.permissions = new Set(control.permissions);

export const canonicalJson = (value) => JSON.stringify(value);
export const isIso4217CurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
export const canonicalIana = (value) => value === "UTC" ? value : undefined;
export const EffectiveSettingsDocumentSchema = { parse: (value) => value };
export const createCurrentAuthorityTarget = ({ permissionId, scope, facts }) => Object.freeze({ permissionId, scope, facts });
export const kNexIdentity = Object.freeze({ applicationId: "customer-alpha", environment: "production" });

const descriptors = [
  { id: "sales.accounts.read", scope: "application", resource: "sales.accounts" },
  { id: "sales.contacts.read", scope: "application", resource: "sales.contacts" },
  { id: "sales.contacts.write", scope: "application", resource: "sales.contacts" },
  { id: "sales.contacts.channels.read", scope: "application", resource: "sales.contacts.channels" },
  { id: "sales.tasks.write", scope: "application", resource: "sales.tasks" }
];
const action = (id) => ({ id, value: { descriptor: { id, version: 1, permission: id === "sales.task.create" ? "sales.tasks.write" : "sales.contacts.write" } } });
export const kNexSalesRegistry = Object.freeze({ permissionDescriptors: descriptors,
  scopedRegistration: { contributions: { sources: [], actions: [action("sales.contact.create"), action("sales.contact.update"), action("sales.task.create")] }, bindings: { sources: [] } }
});

export async function currentPayloadAuthentication() { return { user: { id: "user-1" } }; }
export async function currentSalesGeneration() { return { generation: { runtimeGenerationIds: ["sales-generation-1"] } }; }
export function kNexAuthority() {
  return { adapter: { allows: async (_context, target) => {
    control.adapterCalls.push(target.permissionId);
    control.inFlight += 1; control.maxInFlight = Math.max(control.maxInFlight, control.inFlight);
    try {
      if (control.rejectNextScan) { control.rejectNextScan = false; throw new Error("controlled permission failure"); }
      if (control.hold !== undefined) { const hold = control.hold; control.hold = undefined; hold.entered.resolve(); await hold.release.promise; }
      return control.permissions.has(target.permissionId);
    } finally { control.inFlight -= 1; }
  } } };
}

const pendingDigest = "sha256:" + createHash("sha256").update(JSON.stringify({ state: "pending" })).digest("hex");
export function sql(strings, ...values) { return { text: String.raw({ raw: strings }, ...values.map(() => "?")), values }; }
sql.join = (values, separator) => ({ text: values.map(() => "?").join(separator.text ?? ","), values });
export function activePayloadPostgresTransaction(request) { return request.payload.__transaction; }
export function createPayloadPersistenceCapability(request, _grants, _authorizer, options) {
  request.transactionID = "generated-transaction";
  return { payload: { find: async ({ collection }) => ({ docs: [collection === "sales-accounts" ? { id: "42", ownerId: "user-1", teamId: null, status: "active", archiveStatus: "active", revision: 1 } : { id: "7", ownerId: "user-1", teamId: null, status: "active", archiveStatus: "active", revision: 1, accountId: "42" }] }) }, guard: options.guard,
    transaction: { begin: async () => undefined, commit: async () => undefined, rollback: async () => undefined } };
}
export async function admitTrustedSalesTaskCreateId(request, input) { control.trace.push("admit"); control.admissions.push({ request, input }); }
export function revokeTrustedSalesTaskCreateId(_request) { control.trace.push("revoke"); }
export class CurrentAuthorityPayloadPersistenceAuthorizer { constructor() {} }
export class PayloadRequestAuthenticator { constructor() {} }

export class ActionGatewayError extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
export class DataSourceGatewayError extends Error { constructor(code, status, title, detail) { super(detail ?? title); this.code = code; this.status = status; } }
export class BoundedQueryBudgetEvaluator {}
export class CanonicalOutputContractValidator {}
export class DefinitionSourceSchemaValidator {}
export class DescriptorSurfaceAudienceGuard {}
export class PolicyAuthorizationEvaluator {}
export class RegisteredHandlerDispatcher {}
export class SafeProblemDetailsSerializer {}
export class TableProjectionRedactor {}
export class ApplicationReportingTimezoneResolver {}
export class EffectiveSettingsProvider {}
export class DataSourceGateway {}
export class RegisteredActionGateway {
  constructor(registry, authentication, policy) { this.registry = registry; this.authentication = authentication; this.policy = policy; }
  async execute(request) {
    const contribution = this.registry.contributions.actions.find((entry) => entry.id === request.actionId);
    const authenticated = await this.authentication.authenticate({ idempotencyKey: request.idempotencyKey, input: request.input });
    const data = await this.policy.authorize({ action: contribution.value, input: request.input, authenticated });
    return { ok: true, status: 200, body: { code: "OK", data } };
  }
}
export const commitTransaction = async () => undefined;
export const initTransaction = async () => undefined;
export const killTransaction = async () => undefined;
export const recheckSalesSavedViewExecution = async () => undefined;
export const resolveSalesSavedViewExecution = async () => undefined;
export const canonicalSalesSavedViewJson = (value) => value;
export const salesOpportunitiesDescriptor = {};
export const salesOpportunityStageUpdateDescriptor = {};
export const salesPipelineArchiveDescriptor = {};
export const salesPipelineSnapshotDescriptor = {};
export const salesPipelineUpdateDescriptor = {};
export const salesSavedViewArchiveDescriptor = {};
export const salesSavedViewCalendarDescriptor = {};
export const salesSavedViewCreateDescriptor = {};
export const salesSavedViewDetailDescriptor = {};
export const salesSavedViewKanbanDescriptor = {};
export const salesSavedViewListDescriptor = {};
export const salesSavedViewTableDescriptor = {};
export const salesSavedViewUpdateDescriptor = {};
export const salesTaskCreateDescriptor = {};
export const salesTaskUpdateDescriptor = {};
export const salesTasksDescriptor = {};
export class GeneratedSalesDataMovementStore { constructor() {} }
export const createGeneratedSalesProviderConfigurationReadGateway = () => ({});
export const createGeneratedSalesProviderGateway = () => ({});
export const createGeneratedSalesReportingGateway = () => ({});
export const systemGeneralSettingsDescriptor = {};
`;
}

async function loadGeneratedSalesWorkspace() {
  const directory = mkdtempSync(join(tmpdir(), "k-nex-generated-sales-authorization-"));
  const generated = workspacePageApplicationFiles({ applicationId: "customer-alpha" })["src/k-nex-sales-workspace.ts"]!;
  const body = generated.slice(generated.indexOf("const sourceDefinitions"));
  const names = [
    "EffectiveSettingsDocumentSchema", "canonicalJson", "isIso4217CurrencyCode", "canonicalSalesSavedViewJson", "salesOpportunitiesDescriptor",
    "salesOpportunityStageUpdateDescriptor", "salesPipelineArchiveDescriptor", "salesPipelineSnapshotDescriptor", "salesPipelineUpdateDescriptor",
    "salesSavedViewArchiveDescriptor", "salesSavedViewCalendarDescriptor", "salesSavedViewCreateDescriptor", "salesSavedViewDetailDescriptor",
    "salesSavedViewKanbanDescriptor", "salesSavedViewListDescriptor", "salesSavedViewTableDescriptor", "salesSavedViewUpdateDescriptor",
    "salesTaskCreateDescriptor", "salesTaskUpdateDescriptor", "salesTasksDescriptor", "recheckSalesSavedViewExecution", "resolveSalesSavedViewExecution",
    "ActionGatewayError", "DataSourceGateway", "DataSourceGatewayError", "BoundedQueryBudgetEvaluator", "CanonicalOutputContractValidator",
    "DefinitionSourceSchemaValidator", "DescriptorSurfaceAudienceGuard", "PolicyAuthorizationEvaluator", "RegisteredActionGateway", "RegisteredHandlerDispatcher",
    "SafeProblemDetailsSerializer", "TableProjectionRedactor", "ApplicationReportingTimezoneResolver", "canonicalIana", "EffectiveSettingsProvider",
    "createCurrentAuthorityTarget", "sql", "activePayloadPostgresTransaction", "admitTrustedSalesTaskCreateId", "revokeTrustedSalesTaskCreateId", "createPayloadPersistenceCapability", "CurrentAuthorityPayloadPersistenceAuthorizer",
    "PayloadRequestAuthenticator", "commitTransaction", "initTransaction", "killTransaction", "currentPayloadAuthentication", "currentSalesGeneration",
    "kNexAuthority", "kNexIdentity", "kNexSalesRegistry", "GeneratedSalesDataMovementStore", "createGeneratedSalesProviderConfigurationReadGateway",
    "createGeneratedSalesProviderGateway", "createGeneratedSalesReportingGateway", "systemGeneralSettingsDescriptor"
  ];
  const prelude = `import { createHash } from "node:crypto";\nimport * as stubs from "./stubs.mjs";\nconst { ${names.join(", ")} } = stubs;\n`;
  const output = ts.transpileModule(prelude + body, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText;
  writeFileSync(join(directory, "workspace.mjs"), output);
  writeFileSync(join(directory, "stubs.mjs"), stubs());
  const module = await import(`${pathToFileURL(join(directory, "workspace.mjs")).href}?${Date.now()}`);
  return { directory, module, control: globalThis.__kNexGeneratedSalesAuthorization as Control };
}

function payload(control: Control) {
  const digest = "sha256:" + createHash("sha256").update(JSON.stringify({ state: "pending" })).digest("hex");
  const transaction = { execute: async (query: { text?: string; values?: unknown[] }) => {
    const text = query.text ?? "";
    if (text.includes("INSERT INTO \"sales_action_idempotency\"")) {
      control.trace.push("reservation");
      const requestDigest = query.values?.find((value) => typeof value === "string" && value.startsWith("sha256:"));
      if (control.idempotency === "conflict") return { rows: [{ request_digest: "sha256:different", result_json: { state: "pending" }, result_digest: digest }] };
      if (control.idempotency === "replay") {
        const result = { state: "succeeded", data: { resourceId: "replayed-task" } };
        return { rows: [{ request_digest: requestDigest, result_json: result, result_digest: "sha256:" + createHash("sha256").update(JSON.stringify(result)).digest("hex") }] };
      }
      return { rows: [{ request_digest: requestDigest, result_json: { state: "pending" }, result_digest: digest }] };
    }
    if (text.includes("UPDATE \"sales_action_idempotency\"")) return { rows: [{ idempotency_key: "action-key" }] };
    if (text.includes("nextval(pg_get_serial_sequence")) { control.trace.push("allocation"); return { rows: control.allocations ?? [{ id: "42" }] }; }
    if (text.includes("k_nex_authorization_state")) { control.trace.push("fence"); return { rows: [{ authorization_revision: control.authorityRevision, lifecycle_revision: control.lifecycleRevision }] }; }
    if (text.includes("sales_current_authority_scopes")) return { rows: [{ revision: control.scopeRevision }] };
    return { rows: [{ id: "42" }] };
  } };
  return { db: { pool: { query: async (text: string) => {
    if (text.includes("sales_current_authority_scopes")) return { rows: [{ record_scope: "application-sales-scope", application_wide: true, mutation_allowed: true, authorized_team_ids: [], revision: control.scopeRevision }] };
    if (text.includes("k_nex_authorization_state")) {
      const authorityRevision = control.authorityRevision;
      control.authorityReadCount = (control.authorityReadCount ?? 0) + 1;
      if (control.driftAfterAuthorityReads?.includes(control.authorityReadCount)) control.authorityRevision += 1;
      return { rows: [{ authorization_revision: authorityRevision, lifecycle_revision: control.lifecycleRevision }] };
    }
    return { rows: [{ descriptor_schema_version: 3, document_revision: 1, settings_revision: 1, state_revision: 1, values_json: { reportingCurrency: "USD", reportingTimezone: "UTC" } }] };
  } } }, __transaction: transaction };
}

const contexts = new Set<object>();
afterEach(() => { contexts.clear(); });

describe("generated Sales current-authority executable behavior", () => {
  it("memoizes bounded scans, retries one complete current projection, and fails closed on repeated drift", async () => {
    const loaded = await loadGeneratedSalesWorkspace();
    try {
      const { module, control } = loaded;
      const basePayload = payload(control);
      const context = { id: "same-context" }; contexts.add(context);
      const [first, second] = await Promise.all([module.workspaceSalesPermissions(basePayload, context), module.workspaceSalesPermissions(basePayload, context)]);
      expect(first).toEqual([...control.permissions]);
      expect(second).toEqual(first);
      expect(control.adapterCalls).toHaveLength(5);
      expect(control.maxInFlight).toBeLessThanOrEqual(4);

      await module.workspaceSalesPermissions(basePayload, { id: "different-context" });
      expect(control.adapterCalls).toHaveLength(10);

      control.rejectNextScan = true;
      const rejectedContext = { id: "rejected-context" }; contexts.add(rejectedContext);
      await expect(module.workspaceSalesPermissions(basePayload, rejectedContext)).rejects.toThrow("controlled permission failure");
      await expect(module.workspaceSalesPermissions(basePayload, rejectedContext)).resolves.toEqual([...control.permissions]);
      expect(control.adapterCalls).toHaveLength(19);

      for (const revision of ["authorityRevision", "scopeRevision"] as const) {
        const callsBeforeRace = control.adapterCalls.length;
        const racedContext = { id: `race-${revision}` }; contexts.add(racedContext);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        control.hold = { entered, release };
        const pending = module.workspaceSalesPermissions(basePayload, racedContext);
        await entered.promise;
        control[revision] += 1;
        control.permissions.delete("sales.contacts.channels.read");
        release.resolve();
        await expect(pending).resolves.toEqual(["sales.accounts.read", "sales.contacts.read", "sales.contacts.write"]);
        expect(control.adapterCalls).toHaveLength(callsBeforeRace + 10);
        control.permissions.add("sales.contacts.channels.read");
      }

      const callsBeforeRepeatedDrift = control.adapterCalls.length;
      control.authorityReadCount = 0;
      control.driftAfterAuthorityReads = [1, 3];
      const repeatedlyRacedContext = { id: "repeated-race" }; contexts.add(repeatedlyRacedContext);
      await expect(module.workspaceSalesPermissions(basePayload, repeatedlyRacedContext)).rejects.toThrow("Sales current authority changed during permission projection");
      expect(control.adapterCalls).toHaveLength(callsBeforeRepeatedDrift + 10);
    } finally {
      rmSync(loaded.directory, { recursive: true, force: true });
      delete (globalThis as typeof globalThis & { __kNexGeneratedSalesAuthorization?: unknown }).__kNexGeneratedSalesAuthorization;
    }
  });

  it("projects CRUD actors to the primary grant while related-record and protected-field decisions remain live", async () => {
    const loaded = await loadGeneratedSalesWorkspace();
    try {
      const { module, control } = loaded;
      const action = (id: string) => ({ id, version: 1 });
      const signal = new AbortController().signal;
      const accountDeniedContext = { id: "related-denied" }; contexts.add(accountDeniedContext);
      control.adapterCalls.length = 0;
      control.permissions = new Set(["sales.contacts.write"]);
      await expect(module.executeWorkspaceSalesAction(payload(control), accountDeniedContext, action("sales.contact.create"), { accountId: "42", name: "new-contact" }, "create-denied", signal)).rejects.toMatchObject({ code: "ACTION_FORBIDDEN" });
      expect(control.adapterCalls.slice(0, 2)).toEqual(["sales.contacts.write", "sales.accounts.read"]);

      const relatedAllowedContext = { id: "related-allowed" }; contexts.add(relatedAllowedContext);
      control.adapterCalls.length = 0;
      control.permissions.add("sales.accounts.read");
      await expect(module.executeWorkspaceSalesAction(payload(control), relatedAllowedContext, action("sales.contact.create"), { accountId: "42", name: "new-contact" }, "create-allowed", signal)).resolves.toMatchObject({ ok: true });
      expect(control.adapterCalls[0]).toBe("sales.contacts.write");
      expect(control.adapterCalls).toContain("sales.accounts.read");

      const protectedDeniedContext = { id: "protected-denied" }; contexts.add(protectedDeniedContext);
      control.adapterCalls.length = 0;
      control.permissions = new Set(["sales.contacts.write"]);
      await expect(module.executeWorkspaceSalesAction(payload(control), protectedDeniedContext, action("sales.contact.update"), { id: "7", emailMode: "set", email: "new@example.test" }, "update-denied", signal)).rejects.toMatchObject({ code: "ACTION_FORBIDDEN" });
      expect(control.adapterCalls.slice(0, 3)).toEqual(["sales.contacts.write", "sales.contacts.write", "sales.contacts.write"]);
      expect(control.adapterCalls).toContain("sales.contacts.channels.read");

      const protectedAllowedContext = { id: "protected-allowed" }; contexts.add(protectedAllowedContext);
      control.adapterCalls.length = 0;
      control.permissions.add("sales.contacts.channels.read");
      await expect(module.executeWorkspaceSalesAction(payload(control), protectedAllowedContext, action("sales.contact.update"), { id: "7", emailMode: "set", email: "new@example.test" }, "update-allowed", signal)).resolves.toMatchObject({ ok: true });
      expect(control.adapterCalls[0]).toBe("sales.contacts.write");
      expect(control.adapterCalls).toContain("sales.contacts.channels.read");
    } finally {
      rmSync(loaded.directory, { recursive: true, force: true });
      delete (globalThis as typeof globalThis & { __kNexGeneratedSalesAuthorization?: unknown }).__kNexGeneratedSalesAuthorization;
    }
  });

  it("allocates a task ID only after the fence and new idempotency reservation, on the same emitted-host transaction", async () => {
    const loaded = await loadGeneratedSalesWorkspace();
    try {
      const { module, control } = loaded;
      control.permissions = new Set(["sales.tasks.write"]);
      const response = await module.executeWorkspaceSalesAction(payload(control), { id: "task-create" }, { id: "sales.task.create", version: 1 }, { title: "Call customer" }, "task-create-new", new AbortController().signal);

      expect(response).toMatchObject({ ok: true, body: { data: { resourceId: "42" } } });
      expect(control.trace.indexOf("fence")).toBeLessThan(control.trace.indexOf("reservation"));
      expect(control.trace.indexOf("reservation")).toBeLessThan(control.trace.indexOf("allocation"));
      expect(control.trace.indexOf("allocation")).toBeLessThan(control.trace.indexOf("admit"));
      expect(control.admissions).toHaveLength(1);
      expect(control.admissions[0]).toMatchObject({ input: { id: 42, resourceId: "42" }, request: { transactionID: "generated-transaction" } });
      expect(control.trace).toContain("revoke");
    } finally {
      rmSync(loaded.directory, { recursive: true, force: true });
      delete (globalThis as typeof globalThis & { __kNexGeneratedSalesAuthorization?: unknown }).__kNexGeneratedSalesAuthorization;
    }
  });

  it("does not allocate for replay or conflict and rejects malformed allocation results before action dispatch", async () => {
    const action = { id: "sales.task.create", version: 1 };
    const loaded = await loadGeneratedSalesWorkspace();
    try {
      for (const [idempotency, allocations, message] of [
        ["replay", undefined, undefined],
        ["conflict", undefined, "idempotency key was reused"],
        ["new", [], "allocation is unavailable"],
        ["new", [{ id: "42" }, { id: "43" }], "allocation is unavailable"],
        ["new", [null], "allocation is unavailable"],
        ["new", [{ id: "042" }], "allocation is invalid"],
        ["new", [{ id: 0 }], "allocation is invalid"],
        ["new", [{ id: 2_147_483_648 }], "allocation is invalid"]
      ] as const) {
        const { module, control } = loaded;
        control.trace.length = 0;
        control.admissions.length = 0;
        control.permissions = new Set(["sales.tasks.write"]);
        control.idempotency = idempotency;
        control.allocations = allocations;
        const result = module.executeWorkspaceSalesAction(payload(control), { id: `task-${idempotency}-${String(message)}` }, action, { title: "Call customer" }, `task-${idempotency}-${String(message)}`, new AbortController().signal);
        if (message === undefined) await expect(result).resolves.toMatchObject({ ok: true, body: { data: { idempotencyReplay: { resourceId: "replayed-task" } } } });
        else await expect(result).rejects.toThrow(message);
        expect(control.trace.filter((entry) => entry === "allocation")).toHaveLength(idempotency === "new" ? 1 : 0);
        expect(control.admissions).toHaveLength(0);
      }
    } finally {
      rmSync(loaded.directory, { recursive: true, force: true });
      delete (globalThis as typeof globalThis & { __kNexGeneratedSalesAuthorization?: unknown }).__kNexGeneratedSalesAuthorization;
    }
  });
});
