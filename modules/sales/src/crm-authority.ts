import type { ActionDescriptor, AgentToolJsonSchema, AuthorizationPermissionDescriptor, PermissionPolicyBinding, PluginRouteDescriptor, RoleTemplate } from "@k-nex/contracts";

const publisher = { kind: "extension", deliveryClass: "platform-plugin", extensionId: "module.sales" } as const;

export const salesCrmPermissionIds = Object.freeze([
  "sales.accounts.read", "sales.accounts.write", "sales.accounts.archive",
  "sales.contacts.read", "sales.contacts.write", "sales.contacts.archive", "sales.contacts.channels.read",
  "sales.leads.read", "sales.leads.write", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.qualify", "sales.leads.disqualify",
  "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.archive", "sales.opportunities.amount.read", "sales.opportunities.stage.update", "sales.opportunities.close",
  "sales.activities.read", "sales.activities.write", "sales.tasks.read", "sales.tasks.write", "sales.tasks.archive",
  "sales.notes.read", "sales.notes.write", "sales.notes.body.read", "sales.attachments.read", "sales.attachments.write",
  "sales.pipelines.read", "sales.pipelines.configure", "sales.saved-views.read", "sales.saved-views.write",
  "sales.imports.read", "sales.imports.execute", "sales.exports.read", "sales.exports.execute", "sales.notifications.read", "sales.notifications.write", "sales.reminders.read", "sales.reminders.write",
  "sales.reports.read", "sales.reports.schedule", "sales.communications.email.send", "sales.communications.calendar.sync", "sales.communications.metadata.read",
  "sales.ownership.write", "sales.records.merge", "sales.settings.read", "sales.settings.write"
] as const);

const fieldPermission = new Set(["sales.contacts.channels.read", "sales.leads.channels.read", "sales.opportunities.amount.read", "sales.notes.body.read", "sales.communications.metadata.read"]);
const applicationPermission = new Set(["sales.reports.schedule", "sales.settings.read", "sales.settings.write"]);
const actionOperation = new Set(["archive", "qualify", "disqualify", "update", "close", "configure", "execute", "schedule", "send", "sync", "assign", "merge", "write"]);

function descriptor(id: typeof salesCrmPermissionIds[number]): AuthorizationPermissionDescriptor {
  const operation = id.endsWith(".read") ? "read" : actionOperation.has(id.split(".").at(-1)!) ? "write" : "manage";
  return { schemaVersion: 1, id, publisher, title: id, description: `Authorize ${id}.`, audience: "authenticated", resource: id.slice(0, id.lastIndexOf(".")), operation, scope: applicationPermission.has(id) ? "application" : fieldPermission.has(id) ? "field" : "record" };
}

export const salesCrmPermissionDescriptors: readonly AuthorizationPermissionDescriptor[] = Object.freeze(salesCrmPermissionIds.map(descriptor));

