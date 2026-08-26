import * as z from "zod";

import { ResourceIdSchema } from "./identity.js";

export const CMS_PAGE_METADATA_SCHEMA_VERSION = 1 as const;
const localeSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
const internalPathSchema = z.string().min(1).max(2048).regex(/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/);
const boundedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => value === value.trim(), "CMS text must not have surrounding whitespace.")
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "CMS text must not contain control characters.");

export const CmsPageMetadataSchema = z.strictObject({
  schemaVersion: z.literal(CMS_PAGE_METADATA_SCHEMA_VERSION),
  pageId: ResourceIdSchema,
  locale: localeSchema,
  path: internalPathSchema,
  title: boundedText(120),
  description: boundedText(320),
  canonicalPath: internalPathSchema,
  robots: z.enum(["index-follow", "noindex-follow", "noindex-nofollow"]),
  documentId: ResourceIdSchema,
  themeProfileRevisionId: ResourceIdSchema
}).meta({ $id: "https://schemas.k-nex.dev/cms-page-metadata/v1.json", title: "K-Nex CMS page metadata v1" });

export type CmsPageMetadata = z.infer<typeof CmsPageMetadataSchema>;
