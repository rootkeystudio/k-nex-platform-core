import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import { createRealtimeTopicRegistry, defineRealtimeTopic } from "@k-nex/runtime";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import { createSocketIoMemoryGateway, type SocketIoMemoryGateway } from "../src/index.js";

const topic = defineRealtimeTopic({
  id: "sales.tasks",
  authorize: ({ actor, params }) => topicAllowed && actor.id === params.ownerId,
  parseEvent(value) {
    if (typeof value !== "object" || value === null || !("revision" in value) || !Number.isSafeInteger(value.revision)) throw new TypeError();
    return value as { revision: number };
  },
  parseParams(value) {
    if (typeof value !== "object" || value === null || !("ownerId" in value) || typeof value.ownerId !== "string") throw new TypeError();
    return { ownerId: value.ownerId };
  }
});

const revenueTopic = defineRealtimeTopic({ ...topic, id: "sales.revenue" });

let gateway: SocketIoMemoryGateway | undefined;
let httpServer: HttpServer | undefined;
let client: Socket | undefined;
let actorActive = true;
let topicAllowed = true;

const security = {
  acknowledgementTimeoutMs: 20,
  allowedOrigins: ["https://app.example.test"],
  allowedTransports: ["websocket"],
  maxBufferedMessagesPerConnection: 2,
  maxConnections: 10,
  maxRequestBytes: 1_024,
  maxSubscriptionRequestsPerMinute: 20,
  maxSubscriptionsPerConnection: 2
} as const;

afterEach(async () => {
  client?.disconnect();
  if (gateway) await gateway.close();
  if (httpServer?.listening) await new Promise((resolve) => httpServer?.close(() => resolve(undefined)));
  gateway = undefined;
  httpServer = undefined;
  client = undefined;
  actorActive = true;
  topicAllowed = true;
});

