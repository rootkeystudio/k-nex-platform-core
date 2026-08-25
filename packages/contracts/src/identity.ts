import * as z from "zod";

export const pluginKinds = ["module", "provider", "builder", "theme", "integration", "preset"] as const;

export const identityPatterns = {
  plugin: "^(module|provider|builder|theme|integration|preset)(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  capability: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  resource: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  outputContract: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+@[1-9][0-9]*$"
} as const;

export const exactSemverPattern = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$";

export const PluginIdSchema = z.string().regex(new RegExp(identityPatterns.plugin));
export const CapabilityIdSchema = z.string().regex(new RegExp(identityPatterns.capability));
export const ResourceIdSchema = z.string().regex(new RegExp(identityPatterns.resource));
export const OutputContractIdSchema = z.string().regex(new RegExp(identityPatterns.outputContract));
export const ExactSemverSchema = z.string().regex(new RegExp(exactSemverPattern));

export type PluginId = z.infer<typeof PluginIdSchema>;
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type ResourceId = z.infer<typeof ResourceIdSchema>;
export type OutputContractId = z.infer<typeof OutputContractIdSchema>;
