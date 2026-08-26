import { mcpPlugin, type MCPAccessSettings, type MCPPluginConfig } from "@payloadcms/plugin-mcp";
import {
  APIError,
  UnauthorizedError,
  type CollectionBeforeValidateHook,
  type CollectionConfig,
  type PayloadRequest,
  type Plugin
} from "payload";
import { z } from "zod";

import {
  AgentToolDescriptorSchema,
  type AgentToolDescriptor,
  type AgentToolJsonSchema,
  type DataSourceSurface
} from "@k-nex/contracts";
import {
  type ToolCatalogListResult,
  type ToolCatalogListRequest,
  type ToolCatalogRequest,
  type ToolExecutionGateway,
  type ToolGatewayRequest,
  type ToolGatewayResponse
} from "@k-nex/runtime";

const maxMcpDurationSeconds = 30;
const maxToolDescriptionLength = 512;
const apiKeyLifetimeMilliseconds = 30 * 24 * 60 * 60 * 1_000;

export const payloadMcpAdapterInventory = Object.freeze({
  package: "@payloadcms/plugin-mcp",
  version: "3.88.0",
  collections: Object.freeze(["payload-mcp-api-keys"]),
  endpoints: Object.freeze(["GET /api/mcp", "POST /api/mcp"]),
  adminGroups: Object.freeze(["MCP"]),
  migrationFields: Object.freeze(["expiresAt"])
} as const);

export interface PayloadMcpActorContext extends Omit<ToolCatalogRequest, "authorizationContext"> {
  readonly authorizationContext: unknown;
}

export interface PayloadMcpContextResolver {
  resolve(request: PayloadRequest, user: unknown): PayloadMcpActorContext | Promise<PayloadMcpActorContext>;
}

export interface PayloadMcpCatalog {
  list(request: ToolCatalogListRequest): Promise<ToolCatalogListResult>;
}

export interface PayloadMcpTelemetryEvent {
  readonly kind: "mcp.transport-event";
  readonly event: unknown;
}

export interface PayloadMcpAdapterOptions {
  readonly tools: readonly AgentToolDescriptor[];
  readonly catalog: PayloadMcpCatalog;
  readonly gateway: Pick<ToolExecutionGateway, "execute">;
  readonly context: PayloadMcpContextResolver;
  readonly surface: DataSourceSurface;
  readonly features?: readonly string[];
  readonly userCollection?: string;
  readonly maxDurationSeconds?: number;
  readonly telemetry?: (event: PayloadMcpTelemetryEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function camelCase(value: string): string {
  return value.replace(/[-_\s]+(.)?/g, (_, character: string | undefined) => character ? character.toUpperCase() : "").replace(/^(.)/, (_, character: string) => character.toLowerCase());
}

function toolName(descriptor: AgentToolDescriptor): string {
  return `k-nex-${descriptor.id.replace(/[^A-Za-z0-9]+/g, "-")}-v${descriptor.version}`;
}

function boundedString(value: string, maximum: number): string {
  return value.slice(0, maximum);
}

function jsonSchemaToZod(schema: AgentToolJsonSchema): z.ZodTypeAny {
  let result: z.ZodTypeAny;
  if (schema.type === "object") {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const required = schema.required?.includes(key) ?? false;
      shape[key] = required ? jsonSchemaToZod(property) : jsonSchemaToZod(property).optional();
    }
    result = z.object(shape);
  } else if (schema.type === "array") {
    result = z.array(jsonSchemaToZod(schema.items!));
  } else if (schema.type === "string") {
    result = z.string();
  } else if (schema.type === "integer") {
    result = z.number().int();
  } else if (schema.type === "number") {
    result = z.number();
  } else if (schema.type === "boolean") {
    result = z.boolean();
  } else {
    result = z.null();
  }

  if (schema.description !== undefined) result = result.describe(schema.description);
  if (schema.type === "string") {
    if (schema.minLength !== undefined) result = (result as z.ZodString).min(schema.minLength);
    if (schema.maxLength !== undefined) result = (result as z.ZodString).max(schema.maxLength);
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (schema.minimum !== undefined) result = (result as z.ZodNumber).min(schema.minimum);
    if (schema.maximum !== undefined) result = (result as z.ZodNumber).max(schema.maximum);
  }
  if (schema.type === "array") {
    if (schema.minItems !== undefined) result = (result as z.ZodArray<z.ZodTypeAny>).min(schema.minItems);
    if (schema.maxItems !== undefined) result = (result as z.ZodArray<z.ZodTypeAny>).max(schema.maxItems);
  }
  if (schema.enum !== undefined) {
    const allowed = schema.enum;
    result = result.refine(
      (value) => allowed.some((candidate) => Object.is(candidate, value)),
      { message: "Value must match an allowed enum value." }
    );
  }
  return result;
}

function toolParameters(descriptor: AgentToolDescriptor): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(Object.entries(descriptor.inputSchema.properties).map(([key, schema]) => {
    const required = descriptor.inputSchema.required?.includes(key) ?? false;
    return [key, required ? jsonSchemaToZod(schema) : jsonSchemaToZod(schema).optional()];
  }));
}

function safeJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "null" : serialized;
  } catch {
    return JSON.stringify({ code: "UNSERIALIZABLE_RESPONSE" });
  }
}

function requestHeader(request: PayloadRequest, name: string): string | undefined {
  const value = request.headers.get(name);
  return value === null || value.trim() === "" ? undefined : value.slice(0, 128);
}

function requestSignal(request: PayloadRequest): AbortSignal {
  return (request as PayloadRequest & { signal?: AbortSignal }).signal ?? new AbortController().signal;
}

function durationSeconds(value: number | undefined): number {
  if (value === undefined) return maxMcpDurationSeconds;
  if (!Number.isSafeInteger(value) || value < 1 || value > maxMcpDurationSeconds) {
    throw new RangeError(`MCP max duration must be between 1 and ${maxMcpDurationSeconds} seconds.`);
  }
  return value;
}

function validApiKeyLifetime(expiresAt: unknown, issuedAt: unknown, now: number): boolean {
  if (typeof expiresAt !== "string" || (typeof issuedAt !== "string" && typeof issuedAt !== "number")) return false;
  const expiry = Date.parse(expiresAt);
  const issuance = typeof issuedAt === "number" ? issuedAt : Date.parse(issuedAt);
  return Number.isFinite(expiry) && Number.isFinite(issuance) && issuance <= now && expiry > now &&
    expiry - issuance <= apiKeyLifetimeMilliseconds;
}

function protectApiKeyCollection(collection: CollectionConfig, userCollection: string): CollectionConfig {
  const existing = collection.access ?? {};
  const operations = ["create", "read", "update", "delete", "unlock"] as const;
  const access = Object.fromEntries(operations.map((operation) => [operation, async (args: unknown) => {
    const request = isRecord(args) ? args.req : undefined;
    const user = isRecord(request) ? request.user : undefined;
    if (!isRecord(user) || user.collection !== userCollection) return false;
    const check = existing[operation];
    if (typeof check === "function") return check(args as never);
    return check === true;
  }])) as CollectionConfig["access"];
  const enforceLifetime: CollectionBeforeValidateHook = ({ data, operation, originalDoc }) => {
    const next = isRecord(data) ? data : {};
    const previous = isRecord(originalDoc) ? originalDoc : {};
    const expiresAt = next.expiresAt ?? previous.expiresAt;
    const issuedAt = operation === "create" ? Date.now() : previous.createdAt;
    if (!validApiKeyLifetime(expiresAt, issuedAt, Date.now())) {
      throw new APIError("MCP API-key lifetime is invalid.", 400);
    }
    return data;
  };
  return {
    ...collection,
    access,
    hooks: {
      ...(collection.hooks ?? {}),
      beforeValidate: [...(collection.hooks?.beforeValidate ?? []), enforceLifetime]
    },
    indexes: [...(collection.indexes ?? []), { fields: ["apiKeyIndex"], unique: true }],
    fields: [
      ...(collection.fields ?? []),
      {
        name: "expiresAt",
        type: "date",
        admin: { description: "K-Nex MCP API keys expire after at most 30 days." },
        defaultValue: () => new Date(Date.now() + apiKeyLifetimeMilliseconds).toISOString(),
        index: true,
        required: true
      }
    ]
  } as CollectionConfig;
}

function assertUnexpiredApiKey(settings: MCPAccessSettings): void {
  const key = settings as MCPAccessSettings & { readonly createdAt?: unknown; readonly expiresAt?: unknown };
  if (!validApiKeyLifetime(key.expiresAt, key.createdAt, Date.now())) throw new UnauthorizedError();
}

