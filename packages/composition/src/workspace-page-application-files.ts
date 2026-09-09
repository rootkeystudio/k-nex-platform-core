export interface WorkspacePageApplicationFilesOptions {
  readonly applicationId: string;
}

function workspacePageRuntimeSource(): string {
  return `import { createHash, randomUUID } from "node:crypto";

import { AuthorizationStateSchema, canonicalJson, type UiDocument, type UiNode, type WorkspacePublishedRevision } from "@k-nex/contracts";
import {
  CurrentAuthorityWorkspacePageService,
  ExactWorkspacePageAclPolicy,
  PostgresWorkspaceNavigationStore,
  PostgresWorkspacePageStore,
  WorkspacePageSessionRegistry,
  parseWorkspaceNavigationInvalidation,
  parseWorkspacePageInvalidation,
  type RuntimeExtensionPool,
  type WorkspaceNavigationMutationCatalog,
  type WorkspacePageDocumentValidator,
  type WorkspacePageScope,
  type WorkspacePageSnapshot
} from "@k-nex/payload-adapter";
import { createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";
import { salesActivityByOwnerTeamDescriptor, salesLeadConversionDescriptor, salesOpportunitiesDescriptor, salesOpportunityStageUpdateDescriptor, salesPipelineArchiveDescriptor, salesPipelineSnapshotDescriptor, salesPipelineUpdateDescriptor, salesPipelineValueByStageDescriptor, salesReportRunDescriptor, salesReportScheduleDescriptor, salesSavedViewArchiveDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewCreateDescriptor, salesSavedViewDetailDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor, salesSavedViewUpdateDescriptor, salesSalesCycleDurationDescriptor, salesTaskAgingDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor } from "@k-nex/module-sales/contracts";
import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";
import { genericPuckBlockBridges } from "@k-nex/ui-builder-blocks";
import { genericUiBlockDefinitions } from "@k-nex/ui-builder-blocks/runtime";
import { createCurrentAuthorityTarget } from "@k-nex/runtime";
import type { Payload } from "payload";

import { authorizeRequest, currentSalesGeneration, kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { resolveApplicationTheme, resolvePageThemeOverride } from "./k-nex-theme-runtime.js";
import { admittedWorkspaceSalesDocument, projectWorkspaceSalesDocument, workspaceSalesPermissions } from "./k-nex-sales-workspace.js";

const platformBlocks = new Map(genericUiBlockDefinitions.map(({ id, version }) => [id, version] as const));
const scope = Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment });
type WorkspaceRuntimeRegistry = Readonly<{ runtimes: WeakMap<Payload, ReturnType<typeof createRuntime>>; drainedRuntimes: WeakSet<Payload> }>;
const workspaceRuntimeRegistryKey = Symbol.for("k-nex.workspace-page-runtime.v1");
const workspaceRuntimeGlobal = globalThis as unknown as Record<symbol, unknown>;
const workspaceRuntimeRegistry = (workspaceRuntimeGlobal[workspaceRuntimeRegistryKey] ??= Object.freeze({ runtimes: new WeakMap(), drainedRuntimes: new WeakSet() })) as WorkspaceRuntimeRegistry;
const { runtimes, drainedRuntimes } = workspaceRuntimeRegistry;
const invalidationChannel = "k_nex_runtime_invalidation";
const workspaceNavigationFixedNodes = Object.freeze([
  { id: "k-nex.navigation.root", owner: { kind: "platform" as const }, kind: "folder" as const, label: "K-Nex", icon: "dashboard" as const, order: 0 },
  { id: "system.navigation.root", owner: { kind: "platform" as const }, kind: "folder" as const, label: "System", icon: "system" as const, order: 1_000_000 },
  { id: "k-nex.navigation.workspace", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "k-nex.navigation.root", label: "Workspace", icon: "dashboard" as const, order: 0, target: { class: "system" as const, routeId: "system.route.workspace" } },
  { id: "system.navigation.roles", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Roles", order: 10, target: { class: "system" as const, routeId: "system.route.roles" } },
  { id: "system.navigation.permissions", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Permissions", order: 20, target: { class: "system" as const, routeId: "system.route.permissions" } },
  { id: "system.navigation.assignments", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Assignments", order: 30, target: { class: "system" as const, routeId: "system.route.assignments" } },
  { id: "system.navigation.extensions", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Extensions", icon: "apps" as const, order: 40, target: { class: "system" as const, routeId: "system.route.extensions" } },
  { id: "system.navigation.workspace-pages", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Workspace pages", icon: "dashboard" as const, order: 45, target: { class: "system" as const, routeId: "system.route.workspace-pages" } },
  { id: "system.navigation.themes", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Themes", order: 50, target: { class: "system" as const, routeId: "system.route.themes" } },
  { id: "system.navigation.settings", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Settings", order: 60, target: { class: "system" as const, routeId: "system.route.settings" } },
  { id: "system.navigation.operations", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Operations", order: 70, target: { class: "system" as const, routeId: "system.route.operations" } }
]);

type NotificationClient = {
  query(text: string): Promise<unknown>;
  on(event: "notification", listener: (message: Readonly<{ channel: string; payload?: string }>) => void): void;
  on(event: "error" | "end", listener: () => void): void;
  release(destroy?: boolean): void;
};

function validateNotification(payload: string | undefined): void {
  if (payload === undefined) throw new TypeError("Runtime invalidation payload is missing.");
  const value = JSON.parse(payload) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Runtime invalidation envelope is invalid.");
  const envelope = value as Record<string, unknown>;
  if (envelope.type === "workspace-navigation") {
    const event = parseWorkspaceNavigationInvalidation(envelope.invalidation);
    if (event.applicationId !== scope.applicationId || event.environment !== scope.environment || canonicalJson(value) !== canonicalJson({ type: "workspace-navigation", invalidation: event })) throw new TypeError("Workspace navigation invalidation identity is invalid.");
    return;
  }
  if (envelope.type === "workspace-page") {
    const event = parseWorkspacePageInvalidation(envelope.invalidation);
    if (event.applicationId !== scope.applicationId || event.environment !== scope.environment || canonicalJson(value) !== canonicalJson({ type: "workspace-page", invalidation: event })) throw new TypeError("Workspace page invalidation identity is invalid.");
    return;
  }
  if (envelope.type !== "authorization" || envelope.invalidation === null || typeof envelope.invalidation !== "object" || Array.isArray(envelope.invalidation)) throw new TypeError("Runtime invalidation type is invalid.");
  const raw = envelope.invalidation as Record<string, unknown>;
  const state = AuthorizationStateSchema.safeParse({ schemaVersion: 1, applicationId: raw.applicationId, environment: raw.environment, authorizationRevision: raw.authorizationRevision, lifecycleRevision: raw.lifecycleRevision });
  if (!state.success || raw.scope !== "application" && raw.scope !== "environment") throw new TypeError("Authorization invalidation is invalid.");
  const event = { applicationId: state.data.applicationId, environment: state.data.environment, scope: raw.scope, authorizationRevision: state.data.authorizationRevision, lifecycleRevision: state.data.lifecycleRevision };
  if (event.applicationId !== scope.applicationId || event.environment !== scope.environment || canonicalJson(value) !== canonicalJson({ type: "authorization", invalidation: event })) throw new TypeError("Authorization invalidation identity is invalid.");
}

function listenForInvalidations(payload: Payload, synchronize: () => Promise<unknown>): Readonly<{ close(): Promise<void> }> {
  const pool = payload.db.pool as unknown as { connect(): Promise<NotificationClient> };
  let closed = false;
  let client: NotificationClient | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connecting: Promise<void> | undefined;
  let synchronizing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let synchronizationQueued = false;
  const releasedClients = new WeakSet<object>();
  const release = (notificationClient: NotificationClient): void => {
    if (releasedClients.has(notificationClient)) return;
    releasedClients.add(notificationClient);
    notificationClient.release(true);
    if (client === notificationClient) client = undefined;
  };
  const synchronizeBackground = (): void => {
    if (closed) return;
    if (synchronizing !== undefined) { synchronizationQueued = true; return; }
    const operation = Promise.resolve().then(synchronize).then(() => undefined, () => undefined);
    synchronizing = operation;
    void operation.then(() => {
      if (synchronizing === operation) synchronizing = undefined;
      if (synchronizationQueued && !closed) { synchronizationQueued = false; synchronizeBackground(); }
    });
  };
  const synchronizeTimer = setInterval(synchronizeBackground, 1_000);
  const connect = async (): Promise<void> => {
    if (closed) return;
    let notificationClient: NotificationClient | undefined;
    try {
      notificationClient = await pool.connect();
      client = notificationClient;
      if (closed) { release(notificationClient); return; }
      let finished = false;
      const reconnect = () => {
        if (finished || closed) return;
        finished = true;
        if (notificationClient !== undefined) release(notificationClient);
        reconnectTimer = setTimeout(() => { if (!closed) { connecting = connect(); void connecting.catch(() => undefined); } }, 250);
      };
      notificationClient.on("notification", (message) => {
        if (message.channel !== invalidationChannel) return;
        try { validateNotification(message.payload); synchronizeBackground(); } catch { /* untrusted notifications cannot alter watermarks */ }
      });
      notificationClient.on("error", reconnect);
      notificationClient.on("end", reconnect);
      await notificationClient.query("LISTEN k_nex_runtime_invalidation");
      if (closed) { await notificationClient.query("UNLISTEN k_nex_runtime_invalidation").catch(() => undefined); release(notificationClient); return; }
      synchronizeBackground();
    } catch {
      if (notificationClient !== undefined) release(notificationClient);
      if (!closed) reconnectTimer = setTimeout(() => { if (!closed) { connecting = connect(); void connecting.catch(() => undefined); } }, 250);
    }
  };
  connecting = connect();
  void connecting.catch(() => undefined);
  return Object.freeze({
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      closed = true;
      synchronizationQueued = false;
      clearInterval(synchronizeTimer);
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      closing = (async () => {
        await connecting?.catch(() => undefined);
        if (client !== undefined) {
          await client.query("UNLISTEN k_nex_runtime_invalidation").catch(() => undefined);
          release(client);
        }
        await synchronizing;
      })();
      return closing;
    }
  });
}

function digest(value: unknown): \`sha256:\${string}\` {
  return \`sha256:\${createHash("sha256").update(canonicalJson(value)).digest("hex")}\`;
}

` + workspacePageRuntimeTailSource();
}

function workspacePageHttpSource(): string {
  return `import { kNexRequestContext } from "./k-nex-authority.js";
import { bootKnexApplication } from "./boot.js";
import { kNexIdentity } from "./k-nex-identity.js";

export async function openWorkspaceForm(request: Request, boundary: string) {
  if (request.headers.get("origin") !== kNexIdentity.publicOrigin.origin) throw new TypeError("Workspace form origin is invalid.");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data")) throw new TypeError("Workspace form content type is invalid.");
  const payload = await bootKnexApplication("workspace-web");
  const context = kNexRequestContext(new Headers(request.headers), boundary);
  return Object.freeze({ payload, context, form: await request.formData() });
}

` + workspacePageHttpTailSource();
}

function workspaceSalesServerSource(): string {
  return `import { createHash } from "node:crypto";

import { EffectiveSettingsDocumentSchema, canonicalJson, isIso4217CurrencyCode, type DataSourceBindingResult, type DataSourceDefinition, type UiDocument, type UiNode } from "@k-nex/contracts";
import { canonicalSalesSavedViewJson, salesOpportunitiesDescriptor, salesOpportunityStageUpdateDescriptor, salesPipelineArchiveDescriptor, salesPipelineSnapshotDescriptor, salesPipelineUpdateDescriptor, salesSavedViewArchiveDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewCreateDescriptor, salesSavedViewDetailDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor, salesSavedViewUpdateDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor, type SalesSavedViewSourceId } from "@k-nex/module-sales/contracts";
import { recheckSalesSavedViewExecution, resolveSalesSavedViewExecution, type SalesPersistedSavedView, type SalesSavedViewExecutionPersistence } from "@k-nex/module-sales/server";
import {
  ActionGatewayError,
  DataSourceGateway,
  DataSourceGatewayError,
  BoundedQueryBudgetEvaluator,
  CanonicalOutputContractValidator,
  DefinitionSourceSchemaValidator,
  DescriptorSurfaceAudienceGuard,
  PolicyAuthorizationEvaluator,
  RegisteredActionGateway,
  RegisteredHandlerDispatcher,
  SafeProblemDetailsSerializer,
  TableProjectionRedactor,
  ApplicationReportingTimezoneResolver,
  canonicalIana,
  EffectiveSettingsProvider,
  createCurrentAuthorityTarget,
  type CurrentAuthorityTarget,
  type DataSourceHandler,
  type DataSourcePolicyService,
  type RegisteredDataSource
} from "@k-nex/runtime";
import { sql } from "@payloadcms/db-postgres";
import {
  activePayloadPostgresTransaction,
  createPayloadPersistenceCapability,
  CurrentAuthorityPayloadPersistenceAuthorizer,
  PayloadRequestAuthenticator,
  type PayloadPersistenceCapabilityContext
} from "@k-nex/payload-adapter";
import { commitTransaction, initTransaction, killTransaction, type Payload, type PayloadRequest } from "payload";

import { currentPayloadAuthentication, currentSalesGeneration, kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { GeneratedSalesDataMovementStore } from "./k-nex-sales-data-movement.js";
import { createGeneratedSalesProviderConfigurationReadGateway, createGeneratedSalesProviderGateway, type GeneratedSalesProviderConfigurationReadGateway, type GeneratedSalesProviderGateway } from "./k-nex-sales-communications.js";
import { createGeneratedSalesReportingGateway, type GeneratedSalesReportingGateway } from "./k-nex-sales-reports.js";
import { systemGeneralSettingsDescriptor } from "./k-nex-system-theme-settings.js";

const sourceDefinitions = new Map(kNexSalesRegistry.scopedRegistration.contributions.sources.map((entry) => [entry.id, entry.value as DataSourceDefinition]));
const sourceHandlers = new Map(kNexSalesRegistry.scopedRegistration.bindings.sources.map((entry) => [entry.id, entry.value as DataSourceHandler]));
const sources = new Map<string, RegisteredDataSource>();
for (const [id, definition] of sourceDefinitions) {
  const handler = sourceHandlers.get(id);
  if (handler !== undefined) sources.set(id, Object.freeze({ definition, handler }));
}
const workspaceSalesBudget = new BoundedQueryBudgetEvaluator();

function target(permissionId: string, recordId = "collection", facts: Readonly<Record<string, unknown>> = {}) {
  const descriptor = kNexSalesRegistry.permissionDescriptors.find(({ id }) => id === permissionId);
  if (descriptor === undefined) throw new TypeError("Sales permission is unavailable.");
  const scope = descriptor.scope === "application" ? { kind: "application" as const, resource: descriptor.resource }
    : descriptor.scope === "record" ? { kind: "record" as const, resource: descriptor.resource, recordId }
    : { kind: "field" as const, resource: descriptor.resource, recordId, fieldId: descriptor.resource };
  return createCurrentAuthorityTarget({ permissionId, scope, facts: { boundary: "workspace-sales", applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, recordId, ...facts } });
}

` + workspaceSalesServerTailSource();
}

function workspacePageRuntimeClientSource(): string {
  return `"use client";

import type { DataSourceBindingResult, UiDocument } from "@k-nex/contracts";
import { salesActivityByOwnerTeamDescriptor, salesLeadConversionDescriptor, salesOpportunitiesDescriptor, salesPipelineSnapshotDescriptor, salesPipelineValueByStageDescriptor, salesSalesCycleDurationDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewDetailDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor, salesTaskAgingDescriptor, salesTasksDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor } from "@k-nex/module-sales/contracts";
import { salesUiBlockDefinitions } from "@k-nex/module-sales/ui";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { genericUiBlockDefinitions } from "@k-nex/ui-builder-blocks/runtime";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";
import { useEffect, useMemo, useState } from "react";

const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [...genericUiBlockDefinitions, ...salesUiBlockDefinitions], sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesPipelineSnapshotDescriptor, salesSavedViewListDescriptor, salesSavedViewDetailDescriptor, salesSavedViewTableDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewCalendarDescriptor, salesPipelineValueByStageDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesActivityByOwnerTeamDescriptor, salesTaskAgingDescriptor, salesSalesCycleDurationDescriptor] }));
type Watermark = Readonly<{ authorizationRevision: number; lifecycleRevision: number; pageRevision: number; accessRevision: number; publicationPointerRevision: number; publicationRevisionId: string; themePublicationRevision: number; themeActiveRevisionId: string; themeStateDigest: string }>;
type Projection = Readonly<{ document: UiDocument; permissions: readonly string[]; sourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>>; themeRevision: string; themeMode: "light" | "dark" | "system"; themeCss: string; watermark: Watermark }>;

function projection(value: unknown): Projection | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const watermark = candidate.watermark;
  if (watermark === null || typeof watermark !== "object" || Array.isArray(watermark) || candidate.document === null || typeof candidate.document !== "object" || Array.isArray(candidate.document) || !Array.isArray(candidate.permissions) || candidate.sourceResults === null || typeof candidate.sourceResults !== "object" || Array.isArray(candidate.sourceResults) || typeof candidate.themeRevision !== "string" || !["light", "dark", "system"].includes(String(candidate.themeMode)) || typeof candidate.themeCss !== "string") return undefined;
  const revision = watermark as Record<string, unknown>;
  if (![revision.authorizationRevision, revision.lifecycleRevision, revision.pageRevision, revision.accessRevision, revision.publicationPointerRevision, revision.themePublicationRevision].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0) || typeof revision.publicationRevisionId !== "string" || typeof revision.themeActiveRevisionId !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(revision.themeActiveRevisionId) || typeof revision.themeStateDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(revision.themeStateDigest) || !candidate.permissions.every((item) => typeof item === "string")) return undefined;
  return candidate as Projection;
}

function watermark(value: unknown): Watermark | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (![candidate.authorizationRevision, candidate.lifecycleRevision, candidate.pageRevision, candidate.accessRevision, candidate.publicationPointerRevision, candidate.themePublicationRevision].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0) || typeof candidate.publicationRevisionId !== "string" || typeof candidate.themeActiveRevisionId !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(candidate.themeActiveRevisionId) || typeof candidate.themeStateDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(candidate.themeStateDigest)) return undefined;
  return candidate as Watermark;
}

function sameWatermark(left: Watermark, right: Watermark): boolean {
  return left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision && left.pageRevision === right.pageRevision && left.accessRevision === right.accessRevision && left.publicationPointerRevision === right.publicationPointerRevision && left.publicationRevisionId === right.publicationRevisionId && left.themePublicationRevision === right.themePublicationRevision && left.themeActiveRevisionId === right.themeActiveRevisionId && left.themeStateDigest === right.themeStateDigest;
}

export function WorkspacePageRuntime({ pageId, initialProjection }: Readonly<{ pageId: string; initialProjection: Projection }>) {
  const [current, setCurrent] = useState(initialProjection);
  const [revoked, setRevoked] = useState(false);
  const [pageRequest, setPageRequest] = useState<Readonly<{ nodeId: string; page: number }> | undefined>();
  useEffect(() => {
    const changePage = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === null || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).sort().join("\\0") !== "nodeId\\0page") return;
      const { nodeId, page } = detail as Record<string, unknown>;
      if (typeof nodeId !== "string" || nodeId.length < 1 || nodeId.length > 128 || nodeId !== nodeId.normalize("NFC") || nodeId.includes("\\0") || !Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 1_000_000) return;
      let admitted = false; const visit = (node: UiDocument["regions"][string][number]): void => { if (node.id === nodeId && ["sales.saved-view.table", "sales.saved-view.kanban", "sales.saved-view.calendar"].includes(node.bindings?.source?.source.id ?? "")) admitted = true; node.children?.forEach(visit); };
      Object.values(current.document.regions).forEach((region) => region.forEach(visit));
      if (admitted) setPageRequest(Object.freeze({ nodeId, page: page as number }));
    };
    window.addEventListener("k-nex:sales-page-change", changePage); return () => window.removeEventListener("k-nex:sales-page-change", changePage);
  }, [current.document]);
  useEffect(() => {
    let active = true;
    const failClosed = () => { if (active) setRevoked(true); };
    const synchronize = async () => {
      const pageQuery = pageRequest === undefined ? "" : "&nodeId=" + encodeURIComponent(pageRequest.nodeId) + "&page=" + pageRequest.page;
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/session?watermark=" + encodeURIComponent(JSON.stringify(current.watermark)) + pageQuery, { cache: "no-store" }).catch(() => undefined);
      if (!response?.ok) return failClosed();
      const body = await response.json().catch(() => undefined) as { watermark?: unknown; projection?: unknown } | undefined;
      const nextWatermark = watermark(body?.watermark);
      if (nextWatermark === undefined) return failClosed();
      if (sameWatermark(current.watermark, nextWatermark) && pageRequest === undefined) { if (active) setRevoked(false); return; }
      const next = projection(body?.projection);
      if (next === undefined) return failClosed();
      if (!sameWatermark(nextWatermark, next.watermark)) return failClosed();
      if (active) { setCurrent(next); setPageRequest(undefined); setRevoked(false); }
    };
    void synchronize();
    const timer = setInterval(async () => {
      await synchronize();
    }, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [pageId, current.watermark, pageRequest]);
  const result = useMemo(() => runtime.render({
    document: current.document, surface: "workspace", actor: { authenticated: true, permissions: new Set(current.permissions) }, sourceResults: current.sourceResults,
    dispatchAction: async (request) => {
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/actions/" + encodeURIComponent(request.action.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodeId: request.nodeId, input: request.input, idempotencyKey: "workspace-action-" + crypto.randomUUID() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code ?? "Sales action failed.");
      setCurrent((current) => ({ ...current, sourceResults: Object.fromEntries(Object.entries(current.sourceResults).map(([nodeId, value]) => {
        const state = value as { state?: string; data?: { rows?: readonly { key: string; values: Record<string, unknown> }[] } };
        if (state.state !== "success" || !Array.isArray(state.data?.rows)) return [nodeId, value];
        const rows = state.data.rows.map((row) => row.key !== body.data.id ? row : { ...row, values: { ...row.values, "stage-id": { kind: "status", value: body.data.stage }, revision: { kind: "integer", value: body.data.revision } } });
        return [nodeId, { ...state, data: { ...state.data, rows } }];
      })) }));
      return body.data;
    }
  }), [current, pageId]);
  if (revoked) return <section role="alert"><h1>Page access revoked</h1><p>Current authority no longer permits this page.</p></section>;
  return <section data-k-nex-theme-profile={current.themeRevision} data-k-nex-theme-mode={current.themeMode}><style>{current.themeCss}</style>{presentUiRuntimeReact(presentUiRuntimeResult(result))}</section>;
}
`;
}

function workspacePageViewSource(): string {
  return `import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { bootKnexApplication } from "../../../../../boot.js";
import { kNexRequestContext } from "../../../../../k-nex-authority.js";
import { loadWorkspacePageViewProjection } from "../../../../../k-nex-workspace-pages.js";
import { WorkspacePageRuntime } from "../../../../components/k-nex-workspace-page-runtime.js";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "workspace-page-view");
  const pageId = (await params).pageId;
  try { return <WorkspacePageRuntime pageId={pageId} initialProjection={await loadWorkspacePageViewProjection(payload, context, pageId, context.correlationId)} />; } catch { return notFound(); }
}
`;
}

function workspacePageEditorClientSource(): string {
  return `"use client";

import type { UiDocument } from "@k-nex/contracts";
import { salesActivityByOwnerTeamDescriptor, salesLeadConversionDescriptor, salesOpportunitiesDescriptor, salesPipelineSnapshotDescriptor, salesPipelineValueByStageDescriptor, salesSalesCycleDurationDescriptor, salesSavedViewCalendarDescriptor, salesSavedViewDetailDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewListDescriptor, salesSavedViewTableDescriptor, salesTaskAgingDescriptor, salesTasksDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor } from "@k-nex/module-sales/contracts";
import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { genericPuckBlockBridges } from "@k-nex/ui-builder-blocks";
import { WorkspaceEditorSession, createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";
import { WorkspacePuckEditorHost } from "@k-nex/builder-puck/editor";
import { useEffect, useMemo, useRef, useState } from "react";

type Resource = Readonly<{ id: string; version: number }>;
type Watermark = Readonly<{ authorizationRevision: number; lifecycleRevision: number; pageRevision: number; accessRevision: number; publicationPointerRevision: number; publicationRevisionId: string; themePublicationRevision: number; themeActiveRevisionId: string; themeStateDigest: string }>;
type Projection = Readonly<{ workingCopy: { revision: number; document: UiDocument }; permissions: readonly string[]; authority: { blocks: readonly Resource[]; sources: readonly Resource[]; actions: readonly Resource[] }; rollbackRevisions: readonly { id: string; label: string }[]; watermark: Watermark }>;

function watermark(value: unknown): Watermark | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (![candidate.authorizationRevision, candidate.lifecycleRevision, candidate.pageRevision, candidate.accessRevision, candidate.publicationPointerRevision, candidate.themePublicationRevision].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0) || typeof candidate.publicationRevisionId !== "string" || typeof candidate.themeActiveRevisionId !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(candidate.themeActiveRevisionId) || typeof candidate.themeStateDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(candidate.themeStateDigest)) return undefined;
  return candidate as Watermark;
}

function sameEditorAuthority(left: Watermark, right: Watermark): boolean {
  return left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision && left.accessRevision === right.accessRevision && left.themePublicationRevision === right.themePublicationRevision && left.themeActiveRevisionId === right.themeActiveRevisionId && left.themeStateDigest === right.themeStateDigest;
}

export function WorkspacePageEditor({ pageId, initialProjection }: Readonly<{ pageId: string; initialProjection: Projection }>) {
  const [unavailable, setUnavailable] = useState<"access" | "authority" | undefined>();
  const operations = useRef(new AbortController());
  const currentWatermark = useRef(initialProjection.watermark);
  useEffect(() => {
    const controller = new AbortController();
    operations.current = controller;
    let active = true;
    const failClosed = (reason: "access" | "authority") => { if (active) { controller.abort(); setUnavailable(reason); } };
    const synchronize = async () => {
      const request = () => fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/session?mode=edit&watermark=" + encodeURIComponent(JSON.stringify(currentWatermark.current)), { cache: "no-store", signal: controller.signal }).catch(() => undefined);
      let response = await request();
      for (let confirmation = 0; response?.status === 404 && confirmation < 2; confirmation += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        response = await request();
      }
      if (response === undefined || response.status === 409) return;
      if (!response.ok) return failClosed("access");
      const body = await response.json().catch(() => undefined) as { watermark?: unknown } | undefined;
      const next = watermark(body?.watermark);
      if (next === undefined) return failClosed("access");
      if (!sameEditorAuthority(currentWatermark.current, next)) return failClosed("authority");
      currentWatermark.current = next;
    };
    void synchronize();
    const timer = setInterval(async () => {
      await synchronize();
    }, 1_000);
    return () => { active = false; clearInterval(timer); controller.abort(); };
  }, [pageId, initialProjection.watermark]);
  const profile = useMemo(() => createAuthorizedPuckBuilderProfile({
    profile: "workspace", publication: "save-layout", blocks: [...genericPuckBlockBridges, ...salesPuckBlockBridges],
    sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesPipelineSnapshotDescriptor, salesSavedViewListDescriptor, salesSavedViewDetailDescriptor, salesSavedViewTableDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewCalendarDescriptor, salesPipelineValueByStageDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesActivityByOwnerTeamDescriptor, salesTaskAgingDescriptor, salesSalesCycleDurationDescriptor], authority: initialProjection.authority,
    preview: { surface: "workspace", actor: { authenticated: true, permissions: new Set(initialProjection.permissions) }, present: presentUiRuntimeReact }
  }), [initialProjection.authority, initialProjection.permissions]);
  const session = useMemo(() => new WorkspaceEditorSession({
    profile, workingCopy: initialProjection.workingCopy, editorSessionId: "workspace-editor-" + crypto.randomUUID(), issueIdempotencyKey: (operation, sequence) => "workspace-" + operation + "-" + sequence + "-" + crypto.randomUUID(),
    persistence: {
      async autosave(input) {
        const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/autosave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: operations.current.signal });
        const body = await response.json();
        if (response.status === 409 && body.status === "conflict") return body;
        if (!response.ok) throw new Error(body.code ?? "Autosave failed.");
        return body;
      },
      async publish(input) {
        const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: operations.current.signal });
        if (!response.ok) throw new Error((await response.json()).code ?? "Publish failed.");
      },
      async rollback(input) {
        const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: operations.current.signal });
        if (!response.ok) throw new Error((await response.json()).code ?? "Rollback failed.");
      }
    }
  }), [pageId, profile, initialProjection.workingCopy]);
  if (unavailable === "access") return <section role="alert"><h1>Editor access revoked</h1><p>Current authority no longer permits editing this page.</p></section>;
  if (unavailable === "authority") return <section role="alert"><h1>Editor authority changed</h1><p>Current Sales capabilities were cleared.</p></section>;
  return <WorkspacePuckEditorHost profile={profile} session={session} rollbackRevisions={initialProjection.rollbackRevisions} authentication="Authenticated" router="Workspace" sidebar="Block library" topBar="Page editor" systemScreens={null} globalDialogs={null} />;
}
`;
}

