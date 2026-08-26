import * as z from "zod";

import {
  AgentToolInputSchemaSchema,
  AgentToolJsonSchemaSchema,
  type AgentToolJsonSchema
} from "./agent-tool.js";
import { OutputContractIdSchema, PluginIdSchema, ResourceIdSchema } from "./identity.js";

const boundedActionIdSchema = ResourceIdSchema.min(1).max(128);
const positiveVersionSchema = z.number().finite().int().min(1).max(1_000_000);

export const actionEffects = ["read-only", "write", "destructive", "external"] as const;
export const actionIdempotencyPolicies = ["not-applicable", "required"] as const;

const policyIdSchema = ResourceIdSchema.min(1).max(128);
const actionSchemaDepthLimit = 8;

function validateSchemaDepth(schema: AgentToolJsonSchema, depth: number, context: z.RefinementCtx): void {
  if (depth > actionSchemaDepthLimit) {
    context.addIssue({ code: "custom", message: `JSON schema nesting cannot exceed ${actionSchemaDepthLimit} levels.` });
    return;
  }
  for (const child of Object.values(schema.properties ?? {})) validateSchemaDepth(child, depth + 1, context);
  if (schema.items !== undefined) validateSchemaDepth(schema.items, depth + 1, context);
}

/** Static, serializable metadata for a registered server-side action. */
export const ActionDescriptorSchema = z.strictObject({
  id: boundedActionIdSchema,
  version: positiveVersionSchema,
  ownerPluginId: PluginIdSchema.min(1).max(128),
  inputSchema: AgentToolInputSchemaSchema,
  outputSchema: AgentToolJsonSchemaSchema.optional(),
  outputContract: OutputContractIdSchema.optional(),
  permission: policyIdSchema,
  policy: policyIdSchema,
  effect: z.enum(actionEffects),
  idempotency: z.enum(actionIdempotencyPolicies),
  dryRun: z.boolean()
}).superRefine((action, context) => {
  if (action.outputSchema !== undefined) validateSchemaDepth(action.outputSchema, 1, context);
  if (action.outputSchema === undefined && action.outputContract === undefined) {
    context.addIssue({
      code: "custom",
      path: ["outputSchema"],
      message: "Actions must declare an outputSchema or outputContract."
    });
  }
  if (action.outputSchema !== undefined && action.outputContract !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["outputSchema"],
      message: "An action may declare outputSchema or outputContract, not both."
    });
  }
  if (action.effect !== "read-only" && action.idempotency !== "required") {
    context.addIssue({
      code: "custom",
      path: ["idempotency"],
      message: "Write, destructive, and external actions require idempotency."
    });
  }
});

export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;
export type ActionEffect = (typeof actionEffects)[number];
export type ActionIdempotencyPolicy = (typeof actionIdempotencyPolicies)[number];
