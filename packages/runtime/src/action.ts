import {
  ActionDescriptorSchema,
  canonicalJson,
  type ActionDescriptor,
  type AgentToolDescriptor,
  type RuntimeSchema
} from "@k-nex/contracts";

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  readonly descriptor: ActionDescriptor;
  readonly inputSchema: RuntimeSchema<TInput>;
  readonly outputSchema: RuntimeSchema<TOutput>;
}

export interface ActionHandlerRequest<TInput = unknown> {
  readonly actor: unknown;
  readonly request: unknown;
  readonly authorizationContext: unknown;
  readonly input: TInput;
  readonly idempotencyKey?: string;
  readonly signal: AbortSignal;
}

export type ActionHandler<TInput = unknown, TOutput = unknown> =
  (request: ActionHandlerRequest<TInput>) => TOutput | Promise<TOutput>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeSchema(value: unknown): value is RuntimeSchema {
  return isRecord(value) && typeof value.safeParse === "function";
}

export function isActionDefinition(value: unknown): value is ActionDefinition {
  if (!isRecord(value) || Object.keys(value).sort().join("\u0000") !== "descriptor\u0000inputSchema\u0000outputSchema") return false;
  return ActionDescriptorSchema.safeParse(value.descriptor).success &&
    isRuntimeSchema(value.inputSchema) && isRuntimeSchema(value.outputSchema);
}

export function assertActionDefinition(value: unknown): asserts value is ActionDefinition {
  if (!isActionDefinition(value)) {
    throw new TypeError("An action definition must contain a valid descriptor and executable input/output schemas.");
  }
}

export function actionToolCompatible(tool: AgentToolDescriptor, action: ActionDescriptor): boolean {
  if (tool.invocation.kind !== "action" || tool.invocation.action.version !== action.version) return false;
  if (canonicalJson(tool.inputSchema) !== canonicalJson(action.inputSchema)) return false;
  if (canonicalJson(tool.outputSchema ?? null) !== canonicalJson(action.outputSchema ?? null)) return false;
  if ((tool.outputContract ?? null) !== (action.outputContract ?? null)) return false;
  if (tool.permission !== action.permission) return false;
  if (tool.policy !== action.policy) return false;
  if (tool.effect !== action.effect || tool.idempotency !== action.idempotency) return false;
  return tool.dryRun === false || action.dryRun;
}
