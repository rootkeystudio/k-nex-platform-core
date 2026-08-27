import * as z from "zod";

import { assertJsonValue, canonicalJson, type JsonValue } from "./canonical-json.js";
import { DataSourceSourceSchemaSchema, dataSourcePlatformCeilings } from "./data-source.js";
import { PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";
import { TableFieldIdSchema } from "./table-records.js";

/** The only editor profiles supported by the first canonical document version. */
export const uiDocumentProfiles = ["cms", "workspace"] as const;
export type UiDocumentProfile = (typeof uiDocumentProfiles)[number];

/**
 * These ceilings apply to untrusted persisted documents.  They are deliberately
 * smaller than the general request-body ceiling so a document cannot consume
 * the entire request budget while being validated or rendered.
 */
export const uiDocumentPlatformCeilings = Object.freeze({
  canonicalBytes: 262_144,
  regions: 32,
  nodesPerRegion: 128,
  totalNodes: 512,
  childrenPerNode: 64,
  nodeDepth: 16,
  jsonDepth: 16,
  jsonArrayItems: 256,
  jsonObjectKeys: 128,
  propKeys: 128,
  metadataNamespaces: 32,
  stringLength: 4_096,
  identifierLength: 128,
  tokenLength: 128
} as const);

export const UI_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const UI_DOCUMENT_MAX_CANONICAL_BYTES = uiDocumentPlatformCeilings.canonicalBytes;

const positiveVersionSchema = z.number().finite().int().min(1).max(1_000_000);
const boundedResourceIdSchema = ResourceIdSchema.min(1).max(uiDocumentPlatformCeilings.identifierLength);
const boundedPluginIdSchema = PluginIdSchema.min(1).max(uiDocumentPlatformCeilings.identifierLength);
const nodeIdSchema = z.string().min(1).max(uiDocumentPlatformCeilings.identifierLength).regex(/^[a-z][a-z0-9_-]*$/);
const regionNameSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const tokenReferenceSchema = z.string().min(1).max(uiDocumentPlatformCeilings.tokenLength).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string().max(uiDocumentPlatformCeilings.stringLength),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema).max(uiDocumentPlatformCeilings.jsonArrayItems),
  z.record(
    z.string().max(uiDocumentPlatformCeilings.identifierLength),
    jsonValueSchema
  ).superRefine((value, context) => {
    if (Object.keys(value).length > uiDocumentPlatformCeilings.jsonObjectKeys) {
      context.addIssue({
        code: "custom",
        message: `Objects may not contain more than ${uiDocumentPlatformCeilings.jsonObjectKeys} keys.`
      });
    }
  })
]));

/** Static props are data only; executable or transport-specific fields are rejected below. */
export const UiStaticPropsSchema = z.record(
  z.string().min(1).max(uiDocumentPlatformCeilings.identifierLength),
  jsonValueSchema
).superRefine((props, context) => {
  if (Object.keys(props).length > uiDocumentPlatformCeilings.propKeys) {
    context.addIssue({
      code: "custom",
      message: `A block may declare at most ${uiDocumentPlatformCeilings.propKeys} static props.`
    });
  }
});

/** A source reference includes an explicit stable projection selection. */
export const UiSourceBindingSchema = z.strictObject({
  source: DataSourceSourceSchemaSchema,
  input: jsonValueSchema,
  structuralCompatibilityHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  selectedFields: uniqueArray(TableFieldIdSchema).max(dataSourcePlatformCeilings.selectedFields).optional()
});

export const UiNodeBindingsSchema = z.strictObject({
  source: UiSourceBindingSchema
});

export const UiLayoutConstraintsSchema = z.strictObject({
  locked: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canMove: z.boolean().optional(),
  canResize: z.boolean().optional(),
  editableFields: uniqueArray(TableFieldIdSchema).max(dataSourcePlatformCeilings.selectedFields).optional(),
  allowedChildren: uniqueArray(boundedResourceIdSchema).max(uiDocumentPlatformCeilings.childrenPerNode).optional(),
  minChildren: z.number().finite().int().min(0).max(uiDocumentPlatformCeilings.childrenPerNode).optional(),
  maxChildren: z.number().finite().int().min(0).max(uiDocumentPlatformCeilings.childrenPerNode).optional()
}).superRefine((constraints, context) => {
  if (constraints.minChildren !== undefined && constraints.maxChildren !== undefined && constraints.minChildren > constraints.maxChildren) {
    context.addIssue({ code: "custom", path: ["maxChildren"], message: "maxChildren cannot be less than minChildren." });
  }
});

export const UiLayoutTokensSchema = z.strictObject({
  spacing: tokenReferenceSchema.optional(),
  gap: tokenReferenceSchema.optional(),
  width: tokenReferenceSchema.optional(),
  height: tokenReferenceSchema.optional(),
  typography: tokenReferenceSchema.optional(),
  color: tokenReferenceSchema.optional(),
  radius: tokenReferenceSchema.optional(),
  shadow: tokenReferenceSchema.optional(),
  density: z.enum(["compact", "comfortable", "spacious"]).optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "between", "around", "evenly"]).optional()
});

