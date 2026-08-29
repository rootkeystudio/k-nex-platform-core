import { createHmac, timingSafeEqual } from "node:crypto";

import {
  canonicalJson,
  ExtensionCapabilityRequestSchema,
  type ExtensionCapabilityRequest
} from "@k-nex/contracts";

export const extensionCapabilityIds = [
  "records.query", "records.action", "app-storage.get", "app-storage.put", "app-storage.query", "app-storage.delete",
  "events.publish", "events.subscribe", "http-fetch.request", "files.read", "files.write", "jobs.schedule", "audit.emit"
] as const;

export type ExtensionCapabilityId = typeof extensionCapabilityIds[number];
export type ExtensionCapabilityGrant = ExtensionCapabilityRequest;

export interface ExtensionActorIdentity {
  readonly principalId: string;
  readonly effectiveActorId: string;
  readonly delegationId?: string;
}

export interface ExtensionCapabilityClaims {
  readonly schemaVersion: 1;
  readonly tokenId: string;
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  readonly invocationId: string;
  readonly actor: ExtensionActorIdentity;
  readonly correlationId: string;
  /** A persisted lease acquired before a generation is superseded. */
  readonly drainLeaseId?: string;
  readonly grants: readonly ExtensionCapabilityGrant[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ExtensionCapabilityTokenRequest extends Omit<ExtensionCapabilityClaims, "schemaVersion" | "issuedAt" | "expiresAt"> {
  readonly ttlMs: number;
}

export interface ExtensionCapabilityCall {
  readonly token: string;
  readonly invocationId: string;
  readonly generationId: string;
  readonly sequence: number;
  readonly capability: ExtensionCapabilityId;
  readonly payload: unknown;
  readonly signal: AbortSignal;
}

export interface ExtensionCapabilityInvocationIdentity {
  readonly applicationId: string;
  readonly environment: string;
  readonly appId: string;
  readonly generationId: string;
  readonly invocationId: string;
}

export interface ExtensionCapabilityHandler {
  validateInput(value: unknown): unknown;
  invoke(context: ExtensionCapabilityClaims, input: unknown, signal: AbortSignal): unknown | Promise<unknown>;
  validateOutput(value: unknown): unknown;
}

/**
 * Resolves authority at the capability boundary. Tokens bind an invocation's
 * identity and closed grants, but this port decides whether that identity is
 * still current. Phase 10 supplies the durable policy implementation.
 */
export interface ExtensionCapabilityAuthority {
  reauthorize(claims: ExtensionCapabilityClaims): boolean | Promise<boolean>;
}

/**
 * Atomically advances one invocation's sequence. Production implementations
 * must persist this state; the test adapter below is deliberately in-memory.
 */
export interface ExtensionCapabilitySequenceStore {
  claim(claims: ExtensionCapabilityClaims, sequence: number, maxCalls: number): boolean | Promise<boolean>;
}

export class ExtensionCapabilityError extends Error {
  constructor(readonly code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "IDENTITY_MISMATCH" | "CAPABILITY_DENIED" | "AUTHORITY_DENIED" | "SEQUENCE_INVALID" | "PAYLOAD_INVALID" | "BUDGET_EXCEEDED", message: string) {
    super(message);
    this.name = "ExtensionCapabilityError";
  }
}

export interface ExtensionCapabilityClock { now(): Date; }

const idPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const appIdPattern = /^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const actorPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,159}$/u;
const drainLeasePattern = /^lease-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;

function fail(code: ExtensionCapabilityError["code"], message: string): never {
  throw new ExtensionCapabilityError(code, message);
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) fail("TOKEN_INVALID", "Capability token timestamp is invalid.");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail("TOKEN_INVALID", "Capability token timestamp is invalid.");
  return time;
}

