import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";

import {
  SystemAssignmentsPage,
  SystemAuthorizationAuditPage,
  SystemExtensionDetailPage,
  SystemExtensionsPage,
  SystemPermissionsPage,
  SystemRoleDetailPage,
  SystemRolesPage,
  SystemTemplatesPage
} from "@k-nex/ui-pages";
import {
  SystemAccessAdministrationError,
  SystemAccessAdministrationService,
  type ActivePermissionGroup,
  SystemExtensionAdministrationError,
  SystemExtensionAdministrationService,
  type SystemExtensionExpectedRevision,
  type SystemExtensionPlan
} from "@k-nex/runtime";

type Context = object | undefined;
type Expected = Readonly<{ readonly applicationId: string; readonly environment: string; readonly authorizationRevision: number; readonly lifecycleRevision: number; readonly extensionRevision: number }>;

export interface SystemAdministrationHostOptions<TContext extends Context> {
  readonly access: SystemAccessAdministrationService<TContext>;
  readonly extensions: SystemExtensionAdministrationService<TContext>;
  /** Session selection is host-owned; request bodies never select an actor. */
  context(request: IncomingMessage): TContext;
  /** Opaque, host-owned session key. It scopes short-lived extension plan state. */
  sessionKey(context: TContext): string | undefined;
  /** Reads the current database/inventory revisions immediately before a mutation. */
  expected(): Promise<Expected>;
}

