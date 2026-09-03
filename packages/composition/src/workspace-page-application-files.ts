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
import { createCurrentAuthorityTarget } from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry, kNexThemePresentation } from "./k-nex-registry.js";
import { workspaceSalesPermissions } from "./k-nex-sales-workspace.js";

const platformBlocks = new Map([
  "content.stack", "content.grid", "content.section", "content.heading", "content.text", "content.card", "content.alert",
  "content.tabs", "content.accordion", "content.metric", "content.data-table", "content.form", "content.empty-state"
].map((id) => [id, 1] as const));
const scope = Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment });
const runtimes = new WeakMap<Payload, ReturnType<typeof createRuntime>>();
const invalidationChannel = "k_nex_runtime_invalidation";

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

import type { DataSourceBindingResult, UiDocument } from "@k-nex/contracts";
import {
  salesOpportunitiesDescriptor,
  salesTasksDescriptor,
  salesTotalPotentialRevenueDescriptor
} from "@k-nex/module-sales/contracts";
import {
  salesOpportunitiesHandler,
  salesTasksHandler,
  salesTotalPotentialRevenueHandler
} from "@k-nex/module-sales/server";
import { CurrentAuthorityActionGatewayPolicy, RegisteredActionGateway, createCurrentAuthorityTarget } from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexSalesRegistry } from "./k-nex-registry.js";

const sources = new Map([salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor].map((descriptor) => [descriptor.id, descriptor]));

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
import { createUiDocumentRuntime, createUiRuntimeRegistry, presentUiRuntimeResult } from "@k-nex/ui-runtime";
import { useEffect, useMemo, useState } from "react";

const runtime = createUiDocumentRuntime(createUiRuntimeRegistry({ blocks: salesUiBlockDefinitions, sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor] }));

export function WorkspacePageRuntime({ pageId, document, permissions, initialSourceResults, themeRevision, themeCss }: Readonly<{ pageId: string; document: UiDocument; permissions: readonly string[]; initialSourceResults: Readonly<Record<string, DataSourceBindingResult<unknown>>>; themeRevision: string; themeCss: string }>) {
  const [sourceResults, setSourceResults] = useState(initialSourceResults);
  const [revoked, setRevoked] = useState(false);
  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/session", { cache: "no-store" }).catch(() => undefined);
      if (response?.status === 404 || response?.status === 403) setRevoked(true);
    }, 1_000);
    return () => clearInterval(timer);
  }, [pageId]);
  const result = useMemo(() => runtime.render({
    document, surface: "workspace", actor: { authenticated: true, permissions: new Set(permissions) }, sourceResults,
    dispatchAction: async (request) => {
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/actions/" + encodeURIComponent(request.action.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: request.input, idempotencyKey: "workspace-action-" + crypto.randomUUID() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code ?? "Sales action failed.");
      setSourceResults((current) => Object.fromEntries(Object.entries(current).map(([nodeId, value]) => {
        const state = value as { state?: string; data?: { rows?: readonly { key: string; values: Record<string, unknown> }[] } };
        if (state.state !== "success" || !Array.isArray(state.data?.rows)) return [nodeId, value];
        const rows = state.data.rows.map((row) => row.key !== body.data.id ? row : { ...row, values: { ...row.values, stage: { kind: "status", value: body.data.stage }, revision: { kind: "text", value: body.data.revision } } });
        return [nodeId, { ...state, data: { ...state.data, rows } }];
      })));
      return body.data;
    }
  }), [document, permissions, sourceResults]);
  if (revoked) return <section role="alert"><h1>Page access revoked</h1><p>Current authority no longer permits this page.</p></section>;
  return <section data-k-nex-theme-profile={themeRevision}><style>{themeCss}</style>{presentUiRuntimeReact(presentUiRuntimeResult(result))}</section>;
}
`;
}

function workspacePageViewSource(): string {
  return `import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { bootKnexApplication } from "../../../../../boot.js";
