import * as z from "zod";

import { AuthorizationSubjectSchema } from "./authorization.js";
import { MillisecondTimestampSchema } from "./event.js";
import { ExactSemverSchema, HotApplicationIdSchema, PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";
import { UiDocumentSchema } from "./ui-document.js";

export const WORKSPACE_CONTRACT_SCHEMA_VERSION = 1 as const;
export const workspaceContractsSchemaUrl = "https://schemas.k-nex.dev/workspace.v1.schema.json" as const;

export const workspaceRouteClasses = Object.freeze({
  system: "/system/*",
  hotApplication: "/apps/:appId/*",
  platformPlugin: "registered-static-plugin-route",
  workspacePage: "/workspace/pages/:pageId",
  workspacePageEditor: "/workspace/pages/:pageId/edit"
} as const);

export const workspacePagePermissionIds = Object.freeze([
  "system.workspace-pages.read",
  "system.workspace-pages.create",
  "system.workspace-pages.edit",
  "system.workspace-pages.publish",
  "system.workspace-pages.access.manage"
] as const);

const applicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const environmentSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const recordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/u);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u);
const revisionSchema = z.number().finite().int().nonnegative().max(1_000_000_000);
const positiveRevisionSchema = z.number().finite().int().min(1).max(1_000_000_000);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const boundedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => value === value.trim(), "Workspace text must not have surrounding whitespace.")
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "Workspace text must not contain control characters.");

export const WorkspacePageIdentitySchema = z.strictObject({
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  pageId: ResourceIdSchema,
  documentId: ResourceIdSchema
});

export const WorkspaceThemeProfileRefSchema = z.strictObject({
  profileId: ResourceIdSchema,
  revisionId: ResourceIdSchema,
  surface: z.literal("admin")
});

export const WorkspaceRouteTargetSchema = z.discriminatedUnion("class", [
  z.strictObject({ class: z.literal("system"), routeId: ResourceIdSchema }),
  z.strictObject({ class: z.literal("hot-application"), appId: HotApplicationIdSchema }),
  z.strictObject({ class: z.literal("platform-plugin"), ownerPluginId: PluginIdSchema, routeId: ResourceIdSchema }),
  z.strictObject({ class: z.literal("workspace-page"), pageId: ResourceIdSchema, mode: z.enum(["view", "edit"]) })
]);

const navigationOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("platform") }),
  z.strictObject({ kind: z.literal("platform-plugin"), pluginId: PluginIdSchema }),
  z.strictObject({ kind: z.literal("customer") })
]);

export const WorkspaceNavigationNodeSchema = z.strictObject({
  id: ResourceIdSchema,
  owner: navigationOwnerSchema,
  kind: z.enum(["folder", "link"]),
  parentId: ResourceIdSchema.optional(),
  label: boundedText(120),
  icon: z.enum(["apps", "dashboard", "folder", "sales", "system"]).optional(),
  order: z.number().finite().int().min(0).max(1_000_000),
  target: WorkspaceRouteTargetSchema.optional()
}).superRefine((node, context) => {
  if ((node.kind === "link") !== (node.target !== undefined)) {
    context.addIssue({ code: "custom", path: ["target"], message: "Only navigation links have one route target." });
  }
  if (node.owner.kind === "customer" && node.target !== undefined && node.target.class !== "workspace-page") {
    context.addIssue({ code: "custom", path: ["target"], message: "Customer navigation may target only a workspace page." });
  }
  if (node.owner.kind === "platform-plugin" && node.target !== undefined &&
    (node.target.class !== "platform-plugin" || node.target.ownerPluginId !== node.owner.pluginId)) {
    context.addIssue({ code: "custom", path: ["target"], message: "Plugin navigation must target a statically registered route owned by the same plugin." });
  }
  if (node.owner.kind === "platform" && node.target?.class === "platform-plugin") {
    context.addIssue({ code: "custom", path: ["target"], message: "Platform navigation cannot claim a plugin route." });
  }
});

export const WorkspaceNavigationTreeSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  revision: revisionSchema,
  nodes: z.array(WorkspaceNavigationNodeSchema).min(1).max(512)
}).superRefine((tree, context) => {
  const nodes = new Map<string, z.output<typeof WorkspaceNavigationNodeSchema>>();
  for (const [index, node] of tree.nodes.entries()) {
    if (nodes.has(node.id)) context.addIssue({ code: "custom", path: ["nodes", index, "id"], message: "Navigation IDs must be unique." });
    nodes.set(node.id, node);
  }
  const systemRoot = nodes.get("system.navigation.root");
  if (systemRoot?.owner.kind !== "platform" || systemRoot.kind !== "folder" || systemRoot.parentId !== undefined) {
    context.addIssue({ code: "custom", path: ["nodes"], message: "The fixed platform System root is required and cannot be shadowed or parented." });
  }
  for (const [index, node] of tree.nodes.entries()) {
    if (node.parentId !== undefined && !nodes.has(node.parentId)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "parentId"], message: "Navigation parents must exist in the same resolved tree." });
    }
    if (node.owner.kind === "customer" && node.parentId !== undefined && nodes.get(node.parentId)?.owner.kind === "platform") {
      context.addIssue({ code: "custom", path: ["nodes", index, "parentId"], message: "Customer navigation cannot enter the fixed platform section." });
    }
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId !== undefined) {
      if (visited.has(parentId)) {
        context.addIssue({ code: "custom", path: ["nodes", index, "parentId"], message: "Navigation must be acyclic." });
        break;
      }
      visited.add(parentId);
      parentId = nodes.get(parentId)?.parentId;
    }
  }
});

