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
  authenticationTimeoutMs: 20,
  allowedOrigins: ["https://app.example.test"],
  allowedTransports: ["websocket"],
  maxBufferedMessagesPerConnection: 2,
  maxConnections: 10,
  maxRequestBytes: 1_024,
  maxSubscriptionRequestsPerMinute: 20,
  maxSubscriptionsPerConnection: 2,
  revalidationIntervalMs: 60_000
} as const;

function publication(revision: number) {
  return {
    channel: { topicId: "sales.tasks", params: { ownerId: "owner-1" } },
    correlationId: `correlation-${revision}`,
    message: { revision },
    messageClass: "reconstructible-invalidation" as const
  };
}

function delivered(revision: number) {
  return {
    correlationId: `correlation-${revision}`,
    event: { revision },
    messageClass: "reconstructible-invalidation",
    topicId: "sales.tasks"
  };
}

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
    await active.gateway.publish(publication(2));
    await expect(received).resolves.toEqual(delivered(2));
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
    await expect(harness(null)).rejects.toThrow(/AUTHENTICATION_REQUIRED/);
    expect(gateway?.health()).toMatchObject({ authenticationDenied: 1, connections: 0 });
  });

  it("leaves a registered topic without accepting a raw room string", async () => {
    const active = await harness();
    const subscription = { topicId: "sales.tasks", params: { ownerId: "owner-1" } };
    await active.client.emitWithAck("k-nex:subscribe", subscription);
    await expect(active.client.emitWithAck("k-nex:unsubscribe", subscription)).resolves.toEqual({ ok: true });

    let delivered = false;
    active.client.once("k-nex:event", (_message, acknowledge) => { acknowledge(); delivered = true; });
    await active.gateway.publish(publication(3));
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
      active.gateway.publish(publication(4)),
      active.gateway.publish(publication(5))
    ]);
    await expect(received).resolves.toEqual(delivered(5));
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

  it("bounds pending authentication work before invoking the authenticator", async () => {
    httpServer = createServer();
    let authenticateCalls = 0;
    let releaseAuthentication = () => undefined;
    const barrier = new Promise<void>((resolve) => { releaseAuthentication = resolve; });
    gateway = createSocketIoMemoryGateway({
      httpServer,
      topics: createRealtimeTopicRegistry([topic, revenueTopic]),
      security: { ...security, authenticationTimeoutMs: 1_000, maxConnections: 1 },
      authenticate: async ({ actor }) => {
        authenticateCalls += 1;
        await barrier;
        return typeof actor === "string" ? { id: actor, type: "user" } : null;
      },
      isActorActive: async () => true
    });
    await new Promise((resolve) => httpServer?.listen(0, "127.0.0.1", resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const clients = Array.from({ length: 5 }, () => connect(`http://127.0.0.1:${port}`, {
      auth: { actor: "owner-1" },
      transports: ["websocket"],
      extraHeaders: { origin: "https://app.example.test" },
      reconnection: false
    }));
    const outcomes = clients.map((pendingClient) => new Promise<"connected" | "denied">((resolve) => {
      pendingClient.once("connect", () => resolve("connected"));
      pendingClient.once("connect_error", () => resolve("denied"));
    }));
    await expect.poll(() => gateway?.health()).toMatchObject({ connectionDenied: 4, connections: 0, pendingConnections: 1 });
    expect(authenticateCalls).toBe(1);
    releaseAuthentication();
    const results = await Promise.all(outcomes);
    expect(results.filter((result) => result === "connected")).toHaveLength(1);
    client = clients[results.indexOf("connected")];
    clients.forEach((pendingClient, index) => { if (index !== results.indexOf("connected")) pendingClient.disconnect(); });
    expect(gateway.health()).toMatchObject({ connections: 1, pendingConnections: 0 });
  });

  it("retains authentication slots after middleware disconnect and timeout until work settles", async () => {
    httpServer = createServer();
    const authenticationResolvers: Array<() => void> = [];
    let authenticateCalls = 0;
    gateway = createSocketIoMemoryGateway({
      httpServer,
      topics: createRealtimeTopicRegistry([topic]),
      security: { ...security, authenticationTimeoutMs: 20, maxConnections: 1 },
      authenticate: async () => {
        authenticateCalls += 1;
        await new Promise<void>((resolve) => authenticationResolvers.push(resolve));
        return { id: "owner-1", type: "user" };
      },
      isActorActive: async () => true
    });
    await new Promise((resolve) => httpServer?.listen(0, "127.0.0.1", resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const open = () => connect(`http://127.0.0.1:${port}`, {
      auth: { actor: "owner-1" },
      transports: ["websocket"],
      extraHeaders: { origin: "https://app.example.test" },
      reconnection: false
    });

    const disconnected = open();
    await expect.poll(() => authenticateCalls).toBe(1);
    disconnected.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateway.health()).toMatchObject({ connections: 0, pendingConnections: 1 });
    const deniedDuringDisconnect = open();
    const deniedDuringDisconnectOutcome = new Promise((resolve) => deniedDuringDisconnect.once("connect_error", resolve));
    await deniedDuringDisconnectOutcome;
    expect(authenticateCalls).toBe(1);
    authenticationResolvers[0]?.();
    await expect.poll(() => gateway?.health().pendingConnections).toBe(0);

    const timedOut = open();
    const timedOutOutcome = new Promise((resolve) => timedOut.once("connect_error", resolve));
    await expect.poll(() => authenticateCalls).toBe(2);
    await timedOutOutcome;
    expect(gateway.health()).toMatchObject({ connections: 0, pendingConnections: 1 });
    const deniedDuringTimeout = open();
    const deniedDuringTimeoutOutcome = new Promise((resolve) => deniedDuringTimeout.once("connect_error", resolve));
    await deniedDuringTimeoutOutcome;
    expect(authenticateCalls).toBe(2);
    authenticationResolvers[1]?.();
    await expect.poll(() => gateway?.health().pendingConnections).toBe(0);
    deniedDuringDisconnect.disconnect();
    timedOut.disconnect();
    deniedDuringTimeout.disconnect();
  });

  it("serializes concurrent subscription mutations before enforcing the per-connection limit", async () => {
    const active = await harness("owner-1", { maxSubscriptionsPerConnection: 1 });
    const results = await Promise.all([
      active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } }),
      active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.revenue", params: { ownerId: "owner-1" } })
    ]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results.filter(({ ok }) => !ok)).toEqual([{ ok: false, code: "LIMIT_EXCEEDED" }]);
    expect(active.gateway.health()).toMatchObject({ subscriptions: 1, subscriptionDenied: 1 });
  });

  it("automatically revalidates and removes revoked topic permission", async () => {
    const active = await harness("owner-1", { revalidationIntervalMs: 5 });
    await active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
    topicAllowed = false;
    await expect.poll(() => active.gateway.health().subscriptions).toBe(0);
    expect(active.client.connected).toBe(true);
  });

  it("rejects durable classes at the ephemeral realtime boundary", async () => {
    const active = await harness();
    await expect(active.gateway.publish({
      ...publication(1),
      messageClass: "durable-workflow"
    } as never)).rejects.toThrow();
  });

  it("rejects oversized publications", async () => {
    const active = await harness("owner-1", { maxRequestBytes: 100 });
    await expect(active.gateway.publish({
      ...publication(1),
      message: { revision: 1, padding: "x".repeat(200) }
    })).rejects.toThrow(/maxRequestBytes/);
    expect(active.gateway.health()).toMatchObject({ oversized: 1, published: 0 });
  });

  it("snapshots publication data before size validation and queued delivery", async () => {
    const active = await harness("owner-1", { maxRequestBytes: 200 });
    await active.client.emitWithAck("k-nex:subscribe", { topicId: "sales.tasks", params: { ownerId: "owner-1" } });
    const received = new Promise((resolve) => active.client.once("k-nex:event", (message, acknowledge) => {
      acknowledge();
      resolve(message);
    }));
    const mutable: { revision: number; padding?: string } = { revision: 9 };
    const publishing = active.gateway.publish({ ...publication(9), message: mutable });
    mutable.padding = "x".repeat(10_000);
    await publishing;
    await expect(received).resolves.toEqual(delivered(9));
    expect(active.gateway.health()).toMatchObject({ oversized: 0, published: 1 });
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
    await active.gateway.publish(publication(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disconnected = new Promise((resolve) => active.client.once("disconnect", resolve));
    await active.gateway.publish(publication(2));
    await disconnected;
    expect(active.gateway.health()).toMatchObject({ connections: 0, slowConsumerDisconnects: 1 });
  });

  it("allows an authorized client to reconnect and resubscribe after a stop-before-start rollout", async () => {
    const active = await harness();
    const disconnected = new Promise((resolve) => active.client.once("disconnect", resolve));
    await active.gateway.close();
    await disconnected;
    if (httpServer?.listening) await new Promise((resolve) => httpServer?.close(() => resolve(undefined)));
    gateway = undefined;
    httpServer = undefined;
    client = undefined;
    const replacement = await harness();
    await expect(replacement.client.emitWithAck("k-nex:subscribe", {
      topicId: "sales.tasks",
      params: { ownerId: "owner-1" }
    })).resolves.toEqual({ ok: true });
    const received = new Promise((resolve) => replacement.client.once("k-nex:event", (message, acknowledge) => {
      acknowledge();
      resolve(message);
    }));
    await replacement.gateway.publish(publication(8));
    await expect(received).resolves.toEqual(delivered(8));
  });
});