async function harness(actorId: unknown = "owner-1", securityOverrides = {}, origin = "https://app.example.test") {
  httpServer = createServer();
  gateway = createSocketIoMemoryGateway({
    httpServer,
    topics: createRealtimeTopicRegistry([topic, revenueTopic]),
    security: { ...security, ...securityOverrides },
    authenticate: async ({ actor }) => typeof actor === "string" ? { id: actor, type: "user" } : null,
    isActorActive: async () => actorActive
  });
  await new Promise((resolve) => httpServer?.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  client = connect(`http://127.0.0.1:${port}`, {
    auth: { actor: actorId },
    transports: ["websocket"],
    extraHeaders: { origin }
  });
  await new Promise((resolve, reject) => {
    client?.once("connect", resolve);
    client?.once("connect_error", reject);
  });
  return { client, gateway };
}

describe("Socket.IO memory realtime gateway", () => {
  it("authorizes registered topics and publishes only to the derived room", async () => {
    const active = await harness();
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "owner-1" }
    })).resolves.toEqual({ ok: true });

    const received = new Promise((resolve) => active.client.once("k-nex:event", (message, acknowledge) => {
      acknowledge();
      resolve(message);
    }));
    await active.gateway.publish("sales.tasks", { ownerId: "owner-1" }, { revision: 2 });
    await expect(received).resolves.toEqual({ topicId: "sales.tasks", event: { revision: 2 } });
    expect(active.gateway.mode).toBe("memory");
    expect(active.gateway.topology).toBe("single-process");
  });

  it("rejects unknown, malformed, and unauthorized subscription requests without exposing rooms", async () => {
    const active = await harness("other-user");
    await expect(active.client.emitWithAck("k-nex:subscribe", { room: "sales.tasks:owner-1" })).resolves.toEqual({
      ok: false,
      code: "INVALID_SUBSCRIPTION"
    });
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "owner-1" },
      room: "sales.tasks:owner-1"
    })).resolves.toEqual({ ok: false, code: "INVALID_SUBSCRIPTION" });
    await expect(active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.unknown", params: {} })).resolves.toEqual({
      ok: false,
      code: "TOPIC_NOT_FOUND"
    });
    await expect(active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } })).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN"
    });
  });

  it("fails closed when authentication does not produce a valid actor", async () => {
    const active = await harness(null);
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "owner-1" }
    })).resolves.toEqual({ ok: false, code: "AUTHENTICATION_REQUIRED" });
  });

  it("leaves a registered topic without accepting a raw room string", async () => {
    const active = await harness();
    const subscription = { topicId: "sales.tasks", params: { ownerId: "owner-1" } };
    await active.client.emitWithAck("k-nex:subscribe", subscription);
    await expect(active.client.emitWithAck("k-nex:unsubscribe", subscription)).resolves.toEqual({ ok: true });

    let delivered = false;
    active.client.once("k-nex:event", (_message, acknowledge) => { acknowledge(); delivered = true; });
    await active.gateway.publish("sales.tasks", subscription.params, { revision: 3 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(delivered).toBe(false);
  });

  it("coalesces repeated invalidations and reports only counter health", async () => {
    const active = await harness();
    await active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
    const received = new Promise((resolve) => active.client.once("k-nex:event", (message, acknowledge) => {
      acknowledge();
      resolve(message);
    }));
    await Promise.all([
      active.gateway.publish("sales.tasks", { ownerId: "owner-1" }, { revision: 4 }),
      active.gateway.publish("sales.tasks", { ownerId: "owner-1" }, { revision: 5 })
    ]);
    await expect(received).resolves.toEqual({ topicId: "sales.tasks", event: { revision: 5 } });
    expect(active.gateway.health()).toMatchObject({ connections: 1, subscriptions: 1, coalesced: 1, published: 1 });
    expect(JSON.stringify(active.gateway.health())).not.toContain("owner-1");
  });

  it("enforces subscription rate and size limits", async () => {
    const active = await harness("owner-1", { maxSubscriptionRequestsPerMinute: 1, maxRequestBytes: 100 });
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "x".repeat(200) }
    })).resolves.toEqual({ ok: false, code: "LIMIT_EXCEEDED" });
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "owner-1" }
    })).resolves.toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(active.gateway.health()).toMatchObject({ oversized: 1, rateLimited: 1 });
  });

  it("disconnects revoked sessions during revalidation", async () => {
    const active = await harness();
    actorActive = false;
    const disconnected = new Promise((resolve) => active.client.once("disconnect", resolve));
    await active.gateway.revalidate();
    await disconnected;
    expect(active.gateway.health()).toMatchObject({ connections: 0, authenticationDenied: 1 });
  });

  it("rejects disallowed origins before a Socket.IO session is established", async () => {
    await expect(harness("owner-1", {}, "https://attacker.example.test")).rejects.toThrow();
    expect(gateway?.health()).toMatchObject({ connections: 0 });
  });

  it("rejects transports outside the configured allowlist", async () => {
    await harness();
    const port = (httpServer?.address() as AddressInfo).port;
    const polling = connect(`http://127.0.0.1:${port}`, {
      auth: { actor: "owner-1" },
      transports: ["polling"],
      extraHeaders: { origin: "https://app.example.test" },
      reconnection: false
    });
    await expect(new Promise((_resolve, reject) => polling.once("connect_error", reject))).rejects.toThrow();
    polling.disconnect();
  });

  it("bounds connections and subscriptions", async () => {
    const active = await harness("owner-1", { maxConnections: 1, maxSubscriptionsPerConnection: 1 });
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "owner-1" }
    })).resolves.toEqual({ ok: true });
    await expect(active.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.revenue",
      params: { ownerId: "owner-1" }
    })).resolves.toEqual({ ok: false, code: "LIMIT_EXCEEDED" });

    const port = (httpServer?.address() as AddressInfo).port;
    const second = connect(`http://127.0.0.1:${port}`, {
      auth: { actor: "owner-1" },
      transports: ["websocket"],
      extraHeaders: { origin: "https://app.example.test" },
      reconnection: false
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    second.disconnect();
    expect(active.gateway.health()).toMatchObject({ connections: 1, connectionDenied: 1, subscriptions: 1, subscriptionDenied: 1 });
  });

  it("rejects oversized publications", async () => {
    const active = await harness("owner-1", { maxRequestBytes: 100 });
    await expect(active.gateway.publish("sales.tasks", { ownerId: "owner-1" }, {
      revision: 1,
      padding: "x".repeat(200)
    })).rejects.toThrow(/maxRequestBytes/);
    expect(active.gateway.health()).toMatchObject({ oversized: 1, published: 0 });
  });

  it("removes subscriptions when topic permission is revoked", async () => {
    const active = await harness();
    await active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
    topicAllowed = false;
    await active.gateway.revalidate();
    expect(active.client.connected).toBe(true);
    expect(active.gateway.health()).toMatchObject({ subscriptions: 0, subscriptionDenied: 1 });
  });

  it("disconnects a slow consumer when its acknowledgement buffer is full", async () => {
    const active = await harness("owner-1", { maxBufferedMessagesPerConnection: 1, acknowledgementTimeoutMs: 100 });
    await active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
    active.client.on("k-nex:event", () => undefined);
    await active.gateway.publish("sales.tasks", { ownerId: "owner-1" }, { revision: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disconnected = new Promise((resolve) => active.client.once("disconnect", resolve));
    await active.gateway.publish("sales.tasks", { ownerId: "owner-1" }, { revision: 2 });
    await disconnected;
    expect(active.gateway.health()).toMatchObject({ connections: 0, slowConsumerDisconnects: 1 });
  });
});
