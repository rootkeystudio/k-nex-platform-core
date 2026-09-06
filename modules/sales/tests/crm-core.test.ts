import { readFileSync } from "node:fs";

import { ActionDescriptorSchema, AuthorizationPermissionDescriptorSchema, PermissionPolicyBindingSchema, PluginManifestSchema, PluginRouteDescriptorSchema, RoleTemplateSchema } from "@k-nex/contracts";
import {
  salesAccountsCollection,
  salesActivitiesCollection,
  salesCoreCollectionSlugs,
  salesCrmActionDescriptors,
  salesCrmObjectFieldActionMatrix,
  salesCrmPermissionDescriptors,
  salesCrmPermissionPolicyBindings,
  salesCrmRoleTemplates,
  salesCrmRouteDescriptors,
  salesLeadsCollection,
  salesAttachmentReferencesCollection,
  salesNotesCollection,
  salesOpportunitiesCollection,
  salesPipelinesCollection,
  salesPipelineStagesCollection,
  salesRelatedRecordTypes,
  salesTasksCollection
} from "@k-nex/module-sales/server";
import { describe, expect, it } from "vitest";
import { salesOpportunityStageUpdateDescriptor, salesTaskCreateDescriptor, salesTaskUpdateDescriptor } from "../src/contracts.js";

const frozen = JSON.parse(readFileSync(new URL("../../../contracts/phase-13-crm-product-contract.v1.json", import.meta.url), "utf8")) as {
  readonly dataSemantics: { readonly polymorphicRelatedTargets: { readonly vocabulary: readonly string[] } };
  readonly permissions: { readonly definitions: readonly string[]; readonly personaGrants: readonly { readonly personaId: string; readonly permissionIds: readonly string[] }[]; readonly objectFieldActionMatrix: readonly Record<string, unknown>[]; readonly operationActionPermissions: Readonly<Record<string, string>>; readonly routePermissions: readonly { readonly routeId: string; readonly permissionId: string }[] };
  readonly actions: readonly string[];
};
const manifest = PluginManifestSchema.parse(JSON.parse(readFileSync(new URL("../k-nex.plugin.json", import.meta.url), "utf8")));
const fields = (collection: { readonly fields: readonly { readonly name?: string }[] }) => collection.fields.map(({ name }) => name).filter((name): name is string => name !== undefined);
const field = (collection: { readonly fields: readonly { readonly name?: string }[] }, name: string) => collection.fields.find((candidate) => candidate.name === name);
const selectValues = (collection: { readonly fields: readonly { readonly name?: string; readonly options?: unknown }[] }, name: string) => ((collection.fields.find((candidate) => candidate.name === name)?.options ?? []) as readonly { readonly value: string }[]).map(({ value }) => value);

