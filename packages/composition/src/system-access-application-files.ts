export interface SystemAccessApplicationFilesOptions {
  readonly applicationId: string;
}

function accessServiceSource(): string {
  return `import { createHash } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";
import { SystemAccessAdministrationError, SystemAccessAdministrationService, type ActivePermissionGroup } from "@k-nex/runtime";
import type { SystemPermissionAction, SystemPermissionOwnerGroup } from "@k-nex/ui-pages";
import type { Payload } from "payload";

import { kNexAuthority, type KnexRequestContext } from "./k-nex-authority.js";
import { kNexIdentity } from "./k-nex-identity.js";

const services = new WeakMap<Payload, SystemAccessAdministrationService<KnexRequestContext>>();

export function systemAccessAdministration(payload: Payload): SystemAccessAdministrationService<KnexRequestContext> {
  let service = services.get(payload);
  if (service === undefined) {
    const authority = kNexAuthority(payload);
    // No protectedAssignmentAdmission is installed here: browser form input can never satisfy it.
    service = new SystemAccessAdministrationService({ store: authority.store, catalogProvider: authority.catalogProvider, authority: authority.adapter });
    services.set(payload, service);
  }
  return service;
}

export async function currentAccessExpected(payload: Payload) {
  const state = await kNexAuthority(payload).store.readState(kNexIdentity.applicationId, kNexIdentity.environment);
  if (state === undefined) throw new SystemAccessAdministrationError("REVISION_CONFLICT", "Authorization state is unavailable.");
  return Object.freeze({ applicationId: state.applicationId, environment: state.environment, authorizationRevision: state.authorizationRevision, lifecycleRevision: state.lifecycleRevision });
}

export function accessRouteId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u.test(value)) throw new TypeError("System access route identity is invalid.");
  return value;
}

export function accessText(form: FormData, name: string, minimum: number, maximum: number): string {
  if (form.getAll(name).length !== 1) throw new TypeError("System access form is invalid.");
  const value = form.get(name);
  if (typeof value !== "string" || value !== value.trim() || value.length < minimum || value.length > maximum || /[\\u0000-\\u001f\\u007f-\\u009f]/u.test(value)) throw new TypeError("System access form is invalid.");
  return value;
}

export function accessAssignmentId(roleId: string, userId: string): string {
  return "access.assignment." + createHash("sha256").update(canonicalJson([kNexIdentity.applicationId, roleId, userId])).digest("hex");
}

export function accessMutationError(error: unknown): Response {
  const code = error instanceof SystemAccessAdministrationError ? error.code : "MUTATION_INVALID";
  return Response.json({ code }, { status: code === "UNAUTHORIZED" ? 403 : code === "REVISION_CONFLICT" ? 409 : 400, headers: { "cache-control": "no-store" } });
}

export function accessPermissionGroups(groups: readonly ActivePermissionGroup[], roleId: string, grants: readonly Readonly<{ readonly grant: Readonly<{ readonly id: string; readonly permissionId: string }>; readonly state: "active" | "inactive" }>[], mutable: boolean): readonly SystemPermissionOwnerGroup[] {
  const granted = new Map(grants.map((grant) => [grant.grant.permissionId, grant]));
  const owners = new Map<string, { owner: string; resources: Map<string, Map<string, SystemPermissionAction[]>> }>();
  for (const group of groups) {
    const owner = group.owner.kind === "platform" ? "Platform system" : group.owner.extensionId;
    const entry = owners.get(owner) ?? { owner, resources: new Map() };
    owners.set(owner, entry);
    const resource = entry.resources.get(group.resource) ?? new Map<string, SystemPermissionAction[]>();
    entry.resources.set(group.resource, resource);
    resource.set(group.operation, group.permissions.map(({ descriptor }) => {
      const grant = granted.get(descriptor.id);
      return {
        label: descriptor.id,
        ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
        ...(grant === undefined && mutable ? { add: { label: "Add " + descriptor.id, form: { actionUrl: "/api/system/access/roles/" + encodeURIComponent(roleId) + "/permissions", hiddenFields: [{ name: "permissionId", value: descriptor.id }] } } } : {}),
        ...(grant?.state === "active" && mutable ? { remove: { label: "Remove " + descriptor.id, form: { actionUrl: "/api/system/access/grants/" + encodeURIComponent(grant.grant.id) + "/remove" } } } : {})
      };
    }));
  }
  return [...owners.values()].map((owner) => ({ owner: owner.owner, resources: [...owner.resources].map(([resource, operations]) => ({ resource, operations: [...operations].map(([operation, permissions]) => ({ operation, permissions })) })) }));
}
`;
}

function rolesPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemRolesPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { authorizeRequest, currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { systemAccessAdministration } from "../../../../../k-nex-system-access.js";

export const dynamic = "force-dynamic";

export default async function SystemAccessRolesPage() {
  const payload = await bootKnexApplication("system-access-roles");
  const context = kNexRequestContext(await headers(), "system-access-roles");
  try {
    const access = systemAccessAdministration(payload);
    const roles = await access.roles({ context });
    const details = await Promise.all(roles.roles.map((role) => access.roleDetail({ context, roleId: role.id })));
    const canManage = await authorizeRequest(payload, context, "system.roles.manage", "system.roles");
    return <SystemRolesPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Roles",
      roles: roles.roles.map((role, index) => ({ id: role.id, label: role.label, href: "/system/access/roles/" + encodeURIComponent(role.id), permissionCount: String(details[index]!.grants.length), assignmentCount: String(details[index]!.assignments.length), state: role.protectedRoleId === undefined ? "active" : "protected" })),
      ...(canManage ? { createRole: { label: "Create role", form: { actionUrl: "/api/system/access/roles", inputs: [{ name: "id", label: "Role ID", type: "text" }, { name: "label", label: "Role label", type: "text" }] } } } : {})
    }} />;
  } catch { notFound(); }
}

`;
}

function roleDetailPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemRoleDetailPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../../boot.js";
import { authorizeRequest, currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../../k-nex-authority.js";
import { accessPermissionGroups, accessRouteId, systemAccessAdministration } from "../../../../../../k-nex-system-access.js";

export const dynamic = "force-dynamic";

export default async function SystemAccessRoleDetailPage({ params }: Readonly<{ params: Promise<{ roleId: string }> }>) {
  const payload = await bootKnexApplication("system-access-role-detail");
  const context = kNexRequestContext(await headers(), "system-access-role-detail");
  try {
    const roleId = accessRouteId((await params).roleId);
    const access = systemAccessAdministration(payload);
    const [detail, permissions, canManage] = await Promise.all([
      access.roleDetail({ context, roleId }), access.permissions({ context }), authorizeRequest(payload, context, "system.roles.manage", "system.roles")
    ]);
    return <SystemRoleDetailPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Role", roleLabel: detail.role.label, roleState: detail.role.protectedRoleId === undefined ? "active" : "protected",
      activePermissionGroups: accessPermissionGroups(permissions.active, roleId, detail.grants, canManage && detail.role.protectedRoleId === undefined), templates: [],
      inactiveDiagnostics: detail.grants.filter((grant) => grant.state === "inactive").map((grant) => ({ id: grant.grant.id, label: grant.grant.permissionId, state: grant.inactiveReason ?? "inactive", detail: "This grant remains visible but cannot authorize." }))
    }} />;
  } catch { notFound(); }
}

`;
}

function permissionsPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemPermissionsPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { systemAccessAdministration } from "../../../../../k-nex-system-access.js";

export const dynamic = "force-dynamic";

export default async function SystemAccessPermissionsPage() {
  const payload = await bootKnexApplication("system-access-permissions");
  const context = kNexRequestContext(await headers(), "system-access-permissions");
  try {
    const permissions = await systemAccessAdministration(payload).permissions({ context });
    return <SystemPermissionsPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Permissions", permissions: [
      ...permissions.active.flatMap((group) => group.permissions.map((permission) => ({ id: permission.descriptor.id, label: permission.descriptor.title, owner: group.owner.kind === "platform" ? "Platform system" : group.owner.extensionId, resource: group.resource, operation: group.operation, state: "active" }))),
      ...permissions.inactive.map(({ snapshot }) => ({ id: snapshot.id, label: snapshot.permission.title, owner: snapshot.owner?.kind === "platform" ? "Platform system" : snapshot.owner?.extensionId ?? "Unavailable", resource: snapshot.permission.resource, operation: snapshot.permission.operation, state: snapshot.state, detail: "Administrative diagnostic only; it cannot authorize." }))
    ] }} />;
  } catch { notFound(); }
}

