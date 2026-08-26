import { describe, expect, it } from "vitest";

import {
  DurableEventEnvelopeSchema,
  EVENT_PAYLOAD_MAX_BYTES,
  EVENT_PAYLOAD_MAX_DEPTH,
  durableEventClasses,
  eventClasses,
  realtimeEventClasses
} from "../src/event.js";

const baseEnvelope = {
  id: "event-1",
  type: "sales.task.created",
  schemaVersion: 1,
  messageClass: "durable-integration",
  occurredAt: "2026-08-26T12:00:00.000Z",
  applicationId: "customer-one",
  pluginId: "module.sales",
  actor: { id: "user-1", type: "user" },
  correlationId: "correlation-1",
  causationId: "event-0",
  idempotencyKey: "task-create-1",
  payload: { taskId: "task-1", status: "open" }
} as const;

function nestedPayload(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) value = { next: value };
  return value;
}

describe("durable event envelope v1", () => {
  it("exports the exact realtime and durable event classes", () => {
    expect(realtimeEventClasses).toEqual(["ephemeral-hint", "reconstructible-invalidation"]);
    expect(durableEventClasses).toEqual(["durable-integration", "durable-workflow"]);
    expect(eventClasses).toEqual([...realtimeEventClasses, ...durableEventClasses]);
  });

  it("accepts both durable event classes", () => {
    for (const messageClass of durableEventClasses) {
      expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, messageClass }).success).toBe(true);
    }
  });

  it("rejects realtime classes in the durable envelope", () => {
    for (const messageClass of realtimeEventClasses) {
      expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, messageClass }).success).toBe(false);
    }
  });

  it("rejects unknown envelope and actor fields", () => {
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, extra: true }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload: undefined }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      actor: { ...baseEnvelope.actor, extra: true }
    }).success).toBe(false);
  });

  it("rejects invalid IDs, versions, timestamps, and actor metadata", () => {
    for (const [field, value] of [
      ["id", ""],
      ["id", "   "],
      ["id", "event-\u0000-1"],
      ["type", ""],
      ["type", "sales task.created"],
      ["correlationId", "\n"],
      ["applicationId", "Customer-One"],
      ["applicationId", "customer_one"],
      ["pluginId", "module.sales\u0000"],
      ["schemaVersion", 0],
      ["schemaVersion", 1.5],
      ["schemaVersion", 1_000_001],
      ["occurredAt", "2026-08-26T12:00:00"]
    ] as const) {
      expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, [field]: value }).success).toBe(false);
    }

    const oversizedId = "x".repeat(129);
    for (const field of ["id", "correlationId", "causationId", "idempotencyKey"] as const) {
      expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, [field]: oversizedId }).success).toBe(false);
    }

    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      actor: { id: "", type: "user" }
    }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      actor: { id: oversizedId, type: "user" }
    }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      actor: { id: "user-1", type: "\u0000" }
    }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      actor: { id: "user-1", type: "user", impersonatorId: "   " }
    }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      actor: { id: "user-1", type: "user", impersonatorId: oversizedId }
    }).success).toBe(false);
  });

  it("requires canonical millisecond timestamp precision", () => {
    for (const occurredAt of [
      "2026-08-26T12:00:00Z",
      "2026-08-26T12:00:00.0Z",
      "2026-08-26T12:00:00.00Z",
      "2026-08-26T12:00:00.0000Z",
      "2026-08-26T12:00:00.000001+00:00"
    ]) expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, occurredAt }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, occurredAt: "2026-08-26T12:00:00.000Z" }).success).toBe(true);
  });

  it("rejects circular, non-plain, non-finite, and too-deep payloads", () => {
    const circular: Record<string, unknown> = { name: "task" };
    circular.self = circular;
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload: circular }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload: { createdAt: new Date() } }).success).toBe(false);
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload: { count: Number.NaN } }).success).toBe(false);
    for (const payload of [[], new Date(0), null]) {
      expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload }).success).toBe(false);
    }
    expect(DurableEventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      payload: nestedPayload(EVENT_PAYLOAD_MAX_DEPTH + 1)
    }).success).toBe(false);
  });

  it("rejects oversized and nested secret-bearing payload fields", () => {
    const oversized = { data: "x".repeat(EVENT_PAYLOAD_MAX_BYTES) };
    expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload: oversized }).success).toBe(false);

    for (const key of [
      "Authorization", "cookie", "pass-word", "-password-", "SECRET", "💣secret💣", "to.ken", "_token_", "api_key", "credential", "private-note",
      "accessToken", "access_token", "access-token", "refreshToken", "clientSecret", "sessionToken", "apiKeyValue",
      "credentials", "passwordHash", "authorizationHeader", "accessTokenValue", "refreshTokenValue", "clientSecretValue", "apiKeySecret"
    ]) {
      expect(DurableEventEnvelopeSchema.safeParse({
        ...baseEnvelope,
        payload: { outer: [{ nested: { [key]: "do-not-store" } }] }
      }).success).toBe(false);
    }
    for (const key of ["tokenCount", "token-count", "token_count", "tokenBudget", "token-budget", "token_budget", "secretary", "secretaryName", "monkey"]) {
      expect(DurableEventEnvelopeSchema.safeParse({ ...baseEnvelope, payload: { [key]: 1 } }).success).toBe(true);
    }
  });

  it("does not mutate the input envelope or payload", () => {
    const input = structuredClone(baseEnvelope);
    const snapshot = structuredClone(input);
    expect(DurableEventEnvelopeSchema.safeParse(input).success).toBe(true);
    expect(input).toEqual(snapshot);
  });
});
