import { canonicalJson } from "@k-nex/contracts";

import {
  ToolGatewayError,
  type ToolExecutionContext,
  type ToolIdempotencyClaim,
  type ToolIdempotencyCoordinator
} from "./tool-gateway.js";

export const toolIdempotencyLimits = Object.freeze({
  defaultRetentionMs: 15 * 60 * 1000,
  maxRetentionMs: 24 * 60 * 60 * 1000,
  maxKeyLength: 128,
  maxRecords: 10_000
} as const);

export interface ToolIdempotencyClock {
  now(): number;
}

export interface InMemoryToolIdempotencyOptions {
  readonly retentionMs?: number;
  readonly maxRecords?: number;
}

export class ToolIdempotencyInProgressError extends ToolGatewayError {
  constructor(readonly reference: string) {
    super(
      "IDEMPOTENCY_IN_PROGRESS",
      409,
      "An idempotent request is already in progress.",
      `The idempotent request is already in progress: ${reference}.`
    );
  }
}

export class ToolIdempotencyConflictError extends ToolGatewayError {
  constructor() {
    super("IDEMPOTENCY_KEY_REUSED", 409, "The idempotency key was already used with different request data.");
  }
}

function idempotencyError(code: string, status: number, detail: string): never {
  throw new ToolGatewayError(code, status, detail);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= toolIdempotencyLimits.maxKeyLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function clockNow(clock: ToolIdempotencyClock): number {
  const now = clock.now();
  if (!Number.isSafeInteger(now)) idempotencyError("IDEMPOTENCY_CLOCK_INVALID", 500, "The idempotency clock is invalid.");
  return now;
}

function snapshot<T>(value: T): T {
  let clone: unknown;
  try {
    clone = structuredClone(value);
  } catch {
    idempotencyError("IDEMPOTENCY_RESULT_INVALID", 500, "The idempotent result must be structured data.");
  }
  const seen = new Set<object>();
  const freeze = (child: unknown): void => {
    if (typeof child !== "object" || child === null || seen.has(child)) return;
    seen.add(child);
    for (const nested of Object.values(child)) freeze(nested);
    Object.freeze(child);
  };
  freeze(clone);
  return clone as T;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function inputDigest(input: unknown): Promise<string> {
  try {
    return sha256(canonicalJson(input));
  } catch {
    idempotencyError("IDEMPOTENCY_INPUT_INVALID", 400, "The idempotent input must be bounded JSON.");
  }
}

interface IdempotencyScope {
  readonly principalId: string;
  readonly applicationId: string;
}

interface IdempotencyEntry {
  readonly storageKey: string;
  readonly reference: string;
  readonly scope: IdempotencyScope;
  readonly toolId: string;
  readonly toolVersion: number;
  readonly idempotencyKey: string;
  readonly inputDigest: string;
  state: "pending" | "completed" | "uncertain";
  expiresAt: number;
  result?: unknown;
}

function scopeOf(context: ToolExecutionContext): IdempotencyScope {
  if (typeof context.delegation !== "object" || context.delegation === null || Array.isArray(context.delegation)) {
    idempotencyError("IDEMPOTENCY_CONTEXT_INVALID", 500, "The idempotency subject is invalid.");
  }
  const delegation = context.delegation as Record<string, unknown>;
  if (!validId(delegation.principalId) || !validId(delegation.applicationId)) {
    idempotencyError("IDEMPOTENCY_CONTEXT_INVALID", 500, "The idempotency subject is invalid.");
  }
  return Object.freeze({ principalId: delegation.principalId, applicationId: delegation.applicationId });
}

function keyOf(context: ToolExecutionContext): string {
  const key = context.request.idempotencyKey;
  if (!validId(key)) idempotencyError("IDEMPOTENCY_KEY_REQUIRED", 400, "A bounded idempotency key is required for writes.");
  if (key.length > toolIdempotencyLimits.maxKeyLength) {
    idempotencyError("IDEMPOTENCY_KEY_INVALID", 400, "The idempotency key is too long.");
  }
  if (context.request.tool.id !== context.descriptor.id || context.request.tool.version !== context.descriptor.version) {
    idempotencyError("IDEMPOTENCY_CONTEXT_INVALID", 500, "The idempotency tool context is inconsistent.");
  }
  return key;
}

function noOpClaim(): ToolIdempotencyClaim {
  return Object.freeze({
    context: Object.freeze({ status: "not-applicable" }),
    complete: (): void => undefined,
    fail: (): void => undefined
  });
}

function replayClaim(entry: IdempotencyEntry): ToolIdempotencyClaim {
  return Object.freeze({
    context: Object.freeze({ status: "replay", reference: entry.reference, inputDigest: entry.inputDigest }),
    replay: entry.result,
    complete: (): void => undefined,
    fail: (): void => undefined
  });
}

export class InMemoryToolIdempotencyCoordinator implements ToolIdempotencyCoordinator {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly retentionMs: number;
  private readonly maxRecords: number;

  constructor(
    private readonly clock: ToolIdempotencyClock,
    options: InMemoryToolIdempotencyOptions = {}
  ) {
    this.retentionMs = options.retentionMs ?? toolIdempotencyLimits.defaultRetentionMs;
    this.maxRecords = options.maxRecords ?? toolIdempotencyLimits.maxRecords;
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs < 1 || this.retentionMs > toolIdempotencyLimits.maxRetentionMs ||
      !Number.isSafeInteger(this.maxRecords) || this.maxRecords < 1 || this.maxRecords > toolIdempotencyLimits.maxRecords) {
      throw new TypeError("Idempotency retention and record limits must be positive safe integers.");
    }
  }

  async claim(context: ToolExecutionContext): Promise<ToolIdempotencyClaim> {
    if (context.descriptor.effect === "read-only") return noOpClaim();

    const now = clockNow(this.clock);
    this.purge(now);
    const scope = scopeOf(context);
    const idempotencyKey = keyOf(context);
    const digest = await inputDigest(context.input);
    const storageKey = [
      scope.applicationId,
      scope.principalId,
      context.descriptor.id,
      context.descriptor.version,
      idempotencyKey
    ].join("\u0000");
    const existing = this.entries.get(storageKey);
    if (existing !== undefined) {
      if (existing.inputDigest !== digest) {
        throw new ToolIdempotencyConflictError();
      }
      if (existing.state !== "completed") throw new ToolIdempotencyInProgressError(existing.reference);
      return replayClaim(existing);
    }
    if (this.entries.size >= this.maxRecords) {
      idempotencyError("IDEMPOTENCY_CAPACITY_EXCEEDED", 429, "The idempotency record limit was reached.");
    }

    const reference = await sha256(canonicalJson({
      applicationId: scope.applicationId,
      idempotencyKey,
      principalId: scope.principalId,
      tool: { id: context.descriptor.id, version: context.descriptor.version }
    }));
    const entry: IdempotencyEntry = {
      storageKey,
      reference,
      scope,
      toolId: context.descriptor.id,
      toolVersion: context.descriptor.version,
      idempotencyKey,
      inputDigest: digest,
      state: "pending",
      expiresAt: Number.POSITIVE_INFINITY
    };
    this.entries.set(storageKey, entry);
    let settled = false;
    return Object.freeze({
      context: Object.freeze({ status: "claimed", reference, inputDigest: digest }),
      complete: (result: unknown): void => {
        if (settled) return;
        if (this.entries.get(storageKey) !== entry || entry.state !== "pending") return;
        const stored = snapshot(result);
        const expiresAt = clockNow(this.clock) + this.retentionMs;
        if (!Number.isSafeInteger(expiresAt)) idempotencyError("IDEMPOTENCY_CLOCK_INVALID", 500, "The idempotency clock is invalid.");
        settled = true;
        entry.result = stored;
        entry.state = "completed";
        entry.expiresAt = expiresAt;
      },
      fail: (options: { readonly retain?: boolean } | undefined): void => {
        if (settled) return;
        settled = true;
        if (this.entries.get(storageKey) !== entry || entry.state !== "pending") return;
        if (options?.retain === true) {
          const expiresAt = clockNow(this.clock) + this.retentionMs;
          if (!Number.isSafeInteger(expiresAt)) idempotencyError("IDEMPOTENCY_CLOCK_INVALID", 500, "The idempotency clock is invalid.");
          entry.state = "uncertain";
          entry.expiresAt = expiresAt;
          return;
        }
        this.entries.delete(storageKey);
      }
    });
  }

  private purge(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.state !== "pending" && entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
