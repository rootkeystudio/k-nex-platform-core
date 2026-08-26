import * as z from "zod";

import { assertJsonValue, canonicalJson, type JsonValue } from "./canonical-json.js";
import { DataSourceSourceSchemaSchema, dataSourcePlatformCeilings, dataSourceSurfaces } from "./data-source.js";
import { TableFieldIdSchema } from "./table-records.js";

/** Headless states a source binding may expose to a consumer. */
export const dataSourceBindingStates = [
  "idle",
  "loading",
  "success",
  "empty",
  "forbidden",
  "insufficient-permission",
  "invalid-contract",
  "rate-limited",
  "error",
  "stale",
  "refetching"
] as const;

export const DataSourceBindingStateSchema = z.enum(dataSourceBindingStates);
export type DataSourceBindingState = (typeof dataSourceBindingStates)[number];

const revisionSchema = z.string().min(1).max(256);
const contextValueSchema = z.string().min(1).max(128);
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/**
 * A cache/deduplication boundary that is safe to share in a client query key.
 * Fingerprints and revisions are opaque; role labels are not accepted as a
 * substitute for an authorization boundary by this contract.
 */
export const DataSourceAuthorizationBoundarySchema = z.discriminatedUnion("kind", [
  // Actor fingerprints cover principal, effective actor, and impersonation state.
  z.strictObject({ kind: z.literal("no-store"), actorFingerprint: fingerprintSchema }),
  z.strictObject({ kind: z.literal("actor"), actorFingerprint: fingerprintSchema }),
  // Authorization-context fingerprints cover relevant policy, permission, and membership revisions.
  z.strictObject({ kind: z.literal("authorization-context"), fingerprint: fingerprintSchema }),
  z.strictObject({ kind: z.literal("public"), revision: revisionSchema })
]);

export type DataSourceAuthorizationBoundary = z.infer<typeof DataSourceAuthorizationBoundarySchema>;

const jsonValueSchema = z.custom<JsonValue>((value) => {
  try {
    assertJsonValue(value);
    return true;
  } catch {
    return false;
  }
}, "Value must be a finite, acyclic JSON value.");

const uniqueSelectedFields = (fields: readonly string[], context: z.RefinementCtx): void => {
  if (new Set(fields).size !== fields.length) {
    context.addIssue({ code: "custom", message: "Selected fields must be unique." });
  }
};

/** Unhashed, validated dimensions used to construct a stable client query key. */
export const DataSourceQueryIdentityInputSchema = z.strictObject({
  source: DataSourceSourceSchemaSchema,
  input: jsonValueSchema,
  selectedFields: z.array(TableFieldIdSchema).max(dataSourcePlatformCeilings.selectedFields).superRefine(uniqueSelectedFields),
  surface: z.enum(dataSourceSurfaces),
  /** Set to null when the source does not interpret locale semantically. */
  locale: contextValueSchema.nullable().default(null),
  /** Set to null when the source does not interpret timezone semantically. */
  timezone: contextValueSchema.nullable().default(null),
  publicationRevision: revisionSchema.nullable().default(null),
  authorizationBoundary: DataSourceAuthorizationBoundarySchema
});

export type DataSourceQueryIdentityInput = z.input<typeof DataSourceQueryIdentityInputSchema>;
export type DataSourceQueryIdentityDimensions = z.output<typeof DataSourceQueryIdentityInputSchema>;

/**
 * A validated identity plus its canonical, browser-safe deduplication key.
 * The key intentionally remains canonical JSON instead of exposing a hash
 * implementation or a cache-library key type to consumers.
 */
export type DataSourceQueryIdentity = DataSourceQueryIdentityDimensions & {
  readonly key: string;
};

/** Maximum canonical identity size, matching the platform request-body ceiling. */
export const DATA_SOURCE_QUERY_IDENTITY_MAX_BYTES = dataSourcePlatformCeilings.bodyBytes;

function freezeJson<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Validates untrusted identity dimensions and returns an immutable canonical
 * identity. A malformed or oversized identity fails before it can be used for
 * client deduplication or cache lookup.
 */
export function createDataSourceQueryIdentity(value: unknown): DataSourceQueryIdentity {
  const parsed = DataSourceQueryIdentityInputSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Data-source query identity is invalid.");

  const dimensions = structuredClone(parsed.data);
  const key = canonicalJson(dimensions);
  if (utf8ByteLength(key) > DATA_SOURCE_QUERY_IDENTITY_MAX_BYTES) {
    throw new RangeError("Data-source query identity exceeds the platform size limit.");
  }

  const identity = {
    ...dimensions,
    key
  } as DataSourceQueryIdentity;
  return freezeJson(identity);
}

export interface DataSourceBindingProblem {
  readonly code: string;
  readonly status: 403 | 429 | 500 | 502 | 503 | 504;
}

export type DataSourceBindingResult<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "success"; readonly data: T }
  | { readonly state: "empty" }
  | { readonly state: "forbidden"; readonly problem: DataSourceBindingProblem }
  | { readonly state: "insufficient-permission"; readonly problem: DataSourceBindingProblem }
  | { readonly state: "invalid-contract"; readonly problem: DataSourceBindingProblem }
  | { readonly state: "rate-limited"; readonly problem: DataSourceBindingProblem; readonly retryAfterMs?: number }
  | { readonly state: "error"; readonly problem: DataSourceBindingProblem }
  | { readonly state: "stale"; readonly data: T }
  | { readonly state: "refetching"; readonly data: T };