function workspacePageEditorSource(): string {
  return `import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { bootKnexApplication } from "../../../../../../boot.js";
import { kNexRequestContext } from "../../../../../../k-nex-authority.js";
import { loadWorkspacePageEditorProjection } from "../../../../../../k-nex-workspace-pages.js";
import { WorkspacePageEditor } from "../../../../../components/k-nex-workspace-page-editor.js";

export const dynamic = "force-dynamic";
export default async function EditWorkspacePage({ params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const context = kNexRequestContext(await getHeaders(), "workspace-page-editor");
  const pageId = (await params).pageId;
  try { return <WorkspacePageEditor pageId={pageId} initialProjection={await loadWorkspacePageEditorProjection(payload, context, pageId, context.correlationId)} />; } catch { return notFound(); }
}
`;
}

function workspaceSalesServerTailSource(): string {
return `type WorkspaceSalesScope = Readonly<{ recordScope: "owned-or-assigned-team" | "managed-teams-and-own" | "application-sales-scope" | "explicit-application-or-team-scope"; applicationWide: boolean; mutationAllowed: boolean; authorizedTeamIds: readonly string[]; revision: number }>;
type WorkspaceSalesReportingAuthority = Readonly<{ settingsRevision: number; reportingTimezone: string; reportingCurrency: string }>;
type SalesReportingAuthorityFacts = Readonly<{ authorizationRevision: number; lifecycleRevision: number; salesScopeRevision: number; settingsRevision: number; reportingTimezone: string; reportingCurrency: string; runtimeGenerationId: string; reportPermissionGrants: readonly ("sales.exports.execute" | "sales.reports.read" | "sales.reports.schedule")[]; objectPermissionGrants: readonly ("sales.activities.read" | "sales.leads.read" | "sales.opportunities.read" | "sales.pipelines.read" | "sales.tasks.read")[]; fieldPermissionGrants: readonly "sales.opportunities.amount.read"[] }>;
export type WorkspaceSalesReportAdmission = Readonly<{ context: Readonly<{ applicationId: string; environment: string; actorId: string }>; authorizationRevision: number; lifecycleRevision: number; scopeRevision: number; runtimeGenerationId: string; recordScope: WorkspaceSalesScope["recordScope"]; applicationWide: boolean; authorizedTeamIds: readonly string[]; permissionGrants: readonly ("sales.exports.execute" | "sales.reports.read" | "sales.reports.schedule")[]; objectPermissionGrants: readonly ("sales.activities.read" | "sales.leads.read" | "sales.opportunities.read" | "sales.pipelines.read" | "sales.tasks.read")[]; fieldPermissionGrants: readonly "sales.opportunities.amount.read"[] }>;
const workspaceSalesAuthorityBrand: unique symbol = Symbol("workspace-sales-current-authority");
type WorkspaceSalesAuthorization = Readonly<{ principal: Readonly<{ kind: "user"; id: string }>; effectiveActor: Readonly<{ kind: "user"; id: string }>; salesScope: WorkspaceSalesScope; authorizationRevision: number; lifecycleRevision: number; [workspaceSalesAuthorityBrand]: true }>;

function authorizationTarget(permissionId: string, recordId: string | undefined, record: Readonly<{ ownerId?: unknown; teamId?: unknown }> | undefined, current: ReturnType<typeof authorization>): CurrentAuthorityTarget | undefined {
  const actorId = current.effectiveActor.id;
  const descriptor = kNexSalesRegistry.permissionDescriptors.find(({ id }) => id === permissionId);
  if (descriptor === undefined) return undefined;
  const resolvedRecordId = recordId ?? "collection";
  return target(permissionId, resolvedRecordId, {
    recordEnvironment: kNexIdentity.environment,
    ownerId: record?.ownerId ?? actorId,
    ...(record?.teamId === undefined || record.teamId === null ? {} : { teamId: record.teamId }),
    applicationWide: current.salesScope.applicationWide,
    mutationAllowed: current.salesScope.mutationAllowed,
    authorizedTeamIds: current.salesScope.authorizedTeamIds,
    recordScope: current.salesScope.recordScope,
    salesScopeRevision: current.salesScope.revision,
    collectionScope: recordId === undefined,
    ...(descriptor.scope === "field" ? { fieldId: descriptor.resource, fieldAllowed: true } : {})
  });
}

type SalesPermissionProjection = readonly string[];

async function salesPermissionProjection(payload: Payload, context: KnexRequestContext, current: WorkspaceSalesAuthorization, permissionIds?: readonly string[]): Promise<SalesPermissionProjection> {
  const descriptors = permissionIds === undefined ? kNexSalesRegistry.permissionDescriptors : kNexSalesRegistry.permissionDescriptors.filter(({ id }) => permissionIds.includes(id));
  const targets: CurrentAuthorityTarget[] = [];
  for (const descriptor of descriptors) {
    const currentTarget = authorizationTarget(descriptor.id, undefined, undefined, current);
    if (currentTarget === undefined) return Object.freeze([]);
    targets.push(currentTarget);
  }
  const allowed: boolean[] = [];
  for (let index = 0; index < targets.length; index += 4) {
    allowed.push(...await Promise.all(targets.slice(index, index + 4).map((currentTarget) => kNexAuthority(payload).adapter.allows(context, currentTarget))));
  }
  return Object.freeze(descriptors.flatMap((descriptor, index) => allowed[index] ? [descriptor.id] : []));
}

function selectPermissionGrants<T extends string>(permissions: SalesPermissionProjection, ids: readonly T[]): readonly T[] {
  return Object.freeze(ids.filter((permissionId) => permissions.includes(permissionId)));
}

async function allowed(payload: Payload, context: KnexRequestContext, permissionId: string, recordId?: string, record?: Readonly<{ ownerId?: unknown; teamId?: unknown }>, signal?: AbortSignal, currentAuthorization?: ReturnType<typeof authorization>) {
  if (signal?.aborted) return false;
  const current = currentAuthorization ?? (await actor(payload, context)).authorization;
  const currentTarget = authorizationTarget(permissionId, recordId, record, current);
  if (currentTarget === undefined) return false;
  const result = await kNexAuthority(payload).adapter.allows(context, currentTarget, signal);
  return !signal?.aborted && result;
}

function authorization(user: unknown, salesScope: WorkspaceSalesScope, authority: Readonly<{ authorizationRevision: number; lifecycleRevision: number }>): WorkspaceSalesAuthorization {
  if (typeof user !== "object" || user === null || !("id" in user) || user.id === undefined || user.id === null) throw new TypeError("Sales authentication is unavailable.");
  const id = String(user.id);
  return Object.freeze({ principal: Object.freeze({ kind: "user" as const, id }), effectiveActor: Object.freeze({ kind: "user" as const, id }), salesScope, ...authority, [workspaceSalesAuthorityBrand]: true as const });
}

function workspaceSalesAuthorization(value: unknown): WorkspaceSalesAuthorization {
  if (typeof value !== "object" || value === null || !(workspaceSalesAuthorityBrand in value) || value[workspaceSalesAuthorityBrand] !== true ||
    !("principal" in value) || typeof value.principal !== "object" || value.principal === null || !("id" in value.principal) || typeof value.principal.id !== "string" ||
    !("effectiveActor" in value) || typeof value.effectiveActor !== "object" || value.effectiveActor === null || !("id" in value.effectiveActor) || value.effectiveActor.id !== value.principal.id ||
    !("salesScope" in value) || typeof value.salesScope !== "object" || value.salesScope === null ||
    !("authorizationRevision" in value) || typeof value.authorizationRevision !== "number" || !Number.isSafeInteger(value.authorizationRevision) || value.authorizationRevision < 0 ||
    !("lifecycleRevision" in value) || typeof value.lifecycleRevision !== "number" || !Number.isSafeInteger(value.lifecycleRevision) || value.lifecycleRevision < 0) throw new TypeError("Sales current-authority context is unavailable.");
  return value as WorkspaceSalesAuthorization;
}

function parseSalesScope(row: Readonly<Record<string, unknown>> | undefined): WorkspaceSalesScope {
  if (row === undefined || !["owned-or-assigned-team", "managed-teams-and-own", "application-sales-scope", "explicit-application-or-team-scope"].includes(String(row.record_scope)) ||
    typeof row.application_wide !== "boolean" || typeof row.mutation_allowed !== "boolean" || !Array.isArray(row.authorized_team_ids) || row.authorized_team_ids.length > 32 ||
    row.authorized_team_ids.some((teamId) => typeof teamId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(teamId)) ||
    JSON.stringify(row.authorized_team_ids) !== JSON.stringify([...new Set(row.authorized_team_ids)].sort()) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1) throw new TypeError("Sales current-authority scope is unavailable.");
  const recordScope = row.record_scope as WorkspaceSalesScope["recordScope"];
  const validMode = recordScope === "application-sales-scope" ? row.application_wide && row.mutation_allowed
    : recordScope === "explicit-application-or-team-scope" ? !row.mutation_allowed
      : !row.application_wide && row.mutation_allowed;
  if (!validMode) throw new TypeError("Sales current-authority scope is invalid.");
  return Object.freeze({ recordScope, applicationWide: row.application_wide, mutationAllowed: row.mutation_allowed, authorizedTeamIds: Object.freeze(row.authorized_team_ids as string[]), revision: row.revision as number });
}

async function readSalesScope(payload: Payload, principalId: string): Promise<WorkspaceSalesScope> {
  const result = await (payload.db.pool as unknown as { query(text: string, values: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }).query(
    "select record_scope, application_wide, mutation_allowed, authorized_team_ids, revision from sales_current_authority_scopes where application_id=$1 and environment=$2 and principal_id=$3 and state='active'",
    [kNexIdentity.applicationId, kNexIdentity.environment, principalId]
  );
  if (result.rows.length !== 1) throw new TypeError("Sales current-authority scope is unavailable.");
  return parseSalesScope(result.rows[0]);
}

async function readSalesAuthority(payload: Payload): Promise<Readonly<{ authorizationRevision: number; lifecycleRevision: number }>> {
  const result = await (payload.db.pool as unknown as { query(text: string, values: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }).query(
    "select authorization_revision, lifecycle_revision from k_nex_authorization_state where application_id=$1",
    [kNexIdentity.applicationId]
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !Number.isSafeInteger(row?.authorization_revision) || !Number.isSafeInteger(row?.lifecycle_revision) ||
    (row.authorization_revision as number) < 0 || (row.lifecycle_revision as number) < 0) throw new TypeError("Sales current-authority revision is unavailable.");
  return Object.freeze({ authorizationRevision: row.authorization_revision as number, lifecycleRevision: row.lifecycle_revision as number });
}

async function readSalesReportingAuthority(payload: Payload): Promise<WorkspaceSalesReportingAuthority> {
  const result = await (payload.db.pool as unknown as { query(text: string, values: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }).query(
    "select d.descriptor_schema_version,d.document_revision,d.settings_revision,d.values_json,s.settings_revision as state_revision from k_nex_system_settings_documents d join k_nex_system_settings_state s on s.application_id=d.application_id and s.environment=d.environment where d.application_id=$1 and d.environment=$2 and d.descriptor_id='system.general' and d.owner_scope_key='platform:system' for share",
    [kNexIdentity.applicationId, kNexIdentity.environment]
  );
  const row = result.rows[0]; const values = row?.values_json;
  if (result.rows.length !== 1 || row?.descriptor_schema_version !== 3 || !positiveSafeInteger(row.document_revision) || !positiveSafeInteger(row.settings_revision) || row.settings_revision !== row.state_revision || values === null || typeof values !== "object" || Array.isArray(values)) throw new TypeError("Sales reporting settings are unavailable.");
  const settings = values as Record<string, unknown>;
  if (!isIso4217CurrencyCode(settings.reportingCurrency) || !canonicalIana(settings.reportingTimezone)) throw new TypeError("Sales reporting settings are unavailable.");
  return Object.freeze({ settingsRevision: row.settings_revision as number, reportingTimezone: settings.reportingTimezone as string, reportingCurrency: settings.reportingCurrency });
}

function dataMovementFieldGrants(permissions: SalesPermissionProjection) {
  const grants: Array<"sales.object.contact:email" | "sales.object.contact:phone" | "sales.object.lead:email" | "sales.object.lead:phone"> = [];
  if (permissions.includes("sales.contacts.channels.read")) grants.push("sales.object.contact:email", "sales.object.contact:phone");
  if (permissions.includes("sales.leads.channels.read")) grants.push("sales.object.lead:email", "sales.object.lead:phone");
  return Object.freeze(grants);
}

const dataMovementPermissionIds = Object.freeze([
  "sales.imports.execute", "sales.exports.execute", "sales.records.merge",
  "sales.leads.read", "sales.leads.write", "sales.accounts.read", "sales.accounts.write", "sales.contacts.read", "sales.contacts.write"
] as const);
const communicationsPermissionIds = Object.freeze([
  "sales.communications.email.send", "sales.communications.calendar.sync", "sales.communications.metadata.read", "sales.settings.write", "sales.reminders.write", "sales.notifications.write"
] as const);
const reportPermissionIds = Object.freeze(["sales.exports.execute", "sales.reports.read", "sales.reports.schedule"] as const);
const reportObjectPermissionIds = Object.freeze(["sales.activities.read", "sales.leads.read", "sales.opportunities.read", "sales.pipelines.read", "sales.tasks.read"] as const);
const reportFieldPermissionIds = Object.freeze(["sales.opportunities.amount.read"] as const);

/** Durable movement work may only retain current, exact permission facts. */
const workspaceSalesActorRequests = new WeakMap<KnexRequestContext, ReturnType<typeof buildActor>>();

function actor(payload: Payload, context: KnexRequestContext, refresh = false, permissionIds?: readonly string[]): ReturnType<typeof buildActor> {
  if (!refresh && permissionIds === undefined) {
    const existing = workspaceSalesActorRequests.get(context);
    if (existing !== undefined) return existing;
  }
  const pending = buildActor(payload, context, permissionIds);
  if (!refresh && permissionIds === undefined) {
    workspaceSalesActorRequests.set(context, pending);
    void pending.catch(() => {
      if (workspaceSalesActorRequests.get(context) === pending) workspaceSalesActorRequests.delete(context);
    });
  }
  return pending;
}

async function buildActor(payload: Payload, context: KnexRequestContext, permissionIds?: readonly string[]) {
  const authentication = await currentPayloadAuthentication(payload, context);
  const user = authentication.user;
  if (typeof user !== "object" || user === null || !("id" in user) || user.id === undefined || user.id === null) throw new TypeError("Sales authentication is unavailable.");
  const [salesScope, authority, reportingAuthority, activeGeneration] = await Promise.all([readSalesScope(payload, String(user.id)), readSalesAuthority(payload), readSalesReportingAuthority(payload), currentSalesGeneration(payload)]);
  const current = authorization(user, salesScope, authority);
  const permissions = await salesPermissionProjection(payload, context, current, permissionIds);
  const [finalSalesScope, finalAuthority] = await Promise.all([readSalesScope(payload, current.effectiveActor.id), readSalesAuthority(payload)]);
  if (finalSalesScope.revision !== current.salesScope.revision || finalAuthority.authorizationRevision !== current.authorizationRevision || finalAuthority.lifecycleRevision !== current.lifecycleRevision) {
    throw new TypeError("Sales current authority changed during permission projection.");
  }
  const fieldGrants = dataMovementFieldGrants(permissions);
  const permissionGrants = selectPermissionGrants(permissions, dataMovementPermissionIds);
  const communicationsPermissions = selectPermissionGrants(permissions, communicationsPermissionIds);
  const reportPermissions = selectPermissionGrants(permissions, reportPermissionIds);
  const reportObjectPermissions = selectPermissionGrants(permissions, reportObjectPermissionIds);
  const reportFieldPermissions = selectPermissionGrants(permissions, reportFieldPermissionIds);
  const generation = activeGeneration.generation;
  const runtimeGenerationId = generation !== undefined && generation.runtimeGenerationIds.length === 1 ? generation.runtimeGenerationIds[0] : undefined;
  if (typeof runtimeGenerationId !== "string" || runtimeGenerationId.length < 1 || runtimeGenerationId.length > 160) throw new TypeError("Sales reporting generation is unavailable.");
  const request = { payload, user: authentication.user ?? null, headers: context.headers } as PayloadRequest & { dataMovement?: GeneratedSalesDataMovementStore; providerGateway?: GeneratedSalesProviderGateway; providerConfigurationReadGateway?: GeneratedSalesProviderConfigurationReadGateway; reporting?: GeneratedSalesReportingGateway; reportingAuthority?: Readonly<SalesReportingAuthorityFacts> };
  const dataMovement = new GeneratedSalesDataMovementStore(request, Object.freeze({
    context: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId: current.effectiveActor.id }),
    authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, scopeRevision: current.salesScope.revision,
    recordScope: current.salesScope.recordScope, applicationWide: current.salesScope.applicationWide, mutationAllowed: current.salesScope.mutationAllowed, authorizedTeamIds: current.salesScope.authorizedTeamIds, fieldGrants, permissionGrants
  }));
  const providerGateway = createGeneratedSalesProviderGateway(request, Object.freeze({
    context: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId: current.effectiveActor.id }),
    authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, scopeRevision: current.salesScope.revision, permissionGrants: communicationsPermissions
  }));
  const providerConfigurationReadGateway = createGeneratedSalesProviderConfigurationReadGateway(request, Object.freeze({ context: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId: current.effectiveActor.id }), authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, scopeRevision: current.salesScope.revision, permissionGrants: communicationsPermissions }));
  const reportAdmission: WorkspaceSalesReportAdmission = Object.freeze({ context: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId: current.effectiveActor.id }), authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, scopeRevision: current.salesScope.revision, runtimeGenerationId, recordScope: current.salesScope.recordScope, applicationWide: current.salesScope.applicationWide, authorizedTeamIds: current.salesScope.authorizedTeamIds, permissionGrants: reportPermissions, objectPermissionGrants: reportObjectPermissions, fieldPermissionGrants: reportFieldPermissions });
  const reporting = createGeneratedSalesReportingGateway(request, reportAdmission);
  request.dataMovement = dataMovement;
  request.providerGateway = providerGateway;
  request.providerConfigurationReadGateway = providerConfigurationReadGateway;
  request.reportingAuthority = Object.freeze({ authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, salesScopeRevision: current.salesScope.revision, ...reportingAuthority, runtimeGenerationId, reportPermissionGrants: reportPermissions, objectPermissionGrants: reportObjectPermissions, fieldPermissionGrants: reportFieldPermissions });
  request.reporting = reporting;
  return { authorization: current, permissions, request, dataMovement, providerGateway, providerConfigurationReadGateway, reporting, reportingAuthority: request.reportingAuthority, reportAdmission };
}

/** Artifact/download paths reuse same current actor/scope/grant admission as interactive reports. */
export async function workspaceSalesReportAdmission(payload: Payload, context: KnexRequestContext): Promise<WorkspaceSalesReportAdmission> {
  return (await actor(payload, context)).reportAdmission;
}

function salesRecordWhere(current: ReturnType<typeof authorization>) {
  const identity = [{ applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }];
  const team = current.salesScope.authorizedTeamIds.length === 0 ? undefined : { teamId: { in: current.salesScope.authorizedTeamIds } };
  if (current.salesScope.recordScope === "application-sales-scope" || current.salesScope.recordScope === "explicit-application-or-team-scope" && current.salesScope.applicationWide) return { and: identity };
  if (current.salesScope.recordScope === "explicit-application-or-team-scope") return { and: [...identity, ...(team === undefined ? [{ id: { equals: "__no-authorized-sales-records__" } }] : [team])] };
  const ownership = [{ ownerId: { equals: current.effectiveActor.id } }, ...(team === undefined ? [] : [team])];
  return { and: [...identity, { or: ownership }] };
}

/** A merged detail only redirects after both the requested loser and its winner pass current record authority. */
export async function resolveMergedSalesDetailRedirect(payload: Payload, context: KnexRequestContext, routeId: string, id: string): Promise<string | undefined> {
  const detail = routeId === "sales.route.account-detail" ? { collection: "sales-accounts" as const, permission: "sales.accounts.read", path: "/sales/accounts/" }
    : routeId === "sales.route.contact-detail" ? { collection: "sales-contacts" as const, permission: "sales.contacts.read", path: "/sales/contacts/" } : undefined;
  if (detail === undefined) return undefined;
  const current = (await actor(payload, context)).authorization;
  const read = async (recordId: string) => {
    const found = await payload.find({ collection: detail.collection, depth: 0, overrideAccess: true, pagination: false, limit: 1,
      select: { id: true, applicationId: true, environment: true, ownerId: true, teamId: true, status: true, mergedIntoId: true },
      where: { and: [salesRecordWhere(current), { id: { equals: recordId } }] } as never });
    const record = found.docs.length === 1 ? found.docs[0] as unknown as Record<string, unknown> : undefined;
    return record !== undefined && String(record.id) === recordId && record.applicationId === kNexIdentity.applicationId && record.environment === kNexIdentity.environment ? record : undefined;
  };
  const loser = await read(id);
  if (loser === undefined) return undefined;
  if (!await allowed(payload, context, detail.permission, id, loser, undefined, current)) throw new TypeError("Merged Sales detail is denied.");
  if (loser.status !== "merged" || typeof loser.mergedIntoId !== "string" || !/^[1-9][0-9]{0,9}$/u.test(loser.mergedIntoId)) return undefined;
  const winner = await read(loser.mergedIntoId);
  if (winner === undefined || !await allowed(payload, context, detail.permission, loser.mergedIntoId, winner, undefined, current)) throw new TypeError("Merged Sales winner is denied.");
  const rechecked = (await actor(payload, context, true)).authorization;
  if (rechecked.authorizationRevision !== current.authorizationRevision || rechecked.lifecycleRevision !== current.lifecycleRevision || rechecked.salesScope.revision !== current.salesScope.revision ||
    !await allowed(payload, context, detail.permission, id, loser, undefined, rechecked) || !await allowed(payload, context, detail.permission, loser.mergedIntoId, winner, undefined, rechecked)) throw new TypeError("Merged Sales authority changed.");
  return detail.path + encodeURIComponent(loser.mergedIntoId);
}

function salesActionGrant(actionId: string) {
  if (actionId.startsWith("sales.import.")) return Object.freeze({ collection: "sales-import-jobs", operations: Object.freeze(["find"] as const), permissionId: "sales.imports.execute" });
  if (actionId.startsWith("sales.export.")) return Object.freeze({ collection: "sales-export-jobs", operations: Object.freeze(["find"] as const), permissionId: "sales.exports.execute" });
  if (actionId === "sales.merge.commit") return Object.freeze({ collection: "sales-merge-lineage", operations: Object.freeze(["find"] as const), permissionId: "sales.records.merge" });
  if (actionId === "sales.ownership.assign") return Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.ownership.write" });
  if (actionId === "sales.task.create") return Object.freeze({ collection: "sales-tasks", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.tasks.write" });
  if (actionId === "sales.task.update") return Object.freeze({ collection: "sales-tasks", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.tasks.write" });
  if (actionId === "sales.opportunity.stage.update") return Object.freeze({ collection: "sales-opportunities", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.opportunities.stage.update" });
  if (actionId.startsWith("sales.pipeline.")) return Object.freeze({ collection: "sales-pipelines", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.pipelines.configure" });
  if (actionId.startsWith("sales.saved-view.")) return Object.freeze({ collection: "sales-saved-views", operations: Object.freeze(actionId.endsWith(".create") ? ["create", "update"] as const : ["find", "update"] as const), permissionId: "sales.saved-views.write" });
  if (actionId === "sales.email.send") return Object.freeze({ collection: "sales-activities", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.communications.email.send" });
  if (actionId === "sales.calendar.sync") return Object.freeze({ collection: "sales-activities", operations: Object.freeze(["find"] as const), permissionId: "sales.communications.calendar.sync" });
  // Configuration has no Payload collection; provider configuration remains host-owned SQL state.
  if (actionId === "sales.integration.configure") return Object.freeze({ collection: "sales-provider-configurations", operations: Object.freeze([] as const), permissionId: "sales.settings.write" });
  if (actionId === "sales.report.run") return Object.freeze({ collection: "sales-report-runs", operations: Object.freeze([] as const), permissionId: "sales.exports.execute" });
  if (actionId === "sales.report.schedule") return Object.freeze({ collection: "sales-report-schedules", operations: Object.freeze([] as const), permissionId: "sales.reports.schedule" });
  if (actionId === "sales.notification.read" || actionId === "sales.notification.archive") return Object.freeze({ collection: "sales-notifications", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.notifications.write" });
  if (actionId === "sales.reminder.dismiss") return Object.freeze({ collection: "sales-reminders", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.reminders.write" });
  if (actionId === "sales.reminder.schedule") return Object.freeze({ collection: "sales-reminders", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.reminders.write" });
  if (actionId.startsWith("sales.account.")) return Object.freeze({ collection: "sales-accounts", operations: Object.freeze(actionId.endsWith(".create") ? ["create", "update"] as const : ["find", "update"] as const), permissionId: actionId.endsWith(".archive") ? "sales.accounts.archive" : "sales.accounts.write" });
  if (actionId.startsWith("sales.contact.")) return Object.freeze({ collection: "sales-contacts", operations: Object.freeze(actionId.endsWith(".create") ? ["create", "update"] as const : ["find", "update"] as const), permissionId: actionId.endsWith(".archive") ? "sales.contacts.archive" : "sales.contacts.write" });
  if (actionId.startsWith("sales.lead.")) return Object.freeze({ collection: "sales-leads", operations: Object.freeze(actionId.endsWith(".create") ? ["create", "update"] as const : ["find", "update"] as const), permissionId: actionId.endsWith(".archive") ? "sales.leads.archive" : actionId.endsWith(".qualify") ? "sales.leads.qualify" : actionId.endsWith(".disqualify") ? "sales.leads.disqualify" : "sales.leads.write" });
  if (actionId.startsWith("sales.opportunity.")) return Object.freeze({ collection: "sales-opportunities", operations: Object.freeze(actionId.endsWith(".create") ? ["create", "update"] as const : ["find", "update"] as const), permissionId: actionId.endsWith(".archive") ? "sales.opportunities.archive" : actionId.endsWith(".close") ? "sales.opportunities.close" : "sales.opportunities.write" });
  if (actionId.startsWith("sales.activity.")) return Object.freeze({ collection: "sales-activities", operations: Object.freeze(actionId.endsWith(".create") ? ["create", "update", "find"] as const : ["find", "update"] as const), permissionId: "sales.activities.write" });
  if (actionId === "sales.note.create") return Object.freeze({ collection: "sales-notes", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.notes.write" });
  if (actionId === "sales.attachment.link") return Object.freeze({ collection: "sales-attachment-references", operations: Object.freeze(["create", "update", "find"] as const), permissionId: "sales.attachments.write" });
  if (actionId === "sales.attachment.remove") return Object.freeze({ collection: "sales-attachment-references", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.attachments.write" });
  throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action persistence is unavailable.");
}

/** Interactive CRUD actions only need their own current permission; gateway-backed actions retain their full grant projection. */
function salesActionActorPermissionIds(actionId: string): readonly string[] | undefined {
  if (actionId.startsWith("sales.import.") || actionId.startsWith("sales.export.") || actionId === "sales.merge.commit") return undefined;
  if (actionId === "sales.report.run" || actionId === "sales.report.schedule") return Object.freeze([...new Set([...reportPermissionIds, ...reportObjectPermissionIds, ...reportFieldPermissionIds])]);
  if (actionId === "sales.email.send" || actionId === "sales.calendar.sync" || actionId === "sales.integration.configure") return communicationsPermissionIds;
  return Object.freeze([salesActionGrant(actionId).permissionId]);
}

function salesActionCapabilityGrants(actionId: string) {
  const primary = salesActionGrant(actionId);
  if (actionId === "sales.pipeline.update") return [primary, Object.freeze({ collection: "sales-pipeline-stages", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.pipelines.configure" })];
  if (actionId === "sales.ownership.assign") return [
    Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.ownership.write" }),
    Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.ownership.write" }),
    Object.freeze({ collection: "sales-leads", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.ownership.write" }),
    Object.freeze({ collection: "sales-opportunities", operations: Object.freeze(["find", "update"] as const), permissionId: "sales.ownership.write" })
  ];
  const relatedTargets = actionId.startsWith("sales.activity.") || actionId === "sales.note.create" || actionId === "sales.attachment.link" || actionId === "sales.attachment.remove"
    ? [Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["find"] as const), permissionId: "sales.accounts.read" }), Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["find"] as const), permissionId: "sales.contacts.read" }), Object.freeze({ collection: "sales-leads", operations: Object.freeze(["find"] as const), permissionId: "sales.leads.read" }), Object.freeze({ collection: "sales-opportunities", operations: Object.freeze(["find"] as const), permissionId: "sales.opportunities.read" }), Object.freeze({ collection: "sales-tasks", operations: Object.freeze(["find"] as const), permissionId: "sales.tasks.read" })]
    : [];
  if (actionId === "sales.lead.qualify") return [primary,
    Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["find"] as const), permissionId: "sales.accounts.read" }),
    Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.accounts.write" }),
    Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["find"] as const), permissionId: "sales.contacts.read" }),
    Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.contacts.write" }),
    Object.freeze({ collection: "sales-opportunities", operations: Object.freeze(["create", "update"] as const), permissionId: "sales.opportunities.write" }), Object.freeze({ collection: "sales-pipelines", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" }), Object.freeze({ collection: "sales-pipeline-stages", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" })];
  if (actionId === "sales.contact.create") return [primary, Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["find"] as const), permissionId: "sales.accounts.read" })];
  if (actionId === "sales.opportunity.create") return [primary, Object.freeze({ collection: "sales-accounts", operations: Object.freeze(["find"] as const), permissionId: "sales.accounts.read" }), Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["find"] as const), permissionId: "sales.contacts.read" }), Object.freeze({ collection: "sales-pipelines", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" }), Object.freeze({ collection: "sales-pipeline-stages", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" })];
  if (actionId === "sales.opportunity.stage.update") return [primary, Object.freeze({ collection: "sales-pipelines", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" }), Object.freeze({ collection: "sales-pipeline-stages", operations: Object.freeze(["find"] as const), permissionId: "sales.pipelines.read" })];
  if (actionId === "sales.opportunity.update") return [primary, Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["find"] as const), permissionId: "sales.contacts.read" })];
  if (actionId === "sales.note.create") return [primary, Object.freeze({ collection: "sales-notes", operations: Object.freeze(["find"] as const), permissionId: "sales.notes.read" }), ...relatedTargets];
  if (actionId === "sales.email.send") return [primary,
    Object.freeze({ collection: "sales-contacts", operations: Object.freeze(["find"] as const), permissionId: "sales.contacts.read" }),
    Object.freeze({ collection: "sales-leads", operations: Object.freeze(["find"] as const), permissionId: "sales.leads.read" })];
  if (actionId === "sales.reminder.schedule") return [primary,
    Object.freeze({ collection: "sales-tasks", operations: Object.freeze(["find"] as const), permissionId: "sales.tasks.read" }),
    Object.freeze({ collection: "sales-activities", operations: Object.freeze(["find"] as const), permissionId: "sales.activities.read" })];
  if (actionId === "sales.report.run") return [primary];
  if (actionId === "sales.report.schedule") return [primary];
  return [primary, ...relatedTargets];
}

function postgresRows(value: unknown): readonly unknown[] {
  if (value === null || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) throw new Error("Sales scope guard received an invalid Postgres result.");
  return value.rows;
}

async function resolveSalesAttachmentUpload(request: PayloadRequest, current: ReturnType<typeof authorization>, input: Readonly<{ applicationId: string; environmentId: string; actorId: string; storageRef: string }>) {
  if (input.applicationId !== kNexIdentity.applicationId || input.environmentId !== kNexIdentity.environment || input.actorId !== current.effectiveActor.id) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Attachment upload authority is invalid.");
  const transaction = await activePayloadPostgresTransaction(request);
  const row = postgresRows(await transaction.execute(sql\`
    SELECT "storage_ref","application_id","environment","uploader_actor_id","filename","media_type","byte_size","state","revision"
    FROM "k_nex_sales_attachment_upload_admissions"
    WHERE "storage_ref"=\${input.storageRef} AND "application_id"=\${input.applicationId} AND "environment"=\${input.environmentId}
      AND "uploader_actor_id"=\${input.actorId} AND "state"='ready'
    FOR SHARE
  \`))[0] as Record<string, unknown> | undefined;
  if (row === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Attachment upload is unavailable.");
  return Object.freeze({ storageRef: row.storage_ref, applicationId: row.application_id, environmentId: row.environment, uploaderActorId: row.uploader_actor_id, filename: row.filename, mediaType: row.media_type, byteSize: row.byte_size, state: row.state, revision: row.revision });
}

async function currentSalesAuthorityFence(request: PayloadRequest, current: ReturnType<typeof authorization>): Promise<boolean> {
  const transaction = await activePayloadPostgresTransaction(request);
  const rows = postgresRows(await transaction.execute(sql\`
    SELECT "authorization_revision", "lifecycle_revision" FROM "k_nex_authorization_state"
    WHERE "application_id" = \${kNexIdentity.applicationId} FOR SHARE
  \`));
  if (rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") return false;
  const state = rows[0] as Record<string, unknown>;
  return state.authorization_revision === current.authorizationRevision && state.lifecycle_revision === current.lifecycleRevision;
}

function actionDigest(value: unknown): \`sha256:\${string}\` {
  return \`sha256:\${createHash("sha256").update(canonicalJson(value)).digest("hex")}\`;
}

interface SalesActionIdempotency {
  readonly request: PayloadRequest;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: \`sha256:\${string}\`;
  replay?: unknown;
}

function salesActionEventId(current: ReturnType<typeof authorization>, actionId: string, idempotencyKey: string, requestDigest: string): string {
  return "sales-action-" + createHash("sha256").update(canonicalJson({
    applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment,
    effectiveActorId: current.effectiveActor.id, actionId, idempotencyKey, requestDigest
  })).digest("hex");
}

function idempotencyRow(value: unknown): Readonly<{ requestDigest: string; result: unknown; resultDigest: string }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Sales action idempotency row is invalid.");
  const row = value as Record<string, unknown>;
  if (typeof row.request_digest !== "string" || typeof row.result_digest !== "string" || row.result_json === null || typeof row.result_json !== "object" || Array.isArray(row.result_json)) {
    throw new Error("Sales action idempotency row is invalid.");
  }
  return Object.freeze({ requestDigest: row.request_digest, result: row.result_json, resultDigest: row.result_digest });
}

async function reserveSalesActionIdempotency(input: SalesActionIdempotency, current: ReturnType<typeof authorization>): Promise<unknown | undefined> {
  const transaction = await activePayloadPostgresTransaction(input.request);
  const authority = postgresRows(await transaction.execute(sql\`
    SELECT "authorization_revision", "lifecycle_revision" FROM "k_nex_authorization_state"
    WHERE "application_id" = \${kNexIdentity.applicationId} FOR SHARE
  \`));
  if (authority.length !== 1 || authority[0] === null || typeof authority[0] !== "object") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action authority is unavailable.");
  const revisions = authority[0] as Record<string, unknown>;
  if (!Number.isSafeInteger(revisions.authorization_revision) || !Number.isSafeInteger(revisions.lifecycle_revision)) throw new Error("Sales action authority revision is invalid.");
  const pending = Object.freeze({ state: "pending" });
  const row = idempotencyRow(postgresRows(await transaction.execute(sql\`
    INSERT INTO "sales_action_idempotency" (
      "application_id", "environment", "effective_actor_id", "action_id", "idempotency_key", "request_digest", "result_json", "result_digest", "authorization_revision", "lifecycle_revision"
    ) VALUES (
      \${kNexIdentity.applicationId}, \${kNexIdentity.environment}, \${current.effectiveActor.id}, \${input.actionId}, \${input.idempotencyKey}, \${input.requestDigest},
      \${JSON.stringify(pending)}::jsonb, \${actionDigest(pending)}, \${revisions.authorization_revision}, \${revisions.lifecycle_revision}
    ) ON CONFLICT ("application_id", "environment", "effective_actor_id", "action_id", "idempotency_key")
      DO UPDATE SET "request_digest" = "sales_action_idempotency"."request_digest"
    RETURNING "request_digest", "result_json", "result_digest"
  \`))[0]);
  if (row.requestDigest !== input.requestDigest) throw new ActionGatewayError("IDEMPOTENCY_CONFLICT", 409, "Sales action idempotency key was reused for different input.");
  if (row.resultDigest !== actionDigest(row.result)) throw new Error("Sales action idempotency result is invalid.");
  if ((row.result as { state?: unknown }).state === "pending") return undefined;
  if ((row.result as { state?: unknown }).state !== "succeeded" || !("data" in (row.result as Record<string, unknown>))) throw new Error("Sales action idempotency result is invalid.");
  input.replay = (row.result as Record<string, unknown>).data;
  return input.replay;
}

async function completeSalesActionIdempotency(input: SalesActionIdempotency, current: ReturnType<typeof authorization>, data: unknown): Promise<void> {
  const transaction = await activePayloadPostgresTransaction(input.request);
  const result = Object.freeze({ state: "succeeded", data });
  const completed = postgresRows(await transaction.execute(sql\`
    UPDATE "sales_action_idempotency"
    SET "result_json" = \${JSON.stringify(result)}::jsonb, "result_digest" = \${actionDigest(result)}
    WHERE "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment}
      AND "effective_actor_id" = \${current.effectiveActor.id} AND "action_id" = \${input.actionId}
      AND "idempotency_key" = \${input.idempotencyKey} AND "request_digest" = \${input.requestDigest}
      AND "result_json" = '{"state":"pending"}'::jsonb
    RETURNING "idempotency_key"
  \`));
  if (completed.length !== 1) throw new Error("Sales action idempotency finalization was lost.");
}

async function lockSalesActionTarget(request: PayloadRequest, current: ReturnType<typeof authorization>, input: Readonly<Record<string, unknown>>): Promise<boolean> {
  const transaction = await activePayloadPostgresTransaction(request);
  if (!await currentSalesAuthorityFence(request, current)) return false;
  const actorId = current.effectiveActor.id;
  const teamScope = current.salesScope.authorizedTeamIds.length === 0 ? sql\`false\` : sql\`"team_id" in \${current.salesScope.authorizedTeamIds}\`;
  const savedViewTeamScope = current.salesScope.authorizedTeamIds.length === 0 ? sql\`false\` : sql\`"visibility_team_id" in \${current.salesScope.authorizedTeamIds}\`;
  const recordScope = current.salesScope.recordScope === "application-sales-scope" ? sql\`true\`
    : current.salesScope.recordScope === "explicit-application-or-team-scope" ? sql\`\${current.salesScope.applicationWide} OR \${teamScope}\`
      : sql\`"owner_id" = \${actorId} OR \${teamScope}\`;
  if (postgresRows(await transaction.execute(sql\`SELECT "revision" FROM "sales_current_authority_scopes"
    WHERE "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND "principal_id" = \${actorId} AND "state" = 'active'
      AND "revision" = \${current.salesScope.revision} AND "mutation_allowed" = true FOR SHARE\`)).length !== 1) return false;
  const relatedCollection = input.relatedRecordType === "sales.account" ? "sales-accounts"
    : input.relatedRecordType === "sales.contact" ? "sales-contacts"
      : input.relatedRecordType === "sales.lead" ? "sales-leads"
        : input.relatedRecordType === "sales.opportunity" ? "sales-opportunities"
          : input.relatedRecordType === "sales.task" ? "sales-tasks" : undefined;
  const directId = typeof input.id === "string" ? input.id : Number.isSafeInteger(input.id) && (input.id as number) > 0 ? String(input.id) : undefined;
  const collection = directId !== undefined ? input.collection : relatedCollection;
  const id = directId ?? (typeof input.relatedRecordId === "string" ? input.relatedRecordId : undefined);
  if (typeof collection !== "string" || typeof id !== "string") return true;
  if (collection === "sales-tasks") {
    return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_tasks"
      WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment}
        AND (\${recordScope})
      FOR UPDATE
    \`)).length === 1;
  }
  if (collection === "sales-opportunities") {
    return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_opportunities"
      WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment}
        AND (\${recordScope})
      FOR UPDATE
    \`)).length === 1;
  }
  if (collection === "sales-accounts") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_accounts" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND (\${recordScope}) FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-contacts") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_contacts" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND (\${recordScope}) FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-leads") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_leads" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND (\${recordScope}) FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-activities") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_activities" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND (\${recordScope}) FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-notes") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_notes" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND (\${recordScope}) FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-attachment-references") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_attachment_references" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND (\${recordScope}) FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-notifications") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_notifications" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND "recipient_id" = \${actorId} FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-reminders") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_reminders" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND "recipient_id" = \${actorId} FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-pipelines") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_pipelines" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} FOR UPDATE
    \`)).length === 1;
  if (collection === "sales-saved-views") return postgresRows(await transaction.execute(sql\`
      SELECT "id" FROM "sales_saved_views" WHERE "id" = \${id} AND "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment}
        AND (("owner_id" = \${actorId} AND "visibility"='personal') OR ("visibility"='team' AND \${savedViewTeamScope})) FOR UPDATE
    \`)).length === 1;
  return false;
}

async function lockCurrentSalesMutationScope(request: PayloadRequest, current: ReturnType<typeof authorization>): Promise<boolean> {
  const transaction = await activePayloadPostgresTransaction(request);
  if (!await currentSalesAuthorityFence(request, current)) return false;
  return postgresRows(await transaction.execute(sql\`SELECT "revision" FROM "sales_current_authority_scopes"
    WHERE "application_id" = \${kNexIdentity.applicationId} AND "environment" = \${kNexIdentity.environment} AND "principal_id" = \${current.effectiveActor.id}
      AND "state" = 'active' AND "revision" = \${current.salesScope.revision} AND "mutation_allowed" = true FOR SHARE\`)).length === 1;
}

async function lockSalesPipelineReferences(request: PayloadRequest, actionId: string, input: unknown): Promise<void> {
  if (!["sales.pipeline.update", "sales.opportunity.create", "sales.opportunity.stage.update", "sales.opportunity.close"].includes(actionId)) return;
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales pipeline references are invalid.");
  const value = input as Readonly<Record<string, unknown>>; const transaction = await activePayloadPostgresTransaction(request);
  const recordId = (candidate: unknown) => typeof candidate === "string" && /^(?:[1-9][0-9]{0,8}|1[0-9]{9}|20[0-9]{8}|21[0-3][0-9]{7}|214[0-6][0-9]{6}|2147[0-3][0-9]{5}|21474[0-7][0-9]{4}|214748[0-2][0-9]{3}|2147483[0-5][0-9]{2}|21474836[0-3][0-9]|214748364[0-7])$/u.test(candidate) ? candidate : undefined;
  const revision = (candidate: unknown) => Number.isSafeInteger(candidate) && (candidate as number) > 0 && (candidate as number) <= 1_000_000_000 ? candidate as number : undefined;
  const pipelineId = recordId(actionId === "sales.pipeline.update" ? value.id : actionId === "sales.opportunity.create" ? value.pipelineId : value.expectedPipelineId);
  const pipelineRevision = revision(actionId === "sales.pipeline.update" ? value.expectedRevision : value.expectedPipelineRevision);
  if (pipelineId === undefined || pipelineRevision === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales pipeline references are invalid.");
  const pipeline = postgresRows(await transaction.execute(sql\`SELECT "id","revision" FROM "sales_pipelines" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} AND "id"=\${pipelineId} AND "revision"=\${pipelineRevision} AND "status"='active' AND "is_active"=true FOR UPDATE\`));
  if (pipeline.length !== 1) throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline changed before action.");
  if (actionId === "sales.pipeline.update") {
    if (!Array.isArray(value.stages) || value.stages.length !== 6) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales pipeline snapshot is invalid.");
    const expected = new Map<string, number>();
    for (const stage of value.stages) {
      if (stage === null || typeof stage !== "object" || Array.isArray(stage)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales pipeline snapshot is invalid.");
      const row = stage as Record<string, unknown>; const stageId = typeof row.stageId === "string" ? row.stageId : undefined; const stageRevision = revision(row.expectedRevision);
      if (stageId === undefined || stageRevision === undefined || expected.has(stageId)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales pipeline snapshot is invalid.");
      expected.set(stageId, stageRevision);
    }
    const rows = postgresRows(await transaction.execute(sql\`SELECT "stage_id","revision" FROM "sales_pipeline_stages" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} AND "pipeline_id"=\${pipelineId} AND "status"='active' ORDER BY "stage_id" FOR UPDATE\`));
    if (rows.length !== 6) throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline stages changed before action.");
    for (const raw of rows) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline stages changed before action.");
      const row = raw as Record<string, unknown>; if (expected.get(String(row.stage_id)) !== row.revision) throw new ActionGatewayError("STALE_RECORD", 409, "Sales pipeline stages changed before action.");
    }
    return;
  }
  const stagePairs = actionId === "sales.opportunity.create" ? [[value.stageId, value.expectedStageRevision] as const]
    : [[value.expectedSourceStageId, value.expectedSourceStageRevision] as const, [value.destinationStageId, value.expectedDestinationStageRevision] as const];
  const expectedStages = new Map<string, number>();
  for (const [stageId, expectedRevision] of stagePairs) {
    if (typeof stageId !== "string" || revision(expectedRevision) === undefined || expectedStages.has(stageId) && expectedStages.get(stageId) !== expectedRevision) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales Stage references are invalid.");
    expectedStages.set(stageId, expectedRevision as number);
  }
  const stageIds = [...expectedStages.keys()].sort();
  const stages = postgresRows(await transaction.execute(sql\`SELECT "stage_id","revision" FROM "sales_pipeline_stages" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} AND "pipeline_id"=\${pipelineId} AND "stage_id" in \${stageIds} AND "status"='active' ORDER BY "stage_id" FOR UPDATE\`));
  if (stages.length !== stageIds.length) throw new ActionGatewayError("STALE_RECORD", 409, "Sales Stage changed before action.");
  for (const raw of stages) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales Stage changed before action.");
    const row = raw as Record<string, unknown>; if (expectedStages.get(String(row.stage_id)) !== row.revision) throw new ActionGatewayError("STALE_RECORD", 409, "Sales Stage changed before action.");
  }
}

type LockedSalesReportingTimezone = Readonly<{ timezone: string; revision: number }>;
async function lockSalesReportingTimezone(request: PayloadRequest, actionId: string, input: unknown): Promise<LockedSalesReportingTimezone | undefined> {
  if (actionId !== "sales.saved-view.create" && actionId !== "sales.saved-view.update") return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const definition = (input as Readonly<Record<string, unknown>>).definition;
  if (definition === null || typeof definition !== "object" || Array.isArray(definition) || (definition as Readonly<Record<string, unknown>>).kind !== "calendar") return undefined;
  const transaction = await activePayloadPostgresTransaction(request);
  const stateRows = postgresRows(await transaction.execute(sql\`SELECT "settings_revision" FROM "k_nex_system_settings_state" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} FOR SHARE\`));
  const documentRows = postgresRows(await transaction.execute(sql\`SELECT "owner_kind","owner_namespace","owner_delivery_class","owner_extension_id","owner_generation","document_revision","settings_revision","values_json" FROM "k_nex_system_settings_documents" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} AND "descriptor_id"='system.general' AND "descriptor_schema_version"=3 AND "owner_scope_key"='platform:system' FOR SHARE\`));
  if (stateRows.length !== 1 || documentRows.length !== 1) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting timezone is unavailable.");
  const stateRaw = stateRows[0]; const documentRaw = documentRows[0];
  if (stateRaw === null || typeof stateRaw !== "object" || Array.isArray(stateRaw) || documentRaw === null || typeof documentRaw !== "object" || Array.isArray(documentRaw)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting timezone is unavailable.");
  const state = stateRaw as Record<string, unknown>; const document = documentRaw as Record<string, unknown>; const values = document.values_json;
  if (!positiveSafeInteger(state.settings_revision) || document.owner_kind !== "platform" || document.owner_namespace !== "system" || document.owner_delivery_class !== null || document.owner_extension_id !== null || document.owner_generation !== null || !positiveSafeInteger(document.document_revision) || !positiveSafeInteger(document.settings_revision) || document.settings_revision > state.settings_revision || values === null || typeof values !== "object" || Array.isArray(values) || !canonicalIana((values as Record<string, unknown>).reportingTimezone)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales reporting timezone is unavailable.");
  return Object.freeze({ timezone: (values as Record<string, unknown>).reportingTimezone as string, revision: document.settings_revision });
}

function salesActionCapability(payload: Payload, context: KnexRequestContext, request: PayloadRequest, actionId: string, current: ReturnType<typeof authorization>) {
  const grant = salesActionGrant(actionId);
  return createPayloadPersistenceCapability(request, salesActionCapabilityGrants(actionId).map(({ collection, operations }) => ({ collection, operations })),
    new CurrentAuthorityPayloadPersistenceAuthorizer(kNexAuthority(payload).adapter, context, ({ collection, operation }) => {
      const currentGrant = salesActionCapabilityGrants(actionId).find((candidate) => candidate.collection === collection && candidate.operations.some((candidateOperation) => candidateOperation === operation));
      const currentTarget = authorizationTarget(currentGrant?.permissionId ?? grant.permissionId, undefined, undefined, current);
      if (currentTarget === undefined) throw new Error("Sales persistence permission is unavailable.");
      return currentTarget;
    }), { guard: async (input) => {
      const relatedCollection = input.relatedRecordType === "sales.account" ? "sales-accounts"
        : input.relatedRecordType === "sales.contact" ? "sales-contacts"
          : input.relatedRecordType === "sales.lead" ? "sales-leads"
            : input.relatedRecordType === "sales.opportunity" ? "sales-opportunities"
              : input.relatedRecordType === "sales.task" ? "sales-tasks" : undefined;
      const accountReference = (actionId === "sales.contact.create" || actionId === "sales.opportunity.create") && typeof input.accountId === "string"
        ? Object.freeze({ collection: "sales-accounts", id: input.accountId }) : undefined;
      const collection = typeof input.id === "string" ? input.collection : relatedCollection ?? accountReference?.collection ?? input.collection;
      const id = typeof input.id === "string" ? input.id : typeof input.relatedRecordId === "string" ? input.relatedRecordId : accountReference?.id;
      if (collection !== grant.collection && !salesActionCapabilityGrants(actionId).some((candidate) => candidate.collection === collection)) return false;
      const operation = input.operation;
      if (operation !== "find" && operation !== "create" && operation !== "update") return false;
      const currentGrant = salesActionCapabilityGrants(actionId).find((candidate) => candidate.collection === collection && candidate.operations.some((candidateOperation) => candidateOperation === operation));
      if (currentGrant === undefined || input.id !== undefined && typeof input.id !== "string" && !(Number.isSafeInteger(input.id) && (input.id as number) > 0)) return false;
      const currentTarget = authorizationTarget(currentGrant.permissionId, id, undefined, current);
      return currentTarget !== undefined && await kNexAuthority(payload).adapter.allows(context, currentTarget) && await lockSalesActionTarget(request, current, input);
    } });
}

async function salesActionRecord(capability: PayloadPersistenceCapabilityContext, collection: "sales-tasks" | "sales-opportunities" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-activities" | "sales-notes" | "sales-attachment-references" | "sales-notifications" | "sales-reminders" | "sales-pipelines" | "sales-saved-views", id: string, current: ReturnType<typeof authorization>) {
  const scope = salesRecordWhere(current);
  const authorityWhere = collection === "sales-pipelines" ? [{ applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }]
    : collection === "sales-saved-views" ? [{ applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }, { or: [{ and: [{ ownerId: { equals: current.effectiveActor.id } }, { visibility: { equals: "personal" } }] }, { and: [{ visibilityTeamId: { in: current.salesScope.authorizedTeamIds } }, { visibility: { equals: "team" } }] }] }]
      : collection === "sales-notifications" || collection === "sales-reminders" ? recipientOnlyWhere(current).and
      : scope.and;
  const select = collection === "sales-pipelines" ? { status: true, revision: true } : collection === "sales-saved-views" ? { ownerId: true, visibility: true, visibilityTeamId: true, status: true, revision: true }
    : collection === "sales-notifications" || collection === "sales-reminders" ? { recipientId: true, state: true, revision: true }
    : { ownerId: true, teamId: true, status: true, archiveStatus: true, revision: true, accountId: true, relatedRecordType: true, relatedRecordId: true };
  const result = await capability.payload.find({ collection, depth: 0, limit: 1, pagination: false, overrideAccess: true,
    select, where: { and: [{ id: { equals: id } }, ...authorityWhere] } }) as { docs?: unknown };
  if (!Array.isArray(result.docs) || result.docs.length !== 1 || result.docs[0] === null || typeof result.docs[0] !== "object") {
    throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action target is unavailable.");
  }
  return result.docs[0] as { ownerId?: unknown; teamId?: unknown; visibility?: unknown; visibilityTeamId?: unknown; status?: unknown; archiveStatus?: unknown; revision?: unknown; accountId?: unknown; relatedRecordType?: unknown; relatedRecordId?: unknown };
}

async function salesNoteReplacementIdentity(request: PayloadRequest, id: string) {
  const transaction = await activePayloadPostgresTransaction(request);
  const row = postgresRows(await transaction.execute(sql\`SELECT "status","related_record_type","related_record_id" FROM "sales_notes" WHERE "id"=\${id} AND "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} FOR UPDATE\`))[0] as Record<string, unknown> | undefined;
  return row === undefined ? undefined : Object.freeze({ status: row.status, relatedRecordType: row.related_record_type, relatedRecordId: Number.isSafeInteger(row.related_record_id) || typeof row.related_record_id === "string" ? String(row.related_record_id) : undefined });
}

async function salesRelatedMutationParent(request: PayloadRequest, childCollection: "sales-activities" | "sales-attachment-references", id: string): Promise<Readonly<{ collection: "sales-tasks" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities"; id: string }>> {
  const transaction = await activePayloadPostgresTransaction(request);
  const row = postgresRows(await (childCollection === "sales-activities" ? transaction.execute(sql\`
    SELECT "related_record_type","related_record_id" FROM "sales_activities" WHERE "id"=\${id} AND "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} FOR UPDATE
  \`) : transaction.execute(sql\`
    SELECT "related_record_type","related_record_id" FROM "sales_attachment_references" WHERE "id"=\${id} AND "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} FOR UPDATE
  \`)))[0] as Record<string, unknown> | undefined;
  const collection = row?.related_record_type === "sales.account" ? "sales-accounts" : row?.related_record_type === "sales.contact" ? "sales-contacts"
    : row?.related_record_type === "sales.lead" ? "sales-leads" : row?.related_record_type === "sales.opportunity" ? "sales-opportunities"
      : row?.related_record_type === "sales.task" ? "sales-tasks" : undefined;
  if (collection === undefined || !(Number.isSafeInteger(row?.related_record_id) || typeof row?.related_record_id === "string" && /^[1-9][0-9]*$/u.test(row.related_record_id))) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related mutation target is unavailable.");
  return Object.freeze({ collection, id: String(row!.related_record_id) });
}

async function salesActivityTaskParent(request: PayloadRequest, id: string): Promise<Readonly<{ collection: "sales-tasks" | "sales-accounts" | "sales-contacts" | "sales-leads" | "sales-opportunities"; id: string }>> {
  const transaction = await activePayloadPostgresTransaction(request);
  const row = postgresRows(await transaction.execute(sql\`
    SELECT "related_record_type","related_record_id" FROM "sales_tasks" WHERE "id"=\${id} AND "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} FOR UPDATE
  \`))[0] as Record<string, unknown> | undefined;
  const collection = row?.related_record_type === "sales.account" ? "sales-accounts" : row?.related_record_type === "sales.contact" ? "sales-contacts"
    : row?.related_record_type === "sales.lead" ? "sales-leads" : row?.related_record_type === "sales.opportunity" ? "sales-opportunities" : undefined;
  const taskCollection = row?.related_record_type === "sales.task" ? "sales-tasks" : collection;
  if (taskCollection === undefined || !(Number.isSafeInteger(row?.related_record_id) || typeof row?.related_record_id === "string" && /^[1-9][0-9]*$/u.test(row.related_record_id))) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales activity task parent is unavailable.");
  return Object.freeze({ collection: taskCollection, id: String(row!.related_record_id) });
}

const salesOwnershipPermissions = Object.freeze({
  "sales.account": Object.freeze(["sales.accounts.read", "sales.accounts.write"]),
  "sales.contact": Object.freeze(["sales.contacts.read", "sales.contacts.write"]),
  "sales.lead": Object.freeze(["sales.leads.read", "sales.leads.write"]),
  "sales.opportunity": Object.freeze(["sales.opportunities.read", "sales.opportunities.write"])
} as const);

async function salesOwnershipAdmission(request: PayloadRequest, current: ReturnType<typeof authorization>, input: Readonly<Record<string, unknown>>) {
  const recordType = input.recordType;
  const ownerId = input.ownerId;
  const teamId = input.teamId;
  if ((recordType !== "sales.account" && recordType !== "sales.contact" && recordType !== "sales.lead" && recordType !== "sales.opportunity") || typeof ownerId !== "string" || teamId !== undefined && typeof teamId !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership admission is invalid.");
  const transaction = await activePayloadPostgresTransaction(request);
  const permissions = salesOwnershipPermissions[recordType];
  const grantRows = postgresRows(await transaction.execute(sql\`
    SELECT g."permission_id" FROM "k_nex_role_assignments" a
    JOIN "k_nex_role_permission_grants" g ON g."application_id"=a."application_id" AND g."role_id"=a."role_id"
    JOIN "k_nex_extension_authorization_generations" x ON x."application_id"=g."application_id" AND x."delivery_class"=g."owner_delivery_class" AND x."extension_id"=g."owner_extension_id" AND x."authorization_generation"=g."owner_generation"
    WHERE a."application_id"=\${kNexIdentity.applicationId} AND a."subject_kind"='user' AND a."subject_id"=\${ownerId} AND a."state"='active'
      AND g."permission_id" IN (\${sql.join(permissions.map((permissionId) => sql\`\${permissionId}\`), sql\`, \`)})
      AND g."owner_kind"='extension' AND g."owner_delivery_class"='platform-plugin' AND g."owner_extension_id"='module.sales'
      AND x."delivery_class"='platform-plugin' AND x."extension_id"='module.sales' AND x."state"='current'
    FOR SHARE OF a,g,x
  \`)).map((row) => row !== null && typeof row === "object" ? (row as Record<string, unknown>).permission_id : undefined);
  if (!permissions.every((permissionId) => grantRows.includes(permissionId))) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership owner lacks current object authority.");
  const ownerScope = postgresRows(await transaction.execute(sql\`SELECT "record_scope","application_wide","mutation_allowed","authorized_team_ids","revision" FROM "sales_current_authority_scopes" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} AND "principal_id"=\${ownerId} AND "state"='active' AND "mutation_allowed"=true FOR SHARE\`))[0] as Record<string, unknown> | undefined;
  if (ownerScope === undefined || typeof ownerScope.record_scope !== "string" || typeof ownerScope.application_wide !== "boolean" || ownerScope.mutation_allowed !== true || !Array.isArray(ownerScope.authorized_team_ids) || !Number.isSafeInteger(ownerScope.revision)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership owner scope is unavailable.");
  if (teamId !== undefined) {
    if (!current.salesScope.applicationWide && !current.salesScope.authorizedTeamIds.includes(teamId)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership team is outside caller scope.");
    const teamFacts = postgresRows(await transaction.execute(sql\`SELECT "authorized_team_ids" FROM "sales_current_authority_scopes" WHERE "application_id"=\${kNexIdentity.applicationId} AND "environment"=\${kNexIdentity.environment} AND "state"='active' AND ("principal_id"=\${ownerId} OR "authorized_team_ids" @> \${JSON.stringify([teamId])}::jsonb) FOR SHARE\`));
    const exists = teamId === \`team:\${ownerId}\` || teamFacts.some((row) => row !== null && typeof row === "object" && Array.isArray((row as Record<string, unknown>).authorized_team_ids) && ((row as Record<string, unknown>).authorized_team_ids as unknown[]).includes(teamId));
    if (!exists) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales ownership team is unavailable.");
  }
  return Object.freeze({ ownershipNewOwnerId: ownerId, ownershipTeamCleared: teamId === undefined, ...(teamId === undefined ? {} : { ownershipNewTeamId: teamId }) });
}

export async function workspaceSalesPermissions(payload: Payload, context: KnexRequestContext, signal?: AbortSignal) {
  if (signal?.aborted) return Object.freeze([]);
  const permissions = (await actor(payload, context)).permissions;
  return signal?.aborted ? Object.freeze([]) : permissions;
}

function savedViewMetadataWhere(current: WorkspaceSalesAuthorization) {
  const identity = [{ applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }];
  const personal = { and: [{ ownerId: { equals: current.effectiveActor.id } }, { visibility: { equals: "personal" } }] };
  const team = current.salesScope.authorizedTeamIds.length === 0 ? undefined : { and: [{ visibility: { equals: "team" } }, { visibilityTeamId: { in: current.salesScope.authorizedTeamIds } }] };
  return { and: [...identity, { status: { equals: "active" } }, { or: team === undefined ? [personal] : [personal, team] }] };
}

function recipientOnlyWhere(current: WorkspaceSalesAuthorization) {
  return { and: [{ applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }, { recipientId: { equals: current.effectiveActor.id } }] };
}

const workspaceCurrentSalesPolicy = (permissions: readonly string[], current: WorkspaceSalesAuthorization, plan?: Awaited<ReturnType<typeof resolveSalesSavedViewExecution>>): DataSourcePolicyService => ({
  async authorize(request) {
    const execution = savedViewExecutionSources.has(request.descriptor.id);
    if (!permissions.includes(request.descriptor.permission)) return { sourceAllowed: false, recordScope: undefined, allowedFields: [] };
    const recordScope = execution ? plan?.targetRecordScope
      : request.descriptor.id === "sales.pipeline.snapshot" ? { kind: "sales.pipelines", where: { and: [{ applicationId: { equals: kNexIdentity.applicationId } }, { environment: { equals: kNexIdentity.environment } }] } }
        : request.descriptor.id === "sales.saved-view.list" || request.descriptor.id === "sales.saved-view.detail" ? { kind: "sales.saved-views", where: savedViewMetadataWhere(current) }
          : request.descriptor.id === "sales.notifications" ? { kind: "sales.notifications", where: recipientOnlyWhere(current) }
            : request.descriptor.id === "sales.reminders" ? { kind: "sales.reminders", where: recipientOnlyWhere(current) }
            : request.descriptor.id.startsWith("sales.report.") ? { kind: request.descriptor.id, where: salesRecordWhere(current) }
              : ["sales.opportunities", "sales.opportunity.detail", "sales.tasks", "sales.accounts", "sales.account.detail", "sales.contacts", "sales.contact.detail", "sales.leads", "sales.lead.detail", "sales.timeline"].includes(request.descriptor.id) || dataMovementSources.has(request.descriptor.id) ? { kind: request.descriptor.id, where: salesRecordWhere(current) } : undefined;
    if (recordScope === undefined || execution && (plan?.fieldAuthority === undefined || plan.metadataScope === undefined)) return { sourceAllowed: false, recordScope: undefined, allowedFields: [] };
    const allowedFields: string[] = [];
    const candidates = execution ? plan!.fieldAuthority!.filter(({ select }) => select).map(({ fieldId }) => fieldId) : request.descriptor.outputFields?.map(({ id }) => id) ?? [];
    for (const fieldId of candidates) {
      const field = request.descriptor.outputFields?.find(({ id }) => id === fieldId);
      if (field !== undefined && (execution || permissions.includes(field.permission))) allowedFields.push(fieldId);
    }
    return Object.freeze({ sourceAllowed: true, recordScope, allowedFields: Object.freeze(allowedFields) });
  }
});

function workspaceSalesGateway(payload: Payload, context: KnexRequestContext, permissions: readonly string[], current: ReturnType<typeof authorization>, plan?: Awaited<ReturnType<typeof resolveSalesSavedViewExecution>>, reportingAuthority?: SalesReportingAuthorityFacts): DataSourceGateway {
  return new DataSourceGateway({
    authenticator: new PayloadRequestAuthenticator({
      actor: () => current,
      authorizationContext: () => context,
      requestContext(request) {
        const capability = createPayloadPersistenceCapability(request, [
          { collection: "sales-tasks", operations: ["find"] },
          { collection: "sales-opportunities", operations: ["find"] },
          { collection: "sales-accounts", operations: ["find"] },
          { collection: "sales-contacts", operations: ["find"] },
          { collection: "sales-leads", operations: ["find"] },
          { collection: "sales-activities", operations: ["find"] },
          { collection: "sales-notes", operations: ["find"] },
          { collection: "sales-attachment-references", operations: ["find"] },
          { collection: "sales-notifications", operations: ["find"] },
          { collection: "sales-reminders", operations: ["find"] }
          ,{ collection: "sales-pipelines", operations: ["find"] }
          ,{ collection: "sales-pipeline-stages", operations: ["find"] }
          ,{ collection: "sales-saved-views", operations: ["find"] }
        ], { authorize: ({ collection, operation }) => {
          const permissionId = collection === "sales-tasks" && operation === "find" ? "sales.tasks.read"
            : collection === "sales-opportunities" && operation === "find" ? "sales.opportunities.read"
            : collection === "sales-accounts" && operation === "find" ? "sales.accounts.read"
              : collection === "sales-contacts" && operation === "find" ? "sales.contacts.read"
                : collection === "sales-leads" && operation === "find" ? "sales.leads.read"
                  : collection === "sales-activities" && operation === "find" ? "sales.activities.read"
                    : collection === "sales-notes" && operation === "find" ? "sales.notes.read"
                      : collection === "sales-attachment-references" && operation === "find" ? "sales.attachments.read"
                        : collection === "sales-notifications" && operation === "find" ? "sales.notifications.read"
                          : collection === "sales-reminders" && operation === "find" ? "sales.reminders.read" : undefined;
          const extendedPermissionId = permissionId ?? (collection === "sales-pipelines" || collection === "sales-pipeline-stages" ? "sales.pipelines.read" : collection === "sales-saved-views" ? "sales.saved-views.read" : undefined);
          return extendedPermissionId !== undefined && permissions.includes(extendedPermissionId);
        } });
        const executionAuthority = plan?.metadataScope !== undefined && plan.targetRecordScope !== undefined && plan.fieldAuthority !== undefined
            ? Object.freeze({ metadataScope: plan.metadataScope, targetRecordScope: plan.targetRecordScope, fieldAuthority: plan.fieldAuthority, ...(plan.fence?.reportingTimezone === undefined ? {} : { reportingTimezone: plan.fence.reportingTimezone }) }) : undefined;
        const dataMovement = (request as PayloadRequest & { dataMovement?: GeneratedSalesDataMovementStore }).dataMovement;
        const reporting = createGeneratedSalesReportingGateway(request, Object.freeze({
          context: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId: current.effectiveActor.id }),
          authorizationRevision: current.authorizationRevision, lifecycleRevision: current.lifecycleRevision, scopeRevision: current.salesScope.revision,
          recordScope: current.salesScope.recordScope, applicationWide: current.salesScope.applicationWide, authorizedTeamIds: current.salesScope.authorizedTeamIds,
          runtimeGenerationId: reportingAuthority?.runtimeGenerationId ?? (() => { throw new TypeError("Sales reporting generation is unavailable."); })(),
          permissionGrants: Object.freeze(permissions.filter((permission): permission is "sales.exports.execute" | "sales.reports.read" | "sales.reports.schedule" => permission === "sales.exports.execute" || permission === "sales.reports.read" || permission === "sales.reports.schedule")),
          objectPermissionGrants: reportingAuthority?.objectPermissionGrants ?? (() => { throw new TypeError("Sales reporting authority is unavailable."); })(),
          fieldPermissionGrants: reportingAuthority?.fieldPermissionGrants ?? (() => { throw new TypeError("Sales reporting authority is unavailable."); })()
        }));
        return Object.freeze({ ...capability, applicationIdentity: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }), ...(dataMovement === undefined ? {} : { dataMovement }), reporting, ...(reportingAuthority === undefined ? {} : { reportingAuthority }), ...(executionAuthority === undefined ? {} : { salesSavedViewExecutionAuthority: executionAuthority }) });
      }
    }),
    catalog: { lookup: (sourceId) => sources.get(sourceId) },
    surfaceAudience: new DescriptorSurfaceAudienceGuard(),
    authorization: new PolicyAuthorizationEvaluator(workspaceCurrentSalesPolicy(permissions, current, plan)),
    budget: workspaceSalesBudget,
    dispatcher: new RegisteredHandlerDispatcher(),
    sourceSchema: new DefinitionSourceSchemaValidator(),
    outputContract: new CanonicalOutputContractValidator(),
    redactor: new TableProjectionRedactor(),
    cache: { lookup: () => undefined, store: () => undefined },
    observability: { success() {}, failure() {} },
    problemDetails: new SafeProblemDetailsSerializer()
  });
}

function sourceNodes(document: UiDocument): readonly UiNode[] {
  const result: UiNode[] = [];
  const visit = (node: UiNode) => { result.push(node); node.children?.forEach(visit); };
  Object.values(document.regions).forEach((region) => region.forEach(visit));
  return result;
}

const savedViewExecutionSources = new Set(["sales.saved-view.table", "sales.saved-view.kanban", "sales.saved-view.calendar"]);
const dataMovementSources = new Set(["sales.import-job.list", "sales.import-job.detail", "sales.export-job.list", "sales.export-job.detail", "sales.dedupe.candidates"]);
const salesRecordDetailSources = new Set(["sales.account.detail", "sales.contact.detail", "sales.lead.detail", "sales.opportunity.detail"]);
type SavedViewBindingInput = Readonly<Record<string, never>> | Readonly<{ "saved-view-id": number; "expected-revision": number }>;
type SavedViewOperation = "select" | "filter" | "sort" | "group" | "calendar";
type SavedViewFieldRule = Readonly<{ permission: string; operations: readonly SavedViewOperation[] }>;
type UiSourceInput = NonNullable<NonNullable<UiNode["bindings"]>["source"]>["input"];
const savedViewAuthorityMatrix: Readonly<Record<string, Readonly<{ sourceId: SalesSavedViewSourceId; readPermission: string; fields: Readonly<Record<string, SavedViewFieldRule>> }>>> = Object.freeze({
  "table:sales.object.account": { sourceId: "sales.saved-view.table", readPermission: "sales.accounts.read", fields: { name: { permission: "sales.accounts.read", operations: ["select", "filter", "sort"] }, "owner-id": { permission: "sales.accounts.read", operations: ["select"] }, "team-id": { permission: "sales.accounts.read", operations: ["select"] }, status: { permission: "sales.accounts.read", operations: ["select", "filter", "sort"] }, revision: { permission: "sales.accounts.read", operations: ["select", "filter", "sort"] } } },
  "table:sales.object.contact": { sourceId: "sales.saved-view.table", readPermission: "sales.contacts.read", fields: { "display-name": { permission: "sales.contacts.read", operations: ["select", "filter", "sort"] }, "owner-id": { permission: "sales.contacts.read", operations: ["select"] }, "team-id": { permission: "sales.contacts.read", operations: ["select"] }, "account-id": { permission: "sales.contacts.read", operations: ["select", "filter"] }, status: { permission: "sales.contacts.read", operations: ["select", "filter", "sort"] }, revision: { permission: "sales.contacts.read", operations: ["select", "filter", "sort"] }, email: { permission: "sales.contacts.channels.read", operations: ["select"] }, phone: { permission: "sales.contacts.channels.read", operations: ["select"] } } },
  "table:sales.object.lead": { sourceId: "sales.saved-view.table", readPermission: "sales.leads.read", fields: { "display-name": { permission: "sales.leads.read", operations: ["select", "filter", "sort"] }, "owner-id": { permission: "sales.leads.read", operations: ["select"] }, "team-id": { permission: "sales.leads.read", operations: ["select"] }, status: { permission: "sales.leads.read", operations: ["select", "filter", "sort"] }, "archive-status": { permission: "sales.leads.read", operations: ["select", "filter"] }, revision: { permission: "sales.leads.read", operations: ["select", "filter", "sort"] }, email: { permission: "sales.leads.channels.read", operations: ["select"] }, phone: { permission: "sales.leads.channels.read", operations: ["select"] }, source: { permission: "sales.leads.read", operations: ["select", "filter"] } } },
  "table:sales.object.opportunity": { sourceId: "sales.saved-view.table", readPermission: "sales.opportunities.read", fields: { name: { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] }, "owner-id": { permission: "sales.opportunities.read", operations: ["select"] }, "team-id": { permission: "sales.opportunities.read", operations: ["select"] }, "account-id": { permission: "sales.opportunities.read", operations: ["select"] }, "primary-contact-id": { permission: "sales.opportunities.read", operations: ["select"] }, "pipeline-id": { permission: "sales.opportunities.read", operations: ["select"] }, "stage-id": { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] }, "archive-status": { permission: "sales.opportunities.read", operations: ["select", "filter"] }, "expected-close-date": { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] }, revision: { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] }, amount: { permission: "sales.opportunities.amount.read", operations: ["select"] } } },
  "table:sales.object.task": { sourceId: "sales.saved-view.table", readPermission: "sales.tasks.read", fields: { title: { permission: "sales.tasks.read", operations: ["select", "filter", "sort"] }, "owner-id": { permission: "sales.tasks.read", operations: ["select"] }, "team-id": { permission: "sales.tasks.read", operations: ["select"] }, status: { permission: "sales.tasks.read", operations: ["select", "filter", "sort"] }, "archive-status": { permission: "sales.tasks.read", operations: ["select", "filter"] }, "due-date": { permission: "sales.tasks.read", operations: ["select", "filter", "sort"] }, "related-record-type": { permission: "sales.tasks.read", operations: ["select"] }, "related-record-id": { permission: "sales.tasks.read", operations: ["select"] }, revision: { permission: "sales.tasks.read", operations: ["select", "filter", "sort"] } } },
  "table:sales.object.activity": { sourceId: "sales.saved-view.table", readPermission: "sales.activities.read", fields: { type: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, subject: { permission: "sales.activities.read", operations: ["select"] }, "owner-id": { permission: "sales.activities.read", operations: ["select"] }, "team-id": { permission: "sales.activities.read", operations: ["select"] }, status: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, "scheduled-at": { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, "occurred-at": { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, "related-record-type": { permission: "sales.activities.read", operations: ["select"] }, "related-record-id": { permission: "sales.activities.read", operations: ["select"] }, revision: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] } } },
  "kanban:sales.object.opportunity": { sourceId: "sales.saved-view.kanban", readPermission: "sales.opportunities.read", fields: { "row-kind": { permission: "sales.opportunities.read", operations: ["select"] }, name: { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] }, "stage-id": { permission: "sales.opportunities.read", operations: ["select", "filter", "sort", "group"] }, "stage-metadata": { permission: "sales.opportunities.read", operations: ["select"] }, revision: { permission: "sales.opportunities.read", operations: ["select", "filter", "sort"] } } },
  "calendar:sales.object.activity": { sourceId: "sales.saved-view.calendar", readPermission: "sales.activities.read", fields: { type: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, subject: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, status: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] }, "scheduled-at": { permission: "sales.activities.read", operations: ["select", "filter", "sort", "calendar"] }, "occurred-at": { permission: "sales.activities.read", operations: ["select", "filter", "sort", "calendar"] }, "related-record-type": { permission: "sales.activities.read", operations: ["select"] }, "related-record-id": { permission: "sales.activities.read", operations: ["select"] }, revision: { permission: "sales.activities.read", operations: ["select", "filter", "sort"] } } }
});

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function savedViewBindingInput(value: unknown): SavedViewBindingInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Saved View binding input is invalid.");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join("\\0");
  if (keys === "") return Object.freeze({});
  if (keys !== "expected-revision\\0saved-view-id" || !positiveSafeInteger(input["saved-view-id"]) || !positiveSafeInteger(input["expected-revision"])) throw new TypeError("Saved View binding input is invalid.");
  return Object.freeze({ "saved-view-id": input["saved-view-id"], "expected-revision": input["expected-revision"] });
}

function embeddedSavedViewProps(node: UiNode): Readonly<{ props: UiNode["props"]; input?: SavedViewBindingInput }> {
  const raw = node.props;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Saved View block props are invalid.");
  const props = raw as Record<string, unknown>;
  const pair = positiveSafeInteger(props.savedViewId) && positiveSafeInteger(props.expectedRevision)
    ? Object.freeze({ "saved-view-id": props.savedViewId, "expected-revision": props.expectedRevision }) : undefined;
  if ((props.savedViewId === undefined) !== (props.expectedRevision === undefined) || props.savedViewId !== undefined && pair === undefined) throw new TypeError("Saved View block props are invalid.");
  const remainder = Object.fromEntries(Object.entries(props).filter(([key]) => key !== "savedViewId" && key !== "expectedRevision"));
  const expectedKeys = node.type === "sales.opportunity-kanban" ? "title" : "";
  if (Object.keys(remainder).sort().join("\\0") !== expectedKeys || expectedKeys === "title" && (typeof remainder.title !== "string" || remainder.title.length < 1 || remainder.title.length > 120)) throw new TypeError("Saved View block props are invalid.");
  return Object.freeze({ props: Object.freeze(remainder) as UiNode["props"], ...(pair === undefined ? {} : { input: pair }) });
}

export function admittedWorkspaceSalesDocument(document: UiDocument): UiDocument {
  const rewrite = (node: UiNode): UiNode => {
    const children = node.children?.map(rewrite); const sourceId = node.bindings?.source?.source.id;
    if (sourceId === undefined || !savedViewExecutionSources.has(sourceId)) return { ...node, ...(children === undefined ? {} : { children }) };
    return { ...node, props: embeddedSavedViewProps(node).props, ...(children === undefined ? {} : { children }) };
  };
  return { ...document, regions: Object.fromEntries(Object.entries(document.regions).map(([id, region]) => [id, region.map(rewrite)])) };
}

/** Request-only binding resolution: callers must pass this same document to source loading and rendering. */
export function prepareWorkspaceSalesDocument(document: UiDocument, nativeInput?: SavedViewBindingInput, mode: "table" | "kanban" = "table"): UiDocument {
  const parsedNative = nativeInput === undefined ? undefined : savedViewBindingInput(nativeInput);
  const rewrite = (node: UiNode): UiNode | undefined => {
    if (node.id === "sales-opportunities" && mode === "kanban" || node.id === "sales-opportunity-kanban" && mode === "table") return undefined;
    if ((node.bindings?.action?.id === "sales.saved-view.update" || node.bindings?.action?.id === "sales.saved-view.archive") && parsedNative === undefined) return undefined;
    const children = node.children?.flatMap((child) => { const resolved = rewrite(child); return resolved === undefined ? [] : [resolved]; });
    const sourceId = node.bindings?.source?.source.id;
    if (sourceId === "sales.saved-view.detail") {
      const input = parsedNative === undefined ? {} : { "saved-view-id": parsedNative["saved-view-id"] };
      return { ...node, bindings: { ...node.bindings, source: { ...node.bindings!.source!, input: input as UiSourceInput } }, ...(children === undefined ? {} : { children }) };
    }
    if (sourceId === undefined || !savedViewExecutionSources.has(sourceId)) return { ...node, ...(children === undefined ? {} : { children }) };
    const embedded = embeddedSavedViewProps(node);
    const input = parsedNative ?? embedded.input ?? savedViewBindingInput(node.bindings!.source!.input);
    return { ...node, props: embedded.props, bindings: { ...node.bindings, source: { ...node.bindings!.source!, input: input as UiSourceInput } }, ...(children === undefined ? {} : { children }) };
  };
  const prepared = { ...document, regions: Object.fromEntries(Object.entries(document.regions).map(([id, nodes]) => [id, nodes.flatMap((node) => { const resolved = rewrite(node); return resolved === undefined ? [] : [resolved]; })])) };
  const identify = (node: UiNode): UiNode => ({ ...node, ...(node.type === "sales.pipeline-settings" ? { pipelineIdentity: Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }) } : {}), ...(node.children === undefined ? {} : { children: node.children.map(identify) }) });
  return { ...prepared, regions: Object.fromEntries(Object.entries(prepared.regions).map(([id, nodes]) => [id, nodes.map(identify)])) };
}

type SavedViewQueryClient = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(destroy?: boolean): void }>;
type SavedViewExecutionState = Readonly<{ client: SavedViewQueryClient; current: Awaited<ReturnType<typeof actor>>; persistence: SalesSavedViewExecutionPersistence; plans: ReadonlyMap<string, Awaited<ReturnType<typeof resolveSalesSavedViewExecution>>> }>;
const savedViewExecutionStates = new WeakMap<object, SavedViewExecutionState>();

function persistedSavedView(row: Readonly<Record<string, unknown>> | undefined): SalesPersistedSavedView | undefined {
  if (row === undefined) return undefined;
  if (!positiveSafeInteger(row.id) || !positiveSafeInteger(row.revision) || typeof row.application_id !== "string" || typeof row.environment !== "string" || typeof row.owner_id !== "string" ||
    !["personal", "team"].includes(String(row.visibility)) || row.visibility === "team" && typeof row.visibility_team_id !== "string" || row.visibility === "personal" && row.visibility_team_id !== null ||
    (row.status !== "active" && row.status !== "archived") || row.definition === null || typeof row.definition !== "object" || Array.isArray(row.definition)) throw new TypeError("Sales Saved View row is invalid.");
  return Object.freeze({ id: row.id, revision: row.revision, applicationId: row.application_id, environment: row.environment, ownerId: row.owner_id,
    visibility: row.visibility === "personal" ? Object.freeze({ kind: "personal" as const }) : Object.freeze({ kind: "team" as const, teamId: row.visibility_team_id as string }),
    definition: row.definition as SalesPersistedSavedView["definition"], status: row.status });
}

function savedViewPersistence(client: SavedViewQueryClient, current: WorkspaceSalesAuthorization, permissions: readonly string[]): SalesSavedViewExecutionPersistence {
  const read = async (id: number) => persistedSavedView((await client.query('select id,revision,application_id,environment,owner_id,visibility,visibility_team_id,definition,status from sales_saved_views where id=$1 and application_id=$2 and environment=$3 for share', [id, kNexIdentity.applicationId, kNexIdentity.environment])).rows[0]);
  const targetPermission = (view: SalesPersistedSavedView) => ({
    "sales.object.account": "sales.accounts.read", "sales.object.contact": "sales.contacts.read", "sales.object.lead": "sales.leads.read",
    "sales.object.opportunity": "sales.opportunities.read", "sales.object.task": "sales.tasks.read", "sales.object.activity": "sales.activities.read"
  } as const)[view.definition.targetObjectId];
  const matrix = (view: SalesPersistedSavedView) => savedViewAuthorityMatrix[view.definition.kind + ":" + view.definition.targetObjectId];
  const targetScope = (view: SalesPersistedSavedView) => ({
    kind: ({ "sales.object.account": "sales.accounts", "sales.object.contact": "sales.contacts", "sales.object.lead": "sales.leads", "sales.object.opportunity": "sales.opportunities", "sales.object.task": "sales.tasks", "sales.object.activity": "sales.activities" } as const)[view.definition.targetObjectId],
    where: salesRecordWhere(current)
  });
  const exactFieldAuthority = (view: SalesPersistedSavedView) => {
    const authority = matrix(view);
    if (authority === undefined || authority.sourceId !== view.definition.source.id || authority.readPermission !== targetPermission(view) || !permissions.includes(authority.readPermission)) return [];
    return view.definition.fields.flatMap((fieldId) => { const rule = authority.fields[fieldId]; return rule === undefined || !permissions.includes(rule.permission) ? [] : [{ fieldId, select: rule.operations.includes("select"), filter: rule.operations.includes("filter"), sort: rule.operations.includes("sort") }]; });
  };
  const reportingTimezone = new ApplicationReportingTimezoneResolver(new EffectiveSettingsProvider({
    list: async (applicationId: string, environment: string) => [Object.freeze({ descriptor: systemGeneralSettingsDescriptor, identity: Object.freeze({ applicationId, environment, descriptorId: "system.general", descriptorSchemaVersion: 3, owner: Object.freeze({ kind: "platform" as const, namespace: "system" }) }), lifecycle: "active" as const })]
  }, { read: async (identity) => {
    const state = (await client.query("select settings_revision from k_nex_system_settings_state where application_id=$1 and environment=$2 for share", [identity.applicationId, identity.environment])).rows[0];
    const document = (await client.query("select owner_kind,owner_namespace,owner_delivery_class,owner_extension_id,owner_generation,document_revision,settings_revision,values_json from k_nex_system_settings_documents where application_id=$1 and environment=$2 and descriptor_id='system.general' and descriptor_schema_version=3 and owner_scope_key='platform:system' for share", [identity.applicationId, identity.environment])).rows[0];
    if (!positiveSafeInteger(state?.settings_revision) || document === undefined || document.owner_kind !== "platform" || document.owner_namespace !== "system" || document.owner_delivery_class !== null || document.owner_extension_id !== null || document.owner_generation !== null || !positiveSafeInteger(document.document_revision) || !positiveSafeInteger(document.settings_revision) || document.settings_revision > state.settings_revision || document.values_json === null || typeof document.values_json !== "object" || Array.isArray(document.values_json)) return undefined;
    const parsed = EffectiveSettingsDocumentSchema.safeParse({ schemaVersion: 1, state: "effective", identity, documentRevision: document.document_revision, settingsRevision: document.settings_revision, values: document.values_json });
    if (!parsed.success) return undefined;
    return Object.freeze({ state: Object.freeze({ schemaVersion: 1 as const, applicationId: identity.applicationId, environment: identity.environment, settingsRevision: state.settings_revision }), document: parsed.data });
  } }));
  return Object.freeze({
    lockSavedView: read,
    async resolveDefaultSavedView(sourceId: SalesSavedViewSourceId) {
      const kind = sourceId.slice("sales.saved-view.".length);
      const row = (await client.query("select id,revision,application_id,environment,owner_id,visibility,visibility_team_id,definition,status from sales_saved_views where application_id=$1 and environment=$2 and status='active' and view_kind=$3 and ((owner_id=$4 and visibility='personal') or (visibility='team' and visibility_team_id=any($5::text[]))) order by case when owner_id=$4 and visibility='personal' then 0 else 1 end,id asc limit 1 for share", [kNexIdentity.applicationId, kNexIdentity.environment, kind, current.effectiveActor.id, current.salesScope.authorizedTeamIds])).rows[0];
      return persistedSavedView(row);
    },
    async authorizationRevision() {
      const row = (await client.query("select authorization_revision from k_nex_authorization_state where application_id=$1", [kNexIdentity.applicationId])).rows[0];
      if (!positiveSafeInteger(row?.authorization_revision)) throw new TypeError("Sales authorization revision is invalid.");
      return row.authorization_revision;
    },
    async sourceRevision(sourceId: SalesSavedViewSourceId) {
      const descriptor = sources.get(sourceId)?.definition.descriptor;
      if (descriptor === undefined || !positiveSafeInteger(descriptor.presentationMetadataRevision)) throw new TypeError("Sales source revision is invalid.");
      return descriptor.presentationMetadataRevision;
    },
    async reportingTimezone() {
      const resolved = await reportingTimezone.resolve({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment });
      if (resolved === undefined) throw new TypeError("Sales reporting timezone is unavailable.");
      return resolved;
    },
    authorizeView: async (view: SalesPersistedSavedView) => permissions.includes("sales.saved-views.read") && (view.visibility.kind === "personal" ? view.ownerId === current.effectiveActor.id : current.salesScope.authorizedTeamIds.includes(view.visibility.teamId)),
    authorizeTarget: async (view: SalesPersistedSavedView) => permissions.includes(targetPermission(view)),
    authorizeFields: async (view: SalesPersistedSavedView) => {
      const authority = matrix(view); if (authority === undefined || authority.sourceId !== view.definition.source.id || !permissions.includes(authority.readPermission)) return false;
      const requires = (fieldId: string, operation: SavedViewOperation) => { const rule = authority.fields[fieldId]; return rule !== undefined && rule.operations.includes(operation) && permissions.includes(rule.permission); };
      return view.definition.fields.every((fieldId: string) => requires(fieldId, "select")) && view.definition.filters.every(({ fieldId }: Readonly<{ fieldId: string }>) => requires(fieldId, "filter")) && view.definition.sorts.every(({ fieldId }: Readonly<{ fieldId: string }>) => requires(fieldId, "sort")) &&
        (view.definition.grouping === undefined || requires(view.definition.grouping, "group")) && (view.definition.dateField === undefined || requires(view.definition.dateField, "calendar"));
    },
    targetRecordScope: async (view: SalesPersistedSavedView) => targetScope(view),
    fieldAuthority: async (view: SalesPersistedSavedView) => exactFieldAuthority(view)
  });
}

/** Resolves the management route's canonical personal-first authorized row without persisting selection. */
export async function resolveCanonicalSavedViewBinding(payload: Payload, context: KnexRequestContext): Promise<SavedViewBindingInput> {
  const client = await (payload.db.pool as unknown as { connect(): Promise<SavedViewQueryClient> }).connect();
  try {
    const current = await actor(payload, context);
    const row = (await client.query("select id,revision from sales_saved_views where application_id=$1 and environment=$2 and status='active' and ((owner_id=$3 and visibility='personal') or (visibility='team' and visibility_team_id=any($4::text[]))) order by case when owner_id=$3 and visibility='personal' then 0 else 1 end,id asc limit 1", [kNexIdentity.applicationId, kNexIdentity.environment, current.authorization.effectiveActor.id, current.authorization.salesScope.authorizedTeamIds])).rows[0];
    return row === undefined ? Object.freeze({}) : positiveSafeInteger(row.id) && positiveSafeInteger(row.revision)
      ? Object.freeze({ "saved-view-id": row.id, "expected-revision": row.revision }) : (() => { throw new TypeError("Canonical Saved View identity is invalid."); })();
  } finally { client.release(false); }
}

/** Locks and compiles Saved Views before the normal source gateway sees the request. */
export async function resolveWorkspaceSalesDocument(payload: Payload, context: KnexRequestContext, document: UiDocument, permissions: readonly string[], pageNumber = 1, pageNodeId?: string): Promise<UiDocument> {
  const nodes = sourceNodes(document).filter((node) => savedViewExecutionSources.has(node.bindings?.source?.source.id ?? ""));
  if (nodes.length === 0) return document;
  const client = await (payload.db.pool as unknown as { connect(): Promise<SavedViewQueryClient> }).connect();
  let begun = false;
  try {
    await client.query("begin"); begun = true;
    const current = await actor(payload, context);
    const persistence = savedViewPersistence(client, current.authorization, permissions);
    const plans = new Map<string, Awaited<ReturnType<typeof resolveSalesSavedViewExecution>>>();
    const replacements = new Map<string, UiNode>();
    for (const node of nodes) {
      const binding = node.bindings!.source!; const registeredSourceId = binding.source.id as SalesSavedViewSourceId;
      const parsed = savedViewBindingInput(binding.input); const id = (parsed as { readonly "saved-view-id"?: number })["saved-view-id"];
      const selected = id === undefined ? await persistence.resolveDefaultSavedView(registeredSourceId) : await persistence.lockSavedView(id);
      const sourceId = node.id === "saved-view-table-preview" && selected !== undefined ? selected.definition.source.id : registeredSourceId;
      const descriptor = sources.get(sourceId)?.definition.descriptor;
      if (descriptor === undefined) throw new TypeError("Saved View preview source is unavailable.");
      const selectedFields = selected?.definition.fields ?? binding.selectedFields ?? [];
      const nodePage = pageNodeId === undefined || pageNodeId === node.id ? pageNumber : 1;
      const plan = await resolveSalesSavedViewExecution({ sourceId, bindingInput: parsed, selectedFields, pageNumber: nodePage, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId: current.authorization.effectiveActor.id, persistence });
      plans.set(node.id, plan);
      const preview: Readonly<Partial<UiNode>> = node.id !== "saved-view-table-preview" || selected === undefined ? {} : sourceId === "sales.saved-view.kanban"
        ? { type: "sales.opportunity-kanban", props: { title: "Saved View preview" } }
        : { type: sourceId === "sales.saved-view.calendar" ? "sales.calendar" : "sales.saved-view-table", props: {} };
      const replacement: UiNode = { ...node, ...preview, ...(selected === undefined ? {} : { presentation: JSON.parse(canonicalJson(selected.definition.presentation)) }), bindings: { ...node.bindings, source: { ...binding, source: { id: descriptor.id, version: descriptor.version }, structuralCompatibilityHash: descriptor.structuralCompatibilityHash, input: plan.gatewayInput as UiSourceInput, selectedFields: [...plan.selectedFields] } } };
      replacements.set(node.id, replacement);
    }
    const rewrite = (node: UiNode): UiNode => replacements.get(node.id) ?? { ...node, ...(node.children === undefined ? {} : { children: node.children.map(rewrite) }) };
    const resolved = { ...document, regions: Object.fromEntries(Object.entries(document.regions).map(([id, region]) => [id, region.map(rewrite)])) };
    savedViewExecutionStates.set(resolved, Object.freeze({ client, current, persistence, plans }));
    return resolved;
  } catch (error) {
    let destroy = !begun;
    if (begun) try { await client.query("rollback"); } catch { destroy = true; }
    client.release(destroy); throw error;
  }
}

async function abandonSavedViewExecution(document: UiDocument): Promise<void> {
  const state = savedViewExecutionStates.get(document); if (state === undefined) return;
  let destroy = false; try { await state.client.query("rollback"); } catch { destroy = true; }
  state.client.release(destroy); savedViewExecutionStates.delete(document);
}

function taggedCell(row: Readonly<Record<string, unknown>>, field: string, kind: string): unknown {
  const cell = row[field];
  if (cell === null) return null;
  if (cell === undefined || typeof cell !== "object" || Array.isArray(cell) || (cell as Record<string, unknown>).kind !== kind || Object.keys(cell as Record<string, unknown>).sort().join("\\0") !== "kind\\0value") throw new TypeError("Saved View detail chunk is invalid.");
  return (cell as Record<string, unknown>).value;
}

function unicodeScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

async function validateSavedViewDetail(client: SavedViewQueryClient, current: WorkspaceSalesAuthorization, value: unknown): Promise<void> {
  const expectedFields = ["id", "name", "visibility", "team-id", "chunk-index", "chunk-count", "definition-chunk", "target-object-id", "view-kind", "revision", "status"];
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).sort().join("\\0") !== "fields\\0page\\0rows" || !Array.isArray((value as { rows?: unknown }).rows) ||
    canonicalJson((value as { fields?: unknown }).fields) !== canonicalJson(expectedFields)) throw new TypeError("Saved View detail result is invalid.");
  const page = (value as { page?: unknown }).page;
  if (page === null || typeof page !== "object" || Array.isArray(page) || canonicalJson(page) !== canonicalJson({ number: 1, pageSize: 33, hasNext: false })) throw new TypeError("Saved View detail page is invalid.");
  const rows = (value as { rows: unknown[] }).rows;
  if (rows.length === 0) return;
  if (rows.length > 33 || rows.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) throw new TypeError("Saved View detail chunk is invalid.");
  let identity: string | undefined; const chunks: string[] = [];
  for (const candidate of rows) {
    const row = candidate as { key?: unknown; values?: unknown };
    if (typeof row.key !== "string" || row.values === null || typeof row.values !== "object" || Array.isArray(row.values) || Object.keys(row.values as object).sort().join("\\0") !== [...expectedFields].sort().join("\\0")) throw new TypeError("Saved View detail chunk is invalid.");
    const values = row.values as Record<string, unknown>; const id = taggedCell(values, "id", "integer"); const index = taggedCell(values, "chunk-index", "integer"); const count = taggedCell(values, "chunk-count", "integer"); const chunk = taggedCell(values, "definition-chunk", "text");
    if (!positiveSafeInteger(id) || !Number.isSafeInteger(index) || index !== chunks.length || !positiveSafeInteger(count) || count !== rows.length || typeof chunk !== "string" || !unicodeScalarText(chunk) || [...chunk].length > 512 || Buffer.byteLength(chunk, "utf8") > 512 || row.key !== "saved-view:" + id + ":chunk:" + index) throw new TypeError("Saved View detail chunk is invalid.");
    const metadata = canonicalJson([id, taggedCell(values, "name", "text"), taggedCell(values, "visibility", "enum"), taggedCell(values, "team-id", "text"), taggedCell(values, "target-object-id", "enum"), taggedCell(values, "view-kind", "enum"), taggedCell(values, "revision", "integer"), taggedCell(values, "status", "status"), count]);
    if (identity !== undefined && identity !== metadata) throw new TypeError("Saved View detail chunks are mixed."); identity = metadata; chunks.push(chunk);
  }
  const definitionText = chunks.join("");
  if (Buffer.byteLength(definitionText, "utf8") > 16_384) throw new TypeError("Saved View detail definition is too large.");
  let definition: unknown; try { definition = JSON.parse(definitionText); } catch { throw new TypeError("Saved View detail definition is invalid."); }
  if (canonicalSalesSavedViewJson(definition) !== definitionText) throw new TypeError("Saved View detail definition is not canonical.");
  const first = (rows[0] as { values: Record<string, unknown> }).values; const id = taggedCell(first, "id", "integer") as number; const revision = taggedCell(first, "revision", "integer");
  const trusted = (await client.query("select definition,name,owner_id,visibility,visibility_team_id,target_object_id,view_kind,revision,status from sales_saved_views where id=$1 and application_id=$2 and environment=$3 for share", [id, kNexIdentity.applicationId, kNexIdentity.environment])).rows[0];
  const trustedText = trusted === undefined ? undefined : canonicalSalesSavedViewJson(trusted.definition);
  const authorized = trusted !== undefined && trusted.revision === revision && trusted.status === "active" && trusted.name === taggedCell(first, "name", "text") && trusted.visibility === taggedCell(first, "visibility", "enum") &&
    (trusted.visibility_team_id ?? null) === taggedCell(first, "team-id", "text") && trusted.target_object_id === taggedCell(first, "target-object-id", "enum") && trusted.view_kind === taggedCell(first, "view-kind", "enum") && taggedCell(first, "status", "status") === "active" &&
    trustedText === definitionText && createHash("sha256").update(trustedText).digest("hex") === createHash("sha256").update(definitionText).digest("hex") &&
    (trusted.owner_id === current.effectiveActor.id && trusted.visibility === "personal" || trusted.visibility === "team" && typeof trusted.visibility_team_id === "string" && current.salesScope.authorizedTeamIds.includes(trusted.visibility_team_id));
  if (!authorized) throw new TypeError("Saved View detail authority or digest changed.");
}

export async function loadWorkspaceSalesSources(payload: Payload, context: KnexRequestContext, document: UiDocument, permissions: readonly string[], signal: AbortSignal, routeParams: Readonly<Record<string, string>> = Object.freeze({}), pageNumber = 1, pageNodeId?: string) {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 1_000_000) throw new TypeError("Workspace Sales page is invalid.");
  const output: Record<string, DataSourceBindingResult<unknown>> = {};
  const loaded = new Map<string, DataSourceBindingResult<unknown>>();
  const savedViewState = savedViewExecutionStates.get(document);
  const current = savedViewState?.current ?? await actor(payload, context);
  const movementTransaction = sourceNodes(document).some((node) => dataMovementSources.has(node.bindings?.source?.source.id ?? ""))
    ? createPayloadPersistenceCapability(current.request, [], { authorize: () => false }).transaction
    : undefined;
  await movementTransaction?.begin();
  try {
  for (const node of sourceNodes(document)) {
    const binding = node.bindings?.source;
    if (binding === undefined) continue;
    const source = sources.get(binding.source.id);
    const descriptor = source?.definition.descriptor;
    if (descriptor === undefined || descriptor.version !== binding.source.version || descriptor.structuralCompatibilityHash !== binding.structuralCompatibilityHash) throw new TypeError("Workspace Sales source binding is unavailable.");
    const savedViewPlan = savedViewState?.plans.get(node.id);
    const gateway = workspaceSalesGateway(payload, context, permissions, current.authorization, savedViewPlan, current.reportingAuthority);
    const selectedFields = savedViewPlan?.selectedFields ?? binding.selectedFields ?? descriptor.outputFields?.filter(({ binding }) => binding === "required").map(({ id }) => id) ?? [];
    const detail = salesRecordDetailSources.has(descriptor.id);
    const timeline = descriptor.id === "sales.timeline";
    if ((detail || timeline) && Object.keys(routeParams).sort().join("\\0") !== "id") throw new TypeError("Sales detail route parameters are unavailable.");
    if (!detail && !timeline && Object.keys(routeParams).length !== 0) throw new TypeError("Sales list route parameters are invalid.");
    const sourceInput = savedViewPlan?.gatewayInput ?? (detail ? { id: routeParams.id } : timeline ? (() => {
      const configured = binding.input;
      if (configured === null || typeof configured !== "object" || Array.isArray(configured) || Object.keys(configured).sort().join("\\0") !== "related-record-id\\0related-record-type" ||
        !["sales.account", "sales.contact", "sales.lead", "sales.opportunity"].includes(String((configured as Record<string, unknown>)["related-record-type"]))) throw new TypeError("Sales timeline binding is invalid.");
      return { "related-record-type": (configured as Record<string, unknown>)["related-record-type"], "related-record-id": routeParams.id };
    })() : binding.input);
    const administrationPageSize = descriptor.id === "sales.pipeline.snapshot" ? 6 : descriptor.id === "sales.saved-view.detail" ? 33 : undefined;
    const boundedPageSize = Math.min(administrationPageSize ?? 25, descriptor.limits.maxPageSize);
    const requestedPage = pageNodeId === undefined || pageNodeId === node.id ? pageNumber : 1;
    const sourcePage = timeline ? requestedPage > 4 ? (() => { throw new TypeError("Sales timeline page exceeds its bounded contract."); })() : requestedPage : detail || administrationPageSize !== undefined ? 1 : requestedPage;
    const query = savedViewPlan?.query ?? (descriptor.primaryContract.id === "metric.scalar"
      ? { filters: [], sort: [] }
      : descriptor.paginationModes.includes("cursor")
        ? { cursor: { size: administrationPageSize ?? 100 }, filters: [], sort: [] }
        : { page: { number: sourcePage, size: boundedPageSize }, filters: [], sort: [] });
    const loadKey = canonicalJson({ source: binding.source, sourceInput, selectedFields, query });
    const existing = loaded.get(loadKey);
    if (existing !== undefined) { output[node.id] = existing; continue; }
    if (savedViewPlan?.empty) {
      const page = "page" in query && query.page !== undefined ? query.page : { number: 1, size: 25 };
      const result = { state: "success", data: { fields: [...selectedFields], rows: [], page: { number: page.number, pageSize: page.size, hasNext: false } } } as const;
      loaded.set(loadKey, result); output[node.id] = result; continue;
    }
    const runQuery = () => gateway.query({
      correlationId: context.correlationId,
      rawRequest: current.request,
      sourceId: descriptor.id,
      surface: "workspace",
      input: sourceInput,
      query,
      selectedFields,
      signal
    });
    let ownsReportTransaction = false;
    if (descriptor.id.startsWith("sales.report.")) ownsReportTransaction = await initTransaction(current.request);
    let response: Awaited<ReturnType<DataSourceGateway["query"]>>;
    try {
      response = await runQuery();
      if (ownsReportTransaction) await commitTransaction(current.request);
    } catch (error) {
      if (ownsReportTransaction) await killTransaction(current.request).catch(() => undefined);
      throw error;
    }
    if (response.ok) { if (descriptor.id === "sales.saved-view.detail") { if (savedViewState === undefined) throw new TypeError("Saved View detail transaction is unavailable."); await validateSavedViewDetail(savedViewState.client, current.authorization, response.body.data); } const result = { state: "success", data: response.body.data } as const; loaded.set(loadKey, result); output[node.id] = result; continue; }
    if (response.status === 403) {
      const result = {
        state: response.body.code === "INSUFFICIENT_FIELD_PERMISSION" ? "insufficient-permission" : "forbidden",
        problem: { code: response.body.code, status: 403 }
      } as const;
      loaded.set(loadKey, result); output[node.id] = result;
      continue;
    }
    if (response.status === 429) {
      const result = { state: "rate-limited", problem: { code: response.body.code, status: 429 } } as const;
      loaded.set(loadKey, result); output[node.id] = result;
      continue;
    }
    throw new DataSourceGatewayError(response.body.code, response.status, response.body.title, response.body.detail);
  }
  const finalScope = await readSalesScope(payload, current.authorization.effectiveActor.id);
  if (finalScope.revision !== current.authorization.salesScope.revision) throw new TypeError("Sales current-authority scope changed during projection.");
  if (savedViewState !== undefined) {
    for (const plan of savedViewState.plans.values()) if (plan.fence !== undefined) await recheckSalesSavedViewExecution({ fence: plan.fence, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, persistence: savedViewState.persistence });
    await savedViewState.client.query("commit"); savedViewState.client.release(false); savedViewExecutionStates.delete(document);
  }
  await movementTransaction?.commit();
  return output;
  } catch (error) {
    await movementTransaction?.rollback();
    if (savedViewState !== undefined) { let destroy = false; try { await savedViewState.client.query("rollback"); } catch { destroy = true; } savedViewState.client.release(destroy); savedViewExecutionStates.delete(document); }
    throw error;
  }
}

/** Owns the complete Saved View transaction from resolution through final publication fence. */
export async function projectWorkspaceSalesDocument(payload: Payload, context: KnexRequestContext, persistedDocument: UiDocument, permissions: readonly string[], signal: AbortSignal, routeParams: Readonly<Record<string, string>> = Object.freeze({}), pageNumber = 1, nativeInput?: SavedViewBindingInput, mode: "table" | "kanban" = "table", pageNodeId?: string) {
  let document: UiDocument | undefined; let settled = false;
  try {
    const prepared = prepareWorkspaceSalesDocument(persistedDocument, nativeInput, mode);
    if (pageNodeId !== undefined && !sourceNodes(prepared).some((node) => node.id === pageNodeId && savedViewExecutionSources.has(node.bindings?.source?.source.id ?? ""))) throw new TypeError("Workspace Sales page node is invalid.");
    document = await resolveWorkspaceSalesDocument(payload, context, prepared, permissions, pageNumber, pageNodeId);
    if (signal.aborted) throw signal.reason;
    const sourceResults = await loadWorkspaceSalesSources(payload, context, document, permissions, signal, routeParams, pageNumber, pageNodeId); settled = true;
    return Object.freeze({ document, sourceResults });
  } finally { if (!settled && document !== undefined) await abandonSavedViewExecution(document); }
}

export async function executeWorkspaceSalesAction(payload: Payload, context: KnexRequestContext, action: Readonly<{ id: string; version: number }>, input: unknown, idempotencyKey: string, signal: AbortSignal) {
  const contribution = kNexSalesRegistry.scopedRegistration.contributions.actions.find((entry) => entry.id === action.id)?.value as { readonly descriptor?: { readonly id?: unknown; readonly version?: unknown } } | undefined;
  if (contribution?.descriptor?.id !== action.id || contribution.descriptor.version !== action.version) throw Object.assign(new Error("Workspace Sales action is unavailable."), { code: "NOT_FOUND" });
  let persistence: PayloadPersistenceCapabilityContext | undefined;
  let idempotency: SalesActionIdempotency | undefined;
  let currentAuthorization: ReturnType<typeof authorization> | undefined;
  let actionReportingTimezone: LockedSalesReportingTimezone | undefined;
  const gateway = new RegisteredActionGateway(kNexSalesRegistry.scopedRegistration, {
    async authenticate(request) {
      const current = await actor(payload, context, false, salesActionActorPermissionIds(action.id));
      persistence = salesActionCapability(payload, context, current.request, action.id, current.authorization);
      idempotency = { request: current.request, actionId: action.id, idempotencyKey: request.idempotencyKey ?? "", requestDigest: actionDigest({ actionId: action.id, input: request.input }) };
      currentAuthorization = current.authorization;
      await persistence.transaction.begin();
      await lockSalesPipelineReferences(current.request, action.id, request.input);
      actionReportingTimezone = await lockSalesReportingTimezone(current.request, action.id, request.input);
      return { actor: current.authorization, request: persistence, authorizationContext: Object.freeze({ ...context, actionId: action.id, dataMovement: current.dataMovement, providerGateway: current.providerGateway, reporting: current.reporting, reportingAuthority: current.reportingAuthority }) };
    }
  }, { authorize: async ({ action, input, authenticated }) => {
    if (input === null || typeof input !== "object" || Array.isArray(input) ||
      ["applicationId", "environment", "createdBy", "updatedBy", "revision", "audit", ...(action.descriptor.id === "sales.ownership.assign" ? [] : ["ownerId", "teamId"])].some((key) => key in input)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action facts are forbidden.");
    const actionInput = input as Readonly<Record<string, unknown>>;
    const current = workspaceSalesAuthorization(authenticated.actor);
    const reporting = (authenticated.authorizationContext as { readonly reporting?: GeneratedSalesReportingGateway }).reporting;
    const reportingAuthority = (authenticated.authorizationContext as { readonly reportingAuthority?: SalesReportingAuthorityFacts }).reportingAuthority;
    const dataMovement = action.descriptor.id.startsWith("sales.import.") || action.descriptor.id.startsWith("sales.export.") || action.descriptor.id === "sales.merge.commit"
      ? (authenticated.authorizationContext as { readonly dataMovement?: GeneratedSalesDataMovementStore }).dataMovement : undefined;
    const providerGateway = action.descriptor.id === "sales.email.send" || action.descriptor.id === "sales.calendar.sync" || action.descriptor.id === "sales.integration.configure"
      ? (authenticated.authorizationContext as { readonly providerGateway?: GeneratedSalesProviderGateway }).providerGateway : undefined;
    const actorId = current.effectiveActor.id;
    const capability = authenticated.request as PayloadPersistenceCapabilityContext;
    let resourceId = typeof actionInput.id === "string" ? actionInput.id : undefined;
    let record: { ownerId?: unknown; teamId?: unknown; visibility?: unknown; visibilityTeamId?: unknown; status?: unknown; archiveStatus?: unknown; revision?: unknown; accountId?: unknown; relatedRecordType?: unknown; relatedRecordId?: unknown } | undefined;
    let communicationRelationAdmission: Readonly<Record<string, unknown>> | undefined;
    if (action.descriptor.id === "sales.email.send" || action.descriptor.id === "sales.calendar.sync" || action.descriptor.id === "sales.reminder.schedule") {
      const relation = action.descriptor.id === "sales.email.send"
        ? actionInput.relatedRecordType === "sales.contact" ? { collection: "sales-contacts" as const, recordType: "sales.contact" as const, id: actionInput.relatedRecordId }
          : actionInput.relatedRecordType === "sales.lead" ? { collection: "sales-leads" as const, recordType: "sales.lead" as const, id: actionInput.relatedRecordId } : undefined
        : action.descriptor.id === "sales.calendar.sync"
          ? { collection: "sales-activities" as const, recordType: "sales.activity" as const, id: actionInput.activityId }
          : actionInput.referenceKind === "task" ? { collection: "sales-tasks" as const, recordType: "sales.task" as const, id: actionInput.referenceId }
            : actionInput.referenceKind === "activity" ? { collection: "sales-activities" as const, recordType: "sales.activity" as const, id: actionInput.referenceId } : undefined;
      if (relation === undefined || typeof relation.id !== "string" || await capability.guard({ collection: relation.collection, id: relation.id, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales communication relation is unavailable.");
      record = await salesActionRecord(capability, relation.collection, relation.id, current);
      const expectedRevision = action.descriptor.id === "sales.email.send" ? record.revision : actionInput.expectedRevision;
      const emailActive = relation.recordType === "sales.contact" ? record.status === "active" && record.archiveStatus === undefined
        : relation.recordType === "sales.lead" ? (record.status === "new" || record.status === "working") && record.archiveStatus === "active" : false;
      const referenceActive = relation.recordType === "sales.task" ? record.status === "open" : relation.recordType === "sales.activity" ? record.status === "scheduled" : false;
      if (typeof record.ownerId !== "string" || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1 || expectedRevision !== record.revision || (action.descriptor.id === "sales.email.send" ? !emailActive : !referenceActive)) throw new ActionGatewayError("STALE_RECORD", 409, "Sales communication relation changed before action.");
      resourceId = relation.id;
      communicationRelationAdmission = Object.freeze({ actionId: action.descriptor.id, recordType: relation.recordType, recordId: relation.id, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, revision: record.revision, status: record.status, archiveStatus: relation.recordType === "sales.lead" ? record.archiveStatus : null, ownerId: record.ownerId, teamId: typeof record.teamId === "string" ? record.teamId : null });
    }
    const relatedMutationCollection = action.descriptor.id === "sales.attachment.remove" ? "sales-attachment-references" : action.descriptor.id === "sales.activity.complete" || action.descriptor.id === "sales.activity.cancel" ? "sales-activities" : undefined;
    if (resourceId !== undefined && relatedMutationCollection !== undefined) {
      if (idempotency === undefined) throw new ActionGatewayError("IDEMPOTENCY_KEY_REQUIRED", 400, "Sales action idempotency key is required.");
      const parent = await salesRelatedMutationParent(idempotency.request, relatedMutationCollection, resourceId);
      // Activities inherit a Task's current CRM parent. Attachment references deliberately
      // remain direct-Task resources: their frozen action contract has no parent promotion.
      const authorizedParent = (action.descriptor.id === "sales.activity.complete" || action.descriptor.id === "sales.activity.cancel") && parent.collection === "sales-tasks"
        ? await salesActivityTaskParent(idempotency.request, parent.id)
        : parent;
      if (await capability.guard({ ...authorizedParent, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related mutation target is unavailable.");
      record = await salesActionRecord(capability, authorizedParent.collection, authorizedParent.id, current);
    }
    if (resourceId !== undefined && relatedMutationCollection === undefined && communicationRelationAdmission === undefined) {
      const collection = action.descriptor.id === "sales.task.update" ? "sales-tasks"
        : action.descriptor.id === "sales.activity.complete" || action.descriptor.id === "sales.activity.cancel" ? "sales-activities"
          : action.descriptor.id === "sales.attachment.remove" ? "sales-attachment-references"
        : action.descriptor.id === "sales.ownership.assign" && actionInput.recordType === "sales.account" ? "sales-accounts"
          : action.descriptor.id === "sales.ownership.assign" && actionInput.recordType === "sales.contact" ? "sales-contacts"
            : action.descriptor.id === "sales.ownership.assign" && actionInput.recordType === "sales.lead" ? "sales-leads"
              : action.descriptor.id === "sales.ownership.assign" && actionInput.recordType === "sales.opportunity" ? "sales-opportunities"
        : action.descriptor.id === "sales.notification.read" || action.descriptor.id === "sales.notification.archive" ? "sales-notifications"
          : action.descriptor.id === "sales.reminder.dismiss" ? "sales-reminders"
        : action.descriptor.id.startsWith("sales.account.") ? "sales-accounts"
          : action.descriptor.id.startsWith("sales.contact.") ? "sales-contacts"
            : action.descriptor.id.startsWith("sales.lead.") ? "sales-leads"
               : action.descriptor.id.startsWith("sales.opportunity.") ? "sales-opportunities"
                 : action.descriptor.id.startsWith("sales.pipeline.") ? "sales-pipelines"
                   : action.descriptor.id.startsWith("sales.saved-view.") ? "sales-saved-views" : undefined;
      if (collection === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action target is unavailable.");
      if (await capability.guard({ collection, id: resourceId, operation: "update" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action target is unavailable.");
      record = await salesActionRecord(capability, collection, resourceId, current);
    }
    if (resourceId === undefined && (action.descriptor.id === "sales.activity.create" || action.descriptor.id === "sales.note.create" || action.descriptor.id === "sales.attachment.link")) {
      const relatedType = actionInput.relatedRecordType;
      const relatedId = actionInput.relatedRecordId;
      const collection = relatedType === "sales.account" ? "sales-accounts" : relatedType === "sales.contact" ? "sales-contacts"
        : relatedType === "sales.lead" ? "sales-leads" : relatedType === "sales.opportunity" ? "sales-opportunities"
          : relatedType === "sales.task" ? "sales-tasks" : undefined;
      if (collection === undefined || typeof relatedId !== "string") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related action target is unavailable.");
      const parent = action.descriptor.id === "sales.activity.create" && collection === "sales-tasks" ? await salesActivityTaskParent(idempotency!.request, relatedId) : undefined;
      if (parent !== undefined) {
        if (await capability.guard({ ...parent, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related action target is unavailable.");
        resourceId = parent.id;
        record = await salesActionRecord(capability, parent.collection, parent.id, current);
      } else {
        if (await capability.guard({ collection, id: relatedId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related action target is unavailable.");
        resourceId = relatedId;
        record = await salesActionRecord(capability, collection, resourceId, current);
      }
    }
    if (resourceId === undefined && (action.descriptor.id === "sales.contact.create" || action.descriptor.id === "sales.opportunity.create")) {
      const accountId = actionInput.accountId;
      if (typeof accountId !== "string" || await capability.guard({ collection: "sales-accounts", id: accountId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales related account is unavailable.");
      resourceId = accountId;
      record = await salesActionRecord(capability, "sales-accounts", resourceId, current);
    }
    if (!await allowed(payload, context, action.descriptor.permission, resourceId, record, undefined, current)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Current authority does not permit this action.");
    if ((action.descriptor.id === "sales.opportunity.create" && typeof actionInput.primaryContactId === "string") || (action.descriptor.id === "sales.opportunity.update" && actionInput.primaryContactMode === "set" && typeof actionInput.primaryContactId === "string")) {
      const contactId = actionInput.primaryContactId as string;
      if (await capability.guard({ collection: "sales-contacts", id: contactId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity contact is unavailable.");
      const contact = await salesActionRecord(capability, "sales-contacts", contactId, current);
      const accountId = action.descriptor.id === "sales.opportunity.create" ? actionInput.accountId : record?.accountId;
      if (contact.status !== "active" || contact.archiveStatus === "archived" || typeof accountId !== "string" && typeof accountId !== "number" || String(contact.accountId) !== String(accountId)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales opportunity contact is unavailable.");
    }
    let noteReplacementAdmission: Readonly<Record<string, unknown>> | undefined;
    if (action.descriptor.id === "sales.note.create" && typeof actionInput.replacesNoteId === "string") {
      const predecessor = await salesNoteReplacementIdentity(idempotency!.request, actionInput.replacesNoteId);
      if (predecessor === undefined || predecessor.status !== "recorded" || predecessor.relatedRecordType !== actionInput.relatedRecordType || String(predecessor.relatedRecordId) !== actionInput.relatedRecordId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales replaced note is unavailable.");
      noteReplacementAdmission = Object.freeze({ recordId: actionInput.replacesNoteId, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, relatedRecordType: actionInput.relatedRecordType, relatedRecordId: actionInput.relatedRecordId });
    }
    const protectedFieldRequests = action.descriptor.id.startsWith("sales.contact.") || action.descriptor.id.startsWith("sales.lead.")
      ? ["email", "phone"].filter((fieldId) => action.descriptor.id.endsWith(".update") ? actionInput[\`\${fieldId}Mode\`] !== "retain" : actionInput[fieldId] !== undefined).map((fieldId) => Object.freeze({ fieldId: fieldId as "email" | "phone", permissionId: action.descriptor.id.startsWith("sales.contact.") ? "sales.contacts.channels.read" as const : "sales.leads.channels.read" as const }))
      : action.descriptor.id === "sales.opportunity.create" && actionInput.amount !== undefined || action.descriptor.id === "sales.opportunity.update" && actionInput.amountMode !== "retain"
        ? [Object.freeze({ fieldId: "amount" as const, permissionId: "sales.opportunities.amount.read" as const })] : [];
    for (const admission of protectedFieldRequests) {
      const create = action.descriptor.id.endsWith(".create");
      if (!await allowed(payload, context, admission.permissionId, create ? undefined : resourceId, create ? undefined : record, signal, current)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales protected field is unavailable.");
    }
    if (idempotency === undefined || currentAuthorization === undefined || idempotency.idempotencyKey.length === 0) throw new ActionGatewayError("IDEMPOTENCY_KEY_REQUIRED", 400, "Sales action idempotency key is required.");
    if (!await currentSalesAuthorityFence(idempotency.request, currentAuthorization)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales action authority changed.");
    const ownership = action.descriptor.id === "sales.ownership.assign" ? await salesOwnershipAdmission(idempotency.request, current, actionInput) : undefined;
    const linkedRecordAdmissions: Array<Readonly<{ recordType: "sales.account" | "sales.contact"; recordId: string; applicationId: string; environment: string }>> = [];
    if (action.descriptor.id === "sales.lead.qualify" && actionInput.accountMode === "link") {
      const accountId = actionInput.accountId;
      if (typeof accountId !== "string" || await capability.guard({ collection: "sales-accounts", id: accountId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked account is unavailable.");
      const account = await salesActionRecord(capability, "sales-accounts", accountId, current);
      if (account.status !== "active" || account.archiveStatus === "archived") throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked account is unavailable.");
      linkedRecordAdmissions.push(Object.freeze({ recordType: "sales.account", recordId: accountId, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }));
    }
    if (action.descriptor.id === "sales.lead.qualify" && actionInput.contactMode === "link") {
      const contactId = actionInput.contactId; const accountId = actionInput.accountId;
      if (typeof contactId !== "string" || typeof accountId !== "string" || await capability.guard({ collection: "sales-contacts", id: contactId, operation: "find" }) !== true) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked contact is unavailable.");
      const contact = await salesActionRecord(capability, "sales-contacts", contactId, current);
      if (contact.status !== "active" || contact.archiveStatus === "archived" || String(contact.accountId) !== accountId) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales linked contact is unavailable.");
      linkedRecordAdmissions.push(Object.freeze({ recordType: "sales.contact", recordId: contactId, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment }));
    }
    const topLevelOwnedCreate = action.descriptor.id === "sales.account.create" || action.descriptor.id === "sales.lead.create";
    const personalTeam = "team:" + actorId;
    if (topLevelOwnedCreate && !current.salesScope.applicationWide && !current.salesScope.authorizedTeamIds.includes(personalTeam)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Personal Sales team is outside current scope.");
    const savedViewAction = action.descriptor.id === "sales.saved-view.create" || action.descriptor.id === "sales.saved-view.update" || action.descriptor.id === "sales.saved-view.archive";
    if (savedViewAction && !await lockCurrentSalesMutationScope(idempotency!.request, current)) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales Saved View authority changed.");
    const savedViewCurrent = (action.descriptor.id === "sales.saved-view.update" || action.descriptor.id === "sales.saved-view.archive") && typeof record?.ownerId === "string" && (record.visibility === "personal" || record.visibility === "team") && (record.visibility === "personal" ? record.visibilityTeamId === null : typeof record.visibilityTeamId === "string")
      ? Object.freeze({ ownerId: record.ownerId, visibility: record.visibility, visibilityTeamId: record.visibilityTeamId as string | null }) : undefined;
    const destinationVisibility = actionInput.visibility !== null && typeof actionInput.visibility === "object" && !Array.isArray(actionInput.visibility) ? actionInput.visibility as Readonly<Record<string, unknown>> : undefined;
    const destinationKind = destinationVisibility?.kind;
    const destinationTeamId = destinationVisibility?.teamId;
    const savedViewDestination = (action.descriptor.id === "sales.saved-view.create" || action.descriptor.id === "sales.saved-view.update") && (destinationKind === "personal" || destinationKind === "team") && (destinationKind === "personal" ? Object.keys(destinationVisibility!).length === 1 : Object.keys(destinationVisibility!).sort().join("\\0") === "kind\\0teamId" && typeof destinationTeamId === "string" && current.salesScope.authorizedTeamIds.includes(destinationTeamId))
      ? Object.freeze({ ownerId: savedViewCurrent?.ownerId ?? actorId, visibility: destinationKind, visibilityTeamId: destinationKind === "team" ? destinationTeamId as string : null }) : undefined;
    if ((action.descriptor.id === "sales.saved-view.update" || action.descriptor.id === "sales.saved-view.archive") && savedViewCurrent === undefined || (action.descriptor.id === "sales.saved-view.create" || action.descriptor.id === "sales.saved-view.update") && savedViewDestination === undefined) throw new ActionGatewayError("ACTION_FORBIDDEN", 403, "Sales Saved View authority is unavailable.");
    const replay = await reserveSalesActionIdempotency(idempotency, currentAuthorization);
    return Object.freeze({ actionId: action.descriptor.id, applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment, actorId,
      authorizationRevision: current.authorizationRevision,
      lifecycleRevision: current.lifecycleRevision,
      salesScopeRevision: current.salesScope.revision,
      ...(dataMovement === undefined ? {} : { dataMovement }),
      ...(providerGateway === undefined ? {} : { providerGateway }),
      ...(reporting === undefined ? {} : { reporting }),
      ...(reportingAuthority === undefined ? {} : { reportingAuthority }),
      ...(communicationRelationAdmission === undefined ? {} : { communicationRelationAdmission }),
      ownerId: typeof record?.ownerId === "string" ? record.ownerId : actorId,
      ...(typeof record?.teamId === "string" ? { teamId: record.teamId } : topLevelOwnedCreate ? { teamId: personalTeam } : {}),
      ...(action.descriptor.id === "sales.attachment.link" ? { resolveAttachmentUpload: (upload: Readonly<{ applicationId: string; environmentId: string; actorId: string; storageRef: string }>) => resolveSalesAttachmentUpload(idempotency!.request, current, upload) } : {}),
      ...(noteReplacementAdmission === undefined ? {} : { noteReplacementAdmission }),
      ...(ownership ?? {}),
      ...(linkedRecordAdmissions.length === 0 ? {} : { linkedRecordAdmissions: Object.freeze(linkedRecordAdmissions) }),
      ...(protectedFieldRequests.length === 0 ? {} : { protectedFieldAdmissions: Object.freeze(protectedFieldRequests) }),
      ...(savedViewCurrent === undefined ? {} : { savedViewCurrent }),
      ...(savedViewDestination === undefined ? {} : { savedViewDestination }),
      ...(actionReportingTimezone === undefined ? {} : { reportingTimezone: actionReportingTimezone }),
      ...(actionReportingTimezone === undefined ? {} : { recheckReportingTimezone: () => lockSalesReportingTimezone(idempotency!.request, action.descriptor.id, actionInput) }),
      ...(resourceId === undefined ? {} : { resourceId }),
      eventId: salesActionEventId(currentAuthorization, action.descriptor.id, idempotency.idempotencyKey, idempotency.requestDigest),
      ...(replay === undefined ? {} : { idempotencyReplay: replay }) });
        }});
  try {
    const response = await gateway.execute({ correlationId: context.correlationId, rawRequest: Object.freeze({}), actionId: action.id, input, idempotencyKey, signal });
    if (response.ok && idempotency !== undefined && currentAuthorization !== undefined && idempotency.replay === undefined) await completeSalesActionIdempotency(idempotency, currentAuthorization, response.body.data);
    if (response.ok) await persistence?.transaction.commit();
    else await persistence?.transaction.rollback();
    return response;
  } catch (error) {
    await persistence?.transaction.rollback();
    throw error;
  }
}
`;
}

