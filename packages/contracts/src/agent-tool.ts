import * as z from "zod";

import {
  dataSourceAudiences,
  dataSourceCostClasses,
  dataSourcePlatformCeilings,
  dataSourceSurfaces
} from "./data-source.js";
import { OutputContractIdSchema, PluginIdSchema, ResourceIdSchema } from "./identity.js";
import { uniqueArray } from "./schema-helpers.js";

const boundedResourceIdSchema = ResourceIdSchema.min(1).max(128);
const positiveVersionSchema = z.number().finite().int().min(1).max(1_000_000);
const jsonSchemaPropertyName = z.string().min(1).max(128);
const jsonSchemaType = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);
const jsonSchemaEnumValue = z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()]);
const schemaDepthLimit = 8;

export type AgentToolJsonScalar = string | number | boolean | null;

export const agentToolEffects = ["read-only", "write", "destructive", "external"] as const;
export const agentToolRiskClasses = ["low", "medium", "high", "critical"] as const;
export const agentToolApprovalPolicies = ["none", "per-call"] as const;
export const agentToolIdempotencyPolicies = ["not-applicable", "recommended", "required"] as const;

export type AgentToolJsonSchema = {
  readonly type: z.infer<typeof jsonSchemaType>;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly enum?: readonly AgentToolJsonScalar[] | undefined;
  readonly properties?: Readonly<Record<string, AgentToolJsonSchema>> | undefined;
  readonly required?: readonly string[] | undefined;
  readonly additionalProperties?: false | undefined;
  readonly items?: AgentToolJsonSchema | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly minItems?: number | undefined;
  readonly maxItems?: number | undefined;
};

const jsonSchemaNodeSchema: z.ZodType<AgentToolJsonSchema> = z.lazy(() => z.strictObject({
  type: jsonSchemaType,
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(512).optional(),
  enum: z.array(jsonSchemaEnumValue).max(64).optional(),
  properties: z.record(jsonSchemaPropertyName, jsonSchemaNodeSchema).superRefine((properties, context) => {
    if (Object.keys(properties).length > 64) context.addIssue({ code: "custom", message: "JSON object schemas cannot declare more than 64 properties." });
  }).optional(),
  required: uniqueArray(jsonSchemaPropertyName).max(64).optional(),
  additionalProperties: z.literal(false).optional(),
  items: jsonSchemaNodeSchema.optional(),
  minLength: z.number().finite().int().min(0).max(65_536).optional(),
  maxLength: z.number().finite().int().min(0).max(65_536).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  minItems: z.number().finite().int().min(0).max(1_024).optional(),
  maxItems: z.number().finite().int().min(0).max(1_024).optional()
}).superRefine((schema, context) => {
  if (schema.type === "object") {
    if (schema.properties === undefined) {
      context.addIssue({ code: "custom", path: ["properties"], message: "JSON object schemas must declare a properties object." });
    }
    if (schema.additionalProperties !== false) {
      context.addIssue({ code: "custom", path: ["additionalProperties"], message: "JSON object schemas must set additionalProperties to false." });
    }
    for (const required of schema.required ?? []) {
      if (schema.properties === undefined || !(required in schema.properties)) {
        context.addIssue({ code: "custom", path: ["required"], message: "JSON schema required fields must be declared in properties." });
      }
    }
  } else {
    for (const key of ["properties", "required", "additionalProperties"] as const) {
      if (schema[key] !== undefined) {
        context.addIssue({ code: "custom", path: [key], message: `JSON schema ${key} is only valid for object schemas.` });
      }
    }
  }

  if (schema.type === "array" && schema.items === undefined) {
    context.addIssue({ code: "custom", path: ["items"], message: "JSON array schemas must declare items." });
  }
  if (schema.type !== "array" && schema.items !== undefined) {
    context.addIssue({ code: "custom", path: ["items"], message: "JSON schema items is only valid for array schemas." });
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength > schema.maxLength) {
    context.addIssue({ code: "custom", path: ["maxLength"], message: "JSON schema maxLength cannot be less than minLength." });
  }
  if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) {
    context.addIssue({ code: "custom", path: ["maximum"], message: "JSON schema maximum cannot be less than minimum." });
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) {
    context.addIssue({ code: "custom", path: ["maxItems"], message: "JSON schema maxItems cannot be less than minItems." });
  }
}));

function validateSchemaDepth(schema: AgentToolJsonSchema, depth: number, context: z.RefinementCtx): void {
  if (depth > schemaDepthLimit) {
    context.addIssue({ code: "custom", path: [], message: `JSON schema nesting cannot exceed ${schemaDepthLimit} levels.` });
    return;
  }
  for (const child of Object.values(schema.properties ?? {})) validateSchemaDepth(child, depth + 1, context);
  if (schema.items !== undefined) validateSchemaDepth(schema.items, depth + 1, context);
}

export const AgentToolJsonSchemaSchema = jsonSchemaNodeSchema;

export const AgentToolInputSchemaSchema = z.strictObject({
  type: z.literal("object"),
  title: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(512).optional(),
  properties: z.record(jsonSchemaPropertyName, jsonSchemaNodeSchema).superRefine((properties, context) => {
    if (Object.keys(properties).length > 64) context.addIssue({ code: "custom", message: "JSON object schemas cannot declare more than 64 properties." });
  }),
  required: uniqueArray(jsonSchemaPropertyName).max(64).optional(),
  additionalProperties: z.literal(false)
}).superRefine((schema, context) => {
  for (const required of schema.required ?? []) {
    if (!(required in schema.properties)) {
      context.addIssue({ code: "custom", path: ["required"], message: "JSON schema required fields must be declared in properties." });
    }
  }
  validateSchemaDepth(schema, 1, context);
});