export const salesCrmObjectFieldActionMatrix = Object.freeze([
  { objectId: "sales.object.account", readPermissionId: "sales.accounts.read", writePermissionId: "sales.accounts.write", archivePermissionId: "sales.accounts.archive", recordPolicyId: "sales.policy.accounts.current", actionPermissions: { "sales.account.create": "sales.accounts.write", "sales.account.update": "sales.accounts.write", "sales.account.archive": "sales.accounts.archive", "sales.merge.commit": "sales.records.merge" } },
  { objectId: "sales.object.contact", readPermissionId: "sales.contacts.read", writePermissionId: "sales.contacts.write", archivePermissionId: "sales.contacts.archive", recordPolicyId: "sales.policy.contacts.current", sensitiveFields: { email: "sales.contacts.channels.read", phone: "sales.contacts.channels.read" }, actionPermissions: { "sales.contact.create": "sales.contacts.write", "sales.contact.update": "sales.contacts.write", "sales.contact.archive": "sales.contacts.archive", "sales.merge.commit": "sales.records.merge" } },
  { objectId: "sales.object.lead", readPermissionId: "sales.leads.read", writePermissionId: "sales.leads.write", archivePermissionId: "sales.leads.archive", recordPolicyId: "sales.policy.leads.current", sensitiveFields: { email: "sales.leads.channels.read", phone: "sales.leads.channels.read" }, actionPermissions: { "sales.lead.create": "sales.leads.write", "sales.lead.update": "sales.leads.write", "sales.lead.qualify": "sales.leads.qualify", "sales.lead.disqualify": "sales.leads.disqualify", "sales.lead.archive": "sales.leads.archive" } },
  { objectId: "sales.object.opportunity", readPermissionId: "sales.opportunities.read", writePermissionId: "sales.opportunities.write", archivePermissionId: "sales.opportunities.archive", recordPolicyId: "sales.policy.opportunities.current", sensitiveFields: { amount: "sales.opportunities.amount.read" }, actionPermissions: { "sales.opportunity.create": "sales.opportunities.write", "sales.opportunity.update": "sales.opportunities.write", "sales.opportunity.stage.update": "sales.opportunities.stage.update", "sales.opportunity.close": "sales.opportunities.close", "sales.opportunity.archive": "sales.opportunities.archive", "sales.report.run": "sales.reports.read" } },
  { objectId: "sales.object.pipeline", readPermissionId: "sales.pipelines.read", writePermissionId: "sales.pipelines.configure", recordPolicyId: "sales.policy.pipelines.current", actionPermissions: { "sales.pipeline.update": "sales.pipelines.configure", "sales.pipeline.archive": "sales.pipelines.configure" } },
  { objectId: "sales.object.pipeline-stage", readPermissionId: "sales.pipelines.read", writePermissionId: "sales.pipelines.configure", recordPolicyId: "sales.policy.pipelines.current" },
  { objectId: "sales.object.activity", readPermissionId: "sales.activities.read", writePermissionId: "sales.activities.write", recordPolicyId: "sales.policy.activities.current", sensitiveFields: { providerMetadata: "sales.communications.metadata.read" }, actionPermissions: { "sales.activity.create": "sales.activities.write", "sales.activity.complete": "sales.activities.write", "sales.activity.cancel": "sales.activities.write", "sales.email.send": "sales.communications.email.send", "sales.calendar.sync": "sales.communications.calendar.sync" } },
  { objectId: "sales.object.task", readPermissionId: "sales.tasks.read", writePermissionId: "sales.tasks.write", archivePermissionId: "sales.tasks.archive", recordPolicyId: "sales.policy.tasks.current", actionPermissions: { "sales.task.create": "sales.tasks.write", "sales.task.update": "sales.tasks.write", "sales.task.archive": "sales.tasks.archive" } },
  { objectId: "sales.object.note", readPermissionId: "sales.notes.read", writePermissionId: "sales.notes.write", recordPolicyId: "sales.policy.notes.current", sensitiveFields: { body: "sales.notes.body.read" }, actionPermissions: { "sales.note.create": "sales.notes.write" } },
  { objectId: "sales.object.attachment-reference", readPermissionId: "sales.attachments.read", writePermissionId: "sales.attachments.write", recordPolicyId: "sales.policy.attachments.current", actionPermissions: { "sales.attachment.link": "sales.attachments.write", "sales.attachment.remove": "sales.attachments.write" } },
  { objectId: "sales.object.saved-view", readPermissionId: "sales.saved-views.read", writePermissionId: "sales.saved-views.write", recordPolicyId: "sales.policy.saved-views.current", actionPermissions: { "sales.saved-view.create": "sales.saved-views.write", "sales.saved-view.update": "sales.saved-views.write", "sales.saved-view.archive": "sales.saved-views.write" } },
  { objectId: "sales.object.import-job", readPermissionId: "sales.imports.read", writePermissionId: "sales.imports.execute", recordPolicyId: "sales.policy.imports.current", actionPermissions: { "sales.import.dry-run": "sales.imports.execute", "sales.import.commit": "sales.imports.execute", "sales.import.cancel": "sales.imports.execute" } },
  { objectId: "sales.object.export-job", readPermissionId: "sales.exports.read", writePermissionId: "sales.exports.execute", recordPolicyId: "sales.policy.exports.current", actionPermissions: { "sales.export.create": "sales.exports.execute", "sales.export.cancel": "sales.exports.execute" } },
  { objectId: "sales.object.notification", readPermissionId: "sales.notifications.read", writePermissionId: "sales.notifications.write", recordPolicyId: "sales.policy.notifications.recipient", actionPermissions: { "sales.notification.read": "sales.notifications.write", "sales.notification.archive": "sales.notifications.write" } },
  { objectId: "sales.object.reminder", readPermissionId: "sales.reminders.read", writePermissionId: "sales.reminders.write", recordPolicyId: "sales.policy.reminders.recipient", actionPermissions: { "sales.reminder.dismiss": "sales.reminders.write", "sales.reminder.schedule": "sales.reminders.write" } }
] as const);

const permissionPolicies = new Map<string, string>();
const actionPolicies = new Map<string, string>();
const matrixActionPermissions = new Map<string, string>();
for (const row of salesCrmObjectFieldActionMatrix) {
  for (const permissionId of [row.readPermissionId, row.writePermissionId, "archivePermissionId" in row ? row.archivePermissionId : undefined, ...Object.values("sensitiveFields" in row ? row.sensitiveFields : {})]) {
    if (permissionId !== undefined) permissionPolicies.set(permissionId, row.recordPolicyId);
  }
  for (const [actionId, permissionId] of Object.entries("actionPermissions" in row ? row.actionPermissions : {})) {
    const prior = matrixActionPermissions.get(actionId);
    if (prior !== undefined && prior !== permissionId) throw new TypeError(`Sales action ${actionId} has conflicting frozen permissions.`);
    matrixActionPermissions.set(actionId, permissionId);
    // Merge is the frozen account+contact action; its scalar descriptor names that composite instead of either object policy alone.
    actionPolicies.set(actionId, actionId === "sales.merge.commit" ? "sales.policy.merge.current" : row.recordPolicyId);
    if (!applicationPermission.has(permissionId)) permissionPolicies.set(permissionId, row.recordPolicyId);
  }
}
// These are record decisions even though their operation IDs do not belong to one object row:
// ownership dispatches the target object, while merge requires both account and contact checks.
permissionPolicies.set("sales.ownership.write", "sales.policy.ownership.current");
permissionPolicies.set("sales.records.merge", "sales.policy.merge.current");

