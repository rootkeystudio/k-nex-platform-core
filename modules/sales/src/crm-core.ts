import type { CollectionConfig, Field, RelationshipField } from "payload";

export const salesCoreCollectionSlugs = Object.freeze([
  "sales-accounts",
  "sales-contacts",
  "sales-leads",
  "sales-pipelines",
  "sales-pipeline-stages",
  "sales-activities",
  "sales-opportunities",
  "sales-tasks",
  "sales-notes",
  "sales-attachment-references",
  "sales-saved-views"
] as const);

const deny = () => false;
const directPayloadAccess = Object.freeze({ create: deny, delete: deny, read: deny, update: deny });
const protectedFieldAccess = Object.freeze({ create: deny, read: deny, update: deny });
export const salesRelatedRecordTypes = Object.freeze(["sales.account", "sales.contact", "sales.lead", "sales.opportunity", "sales.task"] as const);

const text = (name: string, required = false): Field => ({ name, type: "text", required });
const select = (name: string, values: readonly string[], defaultValue?: string): Field => ({
  name,
  type: "select",
  required: true,
  ...(defaultValue === undefined ? {} : { defaultValue }),
  options: values.map((value) => ({ label: value, value }))
});

/** Fields controlled only by registered Sales actions; generic Payload access is denied. */
export function salesCommonFields(options: { readonly ownerRequired: boolean; readonly teamRequired?: boolean; readonly lifecycle?: readonly string[] }): Field[] {
  return [
    { name: "applicationId", type: "text", required: true, index: true, access: protectedFieldAccess },
    { name: "environment", type: "text", required: true, index: true, access: protectedFieldAccess },
    { name: "ownerId", type: "text", required: options.ownerRequired, index: true, access: protectedFieldAccess },
    { name: "teamId", type: "text", required: options.teamRequired ?? false, index: true, access: protectedFieldAccess },
    { name: "createdBy", type: "text", required: true, access: protectedFieldAccess },
    { name: "updatedBy", type: "text", required: true, access: protectedFieldAccess },
    { name: "revision", type: "number", required: true, defaultValue: 1, min: 1, access: protectedFieldAccess },
    { name: "audit", type: "json", required: true, defaultValue: () => [], access: protectedFieldAccess },
    ...(options.lifecycle === undefined ? [] : [{ name: "status", type: "select", required: true, defaultValue: options.lifecycle[0]!, options: options.lifecycle.map((value) => ({ label: value, value })), access: protectedFieldAccess } satisfies Field])
  ];
}

function collection(slug: typeof salesCoreCollectionSlugs[number], fields: Field[], indexes: NonNullable<CollectionConfig["indexes"]>): CollectionConfig {
  return { slug, access: directPayloadAccess, fields, indexes };
}

const activitySupersedesField: RelationshipField = {
  // Payload adds `_id` for relationship columns; this preserves migration column `supersedes_activity_id`.
  name: "supersedesActivity", type: "relationship", relationTo: "sales-activities", required: false, index: true,
  validate(value, { siblingData }) {
    const siblingId = typeof siblingData === "object" && siblingData !== null && "id" in siblingData ? siblingData.id : undefined;
    return value === null || value === undefined || siblingId === undefined || String(value) !== String(siblingId)
      ? true : "An activity cannot supersede itself.";
  },
  access: protectedFieldAccess
};

export const salesAccountsCollection = collection("sales-accounts", [
  ...salesCommonFields({ ownerRequired: true, lifecycle: ["active", "archived", "merged"] }),
  text("name", true),
  { name: "mergedIntoId", type: "text", access: protectedFieldAccess },
  { name: "mergeLineage", type: "json", access: protectedFieldAccess }
], [{ fields: ["applicationId", "environment", "ownerId", "status"] }]);

export const salesContactsCollection = collection("sales-contacts", [
  ...salesCommonFields({ ownerRequired: true, lifecycle: ["active", "archived", "merged"] }),
  { name: "accountId", type: "number", required: true, min: 1, index: true },
  text("displayName", true), text("givenName"), text("email"), { name: "phone", type: "text", maxLength: 64 },
  { name: "mergedIntoId", type: "text", access: protectedFieldAccess },
  { name: "mergeLineage", type: "json", access: protectedFieldAccess }
], [{ fields: ["applicationId", "environment", "accountId", "status"] }]);

export const salesLeadsCollection = collection("sales-leads", [
  ...salesCommonFields({ ownerRequired: true, lifecycle: ["new", "working", "qualified", "disqualified"] }),
  text("displayName", true), text("source", true), text("email"), { name: "phone", type: "text", maxLength: 64 },
  { name: "archiveStatus", type: "select", required: true, defaultValue: "active", options: ["active", "archived"].map((value) => ({ label: value, value })), access: protectedFieldAccess },
  { name: "decidedAt", type: "date", access: protectedFieldAccess },
  { name: "qualifiedAt", type: "date", access: protectedFieldAccess },
  { name: "disqualifiedAt", type: "date", access: protectedFieldAccess },
  text("qualifiedAccountId"), text("qualifiedContactId"), text("qualifiedOpportunityId")
], [{ fields: ["applicationId", "environment", "ownerId", "status"] }]);

export const salesPipelinesCollection = collection("sales-pipelines", [
  ...salesCommonFields({ ownerRequired: false, lifecycle: ["active", "archived"] }),
  text("name", true),
  { name: "orderedStageIds", type: "json", required: true, defaultValue: () => [] },
  { name: "isActive", type: "checkbox", required: true, defaultValue: false, access: protectedFieldAccess }
], [{ fields: ["applicationId", "environment", "status"] }]);

