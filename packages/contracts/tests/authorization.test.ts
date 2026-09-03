import { describe, expect, it } from "vitest";

import {
  AuthorizationDecisionSchema,
  AuthorizationDecisionAuditSchema,
  AuthorizationPermissionDescriptorSchema,
  ExtensionAuthorizationGenerationSchema,
  PermissionCatalogSnapshotSchema,
  PermissionPolicyBindingSchema,
  ProtectedRoleBaselineSchema,
  RoleSchema,
  RoleAssignmentSchema,
  RolePermissionGrantSchema,
  RoleTemplateSchema,
  TemplateAdoptionSchema,
  isPermissionOwnedByPublisher,
  permissionPublisherNamespace
} from "../src/index.js";

const publisher = { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales.analytics" } as const;
const owner = { ...publisher, generation: 7 } as const;
const descriptor = {
  schemaVersion: 1,
  id: "sales.analytics.reports.read",
  publisher,
  title: "Read analytics reports",
  description: "Read actor-authorized Sales analytics reports.",
  audience: "authenticated",
  resource: "sales.analytics.reports",
  operation: "read",
  scope: "record"
} as const;

const decision = {
  schemaVersion: 1,
  decisionId: "decision-1",
  correlationId: "correlation-1",
  applicationId: "customer-alpha",
  environment: "production",
  permissionId: descriptor.id,
  owner,
  principal: { kind: "user", id: "user-1" },
  effectiveActor: { kind: "user", id: "user-1" },
  scope: { kind: "record", resource: "sales.analytics.reports", recordId: "report-1" },
  authorizationRevision: 3,
  lifecycleRevision: 4,
  outcome: "allow",
  reason: "granted",
  approval: "not-required",
  reauthentication: "not-required"
} as const;

describe("P10.1 authorization contracts", () => {
  it("accepts platform and full-suffix extension ownership without granting foreign or system permissions", () => {
    expect(permissionPublisherNamespace(publisher)).toBe("sales.analytics");
    expect(isPermissionOwnedByPublisher(publisher, descriptor.id)).toBe(true);
    expect(isPermissionOwnedByPublisher(publisher, "sales.reports.read")).toBe(false);
    expect(isPermissionOwnedByPublisher(publisher, "system.roles.manage")).toBe(false);
    expect(AuthorizationPermissionDescriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(AuthorizationPermissionDescriptorSchema.safeParse({ ...descriptor, id: "system.roles.manage" }).success).toBe(false);
    expect(AuthorizationPermissionDescriptorSchema.safeParse({
      ...descriptor,
      publisher: { kind: "platform", namespace: "system" },
      id: "sales.analytics.reports.read"
    }).success).toBe(false);
    expect(AuthorizationPermissionDescriptorSchema.safeParse({
      ...descriptor,
      publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.system" },
      id: "system.roles.manage"
    }).success).toBe(false);
    expect(AuthorizationPermissionDescriptorSchema.safeParse({
      ...descriptor,
      publisher: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.system.audit" },
      id: "system.audit.read"
    }).success).toBe(false);
  });

  it("requires a numeric authorization generation and forbids Theme Skin publishers", () => {
    expect(RolePermissionGrantSchema.safeParse({
      schemaVersion: 1,
      id: "grant-1",
      applicationId: "customer-alpha",
      roleId: "role-1",
      permissionId: descriptor.id,
      owner,
      revision: 1
    }).success).toBe(true);
    expect(RolePermissionGrantSchema.safeParse({
      schemaVersion: 1,
      id: "grant-1",
      applicationId: "customer-alpha",
      roleId: "role-1",
      permissionId: descriptor.id,
      owner: { ...publisher, generation: "sales-generation-1" },
      revision: 1
    }).success).toBe(false);
    expect(RolePermissionGrantSchema.safeParse({
      schemaVersion: 1,
      id: "grant-1",
      applicationId: "customer-alpha",
      roleId: "role-1",
      permissionId: "system.roles.manage",
      owner: { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.system", generation: 7 },
      revision: 1
    }).success).toBe(false);
    expect(AuthorizationPermissionDescriptorSchema.safeParse({
      ...descriptor,
      publisher: { kind: "extension", deliveryClass: "theme-skin", extensionId: "skin.minimal" }
    }).success).toBe(false);
    expect(PermissionPolicyBindingSchema.safeParse({
      schemaVersion: 1,
      id: "sales.analytics.policy.reports-read",
      publisher,
      permissionId: descriptor.id,
      policyReference: "sales.analytics.policy.reports-read",
      scope: "record",
      failureMode: "deny",
      timeoutMs: 5_000
    }).success).toBe(true);
    expect(PermissionPolicyBindingSchema.safeParse({
      schemaVersion: 1,
      id: "sales.analytics.policy.reports-read",
      publisher,
      permissionId: descriptor.id,
      policyReference: "sales.analytics.policy.reports-read",
      scope: "record",
      failureMode: "allow",
      timeoutMs: 5_001
    }).success).toBe(false);
  });

  it("rejects temporal assignment fields and keeps administrative snapshots non-authoritative", () => {
    const assignment = {
      schemaVersion: 1,
      id: "assignment-1",
      applicationId: "customer-alpha",
      roleId: "role-1",
      principal: { kind: "user", id: "user-1" },
      state: "active",
      revision: 1
    } as const;
    expect(RoleAssignmentSchema.safeParse(assignment).success).toBe(true);
    expect(RoleAssignmentSchema.safeParse({ ...assignment, expiresAt: "2026-09-01T00:00:00.000Z" }).success).toBe(false);
    expect(PermissionCatalogSnapshotSchema.safeParse({
      schemaVersion: 1,
      id: "snapshot-1",
      applicationId: "customer-alpha",
      source: "administrative-non-authoritative",
      permission: descriptor,
      state: "inactive-extension-disabled",
      revision: 2
    }).success).toBe(true);
    expect(PermissionCatalogSnapshotSchema.safeParse({
      schemaVersion: 1,
      id: "snapshot-1",
      applicationId: "customer-alpha",
      source: "effective-catalog",
      permission: descriptor,
      state: "inactive-extension-disabled",
      revision: 2
    }).success).toBe(false);
    expect(PermissionCatalogSnapshotSchema.safeParse({
      schemaVersion: 1,
      id: "snapshot-1",
      applicationId: "customer-alpha",
      source: "administrative-non-authoritative",
      permission: descriptor,
      state: "inactive-extension-disabled",
      owner: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.sales.analytics", generation: 2 },
      revision: 2
    }).success).toBe(false);
  });

  it("keeps templates same-owner and assignment-free, while retaining canonical adoption baselines", () => {
    const template = {
      schemaVersion: 1,
      id: "sales.analytics.template.viewer",
      publisher,
      version: 1,
      instantiation: "automatic",
      title: "Analytics viewer",
      permissionIds: [descriptor.id]
    } as const;
    expect(RoleTemplateSchema.safeParse(template).success).toBe(true);
    expect(RoleTemplateSchema.safeParse({ ...template, permissionIds: ["sales.reports.read"] }).success).toBe(false);
    expect(RoleTemplateSchema.safeParse({ ...template, assignments: [{ principal: "user-1" }] }).success).toBe(false);
    const adoption = {
      schemaVersion: 1,
      id: "adoption-1",
      applicationId: "customer-alpha",
      roleId: "role-1",
      templateId: template.id,
      publisher,
      owner,
      templateVersion: 1,
      oldBaselinePermissionIds: [descriptor.id],
      digestAlgorithm: "sha256-canonical-json-v1",
      oldBaselineDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "instantiated-role",
      state: "adopted",
      revision: 3
    } as const;
    expect(TemplateAdoptionSchema.safeParse(adoption).success).toBe(true);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, roleId: undefined }).success).toBe(false);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, state: "tombstoned", roleId: undefined }).success).toBe(true);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, state: "tombstoned" }).success).toBe(false);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, kind: "copied-permissions" }).success).toBe(true);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, kind: "copied-permissions", state: "tombstoned" }).success).toBe(true);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, kind: "copied-permissions", state: "tombstoned", roleId: undefined }).success).toBe(false);
    expect(TemplateAdoptionSchema.safeParse({
      ...adoption,
      oldBaselinePermissionIds: ["sales.analytics.z.read", descriptor.id]
    }).success).toBe(false);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, digestAlgorithm: "sha256" }).success).toBe(false);
    expect(TemplateAdoptionSchema.safeParse({ ...adoption, mode: "adopted" }).success).toBe(false);
  });

  it("keeps runtime generation strings distinct from authorization generation and rejects role-label authority", () => {
    expect(ExtensionAuthorizationGenerationSchema.safeParse({
      schemaVersion: 1,
      applicationId: "customer-alpha",
      owner,
      runtimeGenerationIds: ["sales-generation-1", "sales-generation-2"],
      state: "current",
      authorizationRevision: 3,
      lifecycleRevision: 4
    }).success).toBe(true);
    expect(ExtensionAuthorizationGenerationSchema.safeParse({
      schemaVersion: 1,
      applicationId: "customer-alpha",
      owner: { ...publisher, generation: "sales-generation-1" },
      runtimeGenerationIds: ["sales-generation-1"],
      state: "current",
      authorizationRevision: 3,
      lifecycleRevision: 4
    }).success).toBe(false);
    expect(ExtensionAuthorizationGenerationSchema.safeParse({
      schemaVersion: 1,
      applicationId: "customer-alpha",
      owner,
      runtimeGenerationIds: ["sales-generation-1", "sales-generation-1"],
      state: "current",
      authorizationRevision: 3,
      lifecycleRevision: 4
    }).success).toBe(false);
    expect(AuthorizationDecisionSchema.safeParse(decision).success).toBe(true);
    expect(AuthorizationDecisionSchema.safeParse({ ...decision, roleLabel: "Administrator" }).success).toBe(false);
  });

  it("permits pending configuration only as one exact Hot Application fence", () => {
    const pending = {
      schemaVersion: 1,
      applicationId: "customer-alpha",
      owner: { kind: "extension", deliveryClass: "hot-application", extensionId: "app.sales", generation: 8 },
      runtimeGenerationIds: ["sales-generation-3"],
      state: "pending-configuration",
      authorizationRevision: 3,
      lifecycleRevision: 5
    } as const;
    expect(ExtensionAuthorizationGenerationSchema.safeParse(pending).success).toBe(true);
    expect(ExtensionAuthorizationGenerationSchema.safeParse({ ...pending, owner }).success).toBe(false);
    expect(ExtensionAuthorizationGenerationSchema.safeParse({ ...pending, runtimeGenerationIds: ["sales-generation-3", "sales-generation-4"] }).success).toBe(false);
  });

  it("requires deterministic protected/template permissions and stable protected IDs", () => {
    expect(ProtectedRoleBaselineSchema.safeParse({
      schemaVersion: 1,
      id: "system.role.owner",
      permissionIds: ["system.permissions.read", "system.roles.manage"]
    }).success).toBe(true);
    expect(ProtectedRoleBaselineSchema.safeParse({
      schemaVersion: 1,
      id: "system.role.owner",
      permissionIds: ["system.roles.manage", "system.permissions.read"]
    }).success).toBe(false);
    expect(RoleSchema.safeParse({
      schemaVersion: 1,
      id: "system.role.owner",
      applicationId: "customer-alpha",
      label: "Owner",
      protectedRoleId: "system.role.owner",
      revision: 1
    }).success).toBe(true);
    expect(RoleSchema.safeParse({
      schemaVersion: 1,
      id: "role-1",
      applicationId: "customer-alpha",
      label: "Owner",
      protectedRoleId: "system.role.owner",
      revision: 1
    }).success).toBe(false);
    expect(RoleSchema.safeParse({
      schemaVersion: 1,
      id: "system.role.owner",
      applicationId: "customer-alpha",
      label: "Owner",
      revision: 1
    }).success).toBe(false);
    expect(RoleTemplateSchema.safeParse({
      schemaVersion: 1,
      id: "sales.analytics.template.viewer",
      publisher,
      version: 1,
      instantiation: "manual",
      title: "Analytics viewer",
      permissionIds: ["sales.analytics.z.read", descriptor.id]
    }).success).toBe(false);
  });

  it("keeps authorization decisions and audits outcome/reason coherent", () => {
    expect(AuthorizationDecisionSchema.safeParse({ ...decision, outcome: "allow", reason: "approval-required" }).success).toBe(false);
    expect(AuthorizationDecisionSchema.safeParse({ ...decision, approval: "required" }).success).toBe(false);
    const audit = {
      schemaVersion: 1,
      auditId: "audit-1",
      decisionId: decision.decisionId,
      correlationId: decision.correlationId,
      applicationId: decision.applicationId,
      environment: decision.environment,
      permissionId: decision.permissionId,
      owner: decision.owner,
      principal: decision.principal,
      effectiveActor: decision.effectiveActor,
      scope: decision.scope,
      operation: "read-roles",
      target: "system.roles",
      authorizationRevision: decision.authorizationRevision,
      lifecycleRevision: decision.lifecycleRevision,
      outcome: "allow",
      reason: "granted",
      approval: "satisfied",
      reauthentication: "not-required"
    } as const;
    expect(AuthorizationDecisionAuditSchema.safeParse(audit).success).toBe(true);
    expect(AuthorizationDecisionAuditSchema.safeParse({ ...audit, outcome: "deny", reason: "granted" }).success).toBe(false);
    expect(AuthorizationDecisionAuditSchema.safeParse({ ...audit, permissionId: "system.roles.manage" }).success).toBe(false);
  });
});
