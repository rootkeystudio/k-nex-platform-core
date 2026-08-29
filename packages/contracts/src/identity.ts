import * as z from "zod";

export const pluginKinds = ["module", "provider", "builder", "theme", "integration", "preset"] as const;
const pluginKindPattern = pluginKinds.join("|");
const hotApplicationKindPattern = "app";
const themeSkinKindPattern = "skin";

export const identityPatterns = {
  plugin: `^(${pluginKindPattern})(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$`,
  hotApplication: `^${hotApplicationKindPattern}(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$`,
  themeSkin: `^${themeSkinKindPattern}(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$`,
  capability: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  resource: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$",
  outputContract: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+@[1-9][0-9]*$"
} as const;

export const exactSemverPattern = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$";

export const PluginIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.plugin));
export const HotApplicationIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.hotApplication));
export const ThemeSkinIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.themeSkin));
export const CapabilityIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.capability));
export const ResourceIdSchema = z.string().max(128).regex(new RegExp(identityPatterns.resource));
export const OutputContractIdSchema = z.string().max(160).regex(new RegExp(identityPatterns.outputContract));
export const ExactSemverSchema = z.string().regex(new RegExp(exactSemverPattern));

export type PluginId = z.infer<typeof PluginIdSchema>;
export type HotApplicationId = z.infer<typeof HotApplicationIdSchema>;
export type ThemeSkinId = z.infer<typeof ThemeSkinIdSchema>;
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type ResourceId = z.infer<typeof ResourceIdSchema>;
export type OutputContractId = z.infer<typeof OutputContractIdSchema>;
