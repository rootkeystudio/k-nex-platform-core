import { describe, expect, it, vi } from "vitest";

import { createOutboxRealtimeRelay } from "../src/outbox-realtime-relay.js";

const event = {
  id: "event-1",
  type: "sales.task.created",
  schemaVersion: 1,
  messageClass: "durable-workflow",
  occurredAt: "2026-08-26T12:00:00.000Z",
  applicationId: "customer-gate-1",
  pluginId: "module.sales",
  correlationId: "correlation-1",
  payload: { ownerId: "owner-1", revision: 2 }
} as const;

describe("outbox realtime relay", () => {
  it("projects a durable event through only the provider-neutral gateway and checkpoints after publication", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const saveCheckpoint = vi.fn().mockResolvedValue(undefined);
    const relay = createOutboxRealtimeRelay({
      gateway: { publish },
      project: (input) => ({ topicId: "sales.tasks", params: { ownerId: input.payload.ownerId }, event: { revision: input.payload.revision } })
    });

    await relay({ actor: { kind: "system", id: "outbox.processor" }, checkpoint: null, event, idempotencyKey: event.id, saveCheckpoint });

    expect(publish).toHaveBeenCalledWith("sales.tasks", { ownerId: "owner-1" }, { revision: 2 });
    expect(saveCheckpoint).toHaveBeenCalledWith({ realtimePublished: true });
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(saveCheckpoint.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not checkpoint a failed publication and skips an already published checkpoint", async () => {
    const publish = vi.fn().mockRejectedValue(new Error("backplane unavailable"));
    const saveCheckpoint = vi.fn();
    const relay = createOutboxRealtimeRelay({
      gateway: { publish },
      project: () => ({ topicId: "sales.tasks", params: {}, event: {} })
    });

    await expect(relay({ actor: { kind: "system", id: "outbox.processor" }, checkpoint: null, event, idempotencyKey: event.id, saveCheckpoint })).rejects.toThrow();
    expect(saveCheckpoint).not.toHaveBeenCalled();
    publish.mockClear();
    await relay({ actor: { kind: "system", id: "outbox.processor" }, checkpoint: { realtimePublished: true }, event, idempotencyKey: event.id, saveCheckpoint });
    expect(publish).not.toHaveBeenCalled();
  });
});