function parseClaims(value: unknown): ExtensionCapabilityClaims {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("TOKEN_INVALID", "Capability token claims are invalid.");
  const claims = value as Record<string, unknown>;
  const expectedKeys = ["actor", "appId", "applicationId", "correlationId", "environment", "expiresAt", "generationId", "grants", "invocationId", "issuedAt", "schemaVersion", "tokenId"];
  const claimKeys = Object.keys(claims).sort().join("\0");
  const normalKeys = expectedKeys.sort().join("\0");
  const drainingKeys = [...expectedKeys, "drainLeaseId"].sort().join("\0");
  if ((claimKeys !== normalKeys && claimKeys !== drainingKeys) || claims.schemaVersion !== 1 ||
    typeof claims.applicationId !== "string" || !idPattern.test(claims.applicationId) || typeof claims.environment !== "string" || !/^[a-z][a-z0-9-]{1,63}$/u.test(claims.environment) ||
    typeof claims.appId !== "string" || !appIdPattern.test(claims.appId) || typeof claims.generationId !== "string" || !idPattern.test(claims.generationId) ||
    typeof claims.invocationId !== "string" || !idPattern.test(claims.invocationId) || typeof claims.tokenId !== "string" || !idPattern.test(claims.tokenId) ||
    typeof claims.correlationId !== "string" || !idPattern.test(claims.correlationId) ||
    (claims.drainLeaseId !== undefined && (typeof claims.drainLeaseId !== "string" || !drainLeasePattern.test(claims.drainLeaseId))) ||
    !Array.isArray(claims.grants) || claims.grants.length > 16 ||
    typeof claims.actor !== "object" || claims.actor === null || Array.isArray(claims.actor)) fail("TOKEN_INVALID", "Capability token claims are invalid.");
  const grants = claims.grants.map((grant) => {
    const parsed = ExtensionCapabilityRequestSchema.safeParse(grant);
    if (!parsed.success) fail("TOKEN_INVALID", "Capability token grants are invalid.");
    return parsed.data;
  });
  if (new Set(grants.map((grant) => canonicalJson(grant))).size !== grants.length) fail("TOKEN_INVALID", "Capability token grants must be unique.");
  const actor = claims.actor as Record<string, unknown>;
  const actorKeys = Object.keys(actor).sort().join("\0");
  if ((actorKeys !== "effectiveActorId\0principalId" && actorKeys !== "delegationId\0effectiveActorId\0principalId") ||
    typeof actor.principalId !== "string" || !actorPattern.test(actor.principalId) || typeof actor.effectiveActorId !== "string" || !actorPattern.test(actor.effectiveActorId) ||
    (actor.delegationId !== undefined && (typeof actor.delegationId !== "string" || !actorPattern.test(actor.delegationId)))) fail("TOKEN_INVALID", "Capability token actor is invalid.");
  parseTimestamp(claims.issuedAt);
  parseTimestamp(claims.expiresAt);
  return { ...claims, grants } as unknown as ExtensionCapabilityClaims;
}

function grantAllowsCapability(grant: ExtensionCapabilityGrant, capability: ExtensionCapabilityId): boolean {
  switch (capability) {
    case "records.query": return grant.kind === "records" && grant.operations.includes("query");
    case "records.action": return grant.kind === "records" && grant.operations.includes("action");
    case "app-storage.get": return grant.kind === "app-storage" && grant.operations.includes("get");
    case "app-storage.put": return grant.kind === "app-storage" && grant.operations.includes("put");
    case "app-storage.query": return grant.kind === "app-storage" && grant.operations.includes("query");
    case "app-storage.delete": return grant.kind === "app-storage" && grant.operations.includes("delete");
    case "events.publish": return grant.kind === "events" && grant.operations.includes("publish");
    case "events.subscribe": return grant.kind === "events" && grant.operations.includes("subscribe");
    case "http-fetch.request": return grant.kind === "http-fetch";
    case "files.read": return grant.kind === "files" && grant.operations.includes("read");
    case "files.write": return grant.kind === "files" && grant.operations.includes("write");
    case "jobs.schedule": return grant.kind === "jobs" && grant.operations.includes("schedule");
    case "audit.emit": return grant.kind === "audit" && grant.operations.includes("emit");
  }
  return false;
}

function signature(secret: Uint8Array, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function boundedJson(value: unknown, maximumBytes: number, maximumDepth: number): number {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maximumDepth) fail("BUDGET_EXCEEDED", "Capability payload nesting exceeds its budget.");
    if (typeof current.value !== "object" || current.value === null) continue;
    if (seen.has(current.value)) fail("PAYLOAD_INVALID", "Capability payload must be acyclic JSON.");
    seen.add(current.value);
    const values = Array.isArray(current.value) ? current.value : Object.values(current.value as Record<string, unknown>);
    for (const nested of values) pending.push({ value: nested, depth: current.depth + 1 });
  }
  let json: string;
  try { json = canonicalJson(value); } catch { fail("PAYLOAD_INVALID", "Capability payload must be canonical JSON."); }
  const bytes = Buffer.byteLength(json);
  if (bytes > maximumBytes) fail("BUDGET_EXCEEDED", "Capability payload size exceeds its budget.");
  return bytes;
}

export class HmacExtensionCapabilityTokens {
  constructor(private readonly secret: Uint8Array, private readonly clock: ExtensionCapabilityClock) {
    if (secret.byteLength < 32) throw new TypeError("Capability signing key must contain at least 32 bytes.");
  }

