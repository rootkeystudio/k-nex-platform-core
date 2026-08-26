import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import { createRealtimeTopicRegistry, defineRealtimeTopic } from "@k-nex/runtime";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import { createSocketIoMemoryGateway, type SocketIoMemoryGateway } from "../src/index.js";

const topic = defineRealtimeTopic({
  id: "sales.tasks",
  authorize: ({ actor, params }) => actor.id === params.ownerId,
  parseEvent(value) {
    if (typeof value !== "object" || value === null || !("revision" in value) || !Number.isSafeInteger(value.revision)) throw new TypeError();
    return value as { revision: number };
  },
  parseParams(value) {
    if (typeof value !== "object" || value === null || !("ownerId" in value) || typeof value.ownerId !== "string") throw new TypeError();
    return { ownerId: value.ownerId };
  }
});

let gateway: SocketIoMemoryGateway | undefined;
let httpServer: HttpServer | undefined;
let client: Socket | undefined;

afterEach(async () => {
  client?.disconnect();
  if (gateway) await gateway.close();
  if (httpServer?.listening) await new Promise((resolve) => httpServer?.close(() => resolve(undefined)));
  gateway = undefined;
  httpServer = undefined;
  client = undefined;
});

async function harness(actorId: unknown = "owner-1") {
  httpServer = createServer();
  gateway = createSocketIoMemoryGateway({
    httpServer,
    topics: createRealtimeTopicRegistry([topic]),
    authenticate: async ({ actor }) => typeof actor === "string" ? { id: actor, type: "user" } : null
  });
  await new Promise((resolve) => httpServer?.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  client = connect(`http://127.0.0.1:${port}`, { auth: { actor: actorId }, transports: ["websocket"] });
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

    const received = new Promise((resolve) => active.client.once("k-nex:event", resolve));
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
    active.client.once("k-nex:event", () => { delivered = true; });
    await active.gateway.publish("sales.tasks", subscription.params, { revision: 3 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(delivered).toBe(false);
  });
});