export const UiLayoutSchema = z.strictObject({
  constraints: UiLayoutConstraintsSchema.optional(),
  tokens: UiLayoutTokensSchema.optional()
}).superRefine((layout, context) => {
  if (layout.constraints === undefined && layout.tokens === undefined) {
    context.addIssue({ code: "custom", message: "A layout must contain constraints or token references." });
  }
});

/** Engine metadata is isolated by a registered plugin namespace and remains JSON data. */
export const UiEngineMetadataSchema = z.record(boundedPluginIdSchema, jsonValueSchema).superRefine((metadata, context) => {
  if (Object.keys(metadata).length > uiDocumentPlatformCeilings.metadataNamespaces) {
    context.addIssue({
      code: "custom",
      message: `Engine metadata may contain at most ${uiDocumentPlatformCeilings.metadataNamespaces} namespaces.`
    });
  }
});

export type UiNodeShape = {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly bindings?: z.output<typeof UiNodeBindingsSchema> | undefined;
  readonly layout?: z.output<typeof UiLayoutSchema> | undefined;
  readonly children?: readonly UiNodeShape[] | undefined;
  readonly engineMetadata?: Readonly<Record<string, JsonValue>> | undefined;
};

export const UiNodeSchema: z.ZodType<UiNodeShape> = z.lazy(() => z.strictObject({
  id: nodeIdSchema,
  type: boundedResourceIdSchema,
  version: positiveVersionSchema,
  props: UiStaticPropsSchema,
  bindings: UiNodeBindingsSchema.optional(),
  layout: UiLayoutSchema.optional(),
  children: z.array(UiNodeSchema).max(uiDocumentPlatformCeilings.childrenPerNode).optional(),
  engineMetadata: UiEngineMetadataSchema.optional()
}));

export const UiDocumentNodeSchema = UiNodeSchema;

const unsafeExactKeys = new Set([
  "authorization",
  "authorizations",
  "auth",
  "cookie",
  "cookies",
  "password",
  "secret",
  "token",
  "apikey",
  "credential",
  "privatenote",
  "javascript",
  "js",
  "script",
  "function",
  "expression",
  "sql",
  "import",
  "package",
  "packagepath",
  "modulepath",
  "filepath",
  "url",
  "href",
  "src",
  "style",
  "styles",
  "classname",
  "html",
  "css"
]);

function isStructuralLayoutTokens(path: readonly (string | number)[], key: string): boolean {
  if (key !== "tokens" || path.length < 4 || path[0] !== "regions" || typeof path[1] !== "string" ||
      typeof path[2] !== "number" || path.at(-1) !== "layout") return false;
  for (let index = 3; index < path.length - 1; index += 2) {
    if (path[index] !== "children" || typeof path[index + 1] !== "number") return false;
  }
  return (path.length - 4) % 2 === 0;
}

function isUnsafePersistedKey(key: string, path: readonly (string | number)[]): boolean {
  const normalized = key.normalize("NFKC").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (isStructuralLayoutTokens(path, normalized)) return false;
  const secretBearing = [
    "password",
    "secret",
    "apikey",
    "credential",
    "privatenote",
    "oauth",
    "bearer",
    "sessionkey",
    "sessionid",
    "accesskey",
    "privatekey",
    "signingkey"
  ].some((part) => normalized.includes(part));
  const tokenBearing = normalized.includes("token");
  const authBearing = /^(?:auth|authentication|authorization)(?:data|header|key|value|config|credential)/.test(normalized);
  return unsafeExactKeys.has(normalized) || secretBearing || tokenBearing || authBearing;
}

function inspectJsonTree(value: unknown, path: readonly (string | number)[], context: z.RefinementCtx, depth: number, ancestors: Set<object>): void {
  if (typeof value === "string") {
    if (value.length > uiDocumentPlatformCeilings.stringLength) {
      context.addIssue({ code: "custom", path: [...path], message: `Strings may not exceed ${uiDocumentPlatformCeilings.stringLength} characters.` });
    }
    const trimmed = value.trim();
    if (/[\p{Cc}\p{Cf}]/u.test(value)) {
      context.addIssue({ code: "custom", path: [...path], message: "Control and format characters are forbidden in persisted UI strings." });
    }
    const slashNormalized = trimmed.replaceAll("\\", "/");
    if (!/^sha256:[a-f0-9]{64}$/.test(trimmed) && /^(?:[a-z][a-z0-9+.-]*:|\/{2,})/i.test(slashNormalized)) {
      context.addIssue({ code: "custom", path: [...path], message: "Unrestricted URL-like strings are forbidden in persisted UI documents." });
    }
    if (/^\\+[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      context.addIssue({ code: "custom", path: [...path], message: "Backslash-obscured URL-like strings are forbidden in persisted UI documents." });
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) context.addIssue({ code: "custom", path: [...path], message: "Numbers must be finite." });
    return;
  }
  if (typeof value !== "object") return;
  if (ancestors.has(value)) {
    context.addIssue({ code: "custom", path: [...path], message: "Values may not contain circular references." });
    return;
  }
  if (depth > uiDocumentPlatformCeilings.jsonDepth) {
    context.addIssue({ code: "custom", path: [...path], message: `JSON nesting may not exceed ${uiDocumentPlatformCeilings.jsonDepth} levels.` });
    return;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > uiDocumentPlatformCeilings.jsonArrayItems) {
      context.addIssue({ code: "custom", path: [...path], message: `Arrays may not contain more than ${uiDocumentPlatformCeilings.jsonArrayItems} items.` });
    }
    for (const [index, child] of value.entries()) inspectJsonTree(child, [...path, index], context, depth + 1, ancestors);
  } else {
    const keys = Object.keys(value);
    if (keys.length > uiDocumentPlatformCeilings.jsonObjectKeys) {
      context.addIssue({ code: "custom", path: [...path], message: `Objects may not contain more than ${uiDocumentPlatformCeilings.jsonObjectKeys} keys.` });
    }
    for (const key of keys) {
      if (/[^\x20-\x7e]/.test(key)) {
        context.addIssue({ code: "custom", path: [...path, key], message: "Persisted keys must use printable ASCII characters." });
      }
      if (isUnsafePersistedKey(key, path)) {
        context.addIssue({ code: "custom", path: [...path, key], message: `Persisted key ${key} is not allowed.` });
      }
      inspectJsonTree((value as Record<string, unknown>)[key], [...path, key], context, depth + 1, ancestors);
    }
  }
  ancestors.delete(value);
}