  issue(request: ExtensionCapabilityTokenRequest): string {
    const now = this.clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf()) || !Number.isSafeInteger(request.ttlMs) || request.ttlMs < 1 || request.ttlMs > 300_000) {
      throw new TypeError("Capability token lifetime is invalid.");
    }
    const { ttlMs: _, ...identity } = request;
    const claims = parseClaims({ ...identity, schemaVersion: 1, issuedAt: now.toISOString(), expiresAt: new Date(now.valueOf() + request.ttlMs).toISOString() });
    const payload = Buffer.from(canonicalJson(claims)).toString("base64url");
    return `v1.${payload}.${signature(this.secret, payload).toString("base64url")}`;
  }

  verify(token: string): ExtensionCapabilityClaims {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) fail("TOKEN_INVALID", "Capability token is malformed.");
    let supplied: Buffer;
    try { supplied = Buffer.from(parts[2], "base64url"); } catch { fail("TOKEN_INVALID", "Capability token signature is malformed."); }
    const expected = signature(this.secret, parts[1]);
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) fail("TOKEN_INVALID", "Capability token signature is invalid.");
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { fail("TOKEN_INVALID", "Capability token payload is invalid."); }
    const claims = parseClaims(parsed);
    const now = this.clock.now().valueOf();
    if (parseTimestamp(claims.issuedAt) > now || parseTimestamp(claims.expiresAt) <= now) fail("TOKEN_EXPIRED", "Capability token is outside its validity window.");
    return Object.freeze(claims);
  }
}

/** Test-only sequence store. Never use this adapter in a web, worker, or gateway process. */
export class InMemoryExtensionCapabilitySequenceStoreForTests implements ExtensionCapabilitySequenceStore {
  private readonly sequences = new Map<string, { sequence: number; expiresAt: number }>();

  constructor(private readonly clock: ExtensionCapabilityClock) {}

  claim(claims: ExtensionCapabilityClaims, sequence: number, maxCalls: number): boolean {
    const now = this.clock.now().valueOf();
    for (const [key, state] of this.sequences) if (state.expiresAt <= now) this.sequences.delete(key);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > maxCalls) return false;
    const key = canonicalJson([claims.applicationId, claims.environment, claims.appId, claims.generationId, claims.invocationId, claims.tokenId, claims.issuedAt, claims.actor]);
    const current = this.sequences.get(key)?.sequence ?? 0;
    if (sequence !== current + 1) return false;
    this.sequences.set(key, { sequence, expiresAt: parseTimestamp(claims.expiresAt) });
    return true;
  }
}

export class ExtensionCapabilityGateway {
  constructor(
    private readonly tokens: HmacExtensionCapabilityTokens,
    private readonly handlers: Readonly<Partial<Record<ExtensionCapabilityId, ExtensionCapabilityHandler>>>,
    private readonly authority: ExtensionCapabilityAuthority,
    private readonly sequences: ExtensionCapabilitySequenceStore,
    private readonly clock: ExtensionCapabilityClock,
    private readonly limits: Readonly<{ maxInputBytes: number; maxOutputBytes: number; maxDepth: number; maxCalls: number }>
  ) {
    if (![limits.maxInputBytes, limits.maxOutputBytes, limits.maxDepth, limits.maxCalls].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new TypeError("Capability gateway limits are invalid.");
    }
  }

  async invoke(call: ExtensionCapabilityCall): Promise<unknown> {
    const claims = this.tokens.verify(call.token);
    if (claims.invocationId !== call.invocationId || claims.generationId !== call.generationId) fail("IDENTITY_MISMATCH", "Capability invocation identity does not match its token.");
    if (!claims.grants.some((grant) => grantAllowsCapability(grant, call.capability))) fail("CAPABILITY_DENIED", "Capability operation was not granted to this invocation.");
    const handler = this.handlers[call.capability];
    if (!handler) fail("CAPABILITY_DENIED", "Capability has no registered host handler.");
    boundedJson(call.payload, this.limits.maxInputBytes, this.limits.maxDepth);
    const input = handler.validateInput(call.payload);
    if (!await this.authority.reauthorize(claims)) fail("AUTHORITY_DENIED", "Capability invocation no longer has current generation or actor authority.");
    if (!await this.sequences.claim(claims, call.sequence, this.limits.maxCalls)) fail("SEQUENCE_INVALID", "Capability sequence is missing, replayed, or outside its call budget.");
    const output = handler.validateOutput(await handler.invoke(claims, input, call.signal));
    boundedJson(output, this.limits.maxOutputBytes, this.limits.maxDepth);
    return output;
  }

  assertInvocationIdentity(token: string, identity: ExtensionCapabilityInvocationIdentity): ExtensionCapabilityClaims {
    const claims = this.tokens.verify(token);
    if (claims.applicationId !== identity.applicationId || claims.environment !== identity.environment || claims.appId !== identity.appId || claims.generationId !== identity.generationId || claims.invocationId !== identity.invocationId) {
      fail("IDENTITY_MISMATCH", "Runner invocation identity does not match its token.");
    }
    return claims;
  }
}