export const salesPipelineStagesCollection = collection("sales-pipeline-stages", [
  ...salesCommonFields({ ownerRequired: false, lifecycle: ["active", "archived"] }),
  { name: "pipelineId", type: "number", required: true, min: 1, index: true },
  text("stageId", true), text("name", true),
  select("semantic", ["qualification", "discovery", "proposal", "negotiation", "won", "lost"]),
  { name: "position", type: "number", required: true, min: 0 },
  { name: "probabilityBasisPoints", type: "number", required: true, min: 0, max: 10_000 },
  { name: "allowedTransitionStageIds", type: "json", required: true, defaultValue: () => [] },
  { name: "requiredFieldIds", type: "json", required: true, defaultValue: () => [] }
], [{ fields: ["applicationId", "environment", "pipelineId", "stageId"], unique: true }]);

export const salesSavedViewsCollection = collection("sales-saved-views", [
  ...salesCommonFields({ ownerRequired: true, lifecycle: ["active", "archived"] }),
  text("name", true),
  select("visibility", ["personal", "team"]),
  text("visibilityTeamId"),
  select("viewKind", ["table", "kanban", "calendar"]),
  select("targetObjectId", ["sales.object.account", "sales.object.contact", "sales.object.lead", "sales.object.opportunity", "sales.object.task", "sales.object.activity"]),
  { name: "definition", type: "json", required: true, access: protectedFieldAccess }
], [{ fields: ["applicationId", "environment", "ownerId", "status"] }, { fields: ["applicationId", "environment", "visibilityTeamId", "status"] }]);

export const salesActivitiesCollection = collection("sales-activities", [
  ...salesCommonFields({ ownerRequired: true, teamRequired: true, lifecycle: ["scheduled", "completed", "cancelled"] }),
  select("type", ["call", "meeting", "email"]), text("subject", true),
  text("actorId", true),
  { name: "scheduledAt", type: "date" },
  { name: "occurredAt", type: "date" },
  text("relatedRecordId", true), select("relatedRecordType", salesRelatedRecordTypes),
  activitySupersedesField,
  { name: "providerMetadata", type: "json", access: { create: deny, read: deny, update: deny } }
], [{ fields: ["applicationId", "environment", "ownerId", "status", "occurredAt"] }]);

export const salesOpportunitiesCollection = collection("sales-opportunities", [
  ...salesCommonFields({ ownerRequired: true }),
  text("name", true),
  { name: "accountId", type: "number", required: true, min: 1, index: true },
  { name: "primaryContactId", type: "number", min: 1 },
  { name: "pipelineId", type: "number", required: true, min: 1, index: true },
  { name: "stageId", type: "text", required: true, index: true, access: protectedFieldAccess },
  { name: "amount", type: "text", access: { create: deny, read: deny, update: deny } },
  text("currency"), text("expectedCloseDate"), { name: "closedAt", type: "date" }, text("lossReason"),
  { name: "archiveStatus", type: "select", required: true, defaultValue: "active", options: ["active", "archived"].map((value) => ({ label: value, value })), access: protectedFieldAccess }
], [{ fields: ["applicationId", "environment", "ownerId", "pipelineId", "stageId"] }]);

export const salesTasksCollection = collection("sales-tasks", [
  ...salesCommonFields({ ownerRequired: true, lifecycle: ["open", "completed", "cancelled"] }),
  text("title", true), text("dueDate"), text("relatedRecordId"), { name: "relatedRecordType", type: "select", options: salesRelatedRecordTypes.map((value) => ({ label: value, value })) },
  { name: "archiveStatus", type: "select", required: true, defaultValue: "active", options: ["active", "archived"].map((value) => ({ label: value, value })), access: protectedFieldAccess }
], [{ fields: ["applicationId", "environment", "ownerId", "status", "dueDate"] }]);

export const salesNotesCollection = collection("sales-notes", [
  ...salesCommonFields({ ownerRequired: false, lifecycle: ["recorded"] }),
  { name: "body", type: "textarea", required: true, access: { create: deny, read: deny, update: deny } },
  text("authorId", true), { name: "occurredAt", type: "date", required: true },
  text("relatedRecordId", true), select("relatedRecordType", salesRelatedRecordTypes), text("replacesNoteId")
], [{ fields: ["applicationId", "environment", "relatedRecordType", "relatedRecordId", "occurredAt"] }]);

export const salesAttachmentReferencesCollection = collection("sales-attachment-references", [
  ...salesCommonFields({ ownerRequired: false, lifecycle: ["active", "removed"] }),
  text("storageReference", true), text("filename", true), { name: "mediaType", type: "text", required: true, maxLength: 128 },
  { name: "byteSize", type: "number", required: true, min: 0 }, text("uploaderId", true),
  text("relatedRecordId", true), select("relatedRecordType", salesRelatedRecordTypes)
], [{ fields: ["applicationId", "environment", "relatedRecordType", "relatedRecordId", "status"] }]);

export const salesCoreCollections: readonly CollectionConfig[] = Object.freeze([
  salesAccountsCollection,
  salesContactsCollection,
  salesLeadsCollection,
  salesPipelinesCollection,
  salesPipelineStagesCollection,
  salesActivitiesCollection,
  salesOpportunitiesCollection,
  salesTasksCollection,
  salesNotesCollection,
  salesAttachmentReferencesCollection,
  salesSavedViewsCollection
]);
