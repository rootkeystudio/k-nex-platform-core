import {
  AgentToolDescriptorSchema,
  type AgentToolDescriptor,
  type AgentToolJsonSchema,
  type DataSourceDefinition,
  type RuntimeSchema
} from "@k-nex/contracts";

import {
  actionToolCompatible,
  type ActionDefinition,
  type ActionHandler,
  type ActionHandlerRequest
} from "./action.js";
import { dataSourceToolCompatible, type DataSourceGatewayRequest, type DataSourceGatewayResponse } from "./data-source-gateway.js";
import type { RegistrationResult } from "./registration-runtime.js";
import { assertExecutableRegistrationAuthority } from "./plugin-lifecycle.js";
import {
  ToolGatewayError,
  type SourceActionDispatcher,
  type ToolAuthorizationEvaluator,
  type ToolExecutionContext,
  type ToolInputValidator,
  type ToolOutputValidator,
  type ToolProjectionRedactor
} from "./tool-gateway.js";

export type RegisteredToolTarget =
  | { readonly kind: "source"; readonly definition: DataSourceDefinition }
  | { readonly kind: "action"; readonly definition: ActionDefinition; readonly handler: ActionHandler };

function invalid(code: string, message: string): never {
  throw new ToolGatewayError(code, 500, message);
}

function targetId(descriptor: AgentToolDescriptor): string {
  return descriptor.invocation.kind === "source" ? descriptor.invocation.source.id : descriptor.invocation.action.id;
}

function targetVersion(descriptor: AgentToolDescriptor): number {
  return descriptor.invocation.kind === "source" ? descriptor.invocation.source.version : descriptor.invocation.action.version;
}

export class RegisteredToolTargetResolver {
  constructor(private readonly registration: RegistrationResult) {}

