import { describe, expect, it, vi } from "vitest";
import type { Payload } from "payload";

import { processNextPayloadOutboxEvent, readPayloadOutboxHealth } from "../src/outbox-processor.js";

const row = {
  event_id: "event-1",
  event_type: "sales.task.created",
  schema_version: 1,
  message_class: "durable-integration",
  occurred_at: "2026-08-26 12:00:00+00",
  application_id: "customer-gate-1",
  plugin_id: "module.sales",
  actor_id: "actor-1",
  actor_type: "user",
  impersonator_id: null,
  correlation_id: "correlation-1",
  causation_id: null,
  idempotency_key: "idempotency-1",
  payload: { taskId: "task-1" },
  checkpoint: { page: 2 },
  attempt_count: 1,
  claim_token: "claim-1"
};

function payload(execute: ReturnType<typeof vi.fn>): Payload {
  return { db: { drizzle: { execute } } } as unknown as Payload;
}

function sqlText(statement: unknown): string {
  if (typeof statement !== "object" || statement === null || !("queryChunks" in statement)) return "";
  return (statement as { queryChunks: unknown[] }).queryChunks.map((chunk) => {
    if (typeof chunk === "object" && chunk !== null && "value" in chunk && Array.isArray(chunk.value)) return chunk.value.join("");
    if (typeof chunk === "object" && chunk !== null && "queryChunks" in chunk) return sqlText(chunk);
    return "";
  }).join("");
}

function sqlValues(statement: unknown): unknown[] {
  if (typeof statement !== "object" || statement === null || !("queryChunks" in statement)) return [];
  return (statement as { queryChunks: unknown[] }).queryChunks.flatMap((chunk) => {
    if (typeof chunk !== "object" || chunk === null) return [chunk];
    if ("queryChunks" in chunk) return sqlValues(chunk);
    return [];
  });
}

describe("Payload outbox processor", () => {
  it("claims due or expired work with deterministic skip-locked leasing", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(processNextPayloadOutboxEvent({ payload: payload(execute), subscriber: async () => undefined })).resolves.toEqual({ status: "idle" });

    const claim = sqlText(execute.mock.calls[1]?.[0]);
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain(`"status" = 'pending'`);
    expect(claim).toContain(`"status" = 'processing'`);
    expect(claim).toContain("lease_expires_at");
    expect(claim).toContain("claim_token");
    expect(claim).toContain(`CASE WHEN "status" = 'pending' THEN "available_at" ELSE "lease_expires_at" END`);
  });

  it("delivers with a least-privileged actor, idempotency key, and durable checkpoint", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const subscriber = vi.fn(async (context) => {
      expect(context.actor).toEqual({ kind: "system", id: "outbox.processor" });
      expect(context.idempotencyKey).toBe("event-1");
      expect(context.checkpoint).toEqual({ page: 2 });
      await context.saveCheckpoint({ page: 3 });
    });

    await expect(processNextPayloadOutboxEvent({ payload: payload(execute), subscriber })).resolves.toEqual({
      eventId: "event-1",
      status: "delivered"
    });
    expect(subscriber).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(4);
    expect(sqlValues(execute.mock.calls[2]?.[0])).toContain("claim-1");
    expect(sqlValues(execute.mock.calls[3]?.[0])).toContain("claim-1");
  });

  it("rejects unsafe checkpoints and schedules bounded retry without persisting error text", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const secretMessage = "secret exception detail";

    await expect(processNextPayloadOutboxEvent({
      payload: payload(execute),
      subscriber: async ({ saveCheckpoint }) => saveCheckpoint({ password: secretMessage })
    })).resolves.toEqual({ eventId: "event-1", status: "retry-scheduled" });

    const failureValues = sqlValues(execute.mock.calls[2]?.[0]);
    expect(failureValues).toContain("DELIVERY_FAILED");
    expect(failureValues).not.toContain(secretMessage);
    expect(failureValues).toContain("pending");
  });

  it("dead-letters poison events at the configured attempt limit", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...row, attempt_count: 3 }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await expect(processNextPayloadOutboxEvent({
      payload: payload(execute),
      maxAttempts: 3,
      subscriber: async () => { throw new Error("poison"); }
    })).resolves.toEqual({ eventId: "event-1", status: "dead-lettered" });

    expect(sqlValues(execute.mock.calls[2]?.[0])).toContain("dead-letter");
  });

  it("cannot complete work after losing its claim token", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rowCount: 0 });

    await expect(processNextPayloadOutboxEvent({
      payload: payload(execute),
      subscriber: async () => undefined
    })).resolves.toEqual({ eventId: "event-1", status: "lease-lost" });
  });

  it("fails closed and schedules bounded retry for malformed persisted events", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...row, payload: { password: "forbidden" } }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await expect(processNextPayloadOutboxEvent({
      payload: payload(execute),
      subscriber: async () => undefined
    })).resolves.toEqual({ eventId: "event-1", status: "retry-scheduled" });
  });

  it("dead-letters an expired claim at the attempt ceiling without invoking the subscriber", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ event_id: "event-1" }] });
    const subscriber = vi.fn();

    await expect(processNextPayloadOutboxEvent({
      payload: payload(execute),
      maxAttempts: 3,
      subscriber
    })).resolves.toEqual({ eventId: "event-1", status: "dead-lettered" });

    expect(subscriber).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("dead-letters pending work stranded by a reduced attempt ceiling", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ event_id: "event-1" }] });
    const subscriber = vi.fn();

    await expect(processNextPayloadOutboxEvent({
      payload: payload(execute),
      maxAttempts: 2,
      subscriber
    })).resolves.toEqual({ eventId: "event-1", status: "dead-lettered" });

    expect(subscriber).not.toHaveBeenCalled();
    const statement = sqlText(execute.mock.calls[0]?.[0]);
    expect(statement).toContain(`"status" = 'pending'`);
    expect(statement).toContain(`"attempt_count" >=`);
  });

  it("reports backlog, expired leases, and dead letters", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{
      pending: 2,
      processing: 1,
      delivered: 5,
      dead_letter: 1,
      expired_leases: 1,
      oldest_pending_at: new Date("2026-08-26T10:00:00.000Z")
    }] });

    await expect(readPayloadOutboxHealth(payload(execute))).resolves.toEqual({
      pending: 2,
      processing: 1,
      delivered: 5,
      deadLetter: 1,
      expiredLeases: 1,
      oldestPendingAt: "2026-08-26T10:00:00.000Z"
    });
  });
});