function workspacePageHttpTailSource(): string {
  return `export async function openWorkspaceJson(request: Request, boundary: string) {
  if (request.headers.get("origin") !== kNexIdentity.publicOrigin.origin) throw new TypeError("Workspace JSON origin is invalid.");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) throw new TypeError("Workspace JSON content type is invalid.");
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 1_048_576) throw new TypeError("Workspace JSON body is too large.");
  const source = await request.text();
  if (Buffer.byteLength(source) > 1_048_576) throw new TypeError("Workspace JSON body is too large.");
  const payload = await bootKnexApplication("workspace-web");
  const context = kNexRequestContext(new Headers(request.headers), boundary);
  return Object.freeze({ payload, context, body: JSON.parse(source) as unknown });
}

export function exactFields(form: FormData, allowed: readonly string[], optional: readonly string[] = []): void {
  const names = [...new Set([...form.keys()])].sort();
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  if (names.some((name) => !allowedSet.has(name)) || allowed.some((name) => !optionalSet.has(name) && !names.includes(name))) throw new TypeError("Workspace form fields are invalid.");
}

export function textField(form: FormData, name: string, minimum: number, maximum: number): string {
  const value = form.get(name);
  if (typeof value !== "string" || value !== value.trim() || value.length < minimum || value.length > maximum || /[\\u0000-\\u001f\\u007f-\\u009f]/u.test(value)) throw new TypeError("Workspace text field is invalid.");
  return value;
}

export function optionalTextField(form: FormData, name: string, maximum: number): string | undefined {
  const value = form.get(name);
  if (value === "") return undefined;
  return textField(form, name, 1, maximum);
}

export function integerField(form: FormData, name: string, minimum: number, maximum: number): number {
  const value = form.get(name);
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError("Workspace integer field is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new TypeError("Workspace integer field is out of range.");
  return parsed;
}

export function idempotencyField(form: FormData): string {
  const value = form.get("idempotencyKey");
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value)) throw new TypeError("Workspace idempotency key is invalid.");
  return value;
}

export function workspaceRedirect(path: string): Response {
  return Response.redirect(new URL(path, kNexIdentity.publicOrigin), 303);
}

export function workspaceMutationError(error: unknown): Response {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "INVALID_INPUT";
  const status = code === "NOT_FOUND" ? 404 : code === "ACCESS_DENIED" ? 403 : code === "REVISION_CONFLICT" || code === "STALE_RECORD" ? 409 : 400;
  return Response.json({ code }, { status, headers: { "cache-control": "no-store" } });
}
`;
}