function validateNodeTree(document: {
  readonly regions: Readonly<Record<string, readonly UiNode[]>>;
}, context: z.RefinementCtx): void {
  const nodeIds = new Set<string>();
  let totalNodes = 0;

  const visit = (node: UiNode, path: readonly (string | number)[], depth: number): void => {
    totalNodes += 1;
    if (totalNodes > uiDocumentPlatformCeilings.totalNodes) {
      context.addIssue({ code: "custom", path: [...path], message: `A document may contain at most ${uiDocumentPlatformCeilings.totalNodes} nodes.` });
      return;
    }
    if (depth > uiDocumentPlatformCeilings.nodeDepth) {
      context.addIssue({ code: "custom", path: [...path], message: `Node nesting may not exceed ${uiDocumentPlatformCeilings.nodeDepth} levels.` });
      return;
    }
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: "custom", path: [...path, "id"], message: "Node IDs must be unique across the entire document." });
    }
    nodeIds.add(node.id);
    for (const [index, child] of (node.children ?? []).entries()) visit(child, [...path, "children", index], depth + 1);
  };

  for (const [region, nodes] of Object.entries(document.regions)) {
    for (const [index, node] of nodes.entries()) visit(node, ["regions", region, index], 1);
  }
}

const UiDocumentObjectSchema = z.strictObject({
  id: boundedResourceIdSchema,
  version: positiveVersionSchema,
  schemaVersion: z.literal(UI_DOCUMENT_SCHEMA_VERSION),
  profile: z.enum(uiDocumentProfiles),
  regions: z.record(regionNameSchema, z.array(UiNodeSchema).max(uiDocumentPlatformCeilings.nodesPerRegion)).superRefine((regions, context) => {
    const regionCount = Object.keys(regions).length;
    if (regionCount === 0) {
      context.addIssue({ code: "custom", message: "A document must contain at least one named root region." });
    }
    if (regionCount > uiDocumentPlatformCeilings.regions) {
      context.addIssue({ code: "custom", message: `A document may contain at most ${uiDocumentPlatformCeilings.regions} regions.` });
    }
  })
}).superRefine((document, context) => {
  validateNodeTree(document, context);
  inspectJsonTree(document, [], context, 0, new Set<object>());

  try {
    const bytes = new TextEncoder().encode(canonicalJson(document)).byteLength;
    if (bytes > uiDocumentPlatformCeilings.canonicalBytes) {
      context.addIssue({ code: "custom", path: [], message: `Canonical document bytes may not exceed ${uiDocumentPlatformCeilings.canonicalBytes}.` });
    }
  } catch {
    context.addIssue({ code: "custom", path: [], message: "Document must be canonical finite JSON." });
  }
});

const UiDocumentShapeSchema = z.preprocess((value, context) => {
  try {
    assertJsonValue(value);
    return value;
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Document must be plain JSON data." });
    return z.NEVER;
  }
}, UiDocumentObjectSchema);

/**
 * Canonical UI documents are cloned after validation so later edits by a caller
 * cannot mutate the validated snapshot or alter its canonical representation.
 */
export const UiDocumentSchema = UiDocumentShapeSchema.transform((document) => structuredClone(document));

export type UiLayoutConstraints = z.output<typeof UiLayoutConstraintsSchema>;
export type UiLayoutTokens = z.output<typeof UiLayoutTokensSchema>;
export type UiLayout = z.output<typeof UiLayoutSchema>;
export type UiNodeBindings = z.output<typeof UiNodeBindingsSchema>;
export type UiSourceBinding = z.output<typeof UiSourceBindingSchema>;
export type UiNode = z.output<typeof UiNodeSchema>;
export type UiDocument = z.output<typeof UiDocumentSchema>;
