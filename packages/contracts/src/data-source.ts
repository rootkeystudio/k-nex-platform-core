import * as z from "zod";

import { PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { TableFieldIdSchema } from "./table-records.js";

const namespacedIdSchema = ResourceIdSchema.min(1).max(128);
const permissionIdSchema = namespacedIdSchema;
const positiveVersionSchema = z.number().finite().int().min(1).max(1_000_000);

export const dataSourceSurfaces = ["workspace", "cms", "public", "driver", "mobile", "system"] as const;
export const dataSourceAudiences = ["public", "authenticated", "internal"] as const;
export const dataSourceCacheClasses = ["no-store", "actor", "authorization-context", "public"] as const;
export const dataSourceCostClasses = ["low", "medium", "high"] as const;
export const dataSourcePlatformCeilings = Object.freeze({
  selectedFields: 64,
  pageSize: 100,
  filters: 32,
  sorts: 16,
  bodyBytes: 1_048_576,
  resultBytes: 4_194_304,
  depth: 8,
  timeoutMs: 30_000,
  concurrency: 64,
  ratePerMinute: 600,
  burst: 60,
  cost: 1_000
} as const);
export const dataSourceInputKinds = ["string", "integer", "number", "boolean", "date", "datetime", "enum"] as const;
export const dataSourceOutputKinds = [
  "text",
  "integer",
  "number",
  "decimal",
  "money",
  "percentage",
  "duration",
  "datetime",
  "date",
  "boolean",
  "status",
  "enum",
  "resource"
] as const;
export const dataSourceFilterOperators = [
  "eq",
  "neq",
  "in",
  "not-in",
  "contains",
  "starts-with",
  "ends-with",
  "gt",
  "gte",
  "lt",
  "lte",
  "is-null",
  "is-not-null"
] as const;

const uniqueValues = (values: readonly string[], context: z.RefinementCtx): void => {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "Values must be unique." });
};

const uniqueFieldIds = (values: readonly { id: string }[], path: string, context: z.RefinementCtx): void => {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id)) {
      context.addIssue({ code: "custom", path: [path, index, "id"], message: "Field IDs must be unique." });
    }
    seen.add(value.id);
  }
};

export const DataSourcePrimaryContractSchema = z.strictObject({
  id: z.enum(["metric.scalar", "table.records"]),
  version: z.literal(1)
});

export const DataSourceSourceSchemaSchema = z.strictObject({
  id: namespacedIdSchema,
  version: positiveVersionSchema
});

export const DataSourceInputFieldSchema = z.strictObject({
  id: TableFieldIdSchema,
  kind: z.enum(dataSourceInputKinds),
  required: z.boolean(),
  nullable: z.boolean()
});

export const DataSourceOutputFieldSchema = z.strictObject({
  id: TableFieldIdSchema,
  kind: z.enum(dataSourceOutputKinds),
  binding: z.enum(["required", "optional"]),
  nullable: z.boolean(),
  permission: permissionIdSchema,
  sortable: z.boolean(),
  filterOperators: z.array(z.enum(dataSourceFilterOperators)).max(8).superRefine(uniqueValues)
});

export const DataSourceLimitsSchema = z.strictObject({
  maxSelectedFields: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.selectedFields),
  maxPageSize: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.pageSize),
  maxFilters: z.number().finite().int().min(0).max(dataSourcePlatformCeilings.filters),
  maxSorts: z.number().finite().int().min(0).max(dataSourcePlatformCeilings.sorts),
  maxBodyBytes: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.bodyBytes),
  maxResultBytes: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.resultBytes),
  maxDepth: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.depth),
  timeoutMs: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.timeoutMs),
  maxConcurrency: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.concurrency),
  ratePerMinute: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.ratePerMinute),
  burst: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.burst),
  costClass: z.enum(dataSourceCostClasses),
  maxCost: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.cost)
});

export const DataSourceDescriptorSchema = z.strictObject({
  id: namespacedIdSchema,
  version: positiveVersionSchema,
  ownerPluginId: PluginIdSchema.min(1).max(128),
  primaryContract: DataSourcePrimaryContractSchema,
  sourceSchema: DataSourceSourceSchemaSchema,
  audience: z.enum(dataSourceAudiences),
  surfaces: z.array(z.enum(dataSourceSurfaces)).min(1).max(dataSourceSurfaces.length).superRefine(uniqueValues),
  permission: permissionIdSchema,
  structuralCompatibilityHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  presentationMetadataRevision: positiveVersionSchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(512).optional(),
  inputFields: z.array(DataSourceInputFieldSchema).max(32),
  outputFields: z.array(DataSourceOutputFieldSchema).max(64).optional(),
  limits: DataSourceLimitsSchema,
  cacheClass: z.enum(dataSourceCacheClasses)
}).superRefine((descriptor, context) => {
  uniqueFieldIds(descriptor.inputFields, "inputFields", context);
  uniqueFieldIds(descriptor.outputFields ?? [], "outputFields", context);

  const outputFieldCount = descriptor.outputFields?.length ?? 0;
  if (descriptor.primaryContract.id === "metric.scalar" && outputFieldCount > 0) {
    context.addIssue({
      code: "custom",
      path: ["outputFields"],
      message: "metric.scalar sources cannot declare table output fields."
    });
  }

  if (descriptor.primaryContract.id === "table.records" && outputFieldCount === 0) {
    context.addIssue({
      code: "custom",
      path: ["outputFields"],
      message: "table.records sources must declare at least one output field."
    });
  }

  const isPublic = descriptor.audience === "public";
  if (isPublic !== descriptor.surfaces.includes("public")) {
    context.addIssue({ code: "custom", path: ["surfaces"], message: "Only public-audience sources may use the public surface." });
  }

  if (isPublic && (descriptor.cacheClass === "actor" || descriptor.cacheClass === "authorization-context")) {
    context.addIssue({ code: "custom", path: ["cacheClass"], message: "Public sources cannot use an authenticated cache class." });
  }

  if (!isPublic && descriptor.cacheClass === "public") {
    context.addIssue({ code: "custom", path: ["cacheClass"], message: "Authenticated and internal sources cannot use the public cache class." });
  }
});

