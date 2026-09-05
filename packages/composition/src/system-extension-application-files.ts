export interface SystemExtensionApplicationFilesOptions {
  readonly applicationId: string;
}

function runtimeSource(): string {
  return `import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { AdministrationActorEnvelopeSchema, canonicalJson, type ExtensionIdentity } from "@k-nex/contracts";
import { NodeHttpsAdministrationOperatorClient, PostgresRuntimeExtensionStore, RemoteAdministrationExtensionOperator, SharedStaticPlatformPluginGenerationRebinder, type RuntimeExtensionPool } from "@k-nex/payload-adapter";
import { SystemExtensionAdministrationError, SystemExtensionAdministrationService, createCurrentAuthorityTarget, type SystemExtensionOperationStatus } from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexAuthority, reauthenticateCurrentUser, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

type ExtensionPermission = "system.extensions.read" | "system.extensions.plan" | "system.extensions.install-live" | "system.extensions.enable" | "system.extensions.update" | "system.extensions.disable" | "system.extensions.rollback" | "system.extensions.uninstall" | "system.extensions.deploy-platform-plugin";
type ExtensionContext = KnexRequestContext & Readonly<{ extensionPermission?: ExtensionPermission }>;

const clock = Object.freeze({ now: () => new Date() });
const staticExtension = Object.freeze({ deliveryClass: "platform-plugin" as const, id: "module.sales" });
const runtimeStores = new WeakMap<Payload, PostgresRuntimeExtensionStore>();
const operatorClients = new WeakMap<Payload, NodeHttpsAdministrationOperatorClient>();

export const kNexHostInventoryDigest = "sha256:" + createHash("sha256").update(canonicalJson({
  applicationId: kNexIdentity.applicationId,
  environment: kNexIdentity.environment,
  platformPlugins: [{ id: staticExtension.id, package: kNexSalesRegistry.staticRelease.package, runtimeGenerationId: kNexSalesRegistry.staticRelease.runtimeGenerationId }]
})).digest("hex");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Required administration operator configuration is missing.");
  return value;
}

function runtimeStore(payload: Payload): PostgresRuntimeExtensionStore {
  let store = runtimeStores.get(payload);
  if (!store) {
    store = new PostgresRuntimeExtensionStore(payload.db.pool as RuntimeExtensionPool, clock, kNexHostInventoryDigest,
      { sharedStaticGenerationRebinder: new SharedStaticPlatformPluginGenerationRebinder() });
    runtimeStores.set(payload, store);
  }
  return store;
}

function operatorClient(payload: Payload): NodeHttpsAdministrationOperatorClient {
  let client = operatorClients.get(payload);
  if (!client) {
    const port = Number(required("K_NEX_ADMINISTRATION_OPERATOR_PORT"));
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Administration operator port is invalid.");
    client = new NodeHttpsAdministrationOperatorClient({
      hostname: required("K_NEX_ADMINISTRATION_OPERATOR_HOST"), port,
      certificate: readFileSync(required("K_NEX_ADMINISTRATION_OPERATOR_CLIENT_CERT")),
      privateKey: readFileSync(required("K_NEX_ADMINISTRATION_OPERATOR_CLIENT_KEY")),
      certificateAuthority: readFileSync(required("K_NEX_ADMINISTRATION_OPERATOR_CA_CERT")),
      expectedMtlsIdentity: { schemaVersion: 1, uriSan: required("K_NEX_ADMINISTRATION_OPERATOR_URI_SAN"), applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, allowedCommandFamilies: ["extension-lifecycle"] },
      operatorIdentity: required("K_NEX_ADMINISTRATION_OPERATOR_IDENTITY"), timeoutMs: 30_000, maxRequestBytes: 65_536, maxResponseBytes: 65_536
    });
    operatorClients.set(payload, client);
  }
  return client;
}

function staticCatalog() {
  return Object.freeze([{ extension: staticExtension, version: kNexSalesRegistry.staticRelease.package.version, displayName: "Sales", support: "supported" as const, review: "approved" as const, security: "clear" as const, revoked: false, availability: "static-release" as const }]);
}

async function actor(payload: Payload, context: ExtensionContext) {
  const authority = kNexAuthority(payload).adapter;
  const permissions = (context.extensionPermission === undefined ? ["system.extensions.read"] : ["system.extensions.plan", context.extensionPermission]) as readonly ExtensionPermission[];
  const decisions = await Promise.all(permissions.map(async (permissionId) => {
    const decision = await authority.authorize(context, createCurrentAuthorityTarget({ permissionId, scope: { kind: "application", resource: "system.extensions" }, facts: { boundary: "generated-system-extensions" } }));
    if (!decision || decision.outcome !== "allow") throw new SystemExtensionAdministrationError("UNAUTHORIZED", "Current authority does not permit extension administration.");
    return decision;
  }));
  const first = decisions[0]!;
  return AdministrationActorEnvelopeSchema.parse({ schemaVersion: 1, applicationId: first.applicationId, environment: first.environment, principal: first.principal, effectiveActor: first.effectiveActor,
    ...(first.delegation === undefined ? {} : { delegation: first.delegation }), authorizationRevision: first.authorizationRevision, lifecycleRevision: first.lifecycleRevision,
    permissions: decisions.map((decision) => ({ decisionId: decision.decisionId, permissionId: decision.permissionId, owner: decision.owner, scope: decision.scope })) });
}

async function remoteOperator(payload: Payload, context: ExtensionContext) {
  const authority = await actor(payload, context);
  const store = runtimeStore(payload);
  const inventory = await store.inventory(authority.applicationId, authority.environment);
  return new RemoteAdministrationExtensionOperator({ actor: authority, inventory, client: operatorClient(payload), store,
    readers: {
      catalogList: async (filter = {}) => staticCatalog().filter((record) => (filter.deliveryClass === undefined || record.extension.deliveryClass === filter.deliveryClass) && (filter.includeUnavailable === true || !record.revoked)),
      catalogDetail: async (extension, version) => staticCatalog().find((record) => record.extension.deliveryClass === extension.deliveryClass && record.extension.id === extension.id && record.version === version),
      status: async (applicationId, environment) => Object.freeze({ applicationId, environment, inventory: await store.inventory(applicationId, environment), health: [],
        runnerIsolation: { schemaVersion: 1, scope: "development-test-only", profile: "local-child-process-v1", isolation: "same-user-child-process", productionEvidence: "forbidden" } as const,
        remoteUiIsolation: { schemaVersion: 1, profile: "credentialless-remote-ui-v1", realm: "opaque-origin-sandbox", hostChannel: "transferred-message-port-only", credentials: "none", browserStorage: "none", ambientNetwork: "denied", directDom: "denied", hostDynamicImport: "denied", serviceWorkers: "denied", sharedWorkers: "denied", popupTopNavigationDownload: "denied", responsePolicy: { contentSecurityPolicy: "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src blob:; img-src 'self'; style-src 'self'", crossOriginResourcePolicy: "cross-origin", opaqueOriginCors: "null", credentialsMode: "omit", generationPinnedIntegrity: true, strictMime: true }, channelChecks: { schema: true, generation: true, sequence: true, replay: true, size: true, depth: true, rate: true, authorization: true } } as const
      })
    }
  });
}

export function systemExtensionAdministration(payload: Payload, password?: string) {
  const authority = kNexAuthority(payload);
  return new SystemExtensionAdministrationService<ExtensionContext>({
    authority: authority.adapter, state: authority.store,
    operator: { resolve: (context) => remoteOperator(payload, context) },
    lifecycleEvidence: { verify: async ({ context }) => password !== undefined && await reauthenticateCurrentUser(payload, context, password) ? { approval: "not-required", reauthentication: "satisfied" } : undefined }
  });
}

export function extensionMutationContext(context: KnexRequestContext, permission: ExtensionPermission): ExtensionContext {
  return Object.freeze({ ...context, extensionPermission: permission });
}

export function extensionRouteId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(value)) throw new TypeError("System extension route identity is invalid.");
  return value;
}

export function extensionOperation(value: string): "install" | "update" | "disable" | "rollback" | "uninstall" {
  if (!["install", "update", "disable", "rollback", "uninstall"].includes(value)) throw new TypeError("System extension action is invalid.");
  return value as "install" | "update" | "disable" | "rollback" | "uninstall";
}

export async function currentExtension(payload: Payload, context: ExtensionContext, extensionId: string, version?: string) {
  const records = await systemExtensionAdministration(payload).list({ context, includeUnavailable: true });
  const matches = records.filter((record) => record.extension.id === extensionId && (version === undefined || record.version === version));
  if (matches.length !== 1) throw new TypeError("Extension is unavailable.");
  return matches[0]!;
}

export async function currentExtensionExpected(payload: Payload, extension: ExtensionIdentity) {
  const state = await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (!state) throw new SystemExtensionAdministrationError("REVISION_CONFLICT", "Authorization state is unavailable.");
  const inventory = await runtimeStore(payload).inventory(state.applicationId, state.environment);
  const entry = extension.deliveryClass === "platform-plugin" ? inventory.extensions.platformPlugins[extension.id] : extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications[extension.id] : inventory.extensions.themeSkins[extension.id];
  return Object.freeze({ applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision, inventoryRevision: inventory.revision, extensionRevision: entry?.revision ?? 0 });
}

export async function currentExtensionAction(payload: Payload, context: ExtensionContext, extension: ExtensionIdentity, operation: "install" | "update" | "disable" | "rollback" | "uninstall") {
  const service = systemExtensionAdministration(payload);
  const action = (await service.actions({ context })).find((candidate) => candidate.id === extension.id && candidate.deliveryClass === extension.deliveryClass && candidate.executableOperation === operation);
  if (!action) throw new SystemExtensionAdministrationError("UNAUTHORIZED", "Current authority does not permit this extension action.");
  const permission = action.permissionId as ExtensionPermission;
  await actor(payload, extensionMutationContext(context, permission));
  return permission;
}

export function extensionMutationError(error: unknown): Response {
  const code = error instanceof SystemExtensionAdministrationError ? error.code : "MUTATION_INVALID";
  return Response.json({ code }, { status: code === "UNAUTHORIZED" ? 403 : code === "REVISION_CONFLICT" ? 409 : 400, headers: { "cache-control": "no-store" } });
}

export function extensionOperationId(value: string): string {
  if (!/^[a-z][a-z0-9-]{2,127}$/u.test(value)) throw new TypeError("System extension operation identity is invalid.");
  return value;
}

export function extensionPassword(form: FormData): string {
  if (form.getAll("password").length !== 1) throw new TypeError("System extension password is invalid.");
  const value = form.get("password");
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024 || value.includes("\\u0000")) throw new TypeError("System extension password is invalid.");
  return value;
}

export function extensionStatusFor(value: SystemExtensionOperationStatus, extension: ExtensionIdentity): SystemExtensionOperationStatus {
  if (value.extension.deliveryClass !== extension.deliveryClass || value.extension.id !== extension.id) throw new TypeError("System extension operation is unavailable.");
  return value;
}
`;
}

function listPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemExtensionsPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../boot.js";
import { currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../k-nex-authority.js";
import { systemExtensionAdministration } from "../../../../k-nex-system-extensions.js";

export const dynamic = "force-dynamic";

export default async function SystemExtensionsRoute() {
  const payload = await bootKnexApplication("system-extensions");
  const context = kNexRequestContext(await headers(), "system-extensions");
  try {
    const extensions = await systemExtensionAdministration(payload).list({ context });
    return <SystemExtensionsPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Extensions", extensions: extensions.map((extension) => ({ id: extension.extension.deliveryClass + ":" + extension.extension.id + ":" + extension.version, label: extension.displayName, href: "/system/extensions/" + encodeURIComponent(extension.extension.id), deliveryClassLabel: extension.extension.deliveryClass, availabilityLabel: extension.availability, lifecycleLabel: extension.support + "/" + extension.review + "/" + extension.security, revision: extension.version })) }} />;
  } catch { notFound(); }
}

`;
}

function detailPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemExtensionDetailPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { currentExtension, currentExtensionAction, extensionOperationId, extensionStatusFor, extensionRouteId, systemExtensionAdministration } from "../../../../../k-nex-system-extensions.js";

export const dynamic = "force-dynamic";

export default async function SystemExtensionDetailRoute({ params, searchParams }: Readonly<{ params: Promise<{ extensionId: string }>; searchParams: Promise<{ operation?: string }> }>) {
  const payload = await bootKnexApplication("system-extension-detail");
  const context = kNexRequestContext(await headers(), "system-extension-detail");
  try {
    const extensionId = extensionRouteId((await params).extensionId);
    const record = await currentExtension(payload, context, extensionId);
    const service = systemExtensionAdministration(payload);
    const detail = await service.detail({ context, extension: record.extension, version: record.version });
    if (!detail) notFound();
    const actions = (await Promise.all((await service.actions({ context })).filter((action) => action.id === record.extension.id && action.deliveryClass === record.extension.deliveryClass).map(async (action) => {
      try { await currentExtensionAction(payload, context, record.extension, action.executableOperation); return action; } catch { return undefined; }
    }))).flatMap((action) => action === undefined ? [] : [action]);
    const query = await searchParams;
    const operation = query.operation === undefined ? undefined : extensionStatusFor(await service.operationStatus({ context, operationId: extensionOperationId(query.operation) }), record.extension);
    const base = "/api/system/extensions/" + encodeURIComponent(extensionId);
    return <SystemExtensionDetailPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Extension", extensionLabel: record.displayName, extensionId: record.extension.id, deliveryClassLabel: record.extension.deliveryClass, availabilityLabel: record.availability, lifecycleLabel: record.support + "/" + record.review + "/" + record.security, impact: operation?.executionClass ?? "Plan required", approval: operation?.approvalRequired ? "Required" : "Server-derived", audit: operation?.operationId ?? "No current operation",
      actions: actions.map((action) => ({ label: "Plan " + action.action, form: { actionUrl: base + "/plan", hiddenFields: [{ name: "operation", value: action.executableOperation }, { name: "version", value: record.version }] } })),
      ...(operation && operation.phase !== "completed" ? { execute: { label: "Execute " + operation.operation, form: { actionUrl: base + "/operations/" + encodeURIComponent(operation.operationId) + "/execute", inputs: [{ name: "password", label: "Password", type: "password" }] } } } : {})
    }} />;
  } catch { notFound(); }
}

`;
}