function intersectToolAccess(
  defaults: MCPAccessSettings,
  visible: ReadonlySet<string>,
  tools: readonly AgentToolDescriptor[]
): Record<string, boolean> {
  const configured = defaults["payload-mcp-tool"] ?? {};
  return Object.fromEntries(tools.map((descriptor) => {
    const name = toolName(descriptor);
    const configuredValue = configured[camelCase(name)] ?? configured[name];
    return [camelCase(name), configuredValue === true && visible.has(name)];
  }));
}

function safeAccessSettings(defaults: MCPAccessSettings, tools: Record<string, boolean>): MCPAccessSettings {
  return {
    user: defaults.user,
    "payload-mcp-tool": tools,
    auth: {},
    collections: {},
    config: {},
    globals: {},
    jobs: {},
    custom: {}
  };
}

async function visibleToolNames(options: PayloadMcpAdapterOptions, context: PayloadMcpActorContext): Promise<Set<string>> {
  const visible = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await options.catalog.list({
      ...context,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor })
    });
    for (const tool of page.tools) visible.add(toolName(tool));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return visible;
}

function gatewayRequest(request: PayloadRequest, descriptor: AgentToolDescriptor, input: unknown, surface: DataSourceSurface, features: readonly string[]): ToolGatewayRequest {
  const idempotencyKey = requestHeader(request, "idempotency-key");
  return {
    correlationId: requestHeader(request, "x-correlation-id") ?? "payload-mcp",
    rawRequest: request,
    tool: { id: descriptor.id, version: descriptor.version },
    surface,
    features,
    input,
    signal: requestSignal(request),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey })
  };
}

function mcpResponse(response: ToolGatewayResponse): {
  content: [{ type: "text"; text: string }];
  isError?: true;
  structuredContent?: Record<string, unknown>;
} {
  if (!response.ok) return { content: [{ type: "text", text: safeJson(response.body) }], isError: true };
  return {
    content: [{ type: "text", text: safeJson(response.body) }],
    ...(isRecord(response.body.data) ? { structuredContent: response.body.data } : {})
  };
}

export function createPayloadMcpPluginConfig(options: PayloadMcpAdapterOptions): MCPPluginConfig {
  if (options.tools.length === 0) throw new TypeError("At least one K-Nex MCP tool is required.");
  const descriptors = options.tools.map((tool) => AgentToolDescriptorSchema.parse(tool));
  const names = descriptors.map(toolName);
  if (new Set(names).size !== names.length) throw new TypeError("MCP tool names must be unique.");
  const features = Object.freeze([...(options.features ?? [])]);
  const maxDuration = durationSeconds(options.maxDurationSeconds);
  const userCollection = options.userCollection ?? "users";

  return {
    collections: {},
    globals: {},
    userCollection,
    mcp: {
      handlerOptions: {
        disableSse: true,
        maxDuration,
        onEvent: (event) => {
          try {
            options.telemetry?.(Object.freeze({ kind: "mcp.transport-event", event }));
          } catch {
            // Telemetry must never affect MCP authorization or execution.
          }
        }
      },
      tools: descriptors.map((descriptor) => ({
        name: toolName(descriptor),
        description: boundedString(descriptor.description, maxToolDescriptionLength),
        parameters: toolParameters(descriptor),
        handler: async (args: Record<string, unknown>, request: PayloadRequest) => {
          const response = await options.gateway.execute(gatewayRequest(request, descriptor, args, options.surface, features));
          return mcpResponse(response);
        }
      }))
    },
    overrideAuth: async (request, getDefaultMcpAccessSettings) => {
      const defaults = await getDefaultMcpAccessSettings();
      assertUnexpiredApiKey(defaults);
      const context = await options.context.resolve(request, defaults.user);
      const visible = await visibleToolNames(options, context);
      return safeAccessSettings(defaults, intersectToolAccess(defaults, visible, descriptors));
    },
    overrideApiKeyCollection: (collection) => protectApiKeyCollection(collection, userCollection)
  };
}

export function createPayloadMcpPlugin(options: PayloadMcpAdapterOptions): Plugin {
  return mcpPlugin(createPayloadMcpPluginConfig(options));
}