`;
}

function assignmentsPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemAssignmentsPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { authorizeRequest, currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { systemAccessAdministration } from "../../../../../k-nex-system-access.js";

export const dynamic = "force-dynamic";

export default async function SystemAccessAssignmentsPage() {
  const payload = await bootKnexApplication("system-access-assignments");
  const context = kNexRequestContext(await headers(), "system-access-assignments");
  try {
    const access = systemAccessAdministration(payload);
    const [assignments, roles] = await Promise.all([access.assignments({ context }), access.roles({ context, includeInactive: true })]);
    const canManage = await authorizeRequest(payload, context, "system.role-assignments.manage", "system.role-assignments");
    const roleById = new Map(roles.roles.map((role) => [role.id, role]));
    const normalRoles = roles.roles.filter((role) => role.protectedRoleId === undefined);
    return <SystemAssignmentsPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Assignments",
      ...(canManage && normalRoles.length > 0 ? { createAssignment: { label: "Assign user to role", form: { actionUrl: "/api/system/access/assignments", inputs: [{ name: "userId", label: "User ID", type: "text" }, { name: "roleId", label: "Role", type: "select", options: normalRoles.map((role) => ({ value: role.id, label: role.label })) }] } } } : {}),
      assignments: assignments.map((assignment) => { const role = roleById.get(assignment.roleId); const mutable = canManage && role?.protectedRoleId === undefined; return { id: assignment.id, principal: assignment.principal.kind + ":" + assignment.principal.id, role: role?.label ?? assignment.roleId, state: assignment.state, revision: String(assignment.revision),
        ...(assignment.state === "active" && mutable ? { revoke: { label: "Revoke " + assignment.id, form: { actionUrl: "/api/system/access/assignments/" + encodeURIComponent(assignment.id) + "/revoke" } } } : {})
      }; })
    }} />;
  } catch { notFound(); }
}

`;
}

function auditPageSource(): string {
  return `import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { SystemAuthorizationAuditPage } from "@k-nex/ui-pages";

import { bootKnexApplication } from "../../../../../boot.js";
import { currentSystemAdministrationNavigation, kNexRequestContext } from "../../../../../k-nex-authority.js";
import { systemAccessAdministration } from "../../../../../k-nex-system-access.js";

export const dynamic = "force-dynamic";

export default async function SystemAccessAuditPage() {
  const payload = await bootKnexApplication("system-access-audit");
  const context = kNexRequestContext(await headers(), "system-access-audit");
  try {
    const audits = await systemAccessAdministration(payload).audits({ context, limit: 100 });
    return <SystemAuthorizationAuditPage view={{ navigation: await currentSystemAdministrationNavigation(payload, context), title: "Authorization audit", events: audits.map(({ audit, occurredAt }) => ({ id: audit.auditId, occurredAt, outcome: audit.outcome, reason: audit.reason, permission: audit.permissionId, owner: audit.owner.kind === "platform" ? "Platform system" : audit.owner.extensionId, revision: audit.authorizationRevision + "/" + audit.lifecycleRevision })) }} />;
  } catch { notFound(); }
}

`;
}

