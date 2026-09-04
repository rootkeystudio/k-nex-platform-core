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
  parseWorkspacePageInvalidation,
  type RuntimeExtensionPool,
  type WorkspacePageDocumentValidator,
  type WorkspacePageScope,
  type WorkspacePageSnapshot
} from "@k-nex/payload-adapter";
import { createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";
import { salesOpportunitiesDescriptor, salesOpportunityStageUpdateDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "@k-nex/module-sales/contracts";
import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";
import { genericPuckBlockBridges } from "@k-nex/ui-builder-blocks";
import { genericUiBlockDefinitions } from "@k-nex/ui-builder-blocks/runtime";
import { createCurrentAuthorityTarget } from "@k-nex/runtime";
import type { Payload } from "payload";

import { authorizeRequest, currentSalesGeneration, kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";
import { resolveApplicationTheme, resolvePageThemeOverride } from "./k-nex-theme-runtime.js";
import { loadWorkspaceSalesSources, workspaceSalesPermissions } from "./k-nex-sales-workspace.js";

const platformBlocks = new Map(genericUiBlockDefinitions.map(({ id, version }) => [id, version] as const));
const scope = Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment });
const runtimes = new WeakMap<Payload, ReturnType<typeof createRuntime>>();
const invalidationChannel = "k_nex_runtime_invalidation";
const workspaceNavigationFixedNodes = Object.freeze([
  { id: "k-nex.navigation.root", owner: { kind: "platform" as const }, kind: "folder" as const, label: "K-Nex", icon: "dashboard" as const, order: 0 },
  { id: "system.navigation.root", owner: { kind: "platform" as const }, kind: "folder" as const, label: "System", icon: "system" as const, order: 1_000_000 },
  { id: "k-nex.navigation.workspace", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "k-nex.navigation.root", label: "Workspace", icon: "dashboard" as const, order: 0, target: { class: "system" as const, routeId: "system.route.workspace" } },
  { id: "system.navigation.workspace-pages", owner: { kind: "platform" as const }, kind: "link" as const, parentId: "system.navigation.root", label: "Workspace pages", icon: "dashboard" as const, order: 45, target: { class: "system" as const, routeId: "system.route.workspace-pages" } }
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

function listenForInvalidations(payload: Payload, synchronize: () => Promise<unknown>): void {
  const pool = payload.db.pool as unknown as { connect(): Promise<NotificationClient> };
  const connect = async (): Promise<void> => {
    let client: NotificationClient | undefined;
    try {
      client = await pool.connect();
      let finished = false;
      const reconnect = () => {
        if (finished) return;
        finished = true;
        client?.release(true);
        setTimeout(() => { void connect(); }, 250);
      };
      client.on("notification", (message) => {
        if (message.channel !== invalidationChannel) return;
        try { validateNotification(message.payload); void synchronize().catch(() => undefined); } catch { /* untrusted notifications cannot alter watermarks */ }
      });
      client.on("error", reconnect);
      client.on("end", reconnect);
      await client.query("LISTEN k_nex_runtime_invalidation");
      await synchronize();
    } catch {
      client?.release(true);
      setTimeout(() => { void connect(); }, 250);
    }
  };
  void connect();
  setInterval(() => { void synchronize().catch(() => undefined); }, 1_000);
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
  return `import "server-only";

import type { DataSourceBindingResult, DataSourceDefinition, UiDocument, UiNode } from "@k-nex/contracts";
import {
  CurrentAuthorityActionGatewayPolicy,
  CurrentAuthorityDataSourcePolicy,
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
  createCurrentAuthorityTarget,
  type DataSourceHandler,
  type DataSourcePolicyService,
  type RegisteredDataSource
} from "@k-nex/runtime";
import { createPayloadPersistenceCapability, CurrentAuthorityPayloadPersistenceAuthorizer, PayloadRequestAuthenticator } from "@k-nex/payload-adapter";
import type { Payload, PayloadRequest } from "payload";

import { kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

const sourceDefinitions = new Map(kNexSalesRegistry.scopedRegistration.contributions.sources.map((entry) => [entry.id, entry.value as DataSourceDefinition]));
const sourceHandlers = new Map(kNexSalesRegistry.scopedRegistration.bindings.sources.map((entry) => [entry.id, entry.value as DataSourceHandler]));
const sources = new Map<string, RegisteredDataSource>();
for (const [id, definition] of sourceDefinitions) {
  const handler = sourceHandlers.get(id);
  if (handler !== undefined) sources.set(id, Object.freeze({ definition, handler }));
}
const workspaceSalesBudget = new BoundedQueryBudgetEvaluator();

function target(permissionId: string, recordId = "collection") {
  const descriptor = kNexSalesRegistry.permissionDescriptors.find(({ id }) => id === permissionId);
  if (descriptor === undefined) throw new TypeError("Sales permission is unavailable.");
  const scope = descriptor.scope === "application" ? { kind: "application" as const, resource: descriptor.resource }
    : descriptor.scope === "record" ? { kind: "record" as const, resource: descriptor.resource, recordId }
    : { kind: "field" as const, resource: descriptor.resource, recordId, fieldId: descriptor.resource };
  return createCurrentAuthorityTarget({ permissionId, scope, facts: { boundary: "workspace-sales" } });
}

` + workspaceSalesServerTailSource();
}

function workspacePageRuntimeClientSource(): string {
  return `"use client";

import type { DataSourceBindingResult, UiDocument } from "@k-nex/contracts";
import { salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "@k-nex/module-sales/contracts";
import { salesUiBlockDefinitions } from "@k-nex/module-sales/ui";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { genericUiBlockDefinitions } from "@k-nex/ui-builder-blocks/runtime";
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";
import { useEffect, useMemo, useState } from "react";

const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: [...genericUiBlockDefinitions, ...salesUiBlockDefinitions], sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor] }));
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
  useEffect(() => {
    let active = true;
    const failClosed = () => { if (active) setRevoked(true); };
    const synchronize = async () => {
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/session?watermark=" + encodeURIComponent(JSON.stringify(current.watermark)), { cache: "no-store" }).catch(() => undefined);
      if (!response?.ok) return failClosed();
      const body = await response.json().catch(() => undefined) as { watermark?: unknown; projection?: unknown } | undefined;
      const nextWatermark = watermark(body?.watermark);
      if (nextWatermark === undefined) return failClosed();
      if (sameWatermark(current.watermark, nextWatermark)) { if (active) setRevoked(false); return; }
      const next = projection(body?.projection);
      if (next === undefined) return failClosed();
      if (!sameWatermark(nextWatermark, next.watermark)) return failClosed();
      if (active) { setCurrent(next); setRevoked(false); }
    };
    void synchronize();
    const timer = setInterval(async () => {
      await synchronize();
    }, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [pageId, current.watermark]);
  const result = useMemo(() => runtime.render({
    document: current.document, surface: "workspace", actor: { authenticated: true, permissions: new Set(current.permissions) }, sourceResults: current.sourceResults,
    dispatchAction: async (request) => {
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/actions/" + encodeURIComponent(request.action.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: request.input, idempotencyKey: "workspace-action-" + crypto.randomUUID() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code ?? "Sales action failed.");
      setCurrent((current) => ({ ...current, sourceResults: Object.fromEntries(Object.entries(current.sourceResults).map(([nodeId, value]) => {
        const state = value as { state?: string; data?: { rows?: readonly { key: string; values: Record<string, unknown> }[] } };
        if (state.state !== "success" || !Array.isArray(state.data?.rows)) return [nodeId, value];
        const rows = state.data.rows.map((row) => row.key !== body.data.id ? row : { ...row, values: { ...row.values, stage: { kind: "status", value: body.data.stage }, revision: { kind: "text", value: body.data.revision } } });
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
import { salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "@k-nex/module-sales/contracts";
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
    sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor], authority: initialProjection.authority,
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
return `async function allowed(payload: Payload, context: KnexRequestContext, permissionId: string, recordId?: string, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  const result = await kNexAuthority(payload).adapter.allows(context, target(permissionId, recordId));
  return !signal?.aborted && result;
}

function authorization(user: unknown) {
  if (typeof user !== "object" || user === null || !("id" in user) || user.id === undefined || user.id === null) throw new TypeError("Sales authentication is unavailable.");
  const id = String(user.id);
  return { principal: { kind: "user" as const, id }, effectiveActor: { kind: "user" as const, id } };
}

async function actor(payload: Payload, context: KnexRequestContext) {
  const authentication = await payload.auth({ headers: context.headers, canSetHeaders: false });
  const request = { payload, user: authentication.user ?? null, headers: context.headers } as PayloadRequest;
  return { authorization: authorization(authentication.user), request };
}

export async function workspaceSalesPermissions(payload: Payload, context: KnexRequestContext, signal?: AbortSignal) {
  const results = await Promise.all(kNexSalesRegistry.permissionDescriptors.map(async (descriptor) => [descriptor.id, await allowed(payload, context, descriptor.id, undefined, signal)] as const));
  return results.filter(([, result]) => result).map(([id]) => id);
}

const workspaceSalesPolicy: DataSourcePolicyService = {
  authorize({ descriptor }) {
    const recordScope = descriptor.id === "sales.opportunities"
      ? { kind: "sales.opportunities" }
      : descriptor.id === "sales.tasks" || descriptor.id === "sales.total-potential-revenue"
        ? { kind: "sales.tasks" }
        : undefined;
    return Object.freeze({
      sourceAllowed: recordScope !== undefined,
      recordScope,
      allowedFields: Object.freeze(descriptor.outputFields?.map(({ id }) => id) ?? [])
    });
  }
};

function workspaceSalesGateway(payload: Payload, context: KnexRequestContext): DataSourceGateway {
  return new DataSourceGateway({
    authenticator: new PayloadRequestAuthenticator({
      actor: (request) => authorization(request.user),
      authorizationContext: () => context,
      requestContext(request) {
        return createPayloadPersistenceCapability(request, [
          { collection: "sales-tasks", operations: ["find"] },
          { collection: "sales-opportunities", operations: ["find"] }
        ], new CurrentAuthorityPayloadPersistenceAuthorizer(kNexAuthority(payload).adapter, context, ({ collection, operation }) => {
          const permissionId = collection === "sales-tasks" && operation === "find" ? "sales.tasks.read"
            : collection === "sales-opportunities" && operation === "find" ? "sales.opportunities.read"
            : undefined;
          if (permissionId === undefined) throw new TypeError("Sales persistence operation is unavailable.");
          return target(permissionId, "payload-" + collection + "-" + operation);
        }));
      }
    }),
    catalog: { lookup: (sourceId) => sources.get(sourceId) },
    surfaceAudience: new DescriptorSurfaceAudienceGuard(),
    authorization: new PolicyAuthorizationEvaluator(new CurrentAuthorityDataSourcePolicy(
      kNexAuthority(payload).adapter,
      (request) => request.authorizationContext as KnexRequestContext,
      {
        source: (descriptor) => target(descriptor.permission),
        field: (descriptor, fieldId) => {
          const field = descriptor.outputFields?.find(({ id }) => id === fieldId);
          if (field === undefined) throw new TypeError("Registered Sales source field is unavailable.");
          return target(field.permission);
        }
      },
      workspaceSalesPolicy
    )),
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

export async function loadWorkspaceSalesSources(payload: Payload, context: KnexRequestContext, document: UiDocument, signal: AbortSignal) {
  const gateway = workspaceSalesGateway(payload, context);
  const current = await actor(payload, context);
  const output: Record<string, DataSourceBindingResult<unknown>> = {};
  for (const node of sourceNodes(document)) {
    const binding = node.bindings?.source;
    if (binding === undefined) continue;
    const source = sources.get(binding.source.id);
    const descriptor = source?.definition.descriptor;
    if (descriptor === undefined || descriptor.version !== binding.source.version || descriptor.structuralCompatibilityHash !== binding.structuralCompatibilityHash) throw new TypeError("Workspace Sales source binding is unavailable.");
    const selectedFields = binding.selectedFields ?? descriptor.outputFields?.filter(({ binding }) => binding === "required").map(({ id }) => id) ?? [];
    const response = await gateway.query({
      correlationId: context.correlationId,
      rawRequest: current.request,
      sourceId: descriptor.id,
      surface: "workspace",
      input: binding.input,
      query: descriptor.primaryContract.id === "metric.scalar" ? { filters: [], sort: [] } : { page: { number: 1, size: 25 }, filters: [], sort: [] },
      selectedFields,
      signal
    });
    if (response.ok) { output[node.id] = { state: "success", data: response.body.data }; continue; }
    if (response.status === 403) {
      output[node.id] = {
        state: response.body.code === "INSUFFICIENT_FIELD_PERMISSION" ? "insufficient-permission" : "forbidden",
        problem: { code: response.body.code, status: 403 }
      };
      continue;
    }
    if (response.status === 429) {
      output[node.id] = { state: "rate-limited", problem: { code: response.body.code, status: 429 } };
      continue;
    }
    throw new DataSourceGatewayError(response.body.code, response.status, response.body.title, response.body.detail);
  }
  return output;
}

export async function executeWorkspaceSalesAction(payload: Payload, context: KnexRequestContext, action: Readonly<{ id: string; version: number }>, input: unknown, idempotencyKey: string, signal: AbortSignal) {
  const contribution = kNexSalesRegistry.scopedRegistration.contributions.actions.find((entry) => entry.id === action.id)?.value as { readonly descriptor?: { readonly id?: unknown; readonly version?: unknown } } | undefined;
  if (contribution?.descriptor?.id !== action.id || contribution.descriptor.version !== action.version) throw Object.assign(new Error("Workspace Sales action is unavailable."), { code: "NOT_FOUND" });
  const gateway = new RegisteredActionGateway(kNexSalesRegistry.scopedRegistration, {
    async authenticate() {
      const current = await actor(payload, context);
      return { actor: current.authorization, request: current.request, authorizationContext: context };
    }
  }, new CurrentAuthorityActionGatewayPolicy(kNexAuthority(payload).adapter, ({ authenticated }) => authenticated.authorizationContext as KnexRequestContext, (definition, value) => {
    const recordId = typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" ? value.id : undefined;
    return target(definition.descriptor.permission, recordId);
  }, { authorize: () => Object.freeze({}) }));
  return gateway.execute({ correlationId: context.correlationId, rawRequest: { payload }, actionId: action.id, input, idempotencyKey, signal });
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
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode !== null && mode !== "edit") throw new TypeError("Workspace page session mode is invalid.");
    const requested = requestedWatermark(new URL(request.url).searchParams.get("watermark"));
    if (new URL(request.url).searchParams.has("watermark") && requested === undefined) throw new TypeError("Workspace page watermark is invalid.");
    const context = kNexRequestContext(await getHeaders(), mode === "edit" ? "workspace-page-editor-session" : "workspace-page-session");
    const pageId = (await params).pageId;
    const watermark = await readWorkspacePageWatermark(payload, context, pageId, mode === "edit" ? "edit" : "view", context.correlationId);
    if (requested !== undefined && (mode === "edit" || sameWatermark(requested, watermark))) return Response.json({ watermark }, { headers: { "cache-control": "no-store" } });
    const projection = mode === "edit"
      ? await loadWorkspacePageEditorProjection(payload, context, pageId, context.correlationId)
      : await loadWorkspacePageViewProjection(payload, context, pageId, context.correlationId);
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
function boundAction(document: UiDocument, actionId: string): Readonly<{ id: string; version: number }> | undefined {
  let bound: Readonly<{ id: string; version: number }> | undefined;
  const visit = (node: UiNode): void => {
    if (bound !== undefined) return;
    const action = node.bindings?.action;
    if (action?.id === actionId) { bound = { id: action.id, version: action.version }; return; }
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
      const action = boundAction(detail.publication.revision.document, actionId);
      if (action === undefined) return notFound();
      if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join("\\0") !== "idempotencyKey\\0input") throw new TypeError("Workspace Sales action body is invalid.");
      const value = body as Record<string, unknown>;
      if (typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value.idempotencyKey)) throw new TypeError("Workspace Sales idempotency key is invalid.");
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
  const sources = [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor].flatMap((candidate) => {
    const registered = contribution("sources", candidate.id, candidate.version) as typeof candidate | undefined;
    if (registered === undefined || registered.id !== candidate.id || registered.version !== candidate.version || !permissions.has(registered.permission)) return [];
    return [{ ...registered, ...(registered.outputFields === undefined ? {} : { outputFields: registered.outputFields.filter(({ permission }) => permissions.has(permission)) }) }];
  });
  const actions = [salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor].flatMap((candidate) => {
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
      profile.validateChange(previous, { ...document, version: previous.version });
      return profile.validateDocument(document);
    },
    async validateDocument({ context, document, signal }) { return (await workspaceBuilderProfile(payload, context, signal)).validateDocument(document); }
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

async function salesGenerationImpact(payload: Payload, lifecycleRevision: number | undefined) {
  const result = await (payload.db.pool as RuntimeExtensionPool).query<{ exact_state: string | null; exact_lifecycle_revision: number | null; other_current: boolean; generation_count: string }>(
    \`select
       max(state) filter (where authorization_generation=$3 and runtime_generation_ids=$4::jsonb) exact_state,
       max(lifecycle_revision) filter (where authorization_generation=$3 and runtime_generation_ids=$4::jsonb) exact_lifecycle_revision,
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
  if (generation.exact_lifecycle_revision !== lifecycleRevision) return "plugin-updated" as const;
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
        const pluginCode = usesSales(document) ? await salesGenerationImpact(payload, state?.lifecycleRevision) : undefined;
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
  listenForInvalidations(payload, synchronizeInvalidations);
  return Object.freeze({ service, store, folders, authority, sessions, synchronizeInvalidations, resolvePlacement });
}

export const kNexWorkspacePageScope = scope;

export function kNexWorkspacePages(payload: Payload) {
  let runtime = runtimes.get(payload);
  if (runtime === undefined) { runtime = createRuntime(payload); runtimes.set(payload, runtime); }
  return runtime;
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

export async function loadWorkspacePageViewProjection(payload: Payload, context: KnexRequestContext, pageId: string, sessionId: string) {
  const session = await openWorkspacePageSession(payload, context, pageId, "view", sessionId);
  try {
    const detail = session.detail;
    if (detail.page.state !== "published" || detail.impact.state !== "ready" || detail.publication === undefined) throw new TypeError("Workspace page publication is unavailable.");
    const document = detail.publication.revision.document;
    const [permissions, sourceResults] = await Promise.all([workspaceSalesPermissions(payload, context, session.signal), loadWorkspaceSalesSources(payload, context, document, session.signal)]);
    if (session.signal.aborted) throw new TypeError("Workspace page projection was invalidated.");
    return Object.freeze({ document, permissions, sourceResults, themeRevision: session.theme.presentation.profileRevisionId, themeMode: session.theme.presentation.mode, themeCss: session.theme.presentation.cssText, watermark: session.watermark });
  } finally { session.close(); }
}

export async function loadWorkspacePageEditorProjection(payload: Payload, context: KnexRequestContext, pageId: string, sessionId: string) {
  const session = await openWorkspacePageSession(payload, context, pageId, "edit", sessionId);
  try {
    const detail = session.detail;
    if (detail.workingCopy === undefined) throw new TypeError("Workspace page working copy is unavailable.");
    const permissions = await workspaceSalesPermissions(payload, context, session.signal);
    const sources = [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor];
    const actions = [salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor];
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
  const target = createCurrentAuthorityTarget({ permissionId: "system.workspace-pages.edit", scope: { kind: "application", resource: "system.workspace-pages" }, facts: { boundary: "workspace-folder-service", operation } });
  const decision = await runtime.authority.adapter.authorize(context, target);
  const state = await runtime.authority.store.readState(scope.applicationId, scope.environment);
  if (decision === undefined || decision.outcome !== "allow" || decision.permissionId !== "system.workspace-pages.edit" || decision.scope.kind !== "application" || decision.scope.resource !== "system.workspace-pages" || decision.applicationId !== scope.applicationId || decision.environment !== scope.environment || decision.effectiveActor.kind !== "user" ||
    state === undefined || state.applicationId !== scope.applicationId || state.environment !== scope.environment || state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision) throw new TypeError("Workspace folder operation is denied.");
  return decision;
}

async function folderCatalog(payload: Payload) {
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
    const label = typeof descriptor.labelMessageId === "string" ? kNexSalesRegistry.navigationSection.messages[descriptor.labelMessageId] : undefined;
    if (typeof descriptor.id !== "string" || descriptor.ownerPluginId !== "module.sales" || route === undefined || typeof label !== "string" || label.length < 1 || label.length > 120 || descriptor.parentId !== undefined && typeof descriptor.parentId !== "string" || !Number.isSafeInteger(descriptor.order)) throw new TypeError("Current Sales navigation descriptor is invalid.");
    return { id: descriptor.id, owner: { kind: "platform-plugin" as const, pluginId: "module.sales" }, kind: "link" as const, parentId: descriptor.parentId ?? kNexSalesRegistry.navigationSection.id, label, order: descriptor.order, target: { class: "platform-plugin" as const, ownerPluginId: "module.sales", routeId } };
  });
  const section = { id: kNexSalesRegistry.navigationSection.id, owner: { kind: "platform-plugin" as const, pluginId: "module.sales" }, kind: "folder" as const, label: kNexSalesRegistry.navigationSection.label, icon: "sales" as const, order: kNexSalesRegistry.navigationSection.order };
  return Object.freeze({ staticNodes: [...workspaceNavigationFixedNodes, section, ...children], staticParentIds: [section.id] });
}

export async function createWorkspaceFolder(payload: Payload, context: KnexRequestContext, input: Readonly<{ label: string; parentNavigationId: string; order: number; idempotencyKey: string }>) {
  const runtime = kNexWorkspacePages(payload);
  const decision = await folderDecision(payload, context, "create");
  const catalog = await folderCatalog(payload);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(input.idempotencyKey)) throw new TypeError("Workspace folder idempotency key is invalid.");
  const id = \`customer.folder.\${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}\`;
  const node = { id, owner: { kind: "customer" as const }, kind: "folder" as const, parentId: input.parentNavigationId, label: input.label, icon: "folder" as const, order: input.order };
  const fence = { applicationId: decision.applicationId, environment: decision.environment, authorizationRevision: decision.authorizationRevision, lifecycleRevision: decision.lifecycleRevision };
  try { return await runtime.folders.create(scope, node, decision.effectiveActor, fence, catalog); }
  catch (error) {
    const existing = await runtime.folders.read(scope, id);
    if (existing !== undefined && canonicalJson(existing.node) === canonicalJson(node)) return existing;
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
