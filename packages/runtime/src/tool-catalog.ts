import {
  AgentToolDescriptorSchema,
  canonicalJson,
  dataSourceSurfaces,
  type AgentToolDescriptor,
  type DataSourceDefinition,
  type DataSourceSurface
} from "@k-nex/contracts";

import { isDataSourceActorContext, type DataSourceActorContext } from "./data-source-authorization.js";
import { actionToolCompatible, type ActionDefinition } from "./action.js";
import type { RegistrationResult } from "./registration-runtime.js";
import { assertExecutableRegistrationAuthority } from "./plugin-lifecycle.js";

export const toolCatalogLimits = Object.freeze({
  maxPageSize: 100,
  maxFeatures: 64,
  maxFeatureLength: 128,
  maxCursorLength: 128,
  maxCatalogSize: 1_000
} as const);

export type ToolCatalogErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ACTOR_CONTEXT"
  | "INVALID_CURSOR"
  | "INVALID_TOOL"
  | "TOOL_OWNER_UNAVAILABLE"
  | "DUPLICATE_TOOL"
  | "TOOL_BINDING_MISSING"
  | "CATALOG_LIMIT_EXCEEDED";

export class ToolCatalogError extends Error {
  readonly code: ToolCatalogErrorCode;

  constructor(code: ToolCatalogErrorCode, message: string) {
    super(message);
    this.name = "ToolCatalogError";
    this.code = code;
  }
}

export interface ToolCatalogRequest {
  readonly actor: DataSourceActorContext;
  readonly delegation: unknown;
  readonly authorizationContext: unknown;
  readonly surface: DataSourceSurface;
  readonly features: readonly string[];
}

export interface ToolCatalogListRequest extends ToolCatalogRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ToolCatalogPolicyRequest extends ToolCatalogRequest {
  readonly descriptor: AgentToolDescriptor;
}

export interface ToolCatalogPolicy {
  isVisible(request: ToolCatalogPolicyRequest): boolean | Promise<boolean>;
}

export interface ToolCatalogListResult {
  readonly revision: string;
  readonly tools: readonly AgentToolDescriptor[];
  readonly nextCursor?: string;
}

function compare(left: AgentToolDescriptor, right: AgentToolDescriptor): number {
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return left.version - right.version;
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (child: unknown): void => {
    if (typeof child !== "object" || child === null || Object.isFrozen(child)) return;
    for (const value of Object.values(child)) freeze(value);
    Object.freeze(child);
  };
  freeze(clone);
  return clone;
}

function sha256(value: string): Promise<string> {
  return globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

function validSurface(value: unknown): value is DataSourceSurface {
  return typeof value === "string" && dataSourceSurfaces.includes(value as DataSourceSurface);
}

function normalizeRequest(request: unknown): ToolCatalogRequest {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new ToolCatalogError("INVALID_REQUEST", "Tool catalog request must be an object.");
  }
  const candidate = request as Partial<ToolCatalogRequest>;
  if (!isDataSourceActorContext(candidate.actor)) {
    throw new ToolCatalogError("INVALID_ACTOR_CONTEXT", "Tool catalog actor context is invalid.");
  }
  if (candidate.delegation === undefined || candidate.authorizationContext === undefined) {
    throw new ToolCatalogError("INVALID_REQUEST", "Tool catalog request must bind delegation and authorization context.");
  }
  if (!validSurface(candidate.surface)) {
    throw new ToolCatalogError("INVALID_REQUEST", "Tool catalog surface is invalid.");
  }
  if (!Array.isArray(candidate.features) || candidate.features.length > toolCatalogLimits.maxFeatures) {
    throw new ToolCatalogError("INVALID_REQUEST", "Tool catalog features exceed the bounded limit.");
  }
  if (candidate.features.some((feature) =>
    typeof feature !== "string" || feature.length < 1 || feature.length > toolCatalogLimits.maxFeatureLength
  ) || new Set(candidate.features).size !== candidate.features.length) {
    throw new ToolCatalogError("INVALID_REQUEST", "Tool catalog features must be bounded and unique.");
  }
  return Object.freeze({
    actor: candidate.actor,
    delegation: candidate.delegation,
    authorizationContext: candidate.authorizationContext,
    surface: candidate.surface,
    features: Object.freeze([...candidate.features])
  });
}

async function cursorToken(descriptor: AgentToolDescriptor): Promise<string> {
  return `sha256:${await sha256(canonicalJson({ id: descriptor.id, version: descriptor.version }))}`;
}

function cursorOffset(cursor: string | undefined, cursors: readonly string[]): number {
  if (cursor === undefined) return 0;
  if (cursor.length < 1 || cursor.length > toolCatalogLimits.maxCursorLength || !/^sha256:[0-9a-f]{64}$/.test(cursor)) {
    throw new ToolCatalogError("INVALID_CURSOR", "Tool catalog cursor is invalid.");
  }
  const index = cursors.indexOf(cursor);
  if (index < 0) {
    throw new ToolCatalogError("INVALID_CURSOR", "Tool catalog cursor is invalid.");
  }
  return index + 1;
}

