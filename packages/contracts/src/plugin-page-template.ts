import * as z from "zod";

import { CapabilityIdSchema, ExactSemverSchema, PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { PluginRouteReferenceSchema } from "./plugin-configuration.js";
import { uniqueArray } from "./schema-helpers.js";
import { UiDocumentSchema, uiDocumentProfiles, type UiNode } from "./ui-document.js";

const versionSchema = z.number().int().positive().max(1_000_000);
const surfaceSchema = z.enum(["workspace", "cms", "public"]);

export const PluginTemplateResourceRequirementSchema = z.strictObject({
  id: ResourceIdSchema,
  version: versionSchema
});

export const PluginTemplateCapabilityRequirementSchema = z.strictObject({
  id: CapabilityIdSchema,
  version: ExactSemverSchema
});

export const PluginPageTemplateDescriptorSchema = z.strictObject({
  id: ResourceIdSchema,
  version: versionSchema,
  ownerPluginId: PluginIdSchema,
  route: PluginRouteReferenceSchema,
  surface: surfaceSchema,
  profile: z.enum(uiDocumentProfiles),
  permission: ResourceIdSchema,
  publicationPolicy: z.strictObject({
    ownership: z.literal("customer"),
    adoption: z.literal("explicit")
  }),
  requirements: z.strictObject({
    capabilities: uniqueArray(PluginTemplateCapabilityRequirementSchema).max(64),
    sources: uniqueArray(PluginTemplateResourceRequirementSchema).max(128),
    actions: uniqueArray(PluginTemplateResourceRequirementSchema).max(128),
    blocks: uniqueArray(PluginTemplateResourceRequirementSchema).max(128)
  }),
  document: UiDocumentSchema,
  migration: z.strictObject({
    adoptableFromVersions: uniqueArray(versionSchema).min(1).max(64),
    notesMessageId: ResourceIdSchema
  }).optional()
}).check((context) => {
  const descriptor = context.value;
  const namespace = descriptor.ownerPluginId.split(".")[1];
  const owned = (id: string): boolean => id.startsWith(`${namespace}.`);
  if (!owned(descriptor.id) || !owned(descriptor.route.routeId)) {
    context.issues.push({ code: "custom", input: descriptor.id, path: ["id"], message: "Template and route IDs must use the owner plugin namespace." });
  }
  if (descriptor.document.id !== descriptor.id || descriptor.document.version !== descriptor.version) {
    context.issues.push({ code: "custom", input: descriptor.document.id, path: ["document"], message: "Template document identity and version must match its immutable descriptor." });
  }
  if (descriptor.document.profile !== descriptor.profile || descriptor.profile === "workspace" && descriptor.surface !== "workspace" ||
    descriptor.profile === "cms" && descriptor.surface === "workspace") {
    context.issues.push({ code: "custom", input: descriptor.profile, path: ["profile"], message: "Template document profile and surface are inconsistent." });
  }
  if (descriptor.version === 1 && descriptor.migration !== undefined || descriptor.version > 1 && descriptor.migration === undefined) {
    context.issues.push({ code: "custom", input: descriptor.version, path: ["migration"], message: "Only later template versions require explicit adoption migration metadata." });
  }
  if (descriptor.migration?.adoptableFromVersions.some((version) => version >= descriptor.version)) {
    context.issues.push({ code: "custom", input: descriptor.migration, path: ["migration"], message: "Template adoption sources must precede the target version." });
  }

  const requiredSources = new Set(descriptor.requirements.sources.map((value) => `${value.id}@${value.version}`));
  const requiredBlocks = new Set(descriptor.requirements.blocks.map((value) => `${value.id}@${value.version}`));
  const visit = (nodes: readonly UiNode[]): void => {
    for (const node of nodes) {
      if (!requiredBlocks.has(`${node.type}@${node.version}`)) {
        context.issues.push({ code: "custom", input: node.type, path: ["requirements", "blocks"], message: `Template block ${node.type}@${node.version} is not declared.` });
      }
      const source = node.bindings?.source?.source;
      if (source !== undefined && !requiredSources.has(`${source.id}@${source.version}`)) {
        context.issues.push({ code: "custom", input: source.id, path: ["requirements", "sources"], message: `Template source ${source.id}@${source.version} is not declared.` });
      }
      visit(node.children ?? []);
    }
  };
  for (const nodes of Object.values(descriptor.document.regions)) visit(nodes);
});

export type PluginTemplateResourceRequirement = z.infer<typeof PluginTemplateResourceRequirementSchema>;
export type PluginTemplateCapabilityRequirement = z.infer<typeof PluginTemplateCapabilityRequirementSchema>;
export type PluginPageTemplateDescriptor = z.infer<typeof PluginPageTemplateDescriptorSchema>;
