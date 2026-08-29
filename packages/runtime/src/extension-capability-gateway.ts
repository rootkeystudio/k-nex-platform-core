import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@k-nex/contracts";

export const extensionCapabilityIds = [
  "records.query", "records.action", "app-storage.get", "app-storage.put", "app-storage.query", "app-storage.delete",
  "events.publish", "events.subscribe", "http-fetch.request", "files.read", "files.write", "jobs.schedule", "audit.emit"
] as const;

export type ExtensionCapabilityId = typeof extensionCapabilityIds[number];

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
  readonly capabilities: readonly ExtensionCapabilityId[];
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

export class ExtensionCapabilityError extends Error {
  constructor(readonly code: "TOKEN_INVALID" | "TOKEN_EXPIRED" | "IDENTITY_MISMATCH" | "CAPABILITY_DENIED" | "SEQUENCE_INVALID" | "PAYLOAD_INVALID" | "BUDGET_EXCEEDED", message: string) {
    super(message);
    this.name = "ExtensionCapabilityError";
  }
}

export interface ExtensionCapabilityClock { now(): Date; }

const idPattern = /^[a-z][a-z0-9-]{2,127}$/u;
const appIdPattern = /^app(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/u;
const actorPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,159}$/u;
const capabilitySet = new Set<string>(extensionCapabilityIds);

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
  const expectedKeys = ["actor", "appId", "applicationId", "capabilities", "correlationId", "environment", "expiresAt", "generationId", "invocationId", "issuedAt", "schemaVersion", "tokenId"];
  if (Object.keys(claims).sort().join("\0") !== expectedKeys.sort().join("\0") || claims.schemaVersion !== 1 ||
    typeof claims.applicationId !== "string" || !idPattern.test(claims.applicationId) || typeof claims.environment !== "string" || !/^[a-z][a-z0-9-]{1,63}$/u.test(claims.environment) ||
    typeof claims.appId !== "string" || !appIdPattern.test(claims.appId) || typeof claims.generationId !== "string" || !idPattern.test(claims.generationId) ||
    typeof claims.invocationId !== "string" || !idPattern.test(claims.invocationId) || typeof claims.tokenId !== "string" || !idPattern.test(claims.tokenId) ||
    typeof claims.correlationId !== "string" || !idPattern.test(claims.correlationId) || !Array.isArray(claims.capabilities) || claims.capabilities.length > 16 ||
    new Set(claims.capabilities).size !== claims.capabilities.length || claims.capabilities.some((capability) => typeof capability !== "string" || !capabilitySet.has(capability)) ||
    typeof claims.actor !== "object" || claims.actor === null || Array.isArray(claims.actor)) fail("TOKEN_INVALID", "Capability token claims are invalid.");
  const actor = claims.actor as Record<string, unknown>;
  const actorKeys = Object.keys(actor).sort().join("\0");
  if ((actorKeys !== "effectiveActorId\0principalId" && actorKeys !== "delegationId\0effectiveActorId\0principalId") ||
    typeof actor.principalId !== "string" || !actorPattern.test(actor.principalId) || typeof actor.effectiveActorId !== "string" || !actorPattern.test(actor.effectiveActorId) ||
    (actor.delegationId !== undefined && (typeof actor.delegationId !== "string" || !actorPattern.test(actor.delegationId)))) fail("TOKEN_INVALID", "Capability token actor is invalid.");
  parseTimestamp(claims.issuedAt);
  parseTimestamp(claims.expiresAt);
  return claims as unknown as ExtensionCapabilityClaims;
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

export class ExtensionCapabilityGateway {
  private readonly sequences = new Map<string, { sequence: number; expiresAt: number }>();

  constructor(
    private readonly tokens: HmacExtensionCapabilityTokens,
    private readonly handlers: Readonly<Partial<Record<ExtensionCapabilityId, ExtensionCapabilityHandler>>>,
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
    if (!claims.capabilities.includes(call.capability)) fail("CAPABILITY_DENIED", "Capability was not granted to this invocation.");
    const handler = this.handlers[call.capability];
    if (!handler) fail("CAPABILITY_DENIED", "Capability has no registered host handler.");
    this.removeExpiredSequences();
    const sequence = this.sequences.get(claims.tokenId)?.sequence ?? 0;
    if (!Number.isSafeInteger(call.sequence) || call.sequence !== sequence + 1 || call.sequence > this.limits.maxCalls) fail("SEQUENCE_INVALID", "Capability sequence is missing, replayed, or outside its call budget.");
    boundedJson(call.payload, this.limits.maxInputBytes, this.limits.maxDepth);
    const input = handler.validateInput(call.payload);
    this.sequences.set(claims.tokenId, { sequence: call.sequence, expiresAt: parseTimestamp(claims.expiresAt) });
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

  private removeExpiredSequences(): void {
    const now = this.clock.now().valueOf();
    for (const [tokenId, state] of this.sequences) if (state.expiresAt <= now) this.sequences.delete(tokenId);
  }
}
