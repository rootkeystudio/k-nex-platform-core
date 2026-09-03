export interface WorkspacePageApplicationFilesOptions {
  readonly applicationId: string;
}

function workspacePageRuntimeSource(): string {
  return `import { createHash, randomUUID } from "node:crypto";

import { canonicalJson, type UiDocument, type UiNode, type WorkspacePublishedRevision } from "@k-nex/contracts";
import {
  CurrentAuthorityWorkspacePageService,
  ExactWorkspacePageAclPolicy,
  PostgresWorkspaceNavigationStore,
  PostgresWorkspacePageStore,
  type RuntimeExtensionPool,
  type WorkspacePageScope,
  type WorkspacePageSnapshot
} from "@k-nex/payload-adapter";
import { createCurrentAuthorityTarget } from "@k-nex/runtime";
import type { Payload } from "payload";

import { kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";
import { kNexSalesRegistry, kNexThemePresentation } from "./k-nex-registry.js";

const platformBlocks = new Map([
  "content.stack", "content.grid", "content.section", "content.heading", "content.text", "content.card", "content.alert",
  "content.tabs", "content.accordion", "content.metric", "content.data-table", "content.form", "content.empty-state"
].map((id) => [id, 1] as const));
const scope = Object.freeze({ applicationId: kNexIdentity.applicationId, environment: kNexIdentity.environment });
const runtimes = new WeakMap<Payload, ReturnType<typeof createRuntime>>();

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
  const status = code === "NOT_FOUND" ? 404 : code === "ACCESS_DENIED" ? 403 : code === "REVISION_CONFLICT" ? 409 : 400;
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
  const roles = state && canManageAccess ? (await kNexAuthority(payload).store.readTransaction(state, (transaction) => transaction.listRoles(kNexWorkspacePageScope.applicationId))).value : [];
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
import { kNexWorkspacePages, kNexWorkspacePageScope } from "../../../../../../k-nex-workspace-pages.js";
import { exactFields, idempotencyField, integerField, openWorkspaceForm, optionalTextField, textField, workspaceMutationError, workspaceRedirect } from "../../../../../../k-nex-workspace-page-http.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ pageId: string; operation: string }> }>) {
  try {
    const { pageId, operation } = await params;
    if (!["metadata", "access", "archive"].includes(operation)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const { payload, context, form } = await openWorkspaceForm(request, \`workspace-page-\${operation}\`);
    const service = kNexWorkspacePages(payload).service;
    if (operation === "metadata") {
      exactFields(form, ["description", "expectedRevision", "idempotencyKey", "order", "parentNavigationId", "themeRevision", "title"]);
      await service.updateMetadata(context, kNexWorkspacePageScope, pageId, {
        expectedRevision: integerField(form, "expectedRevision", 1, 1_000_000_000), title: textField(form, "title", 1, 120),
        ...(optionalTextField(form, "description", 320) === undefined ? {} : { description: optionalTextField(form, "description", 320) }),
        placementSelection: { parentNavigationId: textField(form, "parentNavigationId", 1, 128), order: integerField(form, "order", 0, 1_000_000) },
        themeSelection: form.get("themeRevision"), idempotencyKey: idempotencyField(form)
      });
    } else if (operation === "archive") {
      exactFields(form, ["expectedRevision", "idempotencyKey"]);
      await service.archive(context, kNexWorkspacePageScope, pageId, integerField(form, "expectedRevision", 1, 1_000_000_000), idempotencyField(form));
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
      const roles = new Set((await kNexAuthority(payload).store.readTransaction(state, (transaction) => transaction.listRoles(kNexWorkspacePageScope.applicationId))).value.map(({ id }) => id));
      const users = await payload.find({ collection: "users", overrideAccess: true, limit: 500, pagination: false });
      if (users.totalDocs > 500) throw new TypeError("Workspace access subject ceiling exceeded.");
      const userIds = new Set(users.docs.map(({ id }) => String(id)));
      if (parsed.some(({ kind, id }) => kind === "role" ? !roles.has(id) : !userIds.has(id))) throw new TypeError("Workspace access subject is unavailable.");
      await service.replaceAccess(context, kNexWorkspacePageScope, pageId, {
        expectedPageRevision: integerField(form, "expectedPageRevision", 1, 1_000_000_000), expectedAccessRevision: integerField(form, "expectedAccessRevision", 0, 1_000_000_000),
        assignments: parsed.map(({ kind, id, capability }) => ({ subject: kind === "role" ? { kind, roleId: id } : { kind, userId: id }, capability })), idempotencyKey: idempotencyField(form)
      });
    }
    return workspaceRedirect(\`/system/workspace-pages/\${encodeURIComponent(pageId)}\`);
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
  const value = entry?.value as { readonly version?: unknown } | undefined;
  return value !== undefined && value.version === version ? value : undefined;
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
  const acl = new ExactWorkspacePageAclPolicy<KnexRequestContext>(async ({ decision, signal }) => {
    if (signal.aborted) return { roleIds: [], ownerOverride: false };
    const state = await authority.store.readState(scope.applicationId, scope.environment);
    if (state === undefined || state.authorizationRevision !== decision.authorizationRevision || state.lifecycleRevision !== decision.lifecycleRevision) return { roleIds: [], ownerOverride: false };
    const assignments = await authority.store.readTransaction(state, (transaction) => transaction.listAssignments(scope.applicationId, decision.effectiveActor));
    const receipt = await authority.store.readProtectedRoleBaselineReceipt(scope.applicationId);
    return {
      roleIds: assignments.value.filter((assignment) => assignment.state === "active").map((assignment) => assignment.roleId),
      ownerOverride: receipt?.ownerPrincipal.kind === decision.effectiveActor.kind && receipt.ownerPrincipal.id === decision.effectiveActor.id
    };
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
    identities: {
      page: (owner: WorkspacePageScope) => {
        const value = randomUUID().replaceAll("-", "");
        return { ...owner, pageId: \`workspace.page.\${value}\`, documentId: \`workspace.document.\${value}\` };
      },
      publication: () => {
        const value = randomUUID().replaceAll("-", "");
        return { revisionId: \`workspace.publication.\${value}\`, receiptId: \`workspace.receipt.\${value}\` };
      }
    },
    now: () => new Date()
  });
  return Object.freeze({ service, store, folders, authority, resolvePlacement });
}

export const kNexWorkspacePageScope = scope;

export function kNexWorkspacePages(payload: Payload) {
  let runtime = runtimes.get(payload);
  if (runtime === undefined) { runtime = createRuntime(payload); runtimes.set(payload, runtime); }
  return runtime;
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
    "src/app/(workspace)/system/workspace-pages/page.tsx": workspacePageListSource(),
    "src/app/(workspace)/system/workspace-pages/[pageId]/page.tsx": workspacePageDetailSource(),
    "src/app/api/k-nex/workspace-pages/route.ts": workspacePageCreateRouteSource(),
    "src/app/api/k-nex/workspace-pages/[pageId]/[operation]/route.ts": workspacePageMutationRouteSource(),
    "src/app/api/k-nex/workspace-folders/route.ts": workspaceFolderCreateRouteSource(),
    "src/app/api/k-nex/workspace-folders/[folderId]/route.ts": workspaceFolderUpdateRouteSource(),
    "src/k-nex-workspace-page-http.ts": workspacePageHttpSource(),
    "src/k-nex-workspace-pages.ts": workspacePageRuntimeSource()
  });
}