function createRoleRouteSource(): string {
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../k-nex-workspace-page-http.js";
import { accessMutationError, accessRouteId, accessText, currentAccessExpected, systemAccessAdministration } from "../../../../../k-nex-system-access.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-access-create-role");
    exactFields(form, ["id", "label"]);
    const role = { id: accessRouteId(accessText(form, "id", 1, 160)), label: accessText(form, "label", 1, 120) };
    await systemAccessAdministration(payload).createRole({ context, expected: await currentAccessExpected(payload), role });
    return workspaceRedirect("/system/access/roles/" + encodeURIComponent(role.id));
  } catch (error) { return accessMutationError(error); }
}
`;
}

function addPermissionRouteSource(): string {
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../../../k-nex-workspace-page-http.js";
import { accessMutationError, accessRouteId, accessText, currentAccessExpected, systemAccessAdministration } from "../../../../../../../k-nex-system-access.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ roleId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-access-add-permission");
    exactFields(form, ["permissionId"]);
    const roleId = accessRouteId((await params).roleId);
    await systemAccessAdministration(payload).addPermission({ context, expected: await currentAccessExpected(payload), roleId, permissionId: accessRouteId(accessText(form, "permissionId", 1, 160)) });
    return workspaceRedirect("/system/access/roles/" + encodeURIComponent(roleId));
  } catch (error) { return accessMutationError(error); }
}
`;
}

function removePermissionRouteSource(): string {
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../../../k-nex-workspace-page-http.js";
import { accessMutationError, accessRouteId, currentAccessExpected, systemAccessAdministration } from "../../../../../../../k-nex-system-access.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ grantId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-access-remove-permission");
    exactFields(form, []);
    await systemAccessAdministration(payload).removePermission({ context, expected: await currentAccessExpected(payload), grantId: accessRouteId((await params).grantId) });
    return workspaceRedirect("/system/access/roles");
  } catch (error) { return accessMutationError(error); }
}
`;
}

function createAssignmentRouteSource(): string {
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../k-nex-workspace-page-http.js";
import { accessAssignmentId, accessMutationError, accessRouteId, accessText, currentAccessExpected, systemAccessAdministration } from "../../../../../k-nex-system-access.js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-access-create-assignment");
    exactFields(form, ["roleId", "userId"]);
    const roleId = accessRouteId(accessText(form, "roleId", 1, 160));
    const userId = accessRouteId(accessText(form, "userId", 1, 160));
    await systemAccessAdministration(payload).createAssignment({ context, expected: await currentAccessExpected(payload), assignment: { id: accessAssignmentId(roleId, userId), roleId, principal: { kind: "user", id: userId } } });
    return workspaceRedirect("/system/access/assignments");
  } catch (error) { return accessMutationError(error); }
}
`;
}

function revokeAssignmentRouteSource(): string {
  return `import { exactFields, openWorkspaceForm, workspaceRedirect } from "../../../../../../../k-nex-workspace-page-http.js";
import { accessMutationError, accessRouteId, currentAccessExpected, systemAccessAdministration } from "../../../../../../../k-nex-system-access.js";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: Readonly<{ params: Promise<{ assignmentId: string }> }>) {
  try {
    const { payload, context, form } = await openWorkspaceForm(request, "system-access-revoke-assignment");
    exactFields(form, []);
    await systemAccessAdministration(payload).revokeAssignment({ context, expected: await currentAccessExpected(payload), assignmentId: accessRouteId((await params).assignmentId) });
    return workspaceRedirect("/system/access/assignments");
  } catch (error) { return accessMutationError(error); }
}
`;
}

export function systemAccessApplicationFiles(_options: SystemAccessApplicationFilesOptions): Readonly<Record<string, string>> {
  return {
    "src/k-nex-system-access.ts": accessServiceSource(),
    "src/app/(workspace)/system/access/roles/page.tsx": rolesPageSource(),
    "src/app/(workspace)/system/access/roles/[roleId]/page.tsx": roleDetailPageSource(),
    "src/app/(workspace)/system/access/permissions/page.tsx": permissionsPageSource(),
    "src/app/(workspace)/system/access/assignments/page.tsx": assignmentsPageSource(),
    "src/app/(workspace)/system/access/audit/page.tsx": auditPageSource(),
    "src/app/api/system/access/roles/route.ts": createRoleRouteSource(),
    "src/app/api/system/access/roles/[roleId]/permissions/route.ts": addPermissionRouteSource(),
    "src/app/api/system/access/grants/[grantId]/remove/route.ts": removePermissionRouteSource(),
    "src/app/api/system/access/assignments/route.ts": createAssignmentRouteSource(),
    "src/app/api/system/access/assignments/[assignmentId]/revoke/route.ts": revokeAssignmentRouteSource()
  };
}