export const WorkspaceShellSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  applicationId: applicationIdSchema,
  environment: environmentSchema,
  applicationLabel: boundedText(120),
  location: WorkspaceRouteTargetSchema,
  breadcrumbs: z.array(z.strictObject({ label: boundedText(120), target: WorkspaceRouteTargetSchema })).max(16),
  navigation: WorkspaceNavigationTreeSchema,
  themeProfile: WorkspaceThemeProfileRefSchema,
  authorizationRevision: revisionSchema,
  lifecycleRevision: revisionSchema,
  settingsRevision: revisionSchema
}).superRefine((shell, context) => {
  if (shell.navigation.applicationId !== shell.applicationId || shell.navigation.environment !== shell.environment) {
    context.addIssue({ code: "custom", path: ["navigation"], message: "Shell navigation must use the shell application and environment." });
  }
});

export const WorkspaceNavigationPlacementSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("placed"), parentNavigationId: ResourceIdSchema, order: z.number().finite().int().min(0).max(1_000_000) }),
  z.strictObject({ state: z.literal("unplaced"), reason: z.enum(["manual", "parent-inactive", "parent-missing"]) })
]);

export const WorkspacePageSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  identity: WorkspacePageIdentitySchema,
  title: boundedText(120),
  description: boundedText(320).optional(),
  state: z.enum(["draft", "published", "archived"]),
  navigation: WorkspaceNavigationPlacementSchema,
  workingCopyRevision: positiveRevisionSchema,
  publishedRevisionId: recordIdSchema.optional(),
  accessRevision: revisionSchema,
  themeProfile: WorkspaceThemeProfileRefSchema.optional(),
  dependencyDigest: digestSchema.optional(),
  revision: positiveRevisionSchema,
  createdBy: AuthorizationSubjectSchema,
  updatedBy: AuthorizationSubjectSchema,
  createdAt: MillisecondTimestampSchema,
  updatedAt: MillisecondTimestampSchema
}).superRefine((page, context) => {
  if (page.state === "published" && (page.publishedRevisionId === undefined || page.dependencyDigest === undefined)) {
    context.addIssue({ code: "custom", message: "A published page requires its immutable revision and dependency digest." });
  }
  if (page.state === "draft" && (page.publishedRevisionId !== undefined || page.dependencyDigest !== undefined)) {
    context.addIssue({ code: "custom", message: "A new draft cannot claim a published revision." });
  }
  if (Date.parse(page.updatedAt) < Date.parse(page.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "Page update time cannot precede creation." });
  }
});

export const WorkspacePageAccessSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("role"), roleId: recordIdSchema }),
  z.strictObject({ kind: z.literal("user"), userId: recordIdSchema })
]);

export const WorkspacePageAccessAssignmentSchema = z.strictObject({
  subject: WorkspacePageAccessSubjectSchema,
  capability: z.enum(["view", "edit"])
});

