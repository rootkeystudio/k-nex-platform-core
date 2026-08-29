import * as z from "zod";

import { MillisecondTimestampSchema } from "./event.js";
import { ExactSemverSchema, PluginIdSchema, ResourceIdSchema, ThemeSkinIdSchema, identityPatterns } from "./identity.js";

export const themeSurfaces = ["admin", "public"] as const;
export const themeModes = ["light", "dark", "system"] as const;
export const THEME_PROFILE_SCHEMA_VERSION = 1 as const;

const themeIdSchema = PluginIdSchema.refine((id) => id.startsWith("theme."), "Theme IDs must use the theme.* namespace.");
const tokenIdSchema = z.string().min(3).max(128).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/);
const revisionIdSchema = z.string().min(1).max(128).regex(new RegExp(identityPatterns.resource));
const generationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u);
const profileIdSchema = z.string().min(1).max(128).regex(new RegExp(identityPatterns.resource));
const paletteIdSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const unsafeTokenKey = /(?:^|\.)(?:css|class|classname|style|import|function|secret|password|credential|token|fonturl)(?:\.|$)/i;
const unsafeTokenString = /(?:https?:\/\/|data:|javascript:|@import|url\s*\(|[{};])/i;
const skinTokenNameSchema = z.string().regex(/^--k-nex-[a-z0-9-]{1,80}$/u);

export const ThemeProfileTokenValueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().min(1).max(256).refine((value) => !unsafeTokenString.test(value), "Theme token strings cannot contain URLs, imports, scripts, or arbitrary CSS declarations.")
]);

export const ThemeProfileValuesSchema = z.record(tokenIdSchema, ThemeProfileTokenValueSchema).superRefine((values, context) => {
  if (Object.keys(values).length > 128) context.addIssue({ code: "custom", message: "Theme profiles may override at most 128 tokens." });
  for (const key of Object.keys(values)) {
    if (unsafeTokenKey.test(key)) context.addIssue({ code: "custom", path: [key], message: "Theme profile token key is forbidden." });
  }
});

export const ThemeSkinProfileSelectionSchema = z.strictObject({
  id: ThemeSkinIdSchema,
  generationId: generationIdSchema,
  version: ExactSemverSchema,
  palette: ResourceIdSchema,
  values: z.record(skinTokenNameSchema, z.string().min(1).max(256).refine((value) => !unsafeTokenString.test(value), "Skin token strings cannot contain URLs, imports, scripts, or arbitrary CSS declarations.")).check((context) => {
    if (Object.keys(context.value).length > 128) context.issues.push({ code: "custom", input: context.value, message: "Theme Skin profiles may override at most 128 tokens." });
  }).meta({ maxProperties: 128 })
});

const revisionBase = {
  id: revisionIdSchema,
  number: z.number().int().min(1).max(1_000_000),
  createdAt: MillisecondTimestampSchema,
  previousRevisionId: revisionIdSchema.optional()
};

export const ThemeProfileRevisionSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...revisionBase, state: z.literal("draft") }),
  z.strictObject({ ...revisionBase, state: z.literal("published"), publishedAt: MillisecondTimestampSchema }),
  z.strictObject({ ...revisionBase, state: z.literal("archived"), archivedAt: MillisecondTimestampSchema })
]);

export const ThemeProfileSchema = z.strictObject({
  schemaVersion: z.literal(THEME_PROFILE_SCHEMA_VERSION),
  id: profileIdSchema,
  surface: z.enum(themeSurfaces),
  themeId: themeIdSchema,
  themeVersion: ExactSemverSchema,
  palette: paletteIdSchema,
  mode: z.enum(themeModes),
  values: ThemeProfileValuesSchema,
  skin: ThemeSkinProfileSelectionSchema.optional(),
  revision: ThemeProfileRevisionSchema
}).meta({
  $id: "https://schemas.k-nex.dev/theme-profile/v1.json",
  title: "K-Nex theme profile v1"
});

export const ThemeProfilePublicationEventSchema = z.strictObject({
  "$schema": z.string().max(512).optional(),
  schemaVersion: z.literal(1),
  eventId: z.string().regex(/^theme-profile-event-[0-9a-f]{32}$/u),
  eventType: z.literal("theme-profile.publication"),
  operation: z.enum(["publish", "rollback"]),
  applicationId: z.string().regex(/^[a-z][a-z0-9-]{2,127}$/u),
  environment: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
  profileId: profileIdSchema,
  revisionBefore: z.number().int().min(0).max(999_999_999),
  revisionAfter: z.number().int().min(1).max(1_000_000_000),
  activeRevisionId: revisionIdSchema,
  previousRevisionId: revisionIdSchema.optional(),
  skinGenerationId: generationIdSchema.optional(),
  occurredAt: MillisecondTimestampSchema,
  stateDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u)
}).meta({ $id: "https://schemas.k-nex.dev/theme-profile-publication-event/v1.json", title: "K-Nex Theme Profile Publication Event v1" });

export type ThemeProfile = z.infer<typeof ThemeProfileSchema>;
export type ThemeProfileRevision = z.infer<typeof ThemeProfileRevisionSchema>;
export type ThemeProfileTokenValue = z.infer<typeof ThemeProfileTokenValueSchema>;
export type ThemeSkinProfileSelection = z.infer<typeof ThemeSkinProfileSelectionSchema>;
export type ThemeProfilePublicationEvent = z.infer<typeof ThemeProfilePublicationEventSchema>;