function workspacePageListSource(): string {
  return `import { randomUUID } from "node:crypto";
import { SystemWorkspacePagesPage } from "@k-nex/ui-pages";
import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { authorizeRequest, kNexRequestContext } from "../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../boot.js";
import { listPageThemeOverrides } from "../../../../k-nex-theme-runtime.js";
import { kNexWorkspacePages, kNexWorkspacePageScope } from "../../../../k-nex-workspace-pages.js";

export const dynamic = "force-dynamic";

export default async function WorkspacePagesAdministration() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "workspace-pages-admin");
  const themeOptions = await listPageThemeOverrides(payload);
  const runtime = kNexWorkspacePages(payload);
  let pages;
  try { pages = await runtime.service.list(context, kNexWorkspacePageScope); } catch { return notFound(); }
  const folders = await runtime.folders.list(kNexWorkspacePageScope);
  const [canCreate, canEdit] = await Promise.all([
    authorizeRequest(payload, context, "system.workspace-pages.create", "system.workspace-pages"),
    authorizeRequest(payload, context, "system.workspace-pages.edit", "system.workspace-pages")
  ]);
  const parents = [{ value: "sales.navigation.root", label: "Sales" }, ...folders.map(({ node }) => ({ value: node.id, label: node.label }))];
  const idempotency = () => \`workspace-admin-\${randomUUID()}\`;
  return <SystemWorkspacePagesPage view={{
    title: "Workspace pages",
    navigation: [{ id: "workspace-pages", label: "Workspace pages", href: "/system/workspace-pages" }],
    description: "Create, place, theme, authorize, inspect, and archive customer pages.",
    folders: folders.map(({ node, revision }) => ({
      id: node.id, label: node.label, parent: node.parentId ?? "Workspace", order: String(node.order), revision: String(revision),
      ...(canEdit ? { update: { label: "Update folder", form: { actionUrl: \`/api/k-nex/workspace-folders/\${encodeURIComponent(node.id)}\`, hiddenFields: [{ name: "expectedRevision", value: String(revision) }], inputs: [
        { name: "label", label: "Folder name", type: "text", value: node.label },
        { name: "parentNavigationId", label: "Parent", type: "select", value: node.parentId ?? "sales.navigation.root", options: parents.filter(({ value }) => value !== node.id) },
        { name: "order", label: "Order", type: "number", value: node.order, min: 0, max: 1_000_000 }
      ] } } } : {})
    })),
    pages: pages.map(({ page, impact }) => ({ id: page.identity.pageId, title: page.title, href: \`/system/workspace-pages/\${encodeURIComponent(page.identity.pageId)}\`, state: page.state, placement: page.navigation.state === "placed" ? \`\${page.navigation.parentNavigationId} / \${page.navigation.order}\` : \`unplaced / \${page.navigation.reason}\`, theme: page.themeProfile === undefined ? "application default" : \`\${page.themeProfile.profileId}@\${page.themeProfile.revisionId}\`, impact: impact.code ?? impact.state, revision: \`\${page.revision}/\${page.workingCopyRevision}/\${page.accessRevision}\` })),
    ...(canCreate ? { create: { label: "Create page", form: { actionUrl: "/api/k-nex/workspace-pages", hiddenFields: [{ name: "idempotencyKey", value: idempotency() }], inputs: [
      { name: "title", label: "Title", type: "text" }, { name: "description", label: "Description", type: "text" },
      { name: "parentNavigationId", label: "Placement", type: "select", value: "sales.navigation.root", options: parents },
      { name: "order", label: "Order", type: "number", value: 100, min: 0, max: 1_000_000 },
      { name: "themeRevision", label: "Theme Profile", type: "select", value: "", options: [{ value: "", label: "Application default" }, ...themeOptions] }
    ] } } } : {}),
    ...(canEdit ? { createFolder: { label: "Create folder", form: { actionUrl: "/api/k-nex/workspace-folders", hiddenFields: [{ name: "idempotencyKey", value: idempotency() }], inputs: [
      { name: "label", label: "Folder name", type: "text" }, { name: "parentNavigationId", label: "Parent", type: "select", value: "sales.navigation.root", options: parents },
      { name: "order", label: "Order", type: "number", value: 100, min: 0, max: 1_000_000 }
    ] } } } : {})
  }} />;
}
`;
}