export const WorkspacePageAccessSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  identity: WorkspacePageIdentitySchema,
  accessRevision: revisionSchema,
  assignments: z.array(WorkspacePageAccessAssignmentSchema).max(512)
}).superRefine((snapshot, context) => {
  const keys = snapshot.assignments.map(({ subject }) => subject.kind === "role" ? `role:${subject.roleId}` : `user:${subject.userId}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["assignments"], message: "A page access subject may have only one effective capability." });
});

export const WorkspaceWorkingCopySchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  identity: WorkspacePageIdentitySchema,
  revision: positiveRevisionSchema,
  document: UiDocumentSchema,
  editorSessionId: recordIdSchema,
  idempotencyKey: idempotencyKeySchema,
  updatedBy: AuthorizationSubjectSchema,
  updatedAt: MillisecondTimestampSchema
}).superRefine((copy, context) => {
  if (copy.document.id !== copy.identity.documentId || copy.document.version !== copy.revision || copy.document.profile !== "workspace") {
    context.addIssue({ code: "custom", path: ["document"], message: "A working copy must retain the canonical workspace document identity and revision." });
  }
});

export const WorkspaceWorkingCopyChangeInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  editorSessionId: recordIdSchema,
  idempotencyKey: idempotencyKeySchema,
  document: UiDocumentSchema
}).superRefine((input, context) => {
  if (input.document.profile !== "workspace") context.addIssue({ code: "custom", path: ["document", "profile"], message: "Workspace autosave accepts only a workspace document." });
});

const dependencyOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("platform") }),
  z.strictObject({ kind: z.literal("platform-plugin"), pluginId: PluginIdSchema, version: ExactSemverSchema })
]);

export const WorkspacePageDependencySchema = z.strictObject({
  kind: z.enum(["action", "block", "component", "source"]),
  id: ResourceIdSchema,
  version: positiveRevisionSchema,
  owner: dependencyOwnerSchema,
  structuralCompatibilityHash: digestSchema.optional()
}).superRefine((dependency, context) => {
  if ((dependency.kind === "source") !== (dependency.structuralCompatibilityHash !== undefined)) {
    context.addIssue({ code: "custom", path: ["structuralCompatibilityHash"], message: "Only source dependencies bind a structural compatibility hash." });
  }
});

export const WorkspacePageDependencySnapshotSchema = z.strictObject({
  entries: uniqueArray(WorkspacePageDependencySchema).max(512),
  digest: digestSchema
});

export const WorkspacePublishedRevisionSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  revisionId: recordIdSchema,
  identity: WorkspacePageIdentitySchema,
  documentRevision: positiveRevisionSchema,
  document: UiDocumentSchema,
  accessRevision: revisionSchema,
  themeProfile: WorkspaceThemeProfileRefSchema.optional(),
  dependencies: WorkspacePageDependencySnapshotSchema,
  publishedBy: AuthorizationSubjectSchema,
  publishedAt: MillisecondTimestampSchema
}).superRefine((publication, context) => {
  if (publication.document.id !== publication.identity.documentId || publication.document.version !== publication.documentRevision || publication.document.profile !== "workspace") {
    context.addIssue({ code: "custom", path: ["document"], message: "A publication must retain the canonical workspace document identity and revision." });
  }
});

export const WorkspacePublicationPointerSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  identity: WorkspacePageIdentitySchema,
  pointerRevision: positiveRevisionSchema,
  publishedRevisionId: recordIdSchema,
  publishedDocumentRevision: positiveRevisionSchema,
  previousPublishedRevisionId: recordIdSchema.optional(),
  updatedAt: MillisecondTimestampSchema
});

export const WorkspacePublicationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(WORKSPACE_CONTRACT_SCHEMA_VERSION),
  receiptId: recordIdSchema,
  operation: z.enum(["publish", "rollback"]),
  identity: WorkspacePageIdentitySchema,
  pointerRevision: positiveRevisionSchema,
  publishedRevisionId: recordIdSchema,
  previousPublishedRevisionId: recordIdSchema.optional(),
  accessRevision: revisionSchema,
  dependencyDigest: digestSchema,
  requestedBy: AuthorizationSubjectSchema,
  authorityDigest: digestSchema,
  idempotencyKey: idempotencyKeySchema,
  occurredAt: MillisecondTimestampSchema
});

export const WorkspaceContractValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("shell"), value: WorkspaceShellSnapshotSchema }),
  z.strictObject({ kind: z.literal("navigation"), value: WorkspaceNavigationTreeSchema }),
  z.strictObject({ kind: z.literal("page"), value: WorkspacePageSchema }),
  z.strictObject({ kind: z.literal("page-access"), value: WorkspacePageAccessSnapshotSchema }),
  z.strictObject({ kind: z.literal("working-copy"), value: WorkspaceWorkingCopySchema }),
  z.strictObject({ kind: z.literal("working-copy-change"), value: WorkspaceWorkingCopyChangeInputSchema }),
  z.strictObject({ kind: z.literal("published-revision"), value: WorkspacePublishedRevisionSchema }),
  z.strictObject({ kind: z.literal("publication-pointer"), value: WorkspacePublicationPointerSchema }),
  z.strictObject({ kind: z.literal("publication-receipt"), value: WorkspacePublicationReceiptSchema })
]);

export const WorkspaceContractsSchema = z.strictObject({
  "$schema": z.literal(workspaceContractsSchemaUrl),
  contract: WorkspaceContractValueSchema
});

export type WorkspacePageIdentity = z.infer<typeof WorkspacePageIdentitySchema>;
export type WorkspaceRouteTarget = z.infer<typeof WorkspaceRouteTargetSchema>;
export type WorkspaceNavigationNode = z.infer<typeof WorkspaceNavigationNodeSchema>;
export type WorkspaceNavigationTree = z.infer<typeof WorkspaceNavigationTreeSchema>;
export type WorkspaceShellSnapshot = z.infer<typeof WorkspaceShellSnapshotSchema>;
export type WorkspacePage = z.infer<typeof WorkspacePageSchema>;
export type WorkspacePageAccessSnapshot = z.infer<typeof WorkspacePageAccessSnapshotSchema>;
export type WorkspaceWorkingCopy = z.infer<typeof WorkspaceWorkingCopySchema>;
export type WorkspaceWorkingCopyChangeInput = z.infer<typeof WorkspaceWorkingCopyChangeInputSchema>;
export type WorkspacePageDependencySnapshot = z.infer<typeof WorkspacePageDependencySnapshotSchema>;
export type WorkspacePublishedRevision = z.infer<typeof WorkspacePublishedRevisionSchema>;
export type WorkspacePublicationPointer = z.infer<typeof WorkspacePublicationPointerSchema>;
export type WorkspacePublicationReceipt = z.infer<typeof WorkspacePublicationReceiptSchema>;
export type WorkspaceContracts = z.infer<typeof WorkspaceContractsSchema>;
