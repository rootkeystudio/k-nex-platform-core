import { describe, expect, it, vi } from "vitest";
import type { PayloadRequest } from "payload";

import { writeTransactionalOutboxEvent } from "../src/transactional-outbox.js";

const event = {
  id: "event-1",
  type: "sales.task.created",
  schemaVersion: 1,
  messageClass: "durable-integration",
  occurredAt: "2026-08-26T12:00:00.000+00:00",
  applicationId: "customer-gate-1",
  pluginId: "module.sales",
  actor: { id: "actor-1", type: "user" },
  correlationId: "correlation-1",
  causationId: "event-previous",
  idempotencyKey: "idempotency-1",
  payload: { taskId: "task-1", status: "open" }
} as const;

function request(
  session: unknown,
  transactionID: unknown = "tx-1",
  adapterOverrides: Record<string, unknown> = {},
  drizzleExecute: ReturnType<typeof vi.fn> = vi.fn()
): PayloadRequest {
  return {
    transactionID,
    payload: {
      db: {
        sessions: session === undefined ? {} : { "tx-1": { db: session } },
        drizzle: { execute: drizzleExecute },
        ...adapterOverrides
      }
    }
  } as unknown as PayloadRequest;
}

describe("writeTransactionalOutboxEvent", () => {
  it("validates the event before touching the database", async () => {
    const execute = vi.fn();
    const drizzleExecute = vi.fn();
    const malformed = { ...event, payload: { password: "must-not-pass" } };

    await expect(writeTransactionalOutboxEvent({
      req: request({ execute }, "tx-1", {}, drizzleExecute),
      event: malformed,
      retentionUntil: "2026-08-27T12:00:00.000+00:00"
    })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(drizzleExecute).not.toHaveBeenCalled();
  });

  it("rejects without a request transaction or active session", async () => {
    const transactionExecute = vi.fn();
    const drizzleExecute = vi.fn();
    const missingTransaction = request({ execute: transactionExecute }, null, {}, drizzleExecute);
    const missingSession = request(undefined, "tx-1", {}, drizzleExecute);

    await expect(writeTransactionalOutboxEvent({
      req: missingTransaction,
      event,
      retentionUntil: "2026-08-27T12:00:00.000+00:00"
    })).rejects.toThrow(/active Payload transaction/);
    await expect(writeTransactionalOutboxEvent({
      req: missingSession,
      event,
      retentionUntil: "2026-08-27T12:00:00.000+00:00"
    })).rejects.toThrow(/active Postgres transaction session/);
    expect(transactionExecute).not.toHaveBeenCalled();
    expect(drizzleExecute).not.toHaveBeenCalled();
  });

  it("executes the parameterized insert on the active session database only", async () => {
    const transactionExecute = vi.fn(async () => undefined);
    const drizzleExecute = vi.fn();

    await writeTransactionalOutboxEvent({
      req: request({ execute: transactionExecute }, "tx-1", {}, drizzleExecute),
      event,
      retentionUntil: "2026-08-27T12:00:00.000+00:00"
    });

    expect(transactionExecute).toHaveBeenCalledOnce();
    expect(drizzleExecute).not.toHaveBeenCalled();
    const statement = transactionExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] };
    expect(statement.queryChunks).toBeDefined();
    expect(statement.queryChunks?.length).toBeGreaterThan(0);
  });

  it("rejects invalid or non-increasing retention instants", async () => {
    const execute = vi.fn();
    const drizzleExecute = vi.fn();
    const req = request({ execute }, "tx-1", {}, drizzleExecute);

    await expect(writeTransactionalOutboxEvent({ req, event, retentionUntil: "2026-08-27" })).rejects.toThrow();
    await expect(writeTransactionalOutboxEvent({
      req,
      event,
      retentionUntil: "2026-08-26T12:00:00.000+00:00"
    })).rejects.toThrow(/strictly after/);
    for (const invalidEventTimestamp of ["2026-08-26T12:00:00Z", "2026-08-26T12:00:00.000001Z"]) {
      await expect(writeTransactionalOutboxEvent({
        req,
        event: { ...event, occurredAt: invalidEventTimestamp },
        retentionUntil: "2026-08-27T12:00:00.000Z"
      })).rejects.toThrow();
    }
    for (const invalidRetentionTimestamp of ["2026-08-27T12:00:00Z", "2026-08-27T12:00:00.000001Z"]) {
      await expect(writeTransactionalOutboxEvent({ req, event, retentionUntil: invalidRetentionTimestamp })).rejects.toThrow();
    }
    expect(execute).not.toHaveBeenCalled();
    expect(drizzleExecute).not.toHaveBeenCalled();
  });
});