function planRouteSource(): string {
  return `import { randomUUID } from "node:crypto";

import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../../k-nex-workspace-page-http.js";
import { currentExtension, currentExtensionAction, currentExtensionExpected, extensionMutationContext, extensionMutationError, extensionOperation, extensionRouteId, systemExtensionAdministration } from "../../../../../../k-nex-system-extensions.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ extensionId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-extension-plan");
    exactFields(form, ["operation", "version"]);
    const extensionId = extensionRouteId((await params).extensionId);
    const version = form.get("version");
    if (typeof version !== "string") throw new TypeError("Extension version is invalid.");
    const operation = extensionOperation(String(form.get("operation")));
    const record = await currentExtension(payload, context, extensionId, version);
    const mutation = extensionMutationContext(context, await currentExtensionAction(payload, context, record.extension, operation));
    const plan = await systemExtensionAdministration(payload).plan({ context: mutation, expected: await currentExtensionExpected(payload, record.extension), request: { extension: record.extension, operation, targetVersion: record.version, idempotencyKey: "extension-plan-" + randomUUID() } });
    return workspaceRedirect("/system/extensions/" + encodeURIComponent(extensionId) + "?operation=" + encodeURIComponent(plan.operationId));
  } catch (error) { return extensionMutationError(error); }
}
`;
}