import { kNexRequestContext } from "../../../../../k-nex-authority.js";
import { kNexThemePresentation } from "../../../../../k-nex-registry.js";
import { loadWorkspaceSalesSources, workspaceSalesPermissions } from "../../../../../k-nex-sales-workspace.js";
import { openWorkspacePageSession } from "../../../../../k-nex-workspace-pages.js";
import { WorkspacePageRuntime } from "../../../../components/k-nex-workspace-page-runtime.js";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "workspace-page-view");
  const pageId = (await params).pageId;
  let session;
  try { session = await openWorkspacePageSession(payload, context, pageId, "view", context.correlationId); } catch { return notFound(); }
  try {
    const detail = session.detail;
    if (detail.page.state !== "published" || detail.impact.state !== "ready" || detail.publication === undefined) return notFound();
    const document = detail.publication.revision.document;
    const [permissions, sourceResults] = await Promise.all([workspaceSalesPermissions(payload, context, session.signal), loadWorkspaceSalesSources(payload, context, document, session.signal)]);
    return <WorkspacePageRuntime pageId={pageId} document={document} permissions={permissions} initialSourceResults={sourceResults} themeRevision={detail.publication.revision.themeProfile?.revisionId ?? kNexThemePresentation.profileRevisionId} themeCss={kNexThemePresentation.cssText} />;
  } finally { session.close(); }
}
`;
}

function workspacePageEditorClientSource(): string {
  return `"use client";

import type { UiDocument } from "@k-nex/contracts";
import { salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor } from "@k-nex/module-sales/contracts";
import { salesPuckBlockBridges } from "@k-nex/module-sales/puck";
import { presentUiRuntimeReact } from "@k-nex/ui-components";
import { WorkspaceEditorSession, createAuthorizedPuckBuilderProfile } from "@k-nex/builder-puck";
import { WorkspacePuckEditorHost } from "@k-nex/builder-puck/editor";
import { useEffect, useMemo, useRef, useState } from "react";

type Resource = Readonly<{ id: string; version: number }>;
export function WorkspacePageEditor({ pageId, workingCopy, permissions, authority, rollbackRevisions }: Readonly<{ pageId: string; workingCopy: { revision: number; document: UiDocument }; permissions: readonly string[]; authority: { blocks: readonly Resource[]; sources: readonly Resource[]; actions: readonly Resource[] }; rollbackRevisions: readonly { id: string; label: string }[] }>) {
  const [revoked, setRevoked] = useState(false);
  const operations = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    operations.current = controller;
    const timer = setInterval(async () => {
      const response = await fetch("/api/k-nex/workspace-pages/" + encodeURIComponent(pageId) + "/session", { cache: "no-store", signal: controller.signal }).catch(() => undefined);
      if (response?.status === 404 || response?.status === 403) { controller.abort(); setRevoked(true); }
    }, 1_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pageId]);
  const profile = useMemo(() => createAuthorizedPuckBuilderProfile({
    profile: "workspace", publication: "save-layout", blocks: salesPuckBlockBridges,
    sources: [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor], authority,
    preview: { surface: "workspace", actor: { authenticated: true, permissions: new Set(permissions) }, present: presentUiRuntimeReact }
  }), [authority, permissions]);
  const session = useMemo(() => new WorkspaceEditorSession({
    profile, workingCopy, editorSessionId: "workspace-editor-" + crypto.randomUUID(), issueIdempotencyKey: (operation, sequence) => "workspace-" + operation + "-" + sequence + "-" + crypto.randomUUID(),
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
  }), [pageId, profile, workingCopy]);
  if (revoked) return <section role="alert"><h1>Editor access revoked</h1><p>Current authority no longer permits editing this page.</p></section>;
  return <WorkspacePuckEditorHost profile={profile} session={session} rollbackRevisions={rollbackRevisions} authentication="Authenticated" router="Workspace" sidebar="Block library" topBar="Page editor" systemScreens={null} globalDialogs={null} />;
}
`;
}

function workspacePageEditorSource(): string {
  return `import { salesOpportunitiesDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesTotalPotentialRevenueDescriptor, salesTasksDescriptor, salesOpportunityStageUpdateDescriptor, salesUiBlockDescriptors } from "@k-nex/module-sales/contracts";