function policyBinding(id: string, scope: PermissionPolicyBinding["scope"], policyReference: string): PermissionPolicyBinding {
  return { schemaVersion: 1, id: `${id}.policy`, publisher, permissionId: id, policyReference, scope, failureMode: "deny", timeoutMs: 1_000 };
}
export const salesCrmPermissionPolicyBindings: readonly PermissionPolicyBinding[] = Object.freeze(salesCrmPermissionDescriptors
  .filter(({ scope }) => scope !== "application")
  .map(({ id, scope }) => {
    const policyReference = permissionPolicies.get(id);
    if (policyReference === undefined) throw new TypeError(`Sales permission ${id} has no frozen record policy.`);
    return policyBinding(id, scope, policyReference);
  }));

const grants = Object.freeze({
  "sales.template.representative": ["sales.accounts.read", "sales.accounts.write", "sales.contacts.read", "sales.contacts.write", "sales.contacts.channels.read", "sales.leads.read", "sales.leads.write", "sales.leads.channels.read", "sales.leads.qualify", "sales.leads.disqualify", "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.stage.update", "sales.activities.read", "sales.activities.write", "sales.tasks.read", "sales.tasks.write", "sales.notes.read", "sales.notes.write", "sales.notes.body.read", "sales.attachments.read", "sales.attachments.write", "sales.pipelines.read", "sales.saved-views.read", "sales.saved-views.write", "sales.notifications.read", "sales.notifications.write", "sales.reminders.read", "sales.reminders.write", "sales.reports.read"],
  "sales.template.manager": ["sales.accounts.read", "sales.accounts.write", "sales.accounts.archive", "sales.contacts.read", "sales.contacts.write", "sales.contacts.archive", "sales.contacts.channels.read", "sales.leads.read", "sales.leads.write", "sales.leads.archive", "sales.leads.channels.read", "sales.leads.qualify", "sales.leads.disqualify", "sales.opportunities.read", "sales.opportunities.write", "sales.opportunities.archive", "sales.opportunities.amount.read", "sales.opportunities.stage.update", "sales.opportunities.close", "sales.activities.read", "sales.activities.write", "sales.tasks.read", "sales.tasks.write", "sales.tasks.archive", "sales.notes.read", "sales.notes.write", "sales.notes.body.read", "sales.attachments.read", "sales.attachments.write", "sales.pipelines.read", "sales.saved-views.read", "sales.saved-views.write", "sales.imports.read", "sales.imports.execute", "sales.exports.read", "sales.exports.execute", "sales.notifications.read", "sales.notifications.write", "sales.reminders.read", "sales.reminders.write", "sales.reports.read", "sales.reports.schedule", "sales.ownership.write", "sales.records.merge"],
  "sales.template.administrator": [...salesCrmPermissionIds],
  "sales.template.viewer": ["sales.accounts.read", "sales.contacts.read", "sales.leads.read", "sales.opportunities.read", "sales.activities.read", "sales.tasks.read", "sales.notes.read", "sales.attachments.read", "sales.pipelines.read", "sales.saved-views.read", "sales.notifications.read", "sales.reminders.read", "sales.reports.read"]
} as const);

function roleTemplate(id: keyof typeof grants, title: string, description: string): RoleTemplate {
  return { schemaVersion: 1, id, publisher, version: 2, instantiation: "manual", title, description, permissionIds: [...grants[id]].sort() };
}
export const salesCrmRoleTemplates: readonly RoleTemplate[] = Object.freeze([
  roleTemplate("sales.template.viewer", "Sales Viewer", "Inspect authorized CRM records and reports."),
  roleTemplate("sales.template.representative", "Sales Representative", "Work assigned customer records and follow-up."),
  roleTemplate("sales.template.manager", "Sales Manager", "Manage assigned teams and controlled data movement."),
  roleTemplate("sales.template.administrator", "Sales Administrator", "Operate application Sales configuration.")
]);

const operationActionPermissions = Object.freeze({
  "sales.ownership.assign": "sales.ownership.write", "sales.report.schedule": "sales.reports.schedule", "sales.settings.update": "sales.settings.write", "sales.integration.configure": "sales.settings.write",
  "sales.import.dry-run": "sales.imports.execute", "sales.import.commit": "sales.imports.execute", "sales.import.cancel": "sales.imports.execute",
  "sales.export.create": "sales.exports.execute", "sales.export.cancel": "sales.exports.execute"
} as const);
const operationActionPolicies = Object.freeze({
  "sales.ownership.assign": "sales.policy.ownership.current",
  "sales.report.schedule": "sales.policy.reports.schedule.current",
  "sales.settings.update": "sales.policy.settings.current",
  "sales.integration.configure": "sales.policy.settings.current",
  "sales.import.dry-run": "sales.policy.imports.current", "sales.import.commit": "sales.policy.imports.current", "sales.import.cancel": "sales.policy.imports.current",
  "sales.export.create": "sales.policy.exports.current", "sales.export.cancel": "sales.policy.exports.current"
} as const);
const actionPermissions = Object.freeze(Object.fromEntries([...matrixActionPermissions, ...Object.entries(operationActionPermissions)]));
const recordId = { type: "string" as const, minLength: 1, maxLength: 10 };
const principalIdentity = { type: "string" as const, minLength: 1, maxLength: 160 };