function workspacePageDetailSource(): string {
  return `import { randomUUID } from "node:crypto";
import { SystemWorkspacePageDetailPage } from "@k-nex/ui-pages";
import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { authorizeRequest, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../../boot.js";
import { listPageThemeOverrides } from "../../../../../k-nex-theme-runtime.js";
import { kNexWorkspacePages, kNexWorkspacePageScope, loadWorkspacePageAccessSubjects } from "../../../../../k-nex-workspace-pages.js";

export const dynamic = "force-dynamic";

export default async function WorkspacePageAdministration({ params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "workspace-page-admin");
  const pageId = (await params).pageId;
  const themeOptions = await listPageThemeOverrides(payload);
  const runtime = kNexWorkspacePages(payload);
  let detail;
  try { detail = await runtime.service.detail(context, kNexWorkspacePageScope, pageId, "edit"); } catch { return notFound(); }
  const [folders, audit, canPublish] = await Promise.all([
    runtime.folders.list(kNexWorkspacePageScope), runtime.service.audit(context, kNexWorkspacePageScope, pageId, 100),
    authorizeRequest(payload, context, "system.workspace-pages.publish", "system.workspace-pages")
  ]);
  const subjects = await loadWorkspacePageAccessSubjects(payload, context).catch(() => undefined);
  const canManageAccess = subjects !== undefined;
  const access = canManageAccess ? await runtime.service.readAccess(context, kNexWorkspacePageScope, pageId) : undefined;
  const parents = [{ value: "sales.navigation.root", label: "Sales" }, ...folders.map(({ node }) => ({ value: node.id, label: node.label }))];
  const assignments = access?.assignments ?? [];
  const selected = (kind: "role" | "user", id: string, capability: "view" | "edit") => assignments.some((assignment) => assignment.capability === capability && (assignment.subject.kind === "role" ? kind === "role" && assignment.subject.roleId === id : kind === "user" && assignment.subject.userId === id));
  const options = [
    ...(subjects?.roles ?? []).flatMap((role) => (["view", "edit"] as const).map((capability) => ({ value: \`role|\${role.id}|\${capability}\`, label: \`Role: \${role.label} — \${capability}\`, selected: selected("role", role.id, capability) }))),
    ...(subjects?.users ?? []).flatMap((user) => (["view", "edit"] as const).map((capability) => ({ value: \`user|\${user.id}|\${capability}\`, label: \`User: \${user.displayEmail} — \${capability}\`, selected: selected("user", user.id, capability) })))
  ];
  const idempotency = () => \`workspace-admin-\${randomUUID()}\`;
  const page = detail.page;
  return <SystemWorkspacePageDetailPage view={{
    title: "Workspace page", pageId, pageTitle: page.title, pageState: page.state,
    navigation: [{ id: "workspace-pages", label: "Workspace pages", href: "/system/workspace-pages" }],
    placement: page.navigation.state === "placed" ? \`\${page.navigation.parentNavigationId} / \${page.navigation.order}\` : \`unplaced / \${page.navigation.reason}\`,
    theme: page.themeProfile === undefined ? "application default" : \`\${page.themeProfile.profileId}@\${page.themeProfile.revisionId}\`, impact: detail.impact.code ?? detail.impact.state,
    ...(page.state === "published" && detail.impact.state === "ready" ? { viewHref: \`/workspace/pages/\${encodeURIComponent(pageId)}\` } : {}),
    editorHref: \`/workspace/pages/\${encodeURIComponent(pageId)}/edit\`,
    access: assignments.map((assignment) => ({ subject: assignment.subject.kind === "role" ? \`role:\${assignment.subject.roleId}\` : \`user:\${assignment.subject.userId}\`, capability: assignment.capability })),
    audit: audit.map((event) => ({ id: event.auditId, operation: event.operation, actor: \`\${event.actor.kind}:\${event.actor.id}\`, revision: \`\${event.pageRevision}/\${event.workingCopyRevision}/\${event.accessRevision}\`, occurredAt: event.occurredAt })),
    saveMetadata: { label: "Save metadata", form: { actionUrl: \`/api/k-nex/workspace-pages/\${encodeURIComponent(pageId)}/metadata\`, hiddenFields: [{ name: "expectedRevision", value: String(page.revision) }, { name: "idempotencyKey", value: idempotency() }], inputs: [
      { name: "title", label: "Title", type: "text", value: page.title }, { name: "description", label: "Description", type: "text", value: page.description ?? "" },
      { name: "parentNavigationId", label: "Placement", type: "select", value: page.navigation.state === "placed" ? page.navigation.parentNavigationId : "sales.navigation.root", options: parents },
      { name: "order", label: "Order", type: "number", value: page.navigation.state === "placed" ? page.navigation.order : 100, min: 0, max: 1_000_000 },
      { name: "themeRevision", label: "Theme Profile", type: "select", value: page.themeProfile === undefined ? "" : page.themeProfile.profileId + "|" + page.themeProfile.revisionId, options: [{ value: "", label: "Application default" }, ...themeOptions] }
    ] } },
    ...(canManageAccess && access ? { replaceAccess: { label: "Replace access", form: { actionUrl: \`/api/k-nex/workspace-pages/\${encodeURIComponent(pageId)}/access\`, hiddenFields: [{ name: "expectedPageRevision", value: String(page.revision) }, { name: "expectedAccessRevision", value: String(access.accessRevision) }, { name: "idempotencyKey", value: idempotency() }], selection: { name: "assignment", label: "Role and user page access", options } } } } : {}),
    archive: { label: "Archive page", confirmation: { title: \`Archive \${page.title}\`, description: "The page leaves navigation but retains publication and audit history.", confirmLabel: "Archive" }, form: { actionUrl: \`/api/k-nex/workspace-pages/\${encodeURIComponent(pageId)}/archive\`, hiddenFields: [{ name: "expectedRevision", value: String(page.revision) }, { name: "idempotencyKey", value: idempotency() }] } },
    revision: \`\${page.revision}/\${page.workingCopyRevision}/\${page.accessRevision}\`,
    description: canPublish ? "Publishing is available in the page editor." : "Current authority may edit but cannot publish."
  }} />;
}
`;
}