export type DataSourcePrimaryContract = z.infer<typeof DataSourcePrimaryContractSchema>;
export type DataSourceSourceSchema = z.infer<typeof DataSourceSourceSchemaSchema>;
export type DataSourceInputField = z.infer<typeof DataSourceInputFieldSchema>;
export type DataSourceOutputField = z.infer<typeof DataSourceOutputFieldSchema>;
export type DataSourceLimits = z.infer<typeof DataSourceLimitsSchema>;
export type DataSourceDescriptor = z.infer<typeof DataSourceDescriptorSchema>;
export type DataSourceInputKind = (typeof dataSourceInputKinds)[number];
export type DataSourceOutputKind = (typeof dataSourceOutputKinds)[number];
export type DataSourceFilterOperator = (typeof dataSourceFilterOperators)[number];
export type DataSourceSurface = (typeof dataSourceSurfaces)[number];
export type DataSourceAudience = (typeof dataSourceAudiences)[number];
export type DataSourceCacheClass = (typeof dataSourceCacheClasses)[number];
export type DataSourceCostClass = (typeof dataSourceCostClasses)[number];

export type DataSourceFieldSelectionFailure =
  | "DUPLICATE_FIELDS"
  | "FIELD_LIMIT_EXCEEDED"
  | "METRIC_FIELDS_FORBIDDEN"
  | "UNKNOWN_FIELD"
  | "REQUIRED_FIELD_NOT_REQUESTED"
  | "REQUIRED_FIELD_NOT_ALLOWED"
  | "NO_ALLOWED_FIELDS";

export type DataSourceFieldSelectionResult =
  | { readonly success: true; readonly selectedFields: readonly string[] }
  | { readonly success: false; readonly reason: DataSourceFieldSelectionFailure };

/** Shared descriptor-level projection rules used by gateways and UI readiness checks. */
export function resolveDataSourceFieldSelection(
  descriptor: DataSourceDescriptor,
  requestedFields: readonly string[],
  allowedFields: ReadonlySet<string>
): DataSourceFieldSelectionResult {
  if (new Set(requestedFields).size !== requestedFields.length) return { success: false, reason: "DUPLICATE_FIELDS" };
  if (requestedFields.length > descriptor.limits.maxSelectedFields) return { success: false, reason: "FIELD_LIMIT_EXCEEDED" };
  if (descriptor.primaryContract.id === "metric.scalar") {
    return requestedFields.length === 0
      ? { success: true, selectedFields: Object.freeze([]) }
      : { success: false, reason: "METRIC_FIELDS_FORBIDDEN" };
  }

  const fields = new Map((descriptor.outputFields ?? []).map((field) => [field.id, field]));
  if (requestedFields.some((fieldId) => !fields.has(fieldId))) return { success: false, reason: "UNKNOWN_FIELD" };
  const requested = new Set(requestedFields);
  for (const field of fields.values()) {
    if (field.binding === "required" && !requested.has(field.id)) return { success: false, reason: "REQUIRED_FIELD_NOT_REQUESTED" };
    if (field.binding === "required" && !allowedFields.has(field.id)) return { success: false, reason: "REQUIRED_FIELD_NOT_ALLOWED" };
  }
  const selectedFields = requestedFields.filter((fieldId) => allowedFields.has(fieldId));
  return selectedFields.length === 0
    ? { success: false, reason: "NO_ALLOWED_FIELDS" }
    : { success: true, selectedFields: Object.freeze(selectedFields) };
}

export type RuntimeSchemaResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: unknown };

/** Minimal validator boundary; concrete Zod types remain an implementation detail. */
export interface RuntimeSchema<T = unknown> {
  safeParse(value: unknown): RuntimeSchemaResult<T>;
}

/** Server-only pairing of a serializable descriptor and executable schemas. */
export interface DataSourceDefinition<TInput = unknown, TOutput = unknown> {
  readonly descriptor: DataSourceDescriptor;
  readonly inputSchema: RuntimeSchema<TInput>;
  readonly outputSchema: RuntimeSchema<TOutput>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeSchema(value: unknown): value is RuntimeSchema {
  return isRecord(value) && typeof value.safeParse === "function";
}

export function isDataSourceDefinition(value: unknown): value is DataSourceDefinition {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join("\u0000") !== ["descriptor", "inputSchema", "outputSchema"].join("\u0000")) return false;
  if (!DataSourceDescriptorSchema.safeParse(value.descriptor).success) return false;
  return isRuntimeSchema(value.inputSchema) && isRuntimeSchema(value.outputSchema);
}

export function assertDataSourceDefinition(value: unknown): asserts value is DataSourceDefinition {
  if (!isDataSourceDefinition(value)) {
    throw new TypeError("A data-source definition must contain a valid descriptor and executable input/output schemas.");
  }
}