import { headers as getHeaders } from "next/headers";
import { notFound } from "next/navigation";

import { bootKnexApplication } from "../../../../../../boot.js";
import { kNexRequestContext } from "../../../../../../k-nex-authority.js";
import { workspaceSalesPermissions } from "../../../../../../k-nex-sales-workspace.js";
import { openWorkspacePageSession } from "../../../../../../k-nex-workspace-pages.js";
import { WorkspacePageEditor } from "../../../../../components/k-nex-workspace-page-editor.js";

export const dynamic = "force-dynamic";
export default async function EditWorkspacePage({ params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const context = kNexRequestContext(await getHeaders(), "workspace-page-editor");
  const pageId = (await params).pageId;
  let session;
  try { session = await openWorkspacePageSession(payload, context, pageId, "edit", context.correlationId); } catch { return notFound(); }
  try {
  const detail = session.detail;
  if (detail.workingCopy === undefined) return notFound();
  const permissions = await workspaceSalesPermissions(payload, context, session.signal);
  const sources = [salesOpportunitiesDescriptor, salesTasksDescriptor, salesTotalPotentialRevenueDescriptor];
  const actions = [salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor];
  const authority = {
    blocks: salesUiBlockDescriptors.filter(({ permission }) => permission === undefined || permissions.includes(permission)).map(({ id, version }) => ({ id, version })),
    sources: sources.filter(({ permission }) => permissions.includes(permission)).map(({ id, version }) => ({ id, version })),
    actions: actions.filter(({ permission }) => permissions.includes(permission)).map(({ id, version }) => ({ id, version }))
  };
  const rollbackIds = [detail.publication?.pointer.publishedRevisionId, detail.publication?.pointer.previousPublishedRevisionId].filter((id): id is string => id !== undefined);
  return <WorkspacePageEditor pageId={pageId} workingCopy={{ revision: detail.workingCopy.revision, document: detail.workingCopy.document }} permissions={permissions} authority={authority} rollbackRevisions={rollbackIds.map((id, index) => ({ id, label: "Published revision " + (index + 1) }))} />;
  } finally { session.close(); }
}
`;
}

function workspaceSalesServerTailSource(): string {
  return `async function allowed(payload: Payload, context: KnexRequestContext, permissionId: string, recordId?: string, signal?: AbortSignal) {
  if (signal?.aborted) return false;
  const result = await kNexAuthority(payload).adapter.allows(context, target(permissionId, recordId));
  return !signal?.aborted && result;
}

async function actor(payload: Payload, context: KnexRequestContext) {
  const authentication = await payload.auth({ headers: context.headers, canSetHeaders: false });
  const id = authentication.user?.id;
  if (id === undefined || id === null) throw new TypeError("Sales authentication is unavailable.");
  return { authorization: { principal: { kind: "user" as const, id: String(id) }, effectiveActor: { kind: "user" as const, id: String(id) } }, user: authentication.user };
}

export async function workspaceSalesPermissions(payload: Payload, context: KnexRequestContext, signal?: AbortSignal) {
  const results = await Promise.all(kNexSalesRegistry.permissionDescriptors.map(async (descriptor) => [descriptor.id, await allowed(payload, context, descriptor.id, undefined, signal)] as const));
  return results.filter(([, result]) => result).map(([id]) => id);
}

export async function loadWorkspaceSalesSources(payload: Payload, context: KnexRequestContext, document: UiDocument, signal: AbortSignal) {
  const current = await actor(payload, context);
  const request = { payload, user: current.user };
  const output: Record<string, DataSourceBindingResult<unknown>> = {};
  for (const nodes of Object.values(document.regions)) for (const node of nodes) {
    const binding = node.bindings?.source;
    if (binding === undefined) continue;
    const descriptor = sources.get(binding.source.id);
    if (descriptor === undefined || descriptor.version !== binding.source.version || descriptor.structuralCompatibilityHash !== binding.structuralCompatibilityHash) throw new TypeError("Workspace Sales source binding is unavailable.");
    const selectedFields = binding.selectedFields ?? descriptor.outputFields?.filter(({ binding }) => binding === "required").map(({ id }) => id) ?? [];
    const permissions = [descriptor.permission, ...(descriptor.outputFields ?? []).filter(({ id }) => selectedFields.includes(id)).map(({ permission }) => permission)];
    if (!(await Promise.all(permissions.map((permission) => allowed(payload, context, permission, undefined, signal)))).every(Boolean)) { output[node.id] = { state: "insufficient-permission", problem: { code: "SOURCE_FIELD_PERMISSION_DENIED", status: 403 } }; continue; }
    const recordScope = { kind: descriptor.id === salesOpportunitiesDescriptor.id ? "sales.opportunities" as const : "sales.tasks" as const };
    const common = { actor: current.authorization, request, input: binding.input, query: { page: { number: 1, size: 25 }, filters: [], sort: [] }, selectedFields, recordScope, signal };
    const data = descriptor.id === salesOpportunitiesDescriptor.id ? await salesOpportunitiesHandler(common)
      : descriptor.id === salesTasksDescriptor.id ? await salesTasksHandler(common)
      : await salesTotalPotentialRevenueHandler(common);
    output[node.id] = { state: "success", data };
  }
  return output;
}

export async function executeWorkspaceSalesAction(payload: Payload, context: KnexRequestContext, action: Readonly<{ id: string; version: number }>, input: unknown, idempotencyKey: string, signal: AbortSignal) {
  const contribution = kNexSalesRegistry.scopedRegistration.contributions.actions.find((entry) => entry.id === action.id)?.value as { readonly descriptor?: { readonly id?: unknown; readonly version?: unknown } } | undefined;
  if (contribution?.descriptor?.id !== action.id || contribution.descriptor.version !== action.version) throw Object.assign(new Error("Workspace Sales action is unavailable."), { code: "NOT_FOUND" });
  const gateway = new RegisteredActionGateway(kNexSalesRegistry.scopedRegistration, {
    async authenticate() {
      const current = await actor(payload, context);
      return { actor: current.authorization, request: { payload, user: current.user }, authorizationContext: context };
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
import { kNexThemePresentation } from "../../../../k-nex-registry.js";
import { kNexWorkspacePages, kNexWorkspacePageScope } from "../../../../k-nex-workspace-pages.js";

export const dynamic = "force-dynamic";

export default async function WorkspacePagesAdministration() {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "workspace-pages-admin");
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
      { name: "themeRevision", label: "Theme Profile", type: "select", value: "", options: [{ value: "", label: "Application default" }, { value: kNexThemePresentation.profileRevisionId, label: \`Current admin profile (\${kNexThemePresentation.profileRevisionId})\` }] }
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

import { authorizeRequest, kNexAuthority, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { bootKnexApplication } from "../../../../../boot.js";
import { kNexThemePresentation } from "../../../../../k-nex-registry.js";
import { kNexWorkspacePages, kNexWorkspacePageScope } from "../../../../../k-nex-workspace-pages.js";

export const dynamic = "force-dynamic";

export default async function WorkspacePageAdministration({ params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  const payload = await bootKnexApplication("workspace-web");
  const headers = await getHeaders();
  const context = kNexRequestContext(headers, "workspace-page-admin");
  const pageId = (await params).pageId;
  const runtime = kNexWorkspacePages(payload);
  let detail;
  try { detail = await runtime.service.detail(context, kNexWorkspacePageScope, pageId, "edit"); } catch { return notFound(); }
  const [folders, audit, canManageAccess, canPublish] = await Promise.all([
    runtime.folders.list(kNexWorkspacePageScope), runtime.service.audit(context, kNexWorkspacePageScope, pageId, 100),
    authorizeRequest(payload, context, "system.workspace-pages.access.manage", "system.workspace-pages"),
    authorizeRequest(payload, context, "system.workspace-pages.publish", "system.workspace-pages")
  ]);
  const access = canManageAccess ? await runtime.service.readAccess(context, kNexWorkspacePageScope, pageId) : undefined;
  const parents = [{ value: "sales.navigation.root", label: "Sales" }, ...folders.map(({ node }) => ({ value: node.id, label: node.label }))];
  const state = await kNexAuthority(payload).store.readState(kNexWorkspacePageScope.applicationId, kNexWorkspacePageScope.environment);
  const expected = state && { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
  const roles = expected && canManageAccess ? (await kNexAuthority(payload).store.readTransaction(expected, (transaction) => transaction.listRoles(kNexWorkspacePageScope.applicationId))).value : [];
  const users = canManageAccess ? await payload.find({ collection: "users", overrideAccess: true, limit: 500, pagination: false }) : { docs: [], totalDocs: 0 };
  if (users.totalDocs > 500) throw new TypeError("Workspace access subject ceiling exceeded.");
  const assignments = access?.assignments ?? [];
  const selected = (kind: "role" | "user", id: string, capability: "view" | "edit") => assignments.some((assignment) => assignment.capability === capability && (assignment.subject.kind === "role" ? kind === "role" && assignment.subject.roleId === id : kind === "user" && assignment.subject.userId === id));
  const options = [
    ...roles.flatMap((role) => (["view", "edit"] as const).map((capability) => ({ value: \`role|\${role.id}|\${capability}\`, label: \`Role: \${role.label} — \${capability}\`, selected: selected("role", role.id, capability) }))),
    ...users.docs.flatMap((user) => (["view", "edit"] as const).map((capability) => ({ value: \`user|\${String(user.id)}|\${capability}\`, label: \`User: \${String(user.email ?? user.id)} — \${capability}\`, selected: selected("user", String(user.id), capability) })))
  ];
  const idempotency = () => \`workspace-admin-\${randomUUID()}\`;
  const page = detail.page;
  return <SystemWorkspacePageDetailPage view={{
    title: "Workspace page", pageId, pageTitle: page.title, pageState: page.state,
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
      { name: "themeRevision", label: "Theme Profile", type: "select", value: page.themeProfile?.revisionId ?? "", options: [{ value: "", label: "Application default" }, { value: kNexThemePresentation.profileRevisionId, label: \`Current admin profile (\${kNexThemePresentation.profileRevisionId})\` }] }
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
  return `import { kNexAuthority } from "../../../../../../k-nex-authority.js";
import { kNexWorkspacePages, kNexWorkspacePageScope, openWorkspacePageSession } from "../../../../../../k-nex-workspace-pages.js";
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
      const state = await kNexAuthority(payload).store.readState(kNexWorkspacePageScope.applicationId, kNexWorkspacePageScope.environment);
      if (state === undefined) throw new TypeError("Workspace authority state is unavailable.");
      const expected = { applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision };
      const roles = new Set((await kNexAuthority(payload).store.readTransaction(expected, (transaction) => transaction.listRoles(kNexWorkspacePageScope.applicationId))).value.map(({ id }) => id));
      const users = await payload.find({ collection: "users", overrideAccess: true, limit: 500, pagination: false });
      if (users.totalDocs > 500) throw new TypeError("Workspace access subject ceiling exceeded.");
      const userIds = new Set(users.docs.map(({ id }) => String(id)));
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
import { openWorkspacePageSession } from "../../../../../../k-nex-workspace-pages.js";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Readonly<{ params: Promise<{ pageId: string }> }>) {
  try {
    const payload = await bootKnexApplication("workspace-web");
    const context = kNexRequestContext(await getHeaders(), "workspace-page-session");
    const session = await openWorkspacePageSession(payload, context, (await params).pageId, "view", context.correlationId);
    try { return Response.json({ pageRevision: session.detail.page.revision, accessRevision: session.detail.page.accessRevision }, { headers: { "cache-control": "no-store" } }); }
    finally { session.close(); }
  } catch {
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
  const blocks = salesPuckBlockBridges.filter((bridge) => {
    const registered = contribution("blocks", bridge.definition.id, bridge.definition.version) as { readonly id?: unknown; readonly version?: unknown; readonly permission?: unknown } | undefined;
    return registered?.id === bridge.definition.id && registered.version === bridge.definition.version &&
      (registered.permission === undefined || typeof registered.permission === "string" && permissions.has(registered.permission));
  });
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
    else if (contribution("blocks", node.type, node.version) !== undefined) add({ kind: "block", id: node.type, version: node.version, owner: { kind: "platform-plugin", pluginId: "module.sales", version: "1.0.0" } });
    else throw new TypeError(\`Workspace block \${node.type}@\${node.version} is unavailable.\`);
    const source = node.bindings?.source;
    if (source !== undefined) {
      const descriptor = contribution("sources", source.source.id, source.source.version) as { readonly structuralCompatibilityHash?: unknown } | undefined;
      if (descriptor === undefined || descriptor.structuralCompatibilityHash !== source.structuralCompatibilityHash) throw new TypeError("Workspace source dependency is unavailable.");
      add({ kind: "source", id: source.source.id, version: source.source.version, owner: { kind: "platform-plugin", pluginId: "module.sales", version: "1.0.0" }, structuralCompatibilityHash: source.structuralCompatibilityHash });
    }
    const action = node.bindings?.action;
    if (action !== undefined) {
      if (contribution("actions", action.id, action.version) === undefined) throw new TypeError("Workspace action dependency is unavailable.");
      add({ kind: "action", id: action.id, version: action.version, owner: { kind: "platform-plugin", pluginId: "module.sales", version: "1.0.0" } });
    }
  }
  const ordered = [...entries.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return { entries: ordered, digest: digest(ordered) };
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
    const assignments = await authority.store.readTransaction(expected, (transaction) => transaction.listAssignments(scope.applicationId, decision.effectiveActor));
    const receipt = await authority.store.readProtectedRoleBaselineReceipt(scope.applicationId);
    const roleIds = assignments.value.filter((assignment) => assignment.state === "active").map((assignment) => assignment.roleId);
    const ownerOverride = receipt?.ownerPrincipal.kind === decision.effectiveActor.kind && receipt.ownerPrincipal.id === decision.effectiveActor.id;
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
      if (selection !== kNexThemePresentation.profileRevisionId || kNexThemePresentation.surface !== "admin") throw new TypeError("Workspace Theme Profile is unavailable.");
      return { profileId: "workspace.default-theme", revisionId: kNexThemePresentation.profileRevisionId, surface: "admin" as const };
    },
    dependencies({ snapshot }: Readonly<{ snapshot: WorkspacePageSnapshot }>) { return dependenciesFor(snapshot.workingCopy.document); },
    async impact({ snapshot, revision }: Readonly<{ snapshot: WorkspacePageSnapshot; revision?: WorkspacePublishedRevision }>) {
      const state = await authority.store.readState(scope.applicationId, scope.environment);
      const selected = revision;
      const theme = selected?.themeProfile ?? snapshot.page.themeProfile;
      const fallback = (snapshot.page.dependencyDigest ?? digest([])) as \`sha256:\${string}\`;
      if (theme !== undefined && (theme.revisionId !== kNexThemePresentation.profileRevisionId || theme.surface !== "admin")) return { state: "dependency-unavailable" as const, code: "theme-unavailable" as const, catalogRevision: state?.lifecycleRevision ?? 0, dependencyDigest: fallback };
      try {
        const dependencies = dependenciesFor(selected?.document ?? snapshot.workingCopy.document);
        return { state: "ready" as const, catalogRevision: state?.lifecycleRevision ?? 0, dependencyDigest: dependencies.digest as \`sha256:\${string}\` };
      } catch {
        return { state: "dependency-unavailable" as const, code: "plugin-removed" as const, catalogRevision: state?.lifecycleRevision ?? 0, dependencyDigest: fallback };
      }
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

export async function openWorkspacePageSession(payload: Payload, context: KnexRequestContext, pageId: string, capability: "view" | "edit", sessionId: string) {
  const runtime = kNexWorkspacePages(payload);
  const detail = await runtime.service.detail(context, scope, pageId, capability);
  const state = await runtime.synchronizeInvalidations();
  const session = runtime.sessions.open({ ...scope, pageId, sessionId, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision, accessRevision: detail.page.accessRevision, pageRevision: detail.page.revision });
  return Object.freeze({ detail, signal: session.signal, close: session.close });
}

async function folderDecision(payload: Payload, context: KnexRequestContext, operation: string) {
  const runtime = kNexWorkspacePages(payload);
  const target = createCurrentAuthorityTarget({ permissionId: "system.workspace-pages.edit", scope: { kind: "application", resource: "system.workspace-pages" }, facts: { boundary: "workspace-folder-service", operation } });
  const decision = await runtime.authority.adapter.authorize(context, target);
  if (decision === undefined || decision.outcome !== "allow" || decision.applicationId !== scope.applicationId || decision.environment !== scope.environment || decision.effectiveActor.kind !== "user") throw new TypeError("Workspace folder operation is denied.");
  return decision;
}

export async function createWorkspaceFolder(payload: Payload, context: KnexRequestContext, input: Readonly<{ label: string; parentNavigationId: string; order: number; idempotencyKey: string }>) {
  const runtime = kNexWorkspacePages(payload);
  const decision = await folderDecision(payload, context, "create");
  await runtime.resolvePlacement({ parentNavigationId: input.parentNavigationId, order: input.order });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(input.idempotencyKey)) throw new TypeError("Workspace folder idempotency key is invalid.");
  const id = \`customer.folder.\${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}\`;
  const node = { id, owner: { kind: "customer" as const }, kind: "folder" as const, parentId: input.parentNavigationId, label: input.label, icon: "folder" as const, order: input.order };
  try { return await runtime.folders.create(scope, node, decision.effectiveActor); }
  catch (error) {
    const existing = await runtime.folders.read(scope, id);
    if (existing !== undefined && canonicalJson(existing.node) === canonicalJson(node)) return existing;
    throw error;
  }
}

export async function updateWorkspaceFolder(payload: Payload, context: KnexRequestContext, input: Readonly<{ folderId: string; expectedRevision: number; label: string; parentNavigationId: string; order: number }>) {
  const runtime = kNexWorkspacePages(payload);
  const decision = await folderDecision(payload, context, "update");
  await runtime.resolvePlacement({ parentNavigationId: input.parentNavigationId, order: input.order });
  const existing = await runtime.folders.read(scope, input.folderId);
  if (existing === undefined || existing.node.id === input.parentNavigationId) throw new TypeError("Workspace folder is unavailable.");
  const graph = new Map((await runtime.folders.list(scope)).map(({ node }) => [node.id, node]));
  let parentId: string | undefined = input.parentNavigationId;
  const visited = new Set<string>();
  while (parentId !== undefined && graph.has(parentId)) {
    if (parentId === input.folderId || visited.has(parentId)) throw new TypeError("Workspace folder move creates a cycle.");
    visited.add(parentId);
    parentId = graph.get(parentId)?.parentId;
  }
  return runtime.folders.update(scope, { ...existing.node, label: input.label, parentId: input.parentNavigationId, order: input.order }, input.expectedRevision, decision.effectiveActor);
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
