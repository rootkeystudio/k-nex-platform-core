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

const operationActionPermissions = Object.freeze({ "sales.ownership.assign": "sales.ownership.write", "sales.report.schedule": "sales.reports.schedule", "sales.settings.update": "sales.settings.write", "sales.integration.configure": "sales.settings.write" } as const);
const operationActionPolicies = Object.freeze({
  "sales.ownership.assign": "sales.policy.ownership.current",
  "sales.report.schedule": "sales.policy.reports.schedule.current",
  "sales.settings.update": "sales.policy.settings.current",
  "sales.integration.configure": "sales.policy.settings.current"
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
const mutationInput = (properties: Record<string, AgentToolJsonSchema>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false as const });
const workflowActionInputs: Readonly<Record<string, ActionDescriptor["inputSchema"]>> = Object.freeze({
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
  "sales.opportunity.create": mutationInput({ name: shortText, accountId: recordId, pipelineId: recordId, stageId: { type: "string" as const, enum: ["qualification"] }, primaryContactId: recordId, amount: opportunityMoney, expectedCloseDate: calendarDate }, ["name", "accountId", "pipelineId", "stageId"]),
  "sales.opportunity.update": mutationInput({ id: recordId, expectedRevision: revision, name: shortText, primaryContactMode: optionalMutationMode, primaryContactId: recordId, amountMode: optionalMutationMode, amount: opportunityMoney, expectedCloseDateMode: optionalMutationMode, expectedCloseDate: calendarDate }, ["id", "expectedRevision", "name", "primaryContactMode", "amountMode", "expectedCloseDateMode"]),
  "sales.opportunity.close": mutationInput({ id: recordId, expectedRevision: revision, expectedStage: opportunityStage, stage: { type: "string" as const, enum: ["won", "lost"] }, lossReason: optionalText }, ["id", "expectedRevision", "expectedStage", "stage"]),
  "sales.opportunity.archive": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.activity.create": mutationInput({ relatedRecordType, relatedRecordId: recordId, type: activityType, subject: shortText, scheduledAt: shortText, supersedesActivityId: recordId }, ["relatedRecordType", "relatedRecordId", "type", "subject", "scheduledAt"]),
  "sales.activity.complete": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.activity.cancel": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.note.create": mutationInput({ relatedRecordType, relatedRecordId: recordId, body: { type: "string" as const, minLength: 1, maxLength: 10_000 }, replacesNoteId: recordId }, ["relatedRecordType", "relatedRecordId", "body"]),
  "sales.attachment.link": mutationInput({ relatedRecordType, relatedRecordId: recordId, storageReference: shortText, filename: shortText, mediaType, byteSize: { type: "integer" as const, minimum: 0, maximum: 1_073_741_824 } }, ["relatedRecordType", "relatedRecordId", "storageReference", "filename", "mediaType", "byteSize"]),
  "sales.attachment.remove": mutationInput({ id: recordId, expectedRevision: revision }, ["id", "expectedRevision"]),
  "sales.ownership.assign": mutationInput({ recordType: ownershipRecordType, id: recordId, expectedRevision: revision, ownerId: principalIdentity, teamId: principalIdentity }, ["recordType", "id", "expectedRevision", "ownerId"])
});
const ownershipOutput = { type: "object" as const, properties: { recordType: ownershipRecordType, id: recordId, revision, ownerId: principalIdentity, teamId: principalIdentity }, required: ["recordType", "id", "revision", "ownerId"], additionalProperties: false as const };
const workflowOutputStatuses: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "sales.account.create": ["active"], "sales.account.update": ["active"], "sales.account.archive": ["archived"],
  "sales.contact.create": ["active"], "sales.contact.update": ["active"], "sales.contact.archive": ["archived"],
  "sales.lead.create": ["new"], "sales.lead.update": ["working"], "sales.lead.qualify": ["qualified"], "sales.lead.disqualify": ["disqualified"], "sales.lead.archive": ["archived"],
  "sales.opportunity.create": ["qualification"], "sales.opportunity.update": ["qualification", "discovery", "proposal", "negotiation"], "sales.opportunity.close": ["won", "lost"], "sales.opportunity.archive": ["archived"],
  "sales.activity.create": ["scheduled"], "sales.activity.complete": ["completed"], "sales.activity.cancel": ["cancelled"], "sales.note.create": ["recorded"], "sales.attachment.link": ["active"], "sales.attachment.remove": ["removed"]
});
function workflowOutput(id: string): ActionDescriptor["outputSchema"] {
  const statuses = workflowOutputStatuses[id];
  if (statuses === undefined) return actionOutput;
  const qualification = id === "sales.lead.qualify";
  return { type: "object", properties: { id: recordId, revision, status: { type: "string", enum: [...statuses] }, ...(qualification ? { accountId: recordId, contactId: recordId, opportunityId: recordId } : {}) }, required: ["id", "revision", "status", ...(qualification ? ["accountId", "contactId", "opportunityId"] : [])], additionalProperties: false };
}
export const salesCrmActionDescriptors: readonly ActionDescriptor[] = Object.freeze(Object.entries(actionPermissions).map(([id, permission]) => {
  const policy = actionPolicies.get(id) ?? operationActionPolicies[id as keyof typeof operationActionPolicies];
  if (policy === undefined) throw new TypeError(`Sales action ${id} has no policy.`);
  const workflow = workflowActionInputs[id];
  return {
    id,
    version: id === "sales.task.create" || id === "sales.task.update" || id === "sales.opportunity.stage.update" || id === "sales.ownership.assign" || id === "sales.lead.qualify" || id === "sales.opportunity.create" || id === "sales.opportunity.update" || id === "sales.contact.update" || id === "sales.lead.update" || id === "sales.note.create" ? 2 : 1,
    ownerPluginId: "module.sales",
    inputSchema: workflow ?? actionInput,
    outputSchema: id === "sales.ownership.assign" ? ownershipOutput : workflow === undefined ? { type: "object" as const, properties: { accepted: { type: "boolean" as const } }, required: ["accepted"], additionalProperties: false as const } : workflowOutput(id),
    permission,
    policy,
    effect: "write" as const,
    idempotency: "required" as const,
    dryRun: false
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