export interface SystemAdministrationHost {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

const routeIds = new Set([
  "/system/access/roles", "/system/access/permissions", "/system/access/assignments", "/system/access/templates",
  "/system/access/audit", "/system/extensions"
]);

const apiPrefix = "/api/system/";

/**
 * The fixture's complete system-administration surface. Routes are fixed host
 * routes; all rendering and mutation admission stays on the host process.
 */
export async function startSystemAdministrationHost<TContext extends Context>(options: SystemAdministrationHostOptions<TContext>): Promise<SystemAdministrationHost> {
  const planned = new Map<string, PlanState>();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://system-administration.invalid");
      if (request.method === "GET" && (routeIds.has(url.pathname) || isRoleRoute(url.pathname) || isExtensionRoute(url.pathname))) {
        await renderRoute(options, request, response, url.pathname, planned);
        return;
      }
      if (request.method === "POST" && url.pathname.startsWith(apiPrefix)) {
        await action(options, request, response, url.pathname, planned);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    } catch (error) {
      writeError(response, error);
    }
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("System administration host did not bind a TCP port.");
  return Object.freeze({
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  });
}

type PlanState = Readonly<{ readonly expected: Expected; readonly display: string; readonly impact: SystemExtensionPlan["impact"]; readonly operationId: string }>;

async function renderRoute<TContext extends Context>(options: SystemAdministrationHostOptions<TContext>, request: IncomingMessage, response: ServerResponse, path: string, planned: Map<string, PlanState>): Promise<void> {
  const context = options.context(request);
  let page: ReactElement;
  if (path === "/system/access/roles") {
    const roles = await options.access.roles({ context });
    const expected = await options.expected();
    const detail = await Promise.all(roles.roles.map((role) => options.access.roleDetail({ context, roleId: role.id })));
    page = createElement(SystemRolesPage, { view: {
      title: "Roles", revision: revision(expected),
      roles: roles.roles.map((role, index) => ({ id: role.id, label: role.label, href: `/system/access/roles/${role.id}`, permissionCount: String(detail[index]!.grants.length), assignmentCount: String(detail[index]!.assignments.length), state: role.protectedRoleId ? "protected" : "active" }))
    } });
  } else if (isRoleRoute(path)) {
    const roleId = decodePathSegment(path, "/system/access/roles/");
    const [detail, permissions, templates] = await Promise.all([
      options.access.roleDetail({ context, roleId }), options.access.permissions({ context }), options.access.templates({ context })
    ]);
    const expected = await options.expected();
    page = createElement(SystemRoleDetailPage, { view: {
      title: "Role", revision: revision(expected), roleLabel: detail.role.label, roleState: detail.role.protectedRoleId ? "protected" : "active",
      activePermissionGroups: permissionGroups(permissions.active, roleId, accessExpected(expected)),
      templates: templates.map((template) => ({ id: template.template.id, title: template.template.title, description: `Version ${template.template.version}; ${template.template.permissionIds.length} active permissions.`,
        copySelected: selectionForm(`Copy ${template.template.id} permissions`, "/api/system/access/templates/copy", { expected: accessExpected(expected), templateId: template.template.id, roleId }, "permissionIds", "Permissions to copy", template.template.permissionIds) })),
      inactiveDiagnostics: detail.grants.filter((grant) => grant.state === "inactive").map((grant) => ({ id: grant.grant.id, label: grant.grant.permissionId, state: grant.inactiveReason ?? "inactive", detail: "This grant remains visible but cannot authorize." }))
    } });
  } else if (path === "/system/access/permissions") {
    const permissions = await options.access.permissions({ context });
    const expected = await options.expected();
    page = createElement(SystemPermissionsPage, { view: {
      title: "Permissions", revision: revision(expected),
      permissions: [
        ...permissions.active.flatMap((group) => group.permissions.map((permission) => ({ id: permission.descriptor.id, label: permission.descriptor.title, owner: ownerLabel(group.owner), resource: group.resource, operation: group.operation, state: "active" }))),
        ...permissions.inactive.map(({ snapshot }) => ({ id: snapshot.id, label: snapshot.permission.title, owner: snapshot.owner ? ownerLabel(snapshot.owner) : "Unknown owner", resource: snapshot.permission.resource, operation: snapshot.permission.operation, state: snapshot.state, detail: "Administrative diagnostic only; it cannot authorize." }))
      ]
    } });
  } else if (path === "/system/access/assignments") {
    const [assignments, roles] = await Promise.all([options.access.assignments({ context }), options.access.roles({ context, includeInactive: true })]);
    const expected = await options.expected();
    const labels = new Map(roles.roles.map((role) => [role.id, role.label]));
    page = createElement(SystemAssignmentsPage, { view: { title: "Assignments", revision: revision(expected),
      createAssignment: form("Create fixture assignment", "/api/system/access/assignments", { expected: accessExpected(expected), assignment: { id: "customer.mixed-assignment", principal: { kind: "user", id: "user:inactive-role" }, roleId: "customer.mixed-role" } }),
      assignments: assignments.map((assignment) => ({ id: assignment.id, principal: `${assignment.principal.kind}:${assignment.principal.id}`, role: labels.get(assignment.roleId) ?? assignment.roleId, state: assignment.state, revision: String(assignment.revision),
        ...(assignment.state === "revoked" ? { detail: "Inactive role assignment retained for diagnostics." } : { revoke: form(`Revoke ${assignment.id}`, `/api/system/access/assignments/${encodeURIComponent(assignment.id)}/revoke`, { expected: accessExpected(expected) }) }) })) } });
  } else if (path === "/system/access/templates") {
    const templates = await options.access.templates({ context });
    const expected = await options.expected();
    page = createElement(SystemTemplatesPage, { view: { title: "Role templates", revision: revision(expected), templates: templates.map((template) => ({ id: template.template.id, title: template.template.title, owner: template.owner.extensionId, version: String(template.template.version), state: "active", detail: `${template.template.permissionIds.length} active permissions.`,
      instantiate: form(`Instantiate ${template.template.id}`, "/api/system/access/templates/instantiate", { expected: accessExpected(expected), templateId: template.template.id, role: { id: "customer.sales-manager", label: "Customer sales manager" } }) })) } });
  } else if (path === "/system/access/audit") {
    const audits = await options.access.audits({ context, limit: 100 });
    const expected = await options.expected();
    page = createElement(SystemAuthorizationAuditPage, { view: { title: "Authorization audit", revision: revision(expected), events: audits.map(({ audit, occurredAt }) => ({ id: audit.auditId, occurredAt, outcome: audit.outcome, reason: audit.reason, permission: audit.permissionId, owner: ownerLabel(audit.owner), revision: `${audit.authorizationRevision}/${audit.lifecycleRevision}` })) } });
  } else if (path === "/system/extensions") {
    const [extensions, status] = await Promise.all([options.extensions.list({ context }), options.extensions.status({ context })]);
    const expected = await options.expected();
    page = createElement(SystemExtensionsPage, { view: { title: "Extensions", revision: revision(expected), extensions: await Promise.all(extensions.map(async (extension) => ({ id: extension.extension.id, label: extension.displayName, href: `/system/extensions/${extension.extension.id}`, deliveryClassLabel: deliveryLabel(extension.extension.deliveryClass), availabilityLabel: await planLabel(options, context, planned, extension.extension.id, expected), lifecycleLabel: inventoryDisposition(status.inventory, extension.extension), revision: String(status.inventory.revision) }))) } });
  } else {
    const extensionId = decodePathSegment(path, "/system/extensions/");
    const [records, status] = await Promise.all([options.extensions.list({ context, includeUnavailable: true }), options.extensions.status({ context })]);
    const extension = records.find((candidate) => candidate.extension.id === extensionId);
    if (!extension) throw new RouteError(404, "Extension not found.");
    const expected = await options.expected();
    const currentPlan = await planStatus(options, context, planned, extensionId, expected);
    const requestValue = { extension: extension.extension, operation: "install", targetVersion: extension.version, idempotencyKey: `system-plan-${extensionId.replace(/[^a-z]/gu, "")}` };
    page = createElement(SystemExtensionDetailPage, { view: { title: "Extension", revision: revision(expected), extensionLabel: extension.displayName, extensionId, deliveryClassLabel: deliveryLabel(extension.extension.deliveryClass), availabilityLabel: currentPlan?.display ?? "Plan required", lifecycleLabel: inventoryDisposition(status.inventory, extension.extension), impact: currentPlan === undefined ? "Server plan required before execution." : JSON.stringify(currentPlan.impact), approval: currentPlan?.status.approvalRequired ? "Server verification required when the plan requires approval." : "No approval required by the authoritative plan.", audit: "Server action is audited with the current revision.",
      plan: form("Plan install", "/api/system/extensions/plan", { expected: extensionExpected(expected), request: requestValue }),
      ...(currentPlan === undefined ? {} : { execute: form("Execute planned operation", `/api/system/extensions/${encodeURIComponent(extensionId)}/execute`, { expected: extensionExpected(expected), operationId: currentPlan.operationId }) }) } });
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(document(page));
}

async function action<TContext extends Context>(options: SystemAdministrationHostOptions<TContext>, request: IncomingMessage, response: ServerResponse, path: string, planned: Map<string, PlanState>): Promise<void> {
  const context = options.context(request);
  const body = await parseBody(request);
  if (path === "/api/system/access/templates/instantiate") {
    const value = exact(body, ["expected", "role", "templateId"]);
    return writeJson(response, 200, await options.access.instantiateTemplate({ context, expected: value.expected, role: value.role, templateId: string(value.templateId) }));
  }
  if (path === "/api/system/access/templates/copy") {
    const value = exact(body, ["expected", "permissionIds", "roleId", "templateId"]);
    return writeJson(response, 200, await options.access.copyTemplatePermissions({ context, expected: value.expected, permissionIds: value.permissionIds, roleId: string(value.roleId), templateId: string(value.templateId) }));
  }
  if (path.startsWith("/api/system/access/roles/") && path.endsWith("/permissions")) {
    const roleId = decodePathSegment(path.slice(0, -"/permissions".length), "/api/system/access/roles/");
    const value = exact(body, ["expected", "permissionId"]);
    return writeJson(response, 200, await options.access.addPermission({ context, expected: value.expected, roleId, permissionId: string(value.permissionId) }));
  }
  if (path === "/api/system/access/assignments") {
    const value = exact(body, ["assignment", "expected"]);
    return writeJson(response, 200, await options.access.createAssignment({ context, expected: value.expected, assignment: value.assignment }));
  }
  if (path.startsWith("/api/system/access/assignments/") && path.endsWith("/revoke")) {
    const assignmentId = decodePathSegment(path.slice(0, -"/revoke".length), "/api/system/access/assignments/");
    const value = exact(body, ["expected"]);
    return writeJson(response, 200, await options.access.revokeAssignment({ context, expected: value.expected, assignmentId }));
  }
  if (path === "/api/system/extensions/plan") {
    const value = exact(body, ["expected", "request"]);
    const plan = await options.extensions.plan({ context, expected: value.expected, request: value.request });
    const requestValue = exact(value.request, ["extension", "idempotencyKey", "operation", "targetVersion"]);
    const extension = exact(requestValue.extension, ["deliveryClass", "id"]);
    const expected = expectedValue(value.expected);
    const key = planKey(options, context, string(extension.id));
    planned.set(key, Object.freeze({ expected, display: displayLabel(plan.display.outcome), impact: plan.impact, operationId: plan.operationId }));
    return writeJson(response, 200, plan);
  }
  if (path.startsWith("/api/system/extensions/") && path.endsWith("/execute")) {
    const extensionId = decodePathSegment(path.slice(0, -"/execute".length), "/api/system/extensions/");
    const value = exact(body, ["expected", "operationId"]);
    const operation = string(value.operationId);
    const current = planned.get(planKey(options, context, extensionId));
    if (current?.operationId !== operation || !sameExpected(current.expected, expectedValue(value.expected))) throw new RouteError(403, "A current server-authorized plan is required before execution.");
    return writeJson(response, 200, await options.extensions.execute({ context, expected: value.expected as SystemExtensionExpectedRevision, operationId: operation }));
  }
  throw new RouteError(404, "Action route not found.");
}

function permissionGroups(groups: readonly ActivePermissionGroup[], roleId: string, expected: ReturnType<typeof accessExpected>) {
  const owners = new Map<string, { owner: string; resources: Map<string, Map<string, { label: string; description?: string }[]>> }>();
  for (const group of groups) {
    const owner = ownerLabel(group.owner);
    const entry = owners.get(owner) ?? { owner, resources: new Map() };
    owners.set(owner, entry);
    const resource = entry.resources.get(group.resource) ?? new Map<string, { label: string; description?: string }[]>();
    entry.resources.set(group.resource, resource);
    resource.set(group.operation, group.permissions.map(({ descriptor }) => ({ label: descriptor.id, ...(descriptor.description === undefined ? {} : { description: descriptor.description }), add: form(`Add ${descriptor.id}`, `/api/system/access/roles/${encodeURIComponent(roleId)}/permissions`, { expected, permissionId: descriptor.id }) })));
  }
  return [...owners.values()].map((owner) => ({ owner: owner.owner, resources: [...owner.resources].map(([resource, operations]) => ({ resource, operations: [...operations].map(([operation, permissions]) => ({ operation, permissions })) })) }));
}

function document(page: ReactElement): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>System administration</title></head><body>${renderToStaticMarkup(page)}</body></html>`;
}

function isRoleRoute(path: string): boolean { return /^\/system\/access\/roles\/[A-Za-z0-9._-]+$/u.test(path); }
function isExtensionRoute(path: string): boolean { return /^\/system\/extensions\/[A-Za-z0-9._-]+$/u.test(path); }
function decodePathSegment(path: string, prefix: string): string { return decodeURIComponent(path.slice(prefix.length)); }
function revision(expected: Expected): string { return `${expected.authorizationRevision}/${expected.lifecycleRevision}/${expected.extensionRevision}`; }
function accessExpected(expected: Expected): Readonly<{ readonly applicationId: string; readonly environment: string; readonly authorizationRevision: number; readonly lifecycleRevision: number }> { return { applicationId: expected.applicationId, environment: expected.environment, authorizationRevision: expected.authorizationRevision, lifecycleRevision: expected.lifecycleRevision }; }
function extensionExpected(expected: Expected): Expected { return { ...accessExpected(expected), extensionRevision: expected.extensionRevision }; }
function ownerLabel(owner: { readonly kind: string; readonly extensionId?: string }): string { return owner.kind === "platform" ? "Platform system" : owner.extensionId ?? "Extension"; }
function deliveryLabel(value: string): string { return value === "hot-application" ? "Hot Application" : value === "theme-skin" ? "Theme Skin" : "Platform Plugin"; }
function availabilityLabel(_value: { readonly availability: string }): string { return "Plan required"; }
function displayLabel(value: string): string { return value === "install-live" ? "Install live" : value === "no-outage-deployment" ? "No-outage deployment" : value; }
function form(label: string, actionUrl: string, fields: Readonly<Record<string, unknown>>) { return { label, form: { actionUrl, hiddenFields: Object.entries(fields).map(([name, value]) => ({ name, value: typeof value === "string" ? value : JSON.stringify(value) })) } }; }
function selectionForm(label: string, actionUrl: string, fields: Readonly<Record<string, unknown>>, name: string, selectionLabel: string, values: readonly string[]) { return { label, form: { ...form(label, actionUrl, fields).form, selection: { name, label: selectionLabel, options: values.map((value) => ({ value, label: value })) } } }; }
function planKey<TContext extends Context>(options: SystemAdministrationHostOptions<TContext>, context: TContext, extensionId: string): string { const key = options.sessionKey(context); if (!key) throw new RouteError(403, "A session-bound extension plan is required."); return `${key}\u0000${extensionId}`; }
function sameExpected(left: Expected, right: Expected): boolean { return left.applicationId === right.applicationId && left.environment === right.environment && left.authorizationRevision === right.authorizationRevision && left.lifecycleRevision === right.lifecycleRevision && left.extensionRevision === right.extensionRevision; }
function expectedValue(value: unknown): Expected { const input = exact(value, ["applicationId", "authorizationRevision", "environment", "extensionRevision", "lifecycleRevision"]); if (typeof input.applicationId !== "string" || typeof input.environment !== "string" || ![input.authorizationRevision, input.lifecycleRevision, input.extensionRevision].every((revision) => typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0)) throw new RouteError(400, "Request body is invalid."); return input as Expected; }
function inventoryDisposition(inventory: Awaited<ReturnType<SystemExtensionAdministrationService<Context>["status"]>>["inventory"], extension: { readonly deliveryClass: string; readonly id: string }): string {
  const entries = extension.deliveryClass === "hot-application" ? inventory.extensions.hotApplications : extension.deliveryClass === "theme-skin" ? inventory.extensions.themeSkins : inventory.extensions.platformPlugins;
  return entries[extension.id]?.disposition ?? "not-installed";
}
async function planStatus<TContext extends Context>(options: SystemAdministrationHostOptions<TContext>, context: TContext, planned: Map<string, PlanState>, extensionId: string, expected: Expected): Promise<(PlanState & { readonly status: Awaited<ReturnType<SystemExtensionAdministrationService<TContext>["operationStatus"]>> }) | undefined> { const state = planned.get(planKey(options, context, extensionId)); if (!state || !sameExpected(state.expected, expected)) return undefined; const status = await options.extensions.operationStatus({ context, operationId: state.operationId }); return status.extension.id === extensionId ? Object.freeze({ ...state, status }) : undefined; }
async function planLabel<TContext extends Context>(options: SystemAdministrationHostOptions<TContext>, context: TContext, planned: Map<string, PlanState>, extensionId: string, expected: Expected): Promise<string> { return (await planStatus(options, context, planned, extensionId, expected))?.display ?? "Plan required"; }

class RouteError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function writeError(response: ServerResponse, error: unknown): void {
  const status = error instanceof RouteError ? error.status : error instanceof SystemAccessAdministrationError || error instanceof SystemExtensionAdministrationError
    ? error.code === "REVISION_CONFLICT" ? 409 : error.code === "UNAUTHORIZED" || error.code === "APPROVAL_REQUIRED" ? 403 : 400 : 500;
  writeJson(response, status, { error: status === 500 ? "Internal server error." : "Request denied." });
}
function writeJson(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(value)); }
async function parseBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += bytes.length; if (length > 32_768) throw new RouteError(400, "Request body is too large."); chunks.push(bytes); }
  const text = Buffer.concat(chunks).toString("utf8");
  if ((request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
    const fields = new URLSearchParams(text);
    const result: Record<string, unknown> = {};
    for (const [name, value] of fields) {
      if (name === "permissionIds") { const selected = result[name] ?? []; if (!Array.isArray(selected)) throw new RouteError(400, "Request body is invalid."); result[name] = [...selected, value]; continue; }
      if (name in result) throw new RouteError(400, "Request body is invalid.");
      result[name] = ["assignment", "expected", "request", "role"].includes(name) ? parse(value) : value;
    }
    return result;
  }
  return parse(text);
}
function parse(value: string): unknown { try { return JSON.parse(value); } catch { throw new RouteError(400, "Request body is invalid."); } }
function exact(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new RouteError(400, "Request body is invalid.");
  return value as Readonly<Record<string, unknown>>;
}
function string(value: unknown): string { if (typeof value !== "string") throw new RouteError(400, "Request body is invalid."); return value; }