const actionOutput = {
  type: "object" as const,
  properties: {
    id: recordId,
    revision: { type: "integer" as const, minimum: 1 },
    status: { type: "string" as const },
    accountId: recordId,
    contactId: recordId,
    opportunityId: recordId
  },
  required: ["id", "revision", "status"],
  additionalProperties: false as const
};

const actionInput = { type: "object" as const, properties: {}, additionalProperties: false as const };
const revision = { type: "integer" as const, minimum: 1 };
const shortText = { type: "string" as const, minLength: 1, maxLength: 256 };
const optionalText = { type: "string" as const, minLength: 1, maxLength: 256 };
export const salesPhoneMaxLength = 64;
const phoneText = { type: "string" as const, minLength: 1, maxLength: salesPhoneMaxLength };
const mediaType = { type: "string" as const, minLength: 1, maxLength: 128 };
const relatedRecordType = { type: "string" as const, enum: ["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"] };
const ownershipRecordType = { type: "string" as const, enum: ["sales.account", "sales.contact", "sales.lead", "sales.opportunity"] };
const activityType = { type: "string" as const, enum: ["call", "meeting", "email"] };
const opportunityStage = { type: "string" as const, enum: ["qualification", "discovery", "proposal", "negotiation", "won", "lost"] };
const qualificationMode = { type: "string" as const, enum: ["create", "link"] };
const optionalMutationMode = { type: "string" as const, enum: ["retain", "set", "clear"] };
export const salesCalendarDatePattern = "^(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-[0-9]{2}-[0-9]{2}$";
export function isSalesCalendarDate(value: unknown): value is string {
  return typeof value === "string" && new RegExp(salesCalendarDatePattern, "u").test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
const calendarDate = { type: "string" as const, minLength: 10, maxLength: 10, description: "Exact Gregorian YYYY-MM-DD date in years 0001 through 9999." };
const opportunityMoney = { type: "object" as const, properties: {
  kind: { type: "string" as const, enum: ["money"] }, value: { type: "string" as const, minLength: 1, maxLength: 128 },
  currency: { type: "string" as const, minLength: 3, maxLength: 3 }, scale: { type: "integer" as const, minimum: 0, maximum: 18 }
}, required: ["kind", "value", "currency", "scale"], additionalProperties: false as const };
const stageUuid = { type: "string" as const, minLength: 36, maxLength: 36 };
const stringArray = { type: "array" as const, items: { type: "string" as const }, maxItems: 6 };
const pipelineStageSnapshot = { type: "object" as const, properties: {
  stageId: stageUuid, expectedRevision: revision, semantic: opportunityStage, name: shortText,
  position: { type: "integer" as const, minimum: 0, maximum: 5 }, probabilityBasisPoints: { type: "integer" as const, minimum: 0, maximum: 10_000 },
  allowedTransitionStageIds: stringArray, requiredFieldIds: { type: "array" as const, items: { type: "string" as const }, maxItems: 1 }
}, required: ["stageId", "expectedRevision", "semantic", "name", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds"], additionalProperties: false as const };
const pipelineStageOutput = { type: "object" as const, properties: {
  stageId: stageUuid, revision, semantic: opportunityStage, name: shortText,
  position: { type: "integer" as const, minimum: 0, maximum: 5 }, probabilityBasisPoints: { type: "integer" as const, minimum: 0, maximum: 10_000 },
  allowedTransitionStageIds: stringArray, requiredFieldIds: { type: "array" as const, items: { type: "string" as const }, maxItems: 1 }, status: { type: "string" as const, enum: ["active"] }
}, required: ["stageId", "revision", "semantic", "name", "position", "probabilityBasisPoints", "allowedTransitionStageIds", "requiredFieldIds", "status"], additionalProperties: false as const };
const savedViewName = { type: "string" as const, minLength: 1, maxLength: 120, maxUtf8Bytes: 120 };
const savedViewVisibility = {
  oneOf: [
    { type: "object" as const, properties: { kind: { type: "string" as const, enum: ["personal"] } }, required: ["kind"], additionalProperties: false as const },
    { type: "object" as const, properties: { kind: { type: "string" as const, enum: ["team"] }, teamId: { type: "string" as const, minLength: 1, maxLength: 120, maxUtf8Bytes: 120 } }, required: ["kind", "teamId"], additionalProperties: false as const }
  ]
} satisfies AgentToolJsonSchema;
const savedViewFilterValue = {
  oneOf: [
    { type: "null" as const },
    { type: "string" as const, maxLength: 512, maxUtf8Bytes: 512 },
    { type: "integer" as const, minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    { type: "array" as const, items: { type: "string" as const, maxLength: 512, maxUtf8Bytes: 512 }, minItems: 1, maxItems: 20 },
    { type: "array" as const, items: { type: "integer" as const, minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }, minItems: 1, maxItems: 20 }
  ]
} satisfies AgentToolJsonSchema;
const savedViewDefinition = { type: "object" as const, properties: {
  kind: { type: "string" as const, enum: ["table", "kanban", "calendar"] }, targetObjectId: { type: "string" as const },
  source: { type: "object" as const, properties: { id: { type: "string" as const }, version: revision, sourceSchema: { type: "object" as const, properties: { id: { type: "string" as const }, version: revision }, required: ["id", "version"], additionalProperties: false as const }, structuralCompatibilityHash: { type: "string" as const } }, required: ["id", "version", "sourceSchema", "structuralCompatibilityHash"], additionalProperties: false as const },
  fields: { type: "array" as const, items: { type: "string" as const }, minItems: 1, maxItems: 8 },
  filters: { type: "array" as const, items: { type: "object" as const, properties: { fieldId: { type: "string" as const }, operator: { type: "string" as const }, value: savedViewFilterValue }, required: ["fieldId", "operator"], additionalProperties: false as const }, maxItems: 8 },
  sorts: { type: "array" as const, items: { type: "object" as const, properties: { fieldId: { type: "string" as const }, direction: { type: "string" as const, enum: ["asc", "desc"] } }, required: ["fieldId", "direction"], additionalProperties: false as const }, maxItems: 2 },
  grouping: { type: "string" as const }, dateField: { type: "string" as const }, calendarRange: { type: "object" as const, properties: { start: { type: "string" as const }, end: { type: "string" as const }, timezone: { type: "string" as const } }, required: ["start", "end", "timezone"], additionalProperties: false as const },
  presentation: { type: "object" as const, properties: { density: { type: "string" as const }, mode: { type: "string" as const } }, additionalProperties: false as const }, pageSize: { type: "integer" as const, minimum: 1, maximum: 100 }
}, required: ["kind", "targetObjectId", "source", "fields", "filters", "sorts", "presentation", "pageSize"], additionalProperties: false as const };
const mutationInput = (properties: Record<string, AgentToolJsonSchema>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false as const });
const safeId = { type: "integer" as const, minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const sha256Digest = { type: "string" as const, minLength: 71, maxLength: 71 };
const importMapping = (fields: readonly string[], minimum: number) => ({ type: "array" as const, minItems: minimum, maxItems: fields.length, items: { type: "object" as const, properties: { header: { type: "string" as const, minLength: 1, maxLength: 120, maxUtf8Bytes: 120 }, fieldId: { type: "string" as const, enum: [...fields] } }, required: ["header", "fieldId"], additionalProperties: false as const } });
const importRequest = (targetObjectType: string, fields: readonly string[], minimum: number) => ({ type: "object" as const, properties: { uploadArtifactId: { type: "string" as const, minLength: 1, maxLength: 128 }, targetObjectType: { type: "string" as const, enum: [targetObjectType] }, columnMapping: importMapping(fields, minimum), expectedAuthorizationRevision: safeId }, required: ["uploadArtifactId", "targetObjectType", "columnMapping", "expectedAuthorizationRevision"], additionalProperties: false as const });
const exportRequest = (targetObjectType: string, sourceId: string, fields: readonly string[]) => ({ type: "object" as const, properties: { targetObjectType: { type: "string" as const, enum: [targetObjectType] }, sourceId: { type: "string" as const, enum: [sourceId] }, sourceVersion: { type: "integer" as const, enum: [1] }, sourceSchemaVersion: { type: "integer" as const, enum: [1] }, selectedFields: { type: "array" as const, minItems: 1, maxItems: fields.length, items: { type: "string" as const, enum: [...fields] } }, expectedAuthorizationRevision: safeId }, required: ["targetObjectType", "sourceId", "sourceVersion", "sourceSchemaVersion", "selectedFields", "expectedAuthorizationRevision"], additionalProperties: false as const });
const dataMovementInputs: Readonly<Record<string, ActionDescriptor["inputSchema"]>> = Object.freeze({
  "sales.import.dry-run": mutationInput({ request: { oneOf: [importRequest("sales.object.lead", ["displayName", "source", "email", "phone"], 2), importRequest("sales.object.account", ["name"], 1), importRequest("sales.object.contact", ["displayName", "accountId", "email", "phone"], 2)] } }, ["request"]),
  "sales.import.commit": mutationInput({ importJobId: safeId, expectedRevision: safeId, expectedAuthorizationRevision: safeId }, ["importJobId", "expectedRevision", "expectedAuthorizationRevision"]),
  "sales.import.cancel": mutationInput({ importJobId: safeId, expectedRevision: safeId }, ["importJobId", "expectedRevision"]),
  "sales.export.create": mutationInput({ request: { oneOf: [exportRequest("sales.object.lead", "sales.leads", ["display-name", "owner-id", "team-id", "status", "archive-status", "revision", "email", "phone"]), exportRequest("sales.object.account", "sales.accounts", ["name", "owner-id", "team-id", "status", "revision"]), exportRequest("sales.object.contact", "sales.contacts", ["display-name", "owner-id", "team-id", "account-id", "status", "revision", "email", "phone"])] } }, ["request"]),
  "sales.export.cancel": mutationInput({ exportJobId: safeId, expectedRevision: safeId }, ["exportJobId", "expectedRevision"]),
  "sales.merge.commit": mutationInput({ targetObjectType: { type: "string", enum: ["sales.object.account", "sales.object.contact"] }, winnerId: safeId, winnerExpectedRevision: safeId, loserId: safeId, loserExpectedRevision: safeId, expectedAuthorizationRevision: safeId }, ["targetObjectType", "winnerId", "winnerExpectedRevision", "loserId", "loserExpectedRevision", "expectedAuthorizationRevision"])
});
const workflowActionInputs: Readonly<Record<string, ActionDescriptor["inputSchema"]>> = Object.freeze({
  ...dataMovementInputs,
  "sales.account.create": mutationInput({ name: shortText }, ["name"]),
  "sales.account.update": mutationInput({ id: recordId, expectedRevision: revision, name: shortText }, ["id", "expectedRevision", "name"]),
  "sales.account.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.contact.create": mutationInput({ accountId: recordId, displayName: shortText, email: optionalText, phone: phoneText }, ["accountId", "displayName"]),
  "sales.contact.update": mutationInput({ id: recordId, expectedRevision: revision, displayName: shortText, emailMode: optionalMutationMode, email: optionalText, phoneMode: optionalMutationMode, phone: phoneText }, ["id", "expectedRevision", "displayName", "emailMode", "phoneMode"]),
  "sales.contact.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.lead.create": mutationInput({ displayName: shortText, source: shortText, email: optionalText, phone: phoneText }, ["displayName", "source"]),
  "sales.lead.update": mutationInput({ id: recordId, expectedRevision: revision, displayName: shortText, source: shortText, emailMode: optionalMutationMode, email: optionalText, phoneMode: optionalMutationMode, phone: phoneText }, ["id", "expectedRevision", "displayName", "source", "emailMode", "phoneMode"]),
  "sales.lead.qualify": mutationInput({ id: recordId, expectedRevision: revision, accountMode: qualificationMode, accountName: shortText, accountId: recordId, contactMode: qualificationMode, contactName: shortText, contactId: recordId, opportunityName: shortText, pipelineId: recordId }, ["id", "expectedRevision", "accountMode", "contactMode", "opportunityName", "pipelineId"]),
  "sales.lead.disqualify": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.lead.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.opportunity.create": mutationInput({ name: shortText, accountId: recordId, pipelineId: recordId, expectedPipelineRevision: revision, stageId: stageUuid, expectedStageRevision: revision, primaryContactId: recordId, amount: opportunityMoney, expectedCloseDate: calendarDate }, ["name", "accountId", "pipelineId", "expectedPipelineRevision", "stageId", "expectedStageRevision"]),
  "sales.opportunity.update": mutationInput({ id: recordId, expectedRevision: revision, name: shortText, primaryContactMode: optionalMutationMode, primaryContactId: recordId, amountMode: optionalMutationMode, amount: opportunityMoney, expectedCloseDateMode: optionalMutationMode, expectedCloseDate: calendarDate }, ["id", "expectedRevision", "name", "primaryContactMode", "amountMode", "expectedCloseDateMode"]),
  "sales.opportunity.close": mutationInput({ id: recordId, expectedRevision: revision, expectedPipelineId: recordId, expectedPipelineRevision: revision, expectedSourceStageId: stageUuid, expectedSourceStageRevision: revision, destinationStageId: stageUuid, expectedDestinationStageRevision: revision, lossReason: { type: "string" as const, minLength: 1, maxLength: 500 } }, ["id", "expectedRevision", "expectedPipelineId", "expectedPipelineRevision", "expectedSourceStageId", "expectedSourceStageRevision", "destinationStageId", "expectedDestinationStageRevision"]),
  "sales.opportunity.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.activity.create": mutationInput({ relatedRecordType, relatedRecordId: recordId, type: activityType, subject: shortText, scheduledAt: shortText, supersedesActivityId: recordId }, ["relatedRecordType", "relatedRecordId", "type", "subject", "scheduledAt"]),
  "sales.activity.complete": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.activity.cancel": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.note.create": mutationInput({ relatedRecordType, relatedRecordId: recordId, body: { type: "string" as const, minLength: 1, maxLength: 10_000 }, replacesNoteId: recordId }, ["relatedRecordType", "relatedRecordId", "body"]),
  "sales.attachment.link": mutationInput({ relatedRecordType, relatedRecordId: recordId, storageReference: shortText, filename: shortText, mediaType, byteSize: { type: "integer" as const, minimum: 0, maximum: 1_073_741_824 } }, ["relatedRecordType", "relatedRecordId", "storageReference", "filename", "mediaType", "byteSize"]),
  "sales.attachment.remove": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.pipeline.update": mutationInput({ id: recordId, expectedRevision: revision, name: shortText, orderedStageIds: stringArray, stages: { type: "array" as const, items: pipelineStageSnapshot, minItems: 6, maxItems: 6 } }, ["id", "expectedRevision", "name", "orderedStageIds", "stages"]),
  "sales.pipeline.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.saved-view.create": mutationInput({ name: savedViewName, visibility: savedViewVisibility, definition: savedViewDefinition }, ["name", "visibility", "definition"]),
  "sales.saved-view.update": mutationInput({ id: recordId, expectedRevision: revision, name: savedViewName, visibility: savedViewVisibility, definition: savedViewDefinition }, ["id", "expectedRevision", "name", "visibility", "definition"]),
  "sales.saved-view.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.ownership.assign": mutationInput({ recordType: ownershipRecordType, id: recordId, expectedRevision: revision, ownerId: principalIdentity, teamId: principalIdentity }, ["recordType", "id", "expectedRevision", "ownerId"])
});
const ownershipOutput = { type: "object" as const, properties: { recordType: ownershipRecordType, id: recordId, revision, ownerId: principalIdentity, teamId: principalIdentity }, required: ["recordType", "id", "revision", "ownerId"], additionalProperties: false as const };
const workflowOutputStatuses: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "sales.account.create": ["active"], "sales.account.update": ["active"], "sales.account.archive": ["archived"],
  "sales.contact.create": ["active"], "sales.contact.update": ["active"], "sales.contact.archive": ["archived"],
  "sales.lead.create": ["new"], "sales.lead.update": ["working"], "sales.lead.qualify": ["qualified"], "sales.lead.disqualify": ["disqualified"], "sales.lead.archive": ["archived"],
  "sales.opportunity.create": ["qualification"], "sales.opportunity.update": ["qualification", "discovery", "proposal", "negotiation"], "sales.opportunity.close": ["won", "lost"], "sales.opportunity.archive": ["archived"],
  "sales.activity.create": ["scheduled"], "sales.activity.complete": ["completed"], "sales.activity.cancel": ["cancelled"], "sales.note.create": ["recorded"], "sales.attachment.link": ["active"], "sales.attachment.remove": ["removed"],
  "sales.pipeline.update": ["active"], "sales.pipeline.archive": ["archived"], "sales.saved-view.create": ["active"], "sales.saved-view.update": ["active"], "sales.saved-view.archive": ["archived"]
});
function workflowOutput(id: string): ActionDescriptor["outputSchema"] {
  if (id === "sales.import.dry-run") return mutationInput({ importJobId: safeId, revision: { type: "integer", enum: [2] }, state: { type: "string", enum: ["validated"] }, uploadDigest: sha256Digest, acceptedRows: { type: "integer", minimum: 0, maximum: 10_000 }, rejectedRows: { type: "integer", minimum: 0, maximum: 10_000 }, diagnosticDigest: sha256Digest }, ["importJobId", "revision", "state", "uploadDigest", "acceptedRows", "rejectedRows", "diagnosticDigest"]);
  if (id === "sales.import.commit") return mutationInput({ importJobId: safeId, revision: { type: "integer", minimum: 3, maximum: Number.MAX_SAFE_INTEGER }, state: { type: "string", enum: ["queued"] }, receiptId: { type: "string", minLength: 1, maxLength: 128 } }, ["importJobId", "revision", "state", "receiptId"]);
  if (id === "sales.import.cancel") return mutationInput({ importJobId: safeId, revision: { type: "integer", minimum: 2, maximum: Number.MAX_SAFE_INTEGER }, state: { type: "string", enum: ["cancelled"] } }, ["importJobId", "revision", "state"]);
  if (id === "sales.export.create") return mutationInput({ exportJobId: safeId, revision: { type: "integer", enum: [1] }, state: { type: "string", enum: ["queued"] }, snapshotDigest: sha256Digest, snapshotRevision: safeId, receiptId: { type: "string", minLength: 1, maxLength: 128 } }, ["exportJobId", "revision", "state", "snapshotDigest", "snapshotRevision", "receiptId"]);
  if (id === "sales.export.cancel") return mutationInput({ exportJobId: safeId, revision: { type: "integer", minimum: 2, maximum: Number.MAX_SAFE_INTEGER }, state: { type: "string", enum: ["cancelled"] } }, ["exportJobId", "revision", "state"]);
  if (id === "sales.merge.commit") return mutationInput({ winnerId: safeId, winnerRevision: { type: "integer", minimum: 2, maximum: Number.MAX_SAFE_INTEGER }, loserId: safeId, loserRevision: { type: "integer", minimum: 2, maximum: Number.MAX_SAFE_INTEGER }, matchKind: { type: "string", enum: ["account-name", "contact-email", "contact-phone", "contact-email-and-phone"] }, lineageId: { type: "string", minLength: 1, maxLength: 128 }, lineageDigest: sha256Digest, rewrittenRelationCounts: { type: "array", minItems: 6, maxItems: 7, items: { type: "object", properties: { relationId: { type: "string", enum: ["sales_contacts.account_id", "sales_opportunities.account_id", "sales_leads.qualified_account_id", "sales_activities.related_record_id where related_record_type=sales.account", "sales_notes.related_record_id where related_record_type=sales.account", "sales_attachment_references.related_record_id where related_record_type=sales.account", "sales_tasks.related_record_id where related_record_type=sales.account", "sales_opportunities.primary_contact_id", "sales_leads.qualified_contact_id", "sales_activities.related_record_id where related_record_type=sales.contact", "sales_notes.related_record_id where related_record_type=sales.contact", "sales_attachment_references.related_record_id where related_record_type=sales.contact", "sales_tasks.related_record_id where related_record_type=sales.contact"] }, count: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }, required: ["relationId", "count"], additionalProperties: false } } }, ["winnerId", "winnerRevision", "loserId", "loserRevision", "matchKind", "lineageId", "lineageDigest", "rewrittenRelationCounts"]);
  const statuses = workflowOutputStatuses[id];
  if (statuses === undefined) return actionOutput;
  const qualification = id === "sales.lead.qualify";
  if (id === "sales.opportunity.create" || id === "sales.opportunity.stage.update" || id === "sales.opportunity.close") return {
    type: "object", properties: { id: recordId, revision, pipelineId: recordId, stageId: stageUuid }, required: ["id", "revision", "pipelineId", "stageId"], additionalProperties: false
  };
  if (id === "sales.pipeline.update") return {
    type: "object", properties: { id: recordId, revision, name: shortText, orderedStageIds: stringArray, stages: { type: "array", items: pipelineStageOutput, minItems: 6, maxItems: 6 }, status: { type: "string", enum: ["active"] } }, required: ["id", "revision", "name", "orderedStageIds", "stages", "status"], additionalProperties: false
  };
  if (id === "sales.saved-view.create" || id === "sales.saved-view.update") return {
    type: "object", properties: { id: recordId, revision, name: savedViewName, visibility: savedViewVisibility, definition: savedViewDefinition, status: { type: "string", enum: ["active"] } }, required: ["id", "revision", "name", "visibility", "definition", "status"], additionalProperties: false
  };
  return { type: "object", properties: { id: recordId, revision, status: { type: "string", enum: [...statuses] }, ...(qualification ? { accountId: recordId, contactId: recordId, opportunityId: recordId } : {}) }, required: ["id", "revision", "status", ...(qualification ? ["accountId", "contactId", "opportunityId"] : [])], additionalProperties: false };
}
export const salesCrmActionDescriptors: readonly ActionDescriptor[] = Object.freeze(Object.entries(actionPermissions).map(([id, permission]) => {
  const policy = actionPolicies.get(id) ?? operationActionPolicies[id as keyof typeof operationActionPolicies];
  if (policy === undefined) throw new TypeError(`Sales action ${id} has no policy.`);
  const workflow = workflowActionInputs[id];
  return {
    id,
    version: id === "sales.opportunity.stage.update" || id === "sales.opportunity.create" ? 3 : id === "sales.task.create" || id === "sales.task.update" || id === "sales.ownership.assign" || id === "sales.lead.qualify" || id === "sales.opportunity.update" || id === "sales.opportunity.close" || id === "sales.contact.update" || id === "sales.lead.update" || id === "sales.note.create" || id.startsWith("sales.pipeline.") || id.startsWith("sales.saved-view.") ? 2 : 1,
    ownerPluginId: "module.sales",
    inputSchema: workflow ?? actionInput,
    outputSchema: id === "sales.ownership.assign" ? ownershipOutput : workflow === undefined ? { type: "object" as const, properties: { accepted: { type: "boolean" as const } }, required: ["accepted"], additionalProperties: false as const } : workflowOutput(id),
    permission,
    policy,
    effect: id === "sales.merge.commit" ? "destructive" as const : "write" as const,
    idempotency: "required" as const,
    dryRun: id === "sales.import.dry-run"
  };
}));

const routePermissions = Object.freeze({
  "sales.route.overview": "sales.reports.read", "sales.route.tasks": "sales.tasks.read", "sales.route.notifications": "sales.notifications.read", "sales.route.leads": "sales.leads.read", "sales.route.lead-detail": "sales.leads.read", "sales.route.accounts": "sales.accounts.read", "sales.route.account-detail": "sales.accounts.read", "sales.route.contacts": "sales.contacts.read", "sales.route.contact-detail": "sales.contacts.read", "sales.route.opportunities": "sales.opportunities.read", "sales.route.opportunity-detail": "sales.opportunities.read", "sales.route.pipeline-settings": "sales.pipelines.configure", "sales.route.saved-views": "sales.saved-views.read", "sales.route.imports": "sales.imports.read", "sales.route.exports": "sales.exports.read", "sales.route.calendar": "sales.activities.read", "sales.route.reports": "sales.reports.read"
} as const);

function routeDescriptor(id: string, permission: string): PluginRouteDescriptor {
  const name = id.slice("sales.route.".length);
  const path = name === "overview" ? "/sales" : `/sales/${name.replaceAll("-detail", "/:id").replace("pipeline-settings", "settings/pipeline").replace("saved-views", "views")}`;
  return { id, ownerPluginId: "module.sales", path, parameters: name.endsWith("-detail") ? { id: { type: "string" } } : {}, surface: "workspace", audience: "authenticated", permission, viewId: `sales.page.${name}` };
}
export const salesCrmRouteDescriptors: readonly PluginRouteDescriptor[] = Object.freeze(Object.entries(routePermissions).map(([id, permission]) => routeDescriptor(id, permission)));

export const salesCrmRoutePermissions = routePermissions;