describe("P13.2 CRM core", () => {
  it("registers ten deterministic internal-only collections", async () => {
    expect(salesCoreCollectionSlugs).toEqual(["sales-accounts", "sales-contacts", "sales-leads", "sales-pipelines", "sales-pipeline-stages", "sales-activities", "sales-opportunities", "sales-tasks", "sales-notes", "sales-attachment-references"]);
    for (const collection of [salesAccountsCollection, salesLeadsCollection, salesOpportunitiesCollection, salesTasksCollection]) {
      expect(await collection.access?.create?.({} as never)).toBe(false);
      expect(await collection.access?.read?.({} as never)).toBe(false);
      expect(await collection.access?.update?.({} as never)).toBe(false);
      expect(await collection.access?.delete?.({} as never)).toBe(false);
      expect(fields(collection)).toEqual(expect.arrayContaining(["applicationId", "environment", "ownerId", "teamId", "createdBy", "updatedBy", "revision", "audit"]));
    }
    expect(fields(salesAccountsCollection)).not.toContain("archiveStatus");
    expect(fields(salesLeadsCollection)).toContain("archiveStatus");
    expect(fields(salesTasksCollection)).toContain("archiveStatus");
    expect(fields(salesOpportunitiesCollection)).toEqual(expect.arrayContaining(["accountId", "pipelineId", "stageId", "amount", "currency", "expectedCloseDate"]));
    expect(field(salesTasksCollection, "status")?.access).toMatchObject({ create: expect.any(Function), update: expect.any(Function) });
    expect(await field(salesTasksCollection, "status")?.access?.read?.({} as never)).toBe(false);
    expect(await field(salesOpportunitiesCollection, "amount")?.access?.read?.({} as never)).toBe(false);
    for (const protectedField of [field(salesTasksCollection, "status"), field(salesOpportunitiesCollection, "amount")]) {
      expect(await protectedField?.access?.create?.({} as never)).toBe(false);
      expect(await protectedField?.access?.update?.({} as never)).toBe(false);
    }
    expect(field(salesActivitiesCollection, "teamId")).toMatchObject({ type: "text", required: true });
    expect(field(salesActivitiesCollection, "supersedesActivityId")).toMatchObject({ type: "relationship", relationTo: "sales-activities", required: false });
    expect(field(salesOpportunitiesCollection, "closedAt")).toMatchObject({ type: "date" });
    expect(field(salesPipelinesCollection, "orderedStageIds")).toMatchObject({ type: "json", required: true });
    expect(field(salesPipelineStagesCollection, "probabilityBasisPoints")).toMatchObject({ type: "number", required: true, min: 0, max: 10_000 });
    expect(field(salesPipelineStagesCollection, "allowedTransitions")).toMatchObject({ type: "json", required: true });
    expect(salesRelatedRecordTypes).toEqual(["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"]);
    expect(field(salesActivitiesCollection, "relatedRecordType")).toMatchObject({ type: "select", required: true });
  });

  it("keeps contract, Payload options, and PostgreSQL scope trigger on one closed related-target vocabulary", () => {
    const vocabulary = frozen.dataSemantics.polymorphicRelatedTargets.vocabulary;
    expect(salesRelatedRecordTypes).toEqual(vocabulary);
    for (const collection of [salesActivitiesCollection, salesNotesCollection, salesAttachmentReferencesCollection, salesTasksCollection]) {
      expect(selectValues(collection, "relatedRecordType")).toEqual(vocabulary);
    }
    const migration = readFileSync(new URL("../../../fixtures/customer-gate-1/src/migrations/20260905_000027_crm_core.ts", import.meta.url), "utf8");
    expect([...migration.matchAll(/WHEN '(sales\.[a-z-]+)' THEN 'sales_/gu)].map(([, value]) => value)).toEqual(vocabulary);
  });

  it("matches frozen permissions, action, route, and persona authority exactly", () => {
    expect(salesCrmPermissionDescriptors.map(({ id }) => id)).toEqual(frozen.permissions.definitions);
    expect(salesCrmObjectFieldActionMatrix).toEqual(frozen.permissions.objectFieldActionMatrix);
    const frozenActionPermissions = new Map<string, string>();
    for (const row of frozen.permissions.objectFieldActionMatrix) {
      for (const [actionId, permissionId] of Object.entries((row.actionPermissions ?? {}) as Record<string, string>)) {
        expect(frozenActionPermissions.get(actionId) ?? permissionId).toBe(permissionId);
        frozenActionPermissions.set(actionId, permissionId);
      }
    }
    for (const [actionId, permissionId] of Object.entries(frozen.permissions.operationActionPermissions)) frozenActionPermissions.set(actionId, permissionId);
    expect(salesCrmActionDescriptors.map(({ id, permission }) => [id, permission]).sort()).toEqual([...frozenActionPermissions].sort());
    expect(salesCrmActionDescriptors.find(({ id }) => id === "sales.merge.commit")?.policy).toBe("sales.policy.merge.current");
    expect(salesCrmActionDescriptors.find(({ id }) => id === "sales.ownership.assign")).toMatchObject({ permission: "sales.ownership.write", policy: "sales.policy.ownership.current" });
    expect(salesCrmActionDescriptors.every(({ policy }) => policy !== "")).toBe(true);
    expect(salesCrmPermissionDescriptors.find(({ id }) => id === "sales.ownership.write")?.scope).toBe("record");
    expect(salesCrmPermissionDescriptors.find(({ id }) => id === "sales.records.merge")?.scope).toBe("record");
    expect(salesCrmPermissionPolicyBindings.find(({ permissionId }) => permissionId === "sales.ownership.write")?.policyReference).toBe("sales.policy.ownership.current");
    expect(salesCrmPermissionPolicyBindings.find(({ permissionId }) => permissionId === "sales.records.merge")?.policyReference).toBe("sales.policy.merge.current");
    expect(salesCrmPermissionDescriptors.find(({ id }) => id === "sales.reports.schedule")?.scope).toBe("application");
    expect(salesCrmPermissionDescriptors.find(({ id }) => id === "sales.settings.write")?.scope).toBe("application");
    for (const row of frozen.permissions.objectFieldActionMatrix) {
      const policyPermissions = [row.readPermissionId, row.writePermissionId, row.archivePermissionId, ...Object.values((row.sensitiveFields ?? {}) as Record<string, string>)].filter((value): value is string => typeof value === "string");
      for (const permissionId of policyPermissions) {
        const binding = salesCrmPermissionPolicyBindings.find(({ permissionId: candidate }) => candidate === permissionId);
        expect(binding?.policyReference, `${permissionId} policy`).toBe(row.recordPolicyId);
      }
      for (const [actionId, permissionId] of Object.entries((row.actionPermissions ?? {}) as Record<string, string>)) {
        const descriptor = salesCrmActionDescriptors.find(({ id }) => id === actionId);
        expect(descriptor?.permission, `${actionId} permission`).toBe(permissionId);
        expect(descriptor?.policy, `${actionId} policy`).toBe(actionId === "sales.merge.commit" ? "sales.policy.merge.current" : row.recordPolicyId);
      }
    }
    expect([salesTaskCreateDescriptor, salesTaskUpdateDescriptor, salesOpportunityStageUpdateDescriptor].map(({ id, permission, policy }) => ({ id, permission, policy }))).toEqual([
      { id: "sales.task.create", permission: "sales.tasks.write", policy: "sales.policy.tasks.current" },
      { id: "sales.task.update", permission: "sales.tasks.write", policy: "sales.policy.tasks.current" },
      { id: "sales.opportunity.stage.update", permission: "sales.opportunities.stage.update", policy: "sales.policy.opportunities.current" }
    ]);
    expect(salesCrmActionDescriptors.map(({ id }) => id).sort()).toEqual([...frozen.actions].sort());
    expect(salesCrmRouteDescriptors.map(({ id, permission }) => ({ routeId: id, permissionId: permission }))).toEqual(frozen.permissions.routePermissions.map(({ routeId, permissionId }) => ({ routeId, permissionId })));
    const templatePersona: Readonly<Record<string, string>> = { "sales.template.viewer": "sales.viewer-auditor", "sales.template.representative": "sales.representative", "sales.template.manager": "sales.manager", "sales.template.administrator": "sales.administrator" };
    expect(salesCrmRoleTemplates.map(({ id, permissionIds }) => ({ personaId: templatePersona[id]!, permissionIds: [...permissionIds].sort() })).sort((left, right) => left.personaId.localeCompare(right.personaId))).toEqual(frozen.permissions.personaGrants.map(({ personaId, permissionIds }) => ({ personaId, permissionIds: [...permissionIds].sort() })).sort((left, right) => left.personaId.localeCompare(right.personaId)));
    expect(salesCrmPermissionDescriptors.every((value) => AuthorizationPermissionDescriptorSchema.safeParse(value).success)).toBe(true);
    expect(salesCrmPermissionPolicyBindings.every((value) => PermissionPolicyBindingSchema.safeParse(value).success)).toBe(true);
    expect(salesCrmActionDescriptors.every((value) => ActionDescriptorSchema.safeParse(value).success)).toBe(true);
    expect(salesCrmRouteDescriptors.every((value) => PluginRouteDescriptorSchema.safeParse(value).success)).toBe(true);
    expect(salesCrmRoleTemplates.every((value) => RoleTemplateSchema.safeParse(value).success)).toBe(true);
    expect(Object.keys(manifest.contributions.permissions ?? {}).sort()).toEqual([...frozen.permissions.definitions].sort());
    expect(Object.keys(manifest.contributions.actions ?? {}).sort()).toEqual(["sales.opportunity.stage.update", "sales.task.create", "sales.task.update"]);
  });
});