export const AgentToolInvocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("source"),
    source: z.strictObject({ id: boundedResourceIdSchema, version: positiveVersionSchema })
  }),
  z.strictObject({
    kind: z.literal("action"),
    action: z.strictObject({ id: boundedResourceIdSchema, version: positiveVersionSchema })
  })
]);

const pathSchema = z.string().min(1).max(256);

export const AgentToolLimitsSchema = z.strictObject({
  timeoutMs: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.timeoutMs),
  maxConcurrency: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.concurrency),
  ratePerMinute: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.ratePerMinute),
  burst: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.burst),
  costClass: z.enum(dataSourceCostClasses),
  maxCost: z.number().finite().int().min(1).max(dataSourcePlatformCeilings.cost)
});

export const AgentToolRedactionSchema = z.strictObject({
  inputPaths: uniqueArray(pathSchema).max(64).default([]),
  outputPaths: uniqueArray(pathSchema).max(64).default([])
});

export const AgentToolAuditSchema = z.strictObject({
  category: boundedResourceIdSchema,
  resourcePath: pathSchema.optional()
});

export const AgentToolDescriptorSchema = z.strictObject({
  id: boundedResourceIdSchema,
  version: positiveVersionSchema,
  ownerPluginId: PluginIdSchema.min(1).max(128),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(512),
  inputSchema: AgentToolInputSchemaSchema,
  outputSchema: AgentToolJsonSchemaSchema.optional(),
  outputContract: OutputContractIdSchema.optional(),
  invocation: AgentToolInvocationSchema,
  audience: z.enum(dataSourceAudiences),
  surfaces: z.array(z.enum(dataSourceSurfaces)).min(1).max(dataSourceSurfaces.length).superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "Tool surfaces must be unique." });
  }),
  permission: boundedResourceIdSchema,
  policy: boundedResourceIdSchema,
  effect: z.enum(agentToolEffects),
  risk: z.enum(agentToolRiskClasses),
  approval: z.enum(agentToolApprovalPolicies),
  idempotency: z.enum(agentToolIdempotencyPolicies),
  dryRun: z.boolean(),
  limits: AgentToolLimitsSchema,
  redaction: AgentToolRedactionSchema,
  audit: AgentToolAuditSchema
}).superRefine((tool, context) => {
  if (tool.outputSchema !== undefined) validateSchemaDepth(tool.outputSchema, 1, context);
  if (tool.outputSchema !== undefined && tool.outputContract !== undefined) {
    context.addIssue({ code: "custom", path: ["outputSchema"], message: "A tool may declare outputSchema or outputContract, not both." });
  }
  if (tool.effect === "destructive" || tool.effect === "external") {
    context.addIssue({ code: "custom", path: ["effect"], message: "Destructive and external-side-effect tools are unsupported in Phase 2A." });
  }
  if (tool.effect === "write") {
    if (tool.approval !== "per-call") {
      context.addIssue({ code: "custom", path: ["approval"], message: "Write tools require per-call approval." });
    }
    if (tool.idempotency !== "required") {
      context.addIssue({ code: "custom", path: ["idempotency"], message: "Write tools require idempotency." });
    }
  }
  if (tool.invocation.kind === "source" && tool.effect !== "read-only") {
    context.addIssue({ code: "custom", path: ["effect"], message: "Source-backed tools must be read-only." });
  }
  if (tool.effect === "write" && tool.invocation.kind !== "action") {
    context.addIssue({ code: "custom", path: ["invocation"], message: "Write tools must target a registered action." });
  }
  if (tool.effect !== "read-only" && tool.approval === "none") {
    context.addIssue({ code: "custom", path: ["approval"], message: "Only read-only tools may omit per-call approval." });
  }
  if (tool.audience === "public" && !tool.surfaces.includes("public")) {
    context.addIssue({ code: "custom", path: ["surfaces"], message: "Public tools must include the public surface." });
  }
  if (tool.audience !== "public" && tool.surfaces.includes("public")) {
    context.addIssue({ code: "custom", path: ["surfaces"], message: "Only public-audience tools may use the public surface." });
  }
}).meta({
  $id: "https://schemas.k-nex.dev/agent-tool/v1.json",
  title: "K-Nex Agent Tool Descriptor v1"
});

export type AgentToolInvocation = z.infer<typeof AgentToolInvocationSchema>;
export type AgentToolLimits = z.infer<typeof AgentToolLimitsSchema>;
export type AgentToolRedaction = z.infer<typeof AgentToolRedactionSchema>;
export type AgentToolAudit = z.infer<typeof AgentToolAuditSchema>;
export type AgentToolDescriptor = z.infer<typeof AgentToolDescriptorSchema>;
export type AgentToolEffect = (typeof agentToolEffects)[number];
export type AgentToolRiskClass = (typeof agentToolRiskClasses)[number];
export type AgentToolApprovalPolicy = (typeof agentToolApprovalPolicies)[number];
export type AgentToolIdempotencyPolicy = (typeof agentToolIdempotencyPolicies)[number];