function executeRouteSource(): string {
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../../../../k-nex-workspace-page-http.js";
import { currentExtension, currentExtensionAction, currentExtensionExpected, extensionMutationContext, extensionMutationError, extensionOperationId, extensionPassword, extensionRouteId, extensionStatusFor, systemExtensionAdministration } from "../../../../../../../../k-nex-system-extensions.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ extensionId: string; operationId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-extension-execute");
    exactFields(form, ["password"]);
    const extensionId = extensionRouteId((await params).extensionId);
    const record = await currentExtension(payload, context, extensionId);
    const service = systemExtensionAdministration(payload);
    const status = extensionStatusFor(await service.operationStatus({ context, operationId: extensionOperationId((await params).operationId) }), record.extension);
    const mutation = extensionMutationContext(context, await currentExtensionAction(payload, context, record.extension, status.operation));
    await systemExtensionAdministration(payload, extensionPassword(form)).execute({ context: mutation, expected: await currentExtensionExpected(payload, record.extension), operationId: status.operationId });
    return workspaceRedirect("/system/extensions/" + encodeURIComponent(extensionId) + "?operation=" + encodeURIComponent(status.operationId));
  } catch (error) { return extensionMutationError(error); }
}
`;
}

export function systemExtensionApplicationFiles(_options: SystemExtensionApplicationFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/k-nex-system-extensions.ts": runtimeSource(),
    "src/app/(workspace)/system/extensions/page.tsx": listPageSource(),
    "src/app/(workspace)/system/extensions/[extensionId]/page.tsx": detailPageSource(),
    "src/app/api/system/extensions/[extensionId]/plan/route.ts": planRouteSource(),
    "src/app/api/system/extensions/[extensionId]/operations/[operationId]/execute/route.ts": executeRouteSource()
  };
}
