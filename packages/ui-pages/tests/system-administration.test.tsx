import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SystemAuthorizationAuditPage, SystemAssignmentsPage, SystemExtensionDetailPage, SystemExtensionsPage,
  SystemPermissionsPage, SystemRoleDetailPage, SystemRolesPage, SystemTemplatesPage,
  SystemThemeProfileDetailPage, SystemThemesPage
} from "../src/index.js";

const action = { label: "Review and apply", confirmation: { title: "Confirm change", description: "The server will recheck authority, revision, impact, approval, and audit requirements." } };

function formAction(label: string, actionUrl: string) {
  return {
    label,
    form: {
      actionUrl,
      hiddenFields: [
        { name: "expected", value: '{"authorizationRevision":42,"lifecycleRevision":7}' },
        { name: "request", value: '{"operation":"server-projected"}' }
      ]
    },
    confirmation: { title: "Confirm change", description: "The server rechecks authority, revision, impact, approval, and audit requirements." }
  };
}

describe("system administration pages", () => {
  it("renders the ten fixed administration routes from server-produced view models", () => {
    const pages = [
      <SystemRolesPage view={{ title: "Roles", roles: [{ id: "owner", label: "Owner", href: "/system/access/roles/owner", permissionCount: "2", assignmentCount: "1", state: "active" }], createRole: formAction("Create role", "/api/system/access/roles") }} />,
      <SystemRoleDetailPage view={{ title: "Role", roleLabel: "Manager", roleState: "active", activePermissionGroups: [{ owner: "Platform system", resources: [{ resource: "roles", operations: [{ operation: "manage", permissions: [{ label: "system.roles.manage", add: formAction("Add permission", "/api/system/access/roles/manager/permissions"), remove: formAction("Remove permission", "/api/system/access/grants/grant-roles-manage/remove") }] }] }] }], templates: [{ id: "sales-manager", title: "Sales manager", instantiate: formAction("Instantiate template", "/api/system/access/templates/instantiate"), copySelected: formAction("Copy template permissions", "/api/system/access/templates/copy") }], inactiveDiagnostics: [{ id: "retired", label: "sales.pipeline.manage", state: "inactive-generation-retired", detail: "The retired generation cannot authorize." }], save: action }} />,
      <SystemPermissionsPage view={{ title: "Permissions", permissions: [{ id: "roles", label: "system.roles.manage", owner: "Platform system", resource: "roles", operation: "manage", state: "active" }], state: "stale", refresh: action }} />,
      <SystemAssignmentsPage view={{ title: "Assignments", assignments: [{ id: "assignment", principal: "user:alex", role: "Owner", state: "active", revision: "42", revoke: formAction("Revoke assignment", "/api/system/access/assignments/assignment/revoke") }, { id: "revoked-assignment", principal: "user:sam", role: "Manager", state: "revoked", revision: "43", reactivate: formAction("Reactivate assignment", "/api/system/access/assignments/revoked-assignment/reactivate") }], createAssignment: formAction("Create assignment", "/api/system/access/assignments"), manageAssignments: formAction("Manage assignments", "/api/system/access/assignments/manage") }} />,
      <SystemTemplatesPage view={{ title: "Templates", templates: [{ id: "sales-manager", title: "Sales manager", owner: "module.sales", version: "1", state: "active", instantiate: formAction("Instantiate template", "/api/system/access/templates/instantiate") }] }} />,
      <SystemAuthorizationAuditPage view={{ title: "Authorization audit", events: [{ id: "audit", occurredAt: "2026-09-01", outcome: "deny", reason: "approval-required", permission: "system.extensions.update", owner: "Platform system", revision: "42" }] }} />,
      <SystemExtensionsPage view={{ title: "Extensions", extensions: [{ id: "sales", label: "Sales", href: "/system/extensions/module.sales", deliveryClassLabel: "Platform Plugin", availabilityLabel: "maintenance-required", lifecycleLabel: "active", revision: "42" }] }} />,
      <SystemExtensionDetailPage view={{ title: "Extension", extensionLabel: "Sales", extensionId: "module.sales", deliveryClassLabel: "Platform Plugin", availabilityLabel: "maintenance-required", lifecycleLabel: "active", impact: "Migration affects sales records.", approval: "Approval required.", audit: "Audit event required.", plan: formAction("Plan extension change", "/api/system/extensions/plan"), execute: formAction("Execute extension change", "/api/system/extensions/module.sales/execute"), actions: [action], state: "denied" }} />,
      <SystemThemesPage view={{ title: "Themes", packages: [{ id: "theme.default", label: "Default", version: "1.0.0", surfaces: "admin, public", availability: "installed", referenceImpact: "Blocked by 1 profile" }], skins: [{ id: "skin.accent", label: "Accent", version: "1.0.0", lifecycle: "active", actions: "Disable, uninstall" }], profiles: [{ id: "profile.admin", label: "Admin", href: "/system/themes/profiles/profile.admin", surface: "admin", package: "theme.default@1.0.0", skin: "skin.accent@1.0.0", revision: "2", accessibility: "passed" }] }} />,
      <SystemThemeProfileDetailPage view={{ title: "Theme Profile", profileLabel: "Admin", profileId: "profile.admin", surface: "admin", package: "theme.default@1.0.0", skin: "skin.accent@1.0.0", publication: "draft", accessibility: "passed", preview: formAction("Preview profile", "/api/system/themes/profiles/profile.admin/preview"), stage: { ...formAction("Stage profile", "/api/system/themes/profiles/profile.admin/stage"), form: { ...formAction("Stage profile", "/api/system/themes/profiles/profile.admin/stage").form, textArea: { name: "profile", label: "Theme Profile JSON", value: '{"schemaVersion":1}' } } }, publish: formAction("Publish profile", "/api/system/themes/profiles/profile.admin/publish"), rollback: formAction("Rollback profile", "/api/system/themes/profiles/profile.admin/rollback") }} />
    ];
    const markup = pages.map((page) => renderToStaticMarkup(page)).join("\n");
    expect(markup.match(/<main/g)).toHaveLength(10);
    expect(markup.match(/data-k-nex-component="skip-link"/g)).toHaveLength(10);
    expect(markup.match(/aria-label="System administration"/g)).toHaveLength(10);
    expect(markup).toContain("Active permissions");
    expect(markup).toContain("inactive-generation-retired");
    expect(markup).toContain("Data may be stale");
    expect(markup).toContain("Access denied");
    expect(markup).toContain("maintenance-required");
    expect(markup).toContain('aria-label="Roles"');
    expect(markup).toContain('data-k-nex-component="dialog"');
    expect(markup).toContain('action="/api/system/access/roles/manager/permissions"');
    expect(markup).toContain('action="/api/system/access/grants/grant-roles-manage/remove"');
    expect(markup).toContain('action="/api/system/access/templates/instantiate"');
    expect(markup).toContain('action="/api/system/access/templates/copy"');
    expect(markup).toContain('action="/api/system/access/assignments/assignment/revoke"');
    expect(markup).toContain('action="/api/system/access/assignments/revoked-assignment/reactivate"');
    expect(markup).toContain('aria-label="Theme Packages"');
    expect(markup).toContain('aria-label="Theme Skins"');
    expect(markup).toContain('aria-label="Theme Profiles"');
    expect(markup).toContain('action="/api/system/themes/profiles/profile.admin/publish"');
    expect(markup).toContain('<textarea name="profile"');
  });

  it("renders server-projected native POST forms without client authority fields", () => {
    const markup = renderToStaticMarkup(<SystemExtensionDetailPage view={{
      title: "Extension", extensionLabel: "Sales", extensionId: "module.sales", deliveryClassLabel: "Platform Plugin", availabilityLabel: "maintenance-required", lifecycleLabel: "active",
      impact: "Migration affects sales records.", approval: "Server approval is required.", audit: "Server audit is required.",
      plan: formAction("Plan extension change", "/api/system/extensions/plan"),
      execute: formAction("Execute extension change", "/api/system/extensions/module.sales/execute")
    }} />);
    expect(markup).toContain('<form action="/api/system/extensions/plan" method="post">');
    expect(markup).toContain('<form action="/api/system/extensions/module.sales/execute" method="post">');
    expect(markup).toMatch(/<input[^>]+name="expected"/u);
    expect(markup).toMatch(/<input[^>]+name="request"/u);
    expect(markup).toMatch(/<button[^>]+type="submit"/u);
    expect(markup).toContain("Server approval is required.");
    expect(markup).not.toMatch(/<input[^>]+name="(?:actor|approvalId|authorityTarget|generation|owner|permissionAuthority)"/u);
  });

  it("renders accessible copy-permission selection instead of a fixed hidden subset", () => {
    const markup = renderToStaticMarkup(<SystemRoleDetailPage view={{
      title: "Role", roleLabel: "Manager", roleState: "active", activePermissionGroups: [], inactiveDiagnostics: [],
      templates: [{ id: "sales-manager", title: "Sales manager", copySelected: {
        label: "Copy selected permissions",
        form: {
          actionUrl: "/api/system/access/templates/copy",
          hiddenFields: [{ name: "templateId", value: "sales.manager" }],
          selection: { name: "permissionIds", label: "Permissions to copy", options: [
            { value: "sales.pipeline.manage", label: "sales.pipeline.manage" },
            { value: "sales.pipeline.read", label: "sales.pipeline.read", selected: true }
          ] }
        }
      } }]
    }} />);
    expect(markup).toContain("<fieldset><legend>Permissions to copy</legend>");
    expect(markup.match(/type="checkbox" name="permissionIds"/gu)).toHaveLength(2);
    expect(markup).toContain('value="sales.pipeline.manage"');
    expect(markup).toMatch(/name="permissionIds" checked="" value="sales\.pipeline\.read"/u);
    expect(markup).not.toMatch(/type="hidden" name="permissionIds"/u);
  });
});