function workspacePageCreateRouteSource(): string {
  return `import { kNexWorkspacePages, kNexWorkspacePageScope } from "../../../../k-nex-workspace-pages.js";
import { exactFields, idempotencyField, integerField, openWorkspaceForm, optionalTextField, textField, workspaceMutationError, workspaceRedirect } from "../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "workspace-page-create");
    exactFields(form, ["description", "idempotencyKey", "order", "parentNavigationId", "themeRevision", "title"]);
    const created = await kNexWorkspacePages(payload).service.create(context, kNexWorkspacePageScope, {
      title: textField(form, "title", 1, 120),
      ...(optionalTextField(form, "description", 320) === undefined ? {} : { description: optionalTextField(form, "description", 320) }),
      placementSelection: { parentNavigationId: textField(form, "parentNavigationId", 1, 128), order: integerField(form, "order", 0, 1_000_000) },
      themeSelection: form.get("themeRevision"), regions: { main: [] }, idempotencyKey: idempotencyField(form)
    });
    return workspaceRedirect(\`/system/workspace-pages/\${encodeURIComponent(created.page.identity.pageId)}\`);
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function workspacePageMutationRouteSource(): string {
  return `import { kNexWorkspacePages, kNexWorkspacePageScope, loadWorkspacePageAccessSubjects, openWorkspacePageSession } from "../../../../../../k-nex-workspace-pages.js";
import { exactFields, idempotencyField, integerField, openWorkspaceForm, openWorkspaceJson, optionalTextField, textField, workspaceMutationError, workspaceRedirect } from "../../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ pageId: string; operation: string }> }>) {
  try {
    const { pageId, operation } = await params;
    if (!["metadata", "access", "archive", "autosave", "publish", "rollback"].includes(operation)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (["autosave", "publish", "rollback"].includes(operation)) {
      const { payload, context, body } = await openWorkspaceJson(request, \`workspace-page-\${operation}\`);
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new TypeError("Workspace JSON body is invalid.");
      const value = body as Record<string, unknown>;
      const keys = Object.keys(value).sort().join("\\0");
      const service = kNexWorkspacePages(payload).service;
      if (operation === "autosave") {
        if (keys !== "document\\0editorSessionId\\0expectedRevision\\0idempotencyKey") throw new TypeError("Workspace autosave fields are invalid.");
        const session = await openWorkspacePageSession(payload, context, pageId, "edit", context.correlationId);
        try {
          const saved = await service.autosave(context, kNexWorkspacePageScope, pageId, value, session.signal);
          return Response.json({ status: "saved", workingCopy: { revision: saved.revision, document: saved.document } }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "REVISION_CONFLICT") {
            const detail = await service.detail(context, kNexWorkspacePageScope, pageId, "edit", session.signal);
            return Response.json({ status: "conflict", workingCopy: { revision: detail.workingCopy!.revision, document: detail.workingCopy!.document } }, { status: 409, headers: { "cache-control": "no-store" } });
          }
          throw error;
        } finally { session.close(); }
      }
      if (operation === "publish") {
        if (keys !== "idempotencyKey\\0workingCopyRevision" || !Number.isSafeInteger(value.workingCopyRevision) || typeof value.idempotencyKey !== "string") throw new TypeError("Workspace publish fields are invalid.");
        const session = await openWorkspacePageSession(payload, context, pageId, "edit", context.correlationId);
        try {
          const receipt = await service.publish(context, kNexWorkspacePageScope, pageId, { workingCopyRevision: value.workingCopyRevision as number, idempotencyKey: value.idempotencyKey }, session.signal);
          return Response.json({ receipt }, { headers: { "cache-control": "no-store" } });
        } finally { session.close(); }
      }
      if (keys !== "idempotencyKey\\0revisionId" || typeof value.revisionId !== "string" || typeof value.idempotencyKey !== "string") throw new TypeError("Workspace rollback fields are invalid.");
      const session = await openWorkspacePageSession(payload, context, pageId, "edit", context.correlationId);
      try {
        const receipt = await service.rollback(context, kNexWorkspacePageScope, pageId, value.revisionId, value.idempotencyKey, session.signal);
        return Response.json({ receipt }, { headers: { "cache-control": "no-store" } });
      } finally { session.close(); }
    }
    const { payload, context, form } = await openWorkspaceForm(request, \`workspace-page-\${operation}\`);
    const service = kNexWorkspacePages(payload).service;
    const session = await openWorkspacePageSession(payload, context, pageId, "edit", context.correlationId);
    try {
    if (operation === "metadata") {
      exactFields(form, ["description", "expectedRevision", "idempotencyKey", "order", "parentNavigationId", "themeRevision", "title"]);
      await service.updateMetadata(context, kNexWorkspacePageScope, pageId, {
        expectedRevision: integerField(form, "expectedRevision", 1, 1_000_000_000), title: textField(form, "title", 1, 120),
        ...(optionalTextField(form, "description", 320) === undefined ? {} : { description: optionalTextField(form, "description", 320) }),
        placementSelection: { parentNavigationId: textField(form, "parentNavigationId", 1, 128), order: integerField(form, "order", 0, 1_000_000) },
        themeSelection: form.get("themeRevision"), idempotencyKey: idempotencyField(form)
      }, session.signal);
    } else if (operation === "archive") {
      exactFields(form, ["expectedRevision", "idempotencyKey"]);
      await service.archive(context, kNexWorkspacePageScope, pageId, integerField(form, "expectedRevision", 1, 1_000_000_000), idempotencyField(form), session.signal);
      return workspaceRedirect("/system/workspace-pages");
    } else {
      exactFields(form, ["assignment", "expectedAccessRevision", "expectedPageRevision", "idempotencyKey"], ["assignment"]);
      const values = form.getAll("assignment");
      if (values.some((value) => typeof value !== "string")) throw new TypeError("Workspace access assignment is invalid.");
      const parsed = (values as string[]).map((value) => {
        const match = /^(role|user)\\|([^|]{1,160})\\|(view|edit)$/u.exec(value);
        if (!match) throw new TypeError("Workspace access assignment is invalid.");
        return { kind: match[1] as "role" | "user", id: match[2]!, capability: match[3] as "view" | "edit" };
      });
      if (new Set(parsed.map(({ kind, id }) => \`\${kind}:\${id}\`)).size !== parsed.length) throw new TypeError("Workspace access subject is duplicated.");
      const subjects = await loadWorkspacePageAccessSubjects(payload, context);
      const roles = new Set(subjects.roles.map(({ id }) => id));
      const userIds = new Set(subjects.users.map(({ id }) => id));
      if (parsed.some(({ kind, id }) => kind === "role" ? !roles.has(id) : !userIds.has(id))) throw new TypeError("Workspace access subject is unavailable.");
      await service.replaceAccess(context, kNexWorkspacePageScope, pageId, {
        expectedPageRevision: integerField(form, "expectedPageRevision", 1, 1_000_000_000), expectedAccessRevision: integerField(form, "expectedAccessRevision", 0, 1_000_000_000),
        assignments: parsed.map(({ kind, id, capability }) => ({ subject: kind === "role" ? { kind, roleId: id } : { kind, userId: id }, capability })), idempotencyKey: idempotencyField(form)
      }, session.signal);
    }
    return workspaceRedirect(\`/system/workspace-pages/\${encodeURIComponent(pageId)}\`);
    } finally { session.close(); }
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function workspaceFolderCreateRouteSource(): string {
  return `import { createWorkspaceFolder } from "../../../../k-nex-workspace-pages.js";
import { exactFields, idempotencyField, integerField, openWorkspaceForm, textField, workspaceMutationError, workspaceRedirect } from "../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "workspace-folder-create");
    exactFields(form, ["idempotencyKey", "label", "order", "parentNavigationId"]);
    await createWorkspaceFolder(payload, context, { label: textField(form, "label", 1, 120), parentNavigationId: textField(form, "parentNavigationId", 1, 128), order: integerField(form, "order", 0, 1_000_000), idempotencyKey: idempotencyField(form) });
    return workspaceRedirect("/system/workspace-pages");
  } catch (error) { return workspaceMutationError(error); }
}

`;
}

function workspacePageSessionRouteSource(): string {
  return `import { headers as getHeaders } from "next/headers";

import { bootKnexApplication } from "../../../../../../boot.js";
import { kNexRequestContext } from "../../../../../../k-nex-authority.js";
import { loadWorkspacePageEditorProjection, loadWorkspacePageViewProjection, readWorkspacePageWatermark } from "../../../../../../k-nex-workspace-pages.js";

export const dynamic = "force-dynamic";
type Watermark = Readonly<{ authorizationRevision: number; lifecycleRevision: number; pageRevision: number; accessRevision: number; publicationPointerRevision: number; publicationRevisionId: string; themePublicationRevision: number; themeActiveRevisionId: string; themeStateDigest: string }>;
function requestedWatermark(value: string | null): Watermark | undefined {
  if (value === null) return undefined;
  try {
    const candidate = JSON.parse(value) as unknown;
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
    const watermark = candidate as Record<string, unknown>;
    if (Object.keys(watermark).sort().join("\\0") !== "accessRevision\\0authorizationRevision\\0lifecycleRevision\\0pageRevision\\0publicationPointerRevision\\0publicationRevisionId\\0themeActiveRevisionId\\0themePublicationRevision\\0themeStateDigest" || ![watermark.authorizationRevision, watermark.lifecycleRevision, watermark.pageRevision, watermark.accessRevision, watermark.publicationPointerRevision, watermark.themePublicationRevision].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0) || typeof watermark.publicationRevisionId !== "string" || typeof watermark.themeActiveRevisionId !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(watermark.themeActiveRevisionId) || typeof watermark.themeStateDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(watermark.themeStateDigest)) return undefined;
    return watermark as Watermark;
  } catch { return undefined; }
}
function sameWatermark(left: Watermark, right: Watermark): boolean {
  return left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision && left.pageRevision === right.pageRevision && left.accessRevision === right.accessRevision && left.publicationPointerRevision === right.publicationPointerRevision && left.publicationRevisionId === right.publicationRevisionId && left.themePublicationRevision === right.themePublicationRevision && left.themeActiveRevisionId === right.themeActiveRevisionId && left.themeStateDigest === right.themeStateDigest;
}
export async function GET(request: Request, { params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  try {
    const payload = await bootKnexApplication("workspace-web");
    const search = new URL(request.url).searchParams; const mode = search.get("mode");
    if (mode !== null && mode !== "edit") throw new TypeError("Workspace page session mode is invalid.");
    const requested = requestedWatermark(search.get("watermark"));
    if (search.has("watermark") && requested === undefined) throw new TypeError("Workspace page watermark is invalid.");
    const nodeId = search.get("nodeId"); const pageText = search.get("page");
    if ((nodeId === null) !== (pageText === null) || nodeId !== null && (nodeId.length < 1 || nodeId.length > 128 || nodeId !== nodeId.normalize("NFC") || nodeId.includes("\\0") || !/^[1-9][0-9]{0,6}$/u.test(pageText!) || Number(pageText) > 1_000_000)) throw new TypeError("Workspace Sales page request is invalid.");
    if (mode === "edit" && nodeId !== null) throw new TypeError("Workspace Sales page request is invalid.");
    const context = kNexRequestContext(await getHeaders(), mode === "edit" ? "workspace-page-editor-session" : "workspace-page-session");
    const pageId = (await params).pageId;
    const watermark = await readWorkspacePageWatermark(payload, context, pageId, mode === "edit" ? "edit" : "view", context.correlationId);
    if (requested !== undefined && nodeId === null && (mode === "edit" || sameWatermark(requested, watermark))) return Response.json({ watermark }, { headers: { "cache-control": "no-store" } });
    const projection = mode === "edit"
      ? await loadWorkspacePageEditorProjection(payload, context, pageId, context.correlationId)
      : await loadWorkspacePageViewProjection(payload, context, pageId, context.correlationId, pageText === null ? 1 : Number(pageText), nodeId ?? undefined);
    return Response.json({ watermark: projection.watermark, projection }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof TypeError && ["Workspace page session authority changed.", "Workspace page session was invalidated."].includes(error.message)) {
      return Response.json({ code: "REVISION_CONFLICT" }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
}
`;
}

function workspaceSalesActionRouteSource(): string {
  return `import type { UiDocument, UiNode } from "@k-nex/contracts";

import { executeWorkspaceSalesAction } from "../../../../../../../k-nex-sales-workspace.js";
import { openWorkspacePageSession } from "../../../../../../../k-nex-workspace-pages.js";
import { openWorkspaceJson, workspaceMutationError } from "../../../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";
function boundAction(document: UiDocument, nodeId: string, actionId: string): Readonly<{ id: string; version: number }> | undefined {
  let bound: Readonly<{ id: string; version: number }> | undefined;
  const visit = (node: UiNode): void => {
    if (bound !== undefined) return;
    const action = node.bindings?.action;
    if (node.id === nodeId && action?.id === actionId) { bound = { id: action.id, version: action.version }; return; }
    node.children?.forEach(visit);
  };
  Object.values(document.regions).forEach((region) => region.forEach(visit));
  return bound;
}

function notFound(): Response {
  return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ pageId: string; actionId: string }> }>) {
  try {
    const { payload, context, body } = await openWorkspaceJson(request, "workspace-sales-action");
    const { pageId, actionId } = await params;
    let session;
    try { session = await openWorkspacePageSession(payload, context, pageId, "view", context.correlationId); }
    catch { return notFound(); }
    try {
      const detail = session.detail;
      if (detail.page.state !== "published" || detail.impact.state !== "ready" || detail.publication === undefined) return notFound();
      if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join("\\0") !== "idempotencyKey\\0input\\0nodeId") throw new TypeError("Workspace Sales action body is invalid.");
      const value = body as Record<string, unknown>;
      if (typeof value.nodeId !== "string" || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value.idempotencyKey)) throw new TypeError("Workspace Sales idempotency key is invalid.");
      const action = boundAction(detail.publication.revision.document, value.nodeId, actionId);
      if (action === undefined) return notFound();
      const result = await executeWorkspaceSalesAction(payload, context, action, value.input, value.idempotencyKey, session.signal);
      return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
    } finally { session.close(); }
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function workspaceFolderUpdateRouteSource(): string {
  return `import { updateWorkspaceFolder } from "../../../../../k-nex-workspace-pages.js";
import { exactFields, integerField, openWorkspaceForm, textField, workspaceMutationError, workspaceRedirect } from "../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ folderId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "workspace-folder-update");
    exactFields(form, ["expectedRevision", "label", "order", "parentNavigationId"]);
    await updateWorkspaceFolder(payload, context, { folderId: (await params).folderId, expectedRevision: integerField(form, "expectedRevision", 1, 1_000_000_000), label: textField(form, "label", 1, 120), parentNavigationId: textField(form, "parentNavigationId", 1, 128), order: integerField(form, "order", 0, 1_000_000) });
    return workspaceRedirect("/system/workspace-pages");
  } catch (error) { return workspaceMutationError(error); }
}
`;
}

function workspacePageRuntimeTailSource(): string {
  return `function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Workspace selection is invalid.");
  return value as Record<string, unknown>;
}

function nodes(document: UiDocument): readonly UiNode[] {
  const result: UiNode[] = [];
  const visit = (node: UiNode): void => { result.push(node); node.children?.forEach(visit); };
  Object.values(document.regions).forEach((region) => region.forEach(visit));
  return result;
}

function contribution(kind: "blocks" | "sources" | "actions", id: string, version: number): unknown | undefined {
  const entry = kNexSalesRegistry.scopedRegistration.contributions[kind].find((candidate) => candidate.id === id);
  const registered = entry?.value as { readonly descriptor?: unknown } | undefined;
  const value = (registered?.descriptor ?? registered) as { readonly version?: unknown } | undefined;
  return value !== undefined && value.version === version ? value : undefined;
}

async function workspaceBuilderProfile(payload: Payload, context: KnexRequestContext, signal: AbortSignal) {
  if (signal.aborted) throw new TypeError("Workspace document validation was revoked.");
  const permissions = new Set(await workspaceSalesPermissions(payload, context, signal));
  if (signal.aborted) throw new TypeError("Workspace document validation was revoked.");
  const sources = [salesOpportunitiesDescriptor, salesTasksDescriptor, salesPipelineSnapshotDescriptor, salesSavedViewListDescriptor, salesSavedViewDetailDescriptor, salesSavedViewTableDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewCalendarDescriptor, salesPipelineValueByStageDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesActivityByOwnerTeamDescriptor, salesTaskAgingDescriptor, salesSalesCycleDurationDescriptor].flatMap((candidate) => {
    const registered = contribution("sources", candidate.id, candidate.version) as typeof candidate | undefined;
    if (registered === undefined || registered.id !== candidate.id || registered.version !== candidate.version || !permissions.has(registered.permission)) return [];
    return [{ ...registered, ...(registered.outputFields === undefined ? {} : { outputFields: registered.outputFields.filter(({ permission }) => permissions.has(permission)) }) }];
  });
  const actions = [salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor, salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor, salesReportRunDescriptor, salesReportScheduleDescriptor].flatMap((candidate) => {
    const registered = contribution("actions", candidate.id, candidate.version) as typeof candidate | undefined;
    return registered === undefined || registered.id !== candidate.id || registered.version !== candidate.version || !permissions.has(registered.permission) ? [] : [{ id: registered.id, version: registered.version }];
  });
  const blocks = [...genericPuckBlockBridges, ...salesPuckBlockBridges.filter((bridge) => {
    const registered = contribution("blocks", bridge.definition.id, bridge.definition.version) as { readonly id?: unknown; readonly version?: unknown; readonly permission?: unknown } | undefined;
    return registered?.id === bridge.definition.id && registered.version === bridge.definition.version &&
      (registered.permission === undefined || typeof registered.permission === "string" && permissions.has(registered.permission));
  })];
  return createAuthorizedPuckBuilderProfile({
    profile: "workspace", publication: "save-layout", blocks, sources,
    authority: { blocks: blocks.map(({ definition }) => ({ id: definition.id, version: definition.version })), sources: sources.map(({ id, version }) => ({ id, version })), actions }
  });
}

function workspaceDocumentValidator(payload: Payload): WorkspacePageDocumentValidator<KnexRequestContext> {
  return {
    async validateChange({ context, previous, document, signal }) {
      const profile = await workspaceBuilderProfile(payload, context, signal);
      profile.validateChange(admittedWorkspaceSalesDocument(previous), { ...admittedWorkspaceSalesDocument(document), version: previous.version });
      profile.validateDocument(admittedWorkspaceSalesDocument(document));
      return document;
    },
    async validateDocument({ context, document, signal }) { (await workspaceBuilderProfile(payload, context, signal)).validateDocument(admittedWorkspaceSalesDocument(document)); return document; }
  };
}

function dependenciesFor(document: UiDocument): WorkspacePublishedRevision["dependencies"] {
  const entries = new Map<string, WorkspacePublishedRevision["dependencies"]["entries"][number]>();
  const add = (entry: WorkspacePublishedRevision["dependencies"]["entries"][number]): void => { entries.set(canonicalJson(entry), entry); };
  for (const node of nodes(document)) {
    if (platformBlocks.get(node.type) === node.version) add({ kind: "block", id: node.type, version: node.version, owner: { kind: "platform" } });
    else if (contribution("blocks", node.type, node.version) !== undefined) add({ kind: "block", id: node.type, version: node.version, owner: { kind: "platform-plugin", pluginId: kNexSalesRegistry.authorizationGeneration.owner.extensionId, version: kNexSalesRegistry.staticRelease.package.version } });
    else throw new TypeError(\`Workspace block \${node.type}@\${node.version} is unavailable.\`);
    const source = node.bindings?.source;
    if (source !== undefined) {
      const descriptor = contribution("sources", source.source.id, source.source.version) as { readonly structuralCompatibilityHash?: unknown } | undefined;
      if (descriptor === undefined || descriptor.structuralCompatibilityHash !== source.structuralCompatibilityHash) throw new TypeError("Workspace source dependency is unavailable.");
      add({ kind: "source", id: source.source.id, version: source.source.version, owner: { kind: "platform-plugin", pluginId: kNexSalesRegistry.authorizationGeneration.owner.extensionId, version: kNexSalesRegistry.staticRelease.package.version }, structuralCompatibilityHash: source.structuralCompatibilityHash });
    }
    const action = node.bindings?.action;
    if (action !== undefined) {
      if (contribution("actions", action.id, action.version) === undefined) throw new TypeError("Workspace action dependency is unavailable.");
      add({ kind: "action", id: action.id, version: action.version, owner: { kind: "platform-plugin", pluginId: kNexSalesRegistry.authorizationGeneration.owner.extensionId, version: kNexSalesRegistry.staticRelease.package.version } });
    }
  }
  const ordered = [...entries.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return { entries: ordered, digest: digest(ordered) };
}

function usesSales(document: UiDocument): boolean {
  return dependenciesFor(document).entries.some((entry) => entry.owner.kind === "platform-plugin" &&
    entry.owner.pluginId === kNexSalesRegistry.authorizationGeneration.owner.extensionId &&
    entry.owner.version === kNexSalesRegistry.staticRelease.package.version);
}

async function salesGenerationImpact(payload: Payload) {
  const result = await (payload.db.pool as RuntimeExtensionPool).query<{ exact_state: string | null; other_current: boolean; generation_count: string }>(
    \`select
       max(state) filter (where authorization_generation=$3 and runtime_generation_ids=$4::jsonb) exact_state,
       coalesce(bool_or(state='current' and (authorization_generation<>$3 or runtime_generation_ids<>$4::jsonb)), false) other_current,
       count(*)::text generation_count
     from k_nex_extension_authorization_generations
     where application_id=$1 and delivery_class='platform-plugin' and extension_id=$2\`,
    [scope.applicationId, kNexSalesRegistry.authorizationGeneration.owner.extensionId, kNexSalesRegistry.authorizationGeneration.owner.generation, canonicalJson([kNexSalesRegistry.staticRelease.runtimeGenerationId])]
  );
  const generation = result.rows[0];
  if (generation === undefined || generation.generation_count === "0") return "plugin-removed" as const;
  if (generation.other_current) return "plugin-updated" as const;
  if (generation.exact_state !== "current") return "plugin-disabled" as const;
  if (await currentSalesGeneration(payload).catch(() => undefined) === undefined) return "plugin-disabled" as const;
  return undefined;
}

function createRuntime(payload: Payload) {
  const authority = kNexAuthority(payload);
  const store = new PostgresWorkspacePageStore(payload.db.pool as RuntimeExtensionPool);
  const folders = new PostgresWorkspaceNavigationStore(payload.db.pool as RuntimeExtensionPool);
  const sessions = new WorkspacePageSessionRegistry();
  const synchronizeInvalidations = async () => {
    const state = await authority.store.readState(scope.applicationId, scope.environment);
    if (state === undefined) throw new TypeError("Workspace authority state is unavailable.");
    sessions.invalidate({ ...scope, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
    for (const page of await store.list(scope)) sessions.invalidate({ ...scope, pageId: page.identity.pageId, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision, accessRevision: page.accessRevision, pageRevision: page.revision });
    return state;
  };
  const acl = new ExactWorkspacePageAclPolicy<KnexRequestContext>(async ({ decision, signal }) => {
    if (signal.aborted) return { roleIds: [], ownerOverride: false };
    const state = await authority.store.readState(scope.applicationId, scope.environment);
    if (state === undefined || state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision) {
      return { roleIds: [], ownerOverride: false };
    }
    const expected = { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
    const assignments = (await authority.store.readTransaction(expected, (transaction) => transaction.listAssignments(scope.applicationId, decision.effectiveActor))).value;
    const roleIds = assignments.filter((assignment) => assignment.state === "active").map((assignment) => assignment.roleId);
    const ownerOverride = assignments.some((assignment) => assignment.roleId === "system.role.owner" && assignment.state === "active");
    return { roleIds, ownerOverride };
  });
  const resolvePlacement = async (selectionValue: unknown) => {
    const selection = record(selectionValue);
    if (Object.keys(selection).sort().join("\\0") !== "order\\0parentNavigationId" || typeof selection.parentNavigationId !== "string" ||
      !Number.isSafeInteger(selection.order) || (selection.order as number) < 0 || (selection.order as number) > 1_000_000) throw new TypeError("Workspace placement is invalid.");
    const allowed = selection.parentNavigationId === kNexSalesRegistry.navigationSection.id ||
      (await folders.list(scope)).some(({ node }) => node.id === selection.parentNavigationId);
    if (!allowed) throw new TypeError("Workspace placement parent is unavailable.");
    return { state: "placed" as const, parentNavigationId: selection.parentNavigationId, order: selection.order as number };
  };
  const catalog = {
    resolvePlacement: (_context: KnexRequestContext, selectionValue: unknown) => resolvePlacement(selectionValue),
    async resolveTheme(_context: KnexRequestContext, selection: unknown) {
      if (selection === undefined || selection === "") return undefined;
      if (typeof selection !== "string") throw new TypeError("Workspace Theme Profile selection is invalid.");
      const [profileId, revisionId, extra] = selection.split("|");
      if (!profileId || !revisionId || extra !== undefined) throw new TypeError("Workspace Theme Profile selection is invalid.");
      const reference = { profileId, revisionId, surface: "admin" as const };
      await resolvePageThemeOverride(payload, reference);
      return reference;
    },
    dependencies({ snapshot }: Readonly<{ snapshot: WorkspacePageSnapshot }>) { return dependenciesFor(snapshot.workingCopy.document); },
    async impact({ snapshot, revision }: Readonly<{ snapshot: WorkspacePageSnapshot; revision?: WorkspacePublishedRevision }>) {
      const state = await authority.store.readState(scope.applicationId, scope.environment);
      const selected = revision;
      const theme = selected?.themeProfile ?? snapshot.page.themeProfile;
      const fallback = (snapshot.page.dependencyDigest ?? digest([])) as \`sha256:\${string}\`;
      try { await (theme === undefined ? resolveApplicationTheme(payload) : resolvePageThemeOverride(payload, theme)); }
      catch { return { state: "dependency-unavailable" as const, code: "theme-unavailable" as const, catalogRevision: state?.lifecycleRevision ?? 0, dependencyDigest: fallback }; }
      try {
        const document = selected?.document ?? snapshot.workingCopy.document;
        const pluginCode = usesSales(document) ? await salesGenerationImpact(payload) : undefined;
        if (pluginCode !== undefined) return { state: "dependency-unavailable" as const, code: pluginCode, catalogRevision: state?.lifecycleRevision ?? 0, dependencyDigest: fallback };
        const dependencies = dependenciesFor(document);
        return { state: "ready" as const, catalogRevision: state!.lifecycleRevision, dependencyDigest: dependencies.digest as \`sha256:\${string}\` };
      } catch { return { state: "dependency-unavailable" as const, code: "plugin-removed" as const, catalogRevision: state!.lifecycleRevision, dependencyDigest: fallback }; }
    },
    async observe({ snapshot, revision, signal }: Readonly<{ snapshot: WorkspacePageSnapshot; revision?: WorkspacePublishedRevision; signal: AbortSignal }>) {
      if (signal.aborted) throw new TypeError("Workspace dependency observation was cancelled.");
      const reference = revision?.themeProfile ?? snapshot.page.themeProfile;
      const theme = await (reference === undefined ? resolveApplicationTheme(payload) : resolvePageThemeOverride(payload, reference));
      if (signal.aborted) throw new TypeError("Workspace dependency observation was cancelled.");
      const document = revision?.document ?? snapshot.workingCopy.document;
      return Object.freeze({
        extensionGenerations: Object.freeze(usesSales(document) ? [{ applicationId: scope.applicationId, deliveryClass: "platform-plugin" as const, extensionId: kNexSalesRegistry.authorizationGeneration.owner.extensionId, authorizationGeneration: kNexSalesRegistry.authorizationGeneration.owner.generation }] : []),
        themePublication: Object.freeze({ applicationId: scope.applicationId, environment: scope.environment, profileId: theme.observation.profileId, activeRevisionId: theme.observation.activeRevisionId, revision: theme.observation.publicationRevision, stateDigest: theme.observation.stateDigest as \`sha256:\${string}\` })
      });
    }
  };
  const service = new CurrentAuthorityWorkspacePageService<KnexRequestContext>({
    store,
    authority: authority.adapter,
    acl,
    catalog,
    documents: workspaceDocumentValidator(payload),
    identities: {
      page: (owner: WorkspacePageScope) => {
        const value = "p" + randomUUID().replaceAll("-", "");
        return { ...owner, pageId: \`workspace.page.\${value}\`, documentId: \`workspace.document.\${value}\` };
      },
      publication: () => {
        const value = "p" + randomUUID().replaceAll("-", "");
        return { revisionId: \`workspace.publication.\${value}\`, receiptId: \`workspace.receipt.\${value}\` };
      }
    },
    now: () => new Date()
  });
  const invalidations = listenForInvalidations(payload, synchronizeInvalidations);
  return Object.freeze({ service, store, folders, authority, sessions, synchronizeInvalidations, resolvePlacement, close: invalidations.close });
}

export const kNexWorkspacePageScope = scope;

export function kNexWorkspacePages(payload: Payload) {
  if (drainedRuntimes.has(payload)) throw new Error("K-Nex workspace runtime is closed.");
  let runtime = runtimes.get(payload);
  if (runtime === undefined) { runtime = createRuntime(payload); runtimes.set(payload, runtime); }
  return runtime;
}

/** Peeks only: host shutdown must not create a workspace listener. */
export async function drainKnexWorkspacePages(payload: Payload): Promise<void> {
  const runtime = runtimes.get(payload);
  drainedRuntimes.add(payload);
  if (runtime !== undefined) await runtime.close();
}

export async function loadWorkspacePageAccessSubjects(payload: Payload, context: KnexRequestContext) {
  const authority = kNexAuthority(payload);
  const state = await authority.store.readState(scope.applicationId, scope.environment);
  if (state === undefined) throw new TypeError("Workspace authority state is unavailable.");
  const expected = { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
  if (!await authorizeRequest(payload, context, "system.workspace-pages.access.manage", "system.workspace-pages")) {
    throw Object.assign(new Error("Workspace page access is denied."), { code: "ACCESS_DENIED" });
  }
  const roles = (await authority.store.readTransaction(expected, (transaction) => transaction.listRoles(scope.applicationId))).value;
  const result = await payload.find({ collection: "users", overrideAccess: true, depth: 0, limit: 501, pagination: false, select: { email: true }, sort: "id" });
  if (result.docs.length > 500 || result.totalDocs > 500) throw new TypeError("Workspace access subject ceiling exceeded.");
  const current = await authority.store.readState(scope.applicationId, scope.environment);
  if (current === undefined || current.authorizationRevision !== expected.authorizationRevision || current.lifecycleRevision !== expected.lifecycleRevision) throw new TypeError("Workspace authority changed during access subject projection.");
  if (!await authorizeRequest(payload, context, "system.workspace-pages.access.manage", "system.workspace-pages")) {
    throw Object.assign(new Error("Workspace page access is denied."), { code: "ACCESS_DENIED" });
  }
  const finalState = await authority.store.readState(scope.applicationId, scope.environment);
  if (finalState === undefined || finalState.authorizationRevision !== expected.authorizationRevision || finalState.lifecycleRevision !== expected.lifecycleRevision) throw new TypeError("Workspace authority changed during access subject projection.");
  return Object.freeze({
    roles: Object.freeze(roles.map(({ id, label }) => Object.freeze({ id, label }))),
    users: Object.freeze(result.docs.slice(0, 500).map(({ id, email }) => {
      if (typeof email !== "string") throw new TypeError("Workspace access user email is unavailable.");
      return Object.freeze({ id: String(id), displayEmail: email });
    }))
  });
}

export async function openWorkspacePageSession(payload: Payload, context: KnexRequestContext, pageId: string, capability: "view" | "edit", sessionId: string) {
  const runtime = kNexWorkspacePages(payload);
  const initialState = await runtime.synchronizeInvalidations();
  const detail = await runtime.service.detail(context, scope, pageId, capability);
  const state = await runtime.synchronizeInvalidations();
  if (initialState.authorizationRevision !== state.authorizationRevision || initialState.lifecycleRevision !== state.lifecycleRevision) throw new TypeError("Workspace page session authority changed.");
  const reference = capability === "view" ? detail.publication?.revision.themeProfile : detail.page.themeProfile;
  const theme = await (reference === undefined ? resolveApplicationTheme(payload) : resolvePageThemeOverride(payload, reference));
  const session = runtime.sessions.open({ ...scope, pageId, sessionId, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision, accessRevision: detail.page.accessRevision, pageRevision: detail.page.revision });
  if (session.signal.aborted) { session.close(); throw new TypeError("Workspace page session was invalidated."); }
  return Object.freeze({ detail, signal: session.signal, theme, watermark: Object.freeze({ authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision, pageRevision: detail.page.revision, accessRevision: detail.page.accessRevision, publicationPointerRevision: detail.publication?.pointer.pointerRevision ?? 0, publicationRevisionId: detail.publication?.pointer.publishedRevisionId ?? "", themePublicationRevision: theme.observation.publicationRevision, themeActiveRevisionId: theme.observation.activeRevisionId, themeStateDigest: theme.observation.stateDigest }), close: session.close });
}

export async function readWorkspacePageWatermark(payload: Payload, context: KnexRequestContext, pageId: string, capability: "view" | "edit", sessionId: string) {
  const session = await openWorkspacePageSession(payload, context, pageId, capability, sessionId);
  try { return session.watermark; } finally { session.close(); }
}

export async function loadWorkspacePageViewProjection(payload: Payload, context: KnexRequestContext, pageId: string, sessionId: string, pageNumber = 1, pageNodeId?: string) {
  const session = await openWorkspacePageSession(payload, context, pageId, "view", sessionId);
  try {
    const detail = session.detail;
    if (detail.page.state !== "published" || detail.impact.state !== "ready" || detail.publication === undefined) throw new TypeError("Workspace page publication is unavailable.");
    const permissions = await workspaceSalesPermissions(payload, context, session.signal);
    const projection = await projectWorkspaceSalesDocument(payload, context, detail.publication.revision.document, permissions, session.signal, Object.freeze({}), pageNumber, undefined, "table", pageNodeId);
    const document = projection.document;
    if (session.signal.aborted) throw new TypeError("Workspace page projection was invalidated.");
    const sourceResults = projection.sourceResults;
    if (session.signal.aborted) throw new TypeError("Workspace page projection was invalidated.");
    const currentState = await kNexAuthority(payload).store.readState(scope.applicationId, scope.environment);
    if (currentState === undefined || currentState.authorizationRevision !== session.watermark.authorizationRevision || currentState.lifecycleRevision !== session.watermark.lifecycleRevision) throw new TypeError("Workspace page projection was invalidated.");
    return Object.freeze({ document, permissions, sourceResults, themeRevision: session.theme.presentation.profileRevisionId, themeMode: session.theme.presentation.mode, themeCss: session.theme.presentation.cssText, watermark: session.watermark });
  } finally { session.close(); }
}

export async function loadWorkspacePageEditorProjection(payload: Payload, context: KnexRequestContext, pageId: string, sessionId: string) {
  const session = await openWorkspacePageSession(payload, context, pageId, "edit", sessionId);
  try {
    const detail = session.detail;
    if (detail.workingCopy === undefined) throw new TypeError("Workspace page working copy is unavailable.");
    const permissions = await workspaceSalesPermissions(payload, context, session.signal);
    const sources = [salesOpportunitiesDescriptor, salesTasksDescriptor, salesPipelineSnapshotDescriptor, salesSavedViewListDescriptor, salesSavedViewDetailDescriptor, salesSavedViewTableDescriptor, salesSavedViewKanbanDescriptor, salesSavedViewCalendarDescriptor, salesPipelineValueByStageDescriptor, salesWeightedForecastDescriptor, salesWonLostConversionDescriptor, salesLeadConversionDescriptor, salesActivityByOwnerTeamDescriptor, salesTaskAgingDescriptor, salesSalesCycleDurationDescriptor];
    const actions = [salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor, salesPipelineUpdateDescriptor, salesPipelineArchiveDescriptor, salesSavedViewCreateDescriptor, salesSavedViewUpdateDescriptor, salesSavedViewArchiveDescriptor, salesReportRunDescriptor, salesReportScheduleDescriptor];
    const authority = Object.freeze({
      blocks: [...genericPuckBlockBridges, ...salesPuckBlockBridges.filter(({ definition }) => definition.permission === undefined || permissions.includes(definition.permission))].map(({ definition }) => ({ id: definition.id, version: definition.version })),
      sources: sources.filter(({ permission }) => permissions.includes(permission)).map(({ id, version }) => ({ id, version })),
      actions: actions.filter(({ permission }) => permissions.includes(permission)).map(({ id, version }) => ({ id, version }))
    });
    const rollbackIds = [detail.publication?.pointer.publishedRevisionId, detail.publication?.pointer.previousPublishedRevisionId].filter((id): id is string => id !== undefined);
    if (session.signal.aborted) throw new TypeError("Workspace editor projection was invalidated.");
    return Object.freeze({ workingCopy: { revision: detail.workingCopy.revision, document: detail.workingCopy.document }, permissions, authority, rollbackRevisions: rollbackIds.map((id, index) => ({ id, label: "Published revision " + (index + 1) })), watermark: session.watermark });
  } finally { session.close(); }
}

async function folderDecision(payload: Payload, context: KnexRequestContext, operation: string) {
  const runtime = kNexWorkspacePages(payload);
  const target = createCurrentAuthorityTarget({ permissionId: "system.workspace-pages.access.manage", scope: { kind: "application", resource: "system.workspace-pages" }, facts: { boundary: "workspace-folder-service", operation } });
  const decision = await runtime.authority.adapter.authorize(context, target);
  const state = await runtime.authority.store.readState(scope.applicationId, scope.environment);
  if (decision === undefined || decision.outcome !== "allow" || decision.permissionId !== "system.workspace-pages.access.manage" || decision.scope.kind !== "application" || decision.scope.resource !== "system.workspace-pages" || decision.applicationId !== scope.applicationId || decision.environment !== scope.environment || decision.effectiveActor.kind !== "user" ||
    state === undefined || state.applicationId !== scope.applicationId || state.environment !== scope.environment || state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision) throw new TypeError("Workspace folder operation is denied.");
  return decision;
}

async function folderCatalog(payload: Payload): Promise<WorkspaceNavigationMutationCatalog> {
  if (await currentSalesGeneration(payload).catch(() => undefined) === undefined) {
    return Object.freeze({ staticNodes: workspaceNavigationFixedNodes, staticParentIds: [] });
  }
  const routes = new Map(kNexSalesRegistry.scopedRegistration.contributions.routes.map(({ value }) => {
    const route = value as Readonly<{ id?: unknown; ownerPluginId?: unknown }>;
    if (typeof route.id !== "string" || route.ownerPluginId !== "module.sales") throw new TypeError("Current Sales navigation route is invalid.");
    return [route.id, route] as const;
  }));
  const children = kNexSalesRegistry.scopedRegistration.contributions.navigation.map(({ value }) => {
    const descriptor = value as Readonly<{ id?: unknown; ownerPluginId?: unknown; labelMessageId?: unknown; route?: Readonly<{ routeId?: unknown }>; parentId?: unknown; order?: unknown }>;
    const routeId = descriptor.route?.routeId;
    const route = typeof routeId === "string" ? routes.get(routeId) : undefined;
    const messages = kNexSalesRegistry.navigationSection.messages as Readonly<Record<string, string>>;
    const label = typeof descriptor.labelMessageId === "string" ? messages[descriptor.labelMessageId] : undefined;
    const order = descriptor.order;
    if (typeof descriptor.id !== "string" || descriptor.ownerPluginId !== "module.sales" || typeof routeId !== "string" || route === undefined || typeof label !== "string" || label.length < 1 || label.length > 120 || descriptor.parentId !== undefined && typeof descriptor.parentId !== "string" || typeof order !== "number" || !Number.isSafeInteger(order)) throw new TypeError("Current Sales navigation descriptor is invalid.");
    return { id: descriptor.id, owner: { kind: "platform-plugin" as const, pluginId: "module.sales" }, kind: "link" as const, parentId: descriptor.parentId ?? kNexSalesRegistry.navigationSection.id, label, order, target: { class: "platform-plugin" as const, ownerPluginId: "module.sales", routeId } };
  });
  const section = { id: kNexSalesRegistry.navigationSection.id, owner: { kind: "platform-plugin" as const, pluginId: "module.sales" }, kind: "folder" as const, label: kNexSalesRegistry.navigationSection.label, icon: "sales" as const, order: kNexSalesRegistry.navigationSection.order };
  return Object.freeze({ staticNodes: [...workspaceNavigationFixedNodes, section, ...children], staticParentIds: [section.id] });
}

export async function createWorkspaceFolder(payload: Payload, context: KnexRequestContext, input: Readonly<{ label: string; parentNavigationId: string; order: number; idempotencyKey: string }>) {
  const runtime = kNexWorkspacePages(payload);
  const decision = await folderDecision(payload, context, "create");
  const catalog = await folderCatalog(payload);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(input.idempotencyKey)) throw new TypeError("Workspace folder idempotency key is invalid.");
  const id = \`customer.folder.f\${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 23)}\`;
  const node = { id, owner: { kind: "customer" as const }, kind: "folder" as const, parentId: input.parentNavigationId, label: input.label, icon: "folder" as const, order: input.order };
  const fence = { applicationId: decision.applicationId, environment: decision.environment, authorizationRevision: decision.authorizationRevision, lifecycleRevision: decision.lifecycleRevision };
  try { return await runtime.folders.create(scope, node, decision.effectiveActor, fence, catalog); }
  catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "23505";
    if (duplicate) {
      const existing = await runtime.folders.read(scope, id);
      if (existing !== undefined && canonicalJson(existing.node) === canonicalJson(node)) return existing;
    }
    throw error;
  }
}

export async function updateWorkspaceFolder(payload: Payload, context: KnexRequestContext, input: Readonly<{ folderId: string; expectedRevision: number; label: string; parentNavigationId: string; order: number }>) {
  const runtime = kNexWorkspacePages(payload);
  const decision = await folderDecision(payload, context, "update");
  const catalog = await folderCatalog(payload);
  const existing = await runtime.folders.read(scope, input.folderId);
  if (existing === undefined || existing.node.id === input.parentNavigationId) throw new TypeError("Workspace folder is unavailable.");
  const fence = { applicationId: decision.applicationId, environment: decision.environment, authorizationRevision: decision.authorizationRevision, lifecycleRevision: decision.lifecycleRevision };
  return runtime.folders.update(scope, { ...existing.node, label: input.label, parentId: input.parentNavigationId, order: input.order }, input.expectedRevision, decision.effectiveActor, fence, catalog);
}
`;
}

export function workspacePageApplicationFiles(_options: WorkspacePageApplicationFilesOptions): Readonly<Record<string, string>> {
  return Object.freeze({
    "src/app/(workspace)/workspace/pages/[pageId]/page.tsx": workspacePageViewSource(),
    "src/app/(workspace)/workspace/pages/[pageId]/edit/page.tsx": workspacePageEditorSource(),
    "src/app/components/k-nex-workspace-page-editor.tsx": workspacePageEditorClientSource(),
    "src/app/components/k-nex-workspace-page-runtime.tsx": workspacePageRuntimeClientSource(),
    "src/app/(workspace)/system/workspace-pages/page.tsx": workspacePageListSource(),
    "src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx": workspacePageDetailSource(),
    "src/app/api/k-nex/workspace-pages/route.ts": workspacePageCreateRouteSource(),
    "src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts": workspacePageMutationRouteSource(),
    "src/app/api/k-nex/workspace-pages/[pageId]/session/route.ts": workspacePageSessionRouteSource(),
    "src/app/api/k-nex/workspace-pages/[pageId]/actions/[actionId]/route.ts": workspaceSalesActionRouteSource(),
    "src/app/api/k-nex/workspace-folders/route.ts": workspaceFolderCreateRouteSource(),
    "src/app/api/k-nex/workspace-folders/[folderId]/route.ts": workspaceFolderUpdateRouteSource(),
    "src/k-nex-workspace-page-http.ts": workspacePageHttpSource(),
    "src/k-nex-workspace-pages.ts": workspacePageRuntimeSource(),
    "src/k-nex-sales-workspace.ts": workspaceSalesServerSource()
  });
}
