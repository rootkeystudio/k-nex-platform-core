import * as z from "zod";

import { AgentToolInputSchemaSchema } from "./agent-tool.js";
import { DataSourcePrimaryContractSchema } from "./data-source.js";
import { PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";
import { TableFieldIdSchema } from "./table-records.js";
import { uiDocumentProfiles } from "./ui-document.js";

const resourceReferenceSchema = z.strictObject({
  id: ResourceIdSchema,
  version: z.number().int().positive().max(1_000_000)
});
const uiStates = ["loading", "empty", "error", "forbidden"] as const;

export const PluginUiContributionDescriptorSchema = z.strictObject({
  id: ResourceIdSchema,
  version: z.number().int().positive().max(1_000_000),
  ownerPluginId: PluginIdSchema,
  kind: z.enum(["component", "block"]),
  propsSchema: AgentToolInputSchemaSchema,
  profiles: uniqueArray(z.enum(uiDocumentProfiles)).min(1),
  surfaces: uniqueArray(z.enum(["workspace", "cms", "public"])).min(1),
  audience: z.enum(["public", "authenticated"]),
  permission: ResourceIdSchema.optional(),
  sourcePolicy: z.strictObject({
    required: z.boolean(),
    contracts: uniqueArray(DataSourcePrimaryContractSchema).min(1),
    requiredFields: uniqueArray(TableFieldIdSchema)
  }).optional(),
  actionPolicy: z.strictObject({
    required: z.boolean(),
    actions: uniqueArray(resourceReferenceSchema).min(1)
  }).optional(),
  requiredStates: uniqueArray(z.enum(uiStates)).length(uiStates.length)
}).check((context) => {
  const descriptor = context.value;
  const namespace = descriptor.ownerPluginId.split(".")[1];
  if (!descriptor.id.startsWith(`${namespace}.`)) {
    context.issues.push({ code: "custom", input: descriptor.id, path: ["id"], message: "UI contribution ID must use the owner plugin namespace." });
  }
  if (descriptor.audience === "authenticated" && descriptor.permission === undefined || descriptor.audience === "public" && descriptor.permission !== undefined) {
    context.issues.push({ code: "custom", input: descriptor.audience, path: ["permission"], message: "UI contribution audience and permission are inconsistent." });
  }
  if ((descriptor.audience === "public") !== descriptor.surfaces.includes("public")) {
    context.issues.push({ code: "custom", input: descriptor.surfaces, path: ["surfaces"], message: "Only public UI contributions may use the public surface." });
  }
  if (uiStates.some((state) => !descriptor.requiredStates.includes(state))) {
    context.issues.push({ code: "custom", input: descriptor.requiredStates, path: ["requiredStates"], message: "UI contributions must handle every platform fallback state." });
  }
  if (descriptor.sourcePolicy?.requiredFields.length && !descriptor.sourcePolicy.contracts.some(({ id }) => id === "table.records")) {
    context.issues.push({ code: "custom", input: descriptor.sourcePolicy, path: ["sourcePolicy"], message: "Required source fields need a table.records contract." });
  }
});

export type PluginUiContributionDescriptor = z.infer<typeof PluginUiContributionDescriptorSchema>;