  resolve(descriptor: AgentToolDescriptor): RegisteredToolTarget {
    if (!AgentToolDescriptorSchema.safeParse(descriptor).success) {
      throw new ToolGatewayError("TOOL_TARGET_FORBIDDEN", 403, "Tool target access is forbidden.");
    }
    const id = targetId(descriptor);
    try { assertExecutableRegistrationAuthority(this.registration); } catch {
      throw new ToolGatewayError("TOOL_TARGET_FORBIDDEN", 403, "Tool target access is forbidden until lifecycle availability is reconciled.");
    }
    const version = targetVersion(descriptor);
    const kind = descriptor.invocation.kind;
    const contribution = this.registration.contributions[kind === "source" ? "sources" : "actions"]
      ?.find((entry) => entry.id === id);
    const binding = this.registration.bindings[kind === "source" ? "sources" : "actions"]
      ?.find((entry) => entry.id === id);
    if (contribution?.pluginId !== descriptor.ownerPluginId || binding?.pluginId !== descriptor.ownerPluginId) {
      throw new ToolGatewayError("TOOL_TARGET_FORBIDDEN", 403, "Tool target access is forbidden.");
    }
    if (kind === "source") {
      const definition = contribution?.value as DataSourceDefinition | undefined;
      if (definition?.descriptor.id !== id || definition.descriptor.ownerPluginId !== descriptor.ownerPluginId ||
        !dataSourceToolCompatible(descriptor, definition.descriptor) || typeof binding?.value !== "function") {
        throw new ToolGatewayError("TOOL_TARGET_FORBIDDEN", 403, "Tool target access is forbidden.");
      }
      return { kind, definition };
    }
    const definition = contribution?.value as ActionDefinition | undefined;
    if (definition === undefined || definition.descriptor.id !== id || definition.descriptor.ownerPluginId !== descriptor.ownerPluginId ||
      definition.descriptor.version !== version ||
      !actionToolCompatible(descriptor, definition.descriptor) || typeof binding?.value !== "function") {
      throw new ToolGatewayError("TOOL_TARGET_FORBIDDEN", 403, "Tool target access is forbidden.");
    }
    return { kind, definition, handler: binding.value as ActionHandler };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaMatches(schema: AgentToolJsonSchema, value: unknown): boolean {
  if (schema.enum !== undefined && !schema.enum.some((candidate) => Object.is(candidate, value))) return false;
  switch (schema.type) {
    case "object": {
      if (!isRecord(value)) return false;
      const properties = schema.properties ?? {};
      if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
      if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
      return Object.entries(properties).every(([key, child]) => !Object.hasOwn(value, key) || schemaMatches(child, value[key]));
    }
    case "array":
      return Array.isArray(value) && (schema.minItems === undefined || value.length >= schema.minItems) &&
        (schema.maxItems === undefined || value.length <= schema.maxItems) &&
        schema.items !== undefined && value.every((item) => schemaMatches(schema.items!, item));
    case "string":
      return typeof value === "string" && (schema.minLength === undefined || value.length >= schema.minLength) &&
        (schema.maxLength === undefined || value.length <= schema.maxLength);
    case "number":
      return typeof value === "number" && Number.isFinite(value) &&
        (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value) &&
        (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
  }
}

function runtimeSchemaValue<T>(schema: RuntimeSchema<T>, value: unknown, code: string, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ToolGatewayError(code, code === "TOOL_INPUT_INVALID" ? 400 : 500, message);
  return result.data;
}

export class RegisteredToolInputValidator implements ToolInputValidator {
  constructor(private readonly targets: RegisteredToolTargetResolver) {}

  validate(descriptor: AgentToolDescriptor, input: unknown): unknown {
    const target = this.targets.resolve(descriptor);
    if (!schemaMatches(descriptor.inputSchema, input)) {
      throw new ToolGatewayError("TOOL_INPUT_INVALID", 400, "Tool input is invalid.");
    }
    return target.kind === "action"
      ? runtimeSchemaValue(target.definition.inputSchema, input, "TOOL_INPUT_INVALID", "Tool input is invalid.")
      : input;
  }
}

export class RegisteredToolOutputValidator implements ToolOutputValidator {
  constructor(private readonly targets: RegisteredToolTargetResolver) {}

  validate(descriptor: AgentToolDescriptor, output: unknown): unknown {
    const target = this.targets.resolve(descriptor);
    const validated = runtimeSchemaValue(target.definition.outputSchema, output, "TOOL_OUTPUT_INVALID", "Tool output is invalid.");
    if (descriptor.outputSchema !== undefined && !schemaMatches(descriptor.outputSchema, validated)) {
      throw new ToolGatewayError("TOOL_OUTPUT_INVALID", 500, "Tool output is invalid.");
    }
    return validated;
  }
}

export interface RegisteredToolPolicyContext {
  readonly context: Omit<ToolExecutionContext, "authorization" | "budget" | "signal">;
  readonly target: RegisteredToolTarget;
}

export interface RegisteredToolPolicy {
  authorize(request: RegisteredToolPolicyContext): unknown | Promise<unknown>;
}

export class RegisteredToolAuthorization implements ToolAuthorizationEvaluator {
  constructor(
    private readonly targets: RegisteredToolTargetResolver,
    private readonly policy: RegisteredToolPolicy
  ) {}

  async authorize(context: Omit<ToolExecutionContext, "authorization" | "budget" | "signal">): Promise<unknown> {
    const target = this.targets.resolve(context.descriptor);
    const decision = await this.policy.authorize({ context, target });
    return Object.freeze({ target, decision });
  }
}

export interface RegisteredToolSourceDispatcher {
  dispatch(context: ToolExecutionContext, target: Extract<RegisteredToolTarget, { kind: "source" }>): unknown | Promise<unknown>;
}

export type RegisteredToolSourceQuery = Pick<DataSourceGatewayRequest, "input" | "query" | "selectedFields">;

export interface RegisteredToolDataSourceGateway {
  query(request: DataSourceGatewayRequest): DataSourceGatewayResponse | Promise<DataSourceGatewayResponse>;
}

export interface RegisteredToolSourceQueryMapper {
  map(
    context: ToolExecutionContext,
    target: Extract<RegisteredToolTarget, { kind: "source" }>
  ): RegisteredToolSourceQuery;
}

export class RegisteredToolDataSourceDispatcher implements RegisteredToolSourceDispatcher {
  constructor(
    private readonly gateway: RegisteredToolDataSourceGateway,
    private readonly mapper: RegisteredToolSourceQueryMapper
  ) {}

  async dispatch(context: ToolExecutionContext, target: Extract<RegisteredToolTarget, { kind: "source" }>): Promise<unknown> {
    const query = this.mapper.map(context, target);
    const response = await this.gateway.query({
      correlationId: context.request.correlationId,
      rawRequest: context.request.rawRequest,
      sourceId: target.definition.descriptor.id,
      surface: context.request.surface,
      ...query,
      signal: context.signal
    });
    if (!response.ok) throw new ToolGatewayError(response.body.code, response.status, "Data-source query failed.", response.body.detail);
    return response.body.data;
  }
}

export class RegisteredToolDispatcher implements SourceActionDispatcher {
  constructor(
    private readonly targets: RegisteredToolTargetResolver,
    private readonly source: RegisteredToolSourceDispatcher
  ) {}

  dispatch(context: ToolExecutionContext): unknown | Promise<unknown> {
    const target = this.targets.resolve(context.descriptor);
    if (target.kind === "source") return this.source.dispatch(context, target);
    const request: ActionHandlerRequest = {
      actor: context.principal.actor,
      request: context.principal.request,
      authorizationContext: context.principal.authorizationContext,
      input: context.input,
      signal: context.signal,
      ...(context.request.idempotencyKey === undefined ? {} : { idempotencyKey: context.request.idempotencyKey })
    };
    return target.handler(request);
  }
}

function pathSegments(path: string): readonly string[] {
  if (!path.startsWith("/")) invalid("TOOL_REDACTION_INVALID", "Tool redaction metadata is invalid.");
  return path.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function redactAt(value: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return undefined;
  if (Array.isArray(value)) {
    const index = Number(segments[0]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) return value;
    if (segments.length === 1) return value.filter((_item, itemIndex) => itemIndex !== index);
    const next = redactAt(value[index], segments.slice(1));
    return value.map((item, itemIndex) => itemIndex === index ? next : item);
  }
  if (!isRecord(value) || !Object.hasOwn(value, segments[0]!)) return value;
  const copy = { ...value };
  if (segments.length === 1) {
    delete copy[segments[0]!];
  } else {
    copy[segments[0]!] = redactAt(copy[segments[0]!], segments.slice(1));
  }
  return copy;
}

export class RegisteredToolRedactor implements ToolProjectionRedactor {
  redact(context: ToolExecutionContext, output: unknown): unknown {
    let redacted = output;
    for (const path of context.descriptor.redaction.outputPaths) redacted = redactAt(redacted, pathSegments(path));
    return redacted;
  }
}
