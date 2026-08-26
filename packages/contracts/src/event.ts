import * as z from "zod";

import { assertJsonValue, canonicalJson } from "./canonical-json.js";
import { PluginIdSchema, ResourceIdSchema } from "./identity.js";

/** Event classes whose delivery is realtime-only and may be reconstructed or lost. */
export const realtimeEventClasses = ["ephemeral-hint", "reconstructible-invalidation"] as const;
/** Event classes whose intent must be durably persisted before publication. */
export const durableEventClasses = ["durable-integration", "durable-workflow"] as const;
/** All supported event durability classes. */
export const eventClasses = [...realtimeEventClasses, ...durableEventClasses] as const;

export const EventClassSchema = z.enum(eventClasses);
export const RealtimeEventClassSchema = z.enum(realtimeEventClasses);
export const DurableEventClassSchema = z.enum(durableEventClasses);

export type EventClass = (typeof eventClasses)[number];
export type RealtimeEventClass = (typeof realtimeEventClasses)[number];
export type DurableEventClass = (typeof durableEventClasses)[number];

/** Maximum serialized payload depth, measured from the payload object at depth zero. */
export const EVENT_PAYLOAD_MAX_DEPTH = 8;
/** Maximum UTF-8 byte length of a canonical serialized payload. */
export const EVENT_PAYLOAD_MAX_BYTES = 16 * 1024;

const EVENT_ID_MAX_LENGTH = 128;
const APPLICATION_ID_MAX_LENGTH = 128;
const PLUGIN_ID_MAX_LENGTH = 128;
const ACTOR_TYPE_MAX_LENGTH = 64;
const SCHEMA_VERSION_MAX = 1_000_000;
const applicationIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const controlFreeIdentifierPattern = /^(?!\s*$)[^\u0000-\u001F\u007F-\u009F]+$/;
const secretFieldNames = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "credential",
  "privatenote"
]);

const boundedIdSchema = (maximum: number) => z.string().min(1).max(maximum).regex(controlFreeIdentifierPattern);

const EventIdSchema = boundedIdSchema(EVENT_ID_MAX_LENGTH);
const EventTypeSchema = ResourceIdSchema.min(1).max(EVENT_ID_MAX_LENGTH);
const ApplicationIdSchema = z.string().min(1).max(APPLICATION_ID_MAX_LENGTH).regex(applicationIdPattern);
const EventPluginIdSchema = PluginIdSchema.max(PLUGIN_ID_MAX_LENGTH);
const ActorTypeSchema = boundedIdSchema(ACTOR_TYPE_MAX_LENGTH);
const EventTimestampSchema = z.iso.datetime({ offset: true }).max(64);
const EventSchemaVersionSchema = z.number().finite().int().min(1).max(SCHEMA_VERSION_MAX);

type PayloadValidationContext = Pick<z.RefinementCtx, "addIssue">;

function normalizedFieldName(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isEventSecretFieldName(key: string): boolean {
  return secretFieldNames.has(normalizedFieldName(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectPayload(value: unknown, context: PayloadValidationContext): void {
  if (!isPlainObject(value)) return;

  try {
    assertJsonValue(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Payload must be finite, acyclic, and plain JSON."
    });
    return;
  }

  let tooDeep = false;
  let secretField: string | undefined;

  const visit = (current: unknown, depth: number): void => {
    if (depth > EVENT_PAYLOAD_MAX_DEPTH) {
      tooDeep = true;
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child, depth + 1);
      return;
    }
    if (current === null || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (secretField === undefined && isEventSecretFieldName(key)) secretField = key;
      visit(child, depth + 1);
    }
  };

  visit(value, 0);
  if (tooDeep) {
    context.addIssue({ code: "custom", message: `Payload must not exceed depth ${EVENT_PAYLOAD_MAX_DEPTH}.` });
  }
  if (secretField !== undefined) {
    context.addIssue({ code: "custom", message: `Payload contains a secret-bearing field name: ${secretField}.` });
  }

  const serialized = canonicalJson(value);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > EVENT_PAYLOAD_MAX_BYTES) {
    context.addIssue({ code: "custom", message: `Payload must not exceed ${EVENT_PAYLOAD_MAX_BYTES} UTF-8 bytes when canonicalized.` });
  }
}

export const EventPayloadSchema = z.record(z.string(), z.unknown()).superRefine(inspectPayload);

export const DurableEventActorSchema = z.strictObject({
  id: EventIdSchema,
  type: ActorTypeSchema,
  impersonatorId: EventIdSchema.optional()
});

export const DurableEventEnvelopeSchema = z.strictObject({
  id: EventIdSchema,
  type: EventTypeSchema,
  schemaVersion: EventSchemaVersionSchema,
  messageClass: DurableEventClassSchema,
  occurredAt: EventTimestampSchema,
  applicationId: ApplicationIdSchema,
  pluginId: EventPluginIdSchema,
  actor: DurableEventActorSchema.optional(),
  correlationId: EventIdSchema,
  causationId: EventIdSchema.optional(),
  idempotencyKey: EventIdSchema.optional(),
  payload: EventPayloadSchema
}).meta({
  $id: "https://schemas.k-nex.dev/event/v1.json",
  title: "K-Nex durable event envelope v1"
});

export type DurableEventActor = z.infer<typeof DurableEventActorSchema>;
export type DurableEventEnvelope = z.infer<typeof DurableEventEnvelopeSchema>;
