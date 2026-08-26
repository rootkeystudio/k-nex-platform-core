import { canonicalJson } from "@k-nex/contracts";

import { isDataSourceActorContext } from "./data-source-authorization.js";
import {
  DataSourceGatewayError,
  type CachePolicyEvaluator,
  type DataSourceExecutionContext,
  type DataSourceSuccessEnvelope
} from "./data-source-gateway.js";

export interface DataSourceCacheAuthorizationContext {
  /** Stable fingerprint covering permissions, policy, and relevant memberships. */
  readonly permissionFingerprint: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly publicationRevision?: string;
  readonly featureRevision?: string;
}

export interface InMemoryDataSourceCacheOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly envelope: DataSourceSuccessEnvelope;
}

const contextKeys = new Set(["permissionFingerprint", "locale", "timezone", "publicationRevision", "featureRevision"]);
const maxCacheKeyBytes = 1_048_576;

function cacheError(): DataSourceGatewayError {
  return new DataSourceGatewayError("INVALID_CACHE_CONTEXT", 500, "Data-source cache context is invalid.");
}

function authorizationContext(value: unknown): DataSourceCacheAuthorizationContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw cacheError();
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !contextKeys.has(key))) throw cacheError();
  for (const key of contextKeys) {
    const field = candidate[key];
    if (key === "permissionFingerprint") {
      if (typeof field !== "string" || field.length < 1 || field.length > 256) throw cacheError();
    } else if (field !== undefined && (typeof field !== "string" || field.length < 1 || field.length > 128)) {
      throw cacheError();
    }
  }
  return candidate as unknown as DataSourceCacheAuthorizationContext;
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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class InMemoryDataSourceCachePolicy implements CachePolicyEvaluator {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryDataSourceCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 1_000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1 || !Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new TypeError("Cache TTL and entry limit must be positive safe integers.");
    }
  }

  async lookup(context: DataSourceExecutionContext): Promise<DataSourceSuccessEnvelope | undefined> {
    const key = await this.key(context);
    if (key === undefined) return undefined;
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return frozenClone(entry.envelope);
  }

  async store(context: DataSourceExecutionContext, envelope: DataSourceSuccessEnvelope): Promise<void> {
    const key = await this.key(context);
    if (key === undefined) return;
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, envelope: frozenClone(envelope) });
  }

  private async key(context: DataSourceExecutionContext): Promise<string | undefined> {
    const descriptor = context.source.definition.descriptor;
    if (descriptor.cacheClass === "no-store") return undefined;
    if (!isDataSourceActorContext(context.authenticated.actor)) throw cacheError();
    if (descriptor.audience === "internal" && descriptor.cacheClass === "authorization-context") throw cacheError();

    const actor = context.authenticated.actor;
    const identity = authorizationContext(context.authenticated.authorizationContext);
    if (descriptor.cacheClass === "public") {
      const publicActor = actor.effectiveActor.kind === "public" || actor.effectiveActor.kind === "public-session";
      if (descriptor.audience !== "public" || context.surface !== "public" || !publicActor || actor.impersonation !== undefined) throw cacheError();
    }

    try {
      const canonical = canonicalJson({
        source: {
          id: descriptor.id,
          version: descriptor.version,
          structuralCompatibilityHash: descriptor.structuralCompatibilityHash,
          presentationMetadataRevision: descriptor.presentationMetadataRevision
        },
        cacheClass: descriptor.cacheClass,
        surface: context.surface,
        input: context.query.input,
        controls: context.query.controls,
        selectedFields: context.query.selectedFields,
        recordScope: context.query.recordScope,
        identity,
        actor: descriptor.cacheClass === "actor"
          ? actor
          : actor.impersonation === undefined
            ? null
            : actor
      });
      if (utf8ByteLength(canonical) > maxCacheKeyBytes) throw cacheError();
      return `sha256:${await sha256(canonical)}`;
    } catch {
      throw cacheError();
    }
  }
}