function descriptorAllowed(descriptor: AgentToolDescriptor, request: ToolCatalogRequest): boolean {
  if (!descriptor.surfaces.includes(request.surface)) return false;
  const actor = request.actor.effectiveActor;
  if (request.surface === "public" && descriptor.audience !== "public") return false;
  if ((actor.kind === "public" || actor.kind === "public-session") && descriptor.audience !== "public") return false;
  if (descriptor.audience === "internal" && actor.kind !== "service" && actor.kind !== "system-job") return false;
  return true;
}

function targetBinding(registration: RegistrationResult, descriptor: AgentToolDescriptor): boolean {
  const kind = descriptor.invocation.kind === "source" ? "sources" : "actions";
  const id = descriptor.invocation.kind === "source" ? descriptor.invocation.source.id : descriptor.invocation.action.id;
  const contribution = registration.contributions[kind]?.find((entry) => entry.id === id);
  const binding = registration.bindings[kind]?.find((entry) => entry.id === id);
  if (contribution?.pluginId !== descriptor.ownerPluginId || binding?.pluginId !== descriptor.ownerPluginId) return false;
  return descriptor.invocation.kind === "source"
    ? (contribution.value as DataSourceDefinition).descriptor.version === descriptor.invocation.source.version
    : actionToolCompatible(descriptor, (contribution.value as ActionDefinition).descriptor);
}

export class ToolCatalog {
  private readonly tools: readonly AgentToolDescriptor[];
  private readonly policy: ToolCatalogPolicy;
  private readonly listeners = new Set<() => void>();

  constructor(registration: RegistrationResult, policy: ToolCatalogPolicy) {
    assertExecutableRegistrationAuthority(registration);
    if (typeof policy?.isVisible !== "function") throw new TypeError("Tool catalog policy must define isVisible.");
    this.policy = policy;
    const installedOwners = new Set(registration.inventory.map((plugin) => plugin.id));
    const seen = new Set<string>();
    const values = registration.contributions.tools ?? [];
    if (values.length > toolCatalogLimits.maxCatalogSize) {
      throw new ToolCatalogError("CATALOG_LIMIT_EXCEEDED", "Tool catalog exceeds the bounded size.");
    }
    const tools = values.map((entry) => {
      const parsed = AgentToolDescriptorSchema.safeParse(entry.value);
      if (!parsed.success || parsed.data.id !== entry.id || parsed.data.ownerPluginId !== entry.pluginId) {
        throw new ToolCatalogError("INVALID_TOOL", `Tool contribution ${entry.id} is invalid.`);
      }
      if (!installedOwners.has(parsed.data.ownerPluginId)) {
        throw new ToolCatalogError("TOOL_OWNER_UNAVAILABLE", `Tool owner ${parsed.data.ownerPluginId} is unavailable.`);
      }
      const key = `${parsed.data.id}\u0000${parsed.data.version}`;
      if (seen.has(key)) throw new ToolCatalogError("DUPLICATE_TOOL", `Tool ${parsed.data.id} v${parsed.data.version} is duplicated.`);
      if (!targetBinding(registration, parsed.data)) {
        throw new ToolCatalogError("TOOL_BINDING_MISSING", `Tool ${parsed.data.id} has no registered target binding.`);
      }
      seen.add(key);
      return frozenClone(parsed.data);
    });
    this.tools = Object.freeze(tools.sort(compare));
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== "function") throw new TypeError("Tool catalog listener must be a function.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyChanged(): void {
    for (const listener of [...this.listeners]) listener();
  }

  async list(request: ToolCatalogListRequest): Promise<ToolCatalogListResult> {
    const normalized = normalizeRequest(request);
    const limit = request.limit ?? toolCatalogLimits.maxPageSize;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > toolCatalogLimits.maxPageSize) {
      throw new ToolCatalogError("INVALID_REQUEST", "Tool catalog page size is invalid.");
    }
    const visible = (await Promise.all(this.tools.map((descriptor) => this.visible(descriptor, normalized))))
      .flatMap((allowed, index) => allowed ? [this.tools[index]!] : []);
    const cursors = await Promise.all(visible.map((descriptor) => cursorToken(descriptor)));
    const start = cursorOffset(request.cursor, cursors);
    const page = visible.slice(start, start + limit);
    const result: ToolCatalogListResult = {
      revision: `sha256:${await sha256(canonicalJson(visible))}`,
      tools: Object.freeze(page)
    };
    const nextCursor = cursors[start + page.length - 1];
    if (start + page.length < visible.length && nextCursor !== undefined) return Object.freeze({ ...result, nextCursor });
    return Object.freeze(result);
  }

  async lookup(id: string, version: number, request: ToolCatalogRequest): Promise<AgentToolDescriptor | undefined> {
    const normalized = normalizeRequest(request);
    if (typeof id !== "string" || typeof version !== "number" || !Number.isSafeInteger(version)) return undefined;
    const descriptor = this.tools.find((tool) => tool.id === id && tool.version === version);
    if (descriptor === undefined || !(await this.visible(descriptor, normalized))) return undefined;
    return descriptor;
  }

  private visible(descriptor: AgentToolDescriptor, request: ToolCatalogRequest): Promise<boolean> {
    if (!descriptorAllowed(descriptor, request)) return Promise.resolve(false);
    return Promise.resolve(this.policy.isVisible(Object.freeze({ ...request, descriptor }))).then((visible) => visible === true);
  }
}
