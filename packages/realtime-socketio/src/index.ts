import { createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { canonicalJson, DurableEventActorSchema } from "@k-nex/contracts";
import type { RealtimeActor, RealtimeGateway, RealtimeTopicDefinition, RealtimeTopicRegistry } from "@k-nex/runtime";
import { Server } from "socket.io";

const SUBSCRIBE = "k-nex:subscribe";
const UNSUBSCRIBE = "k-nex:unsubscribe";
const EVENT = "k-nex:event";

type SubscriptionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "AUTHENTICATION_REQUIRED" | "FORBIDDEN" | "INVALID_SUBSCRIPTION" | "TOPIC_NOT_FOUND" }>;

export interface SocketIoMemoryGatewayOptions {
  readonly httpServer: HttpServer;
  readonly topics: RealtimeTopicRegistry;
  authenticate(credentials: Readonly<Record<string, unknown>>): Promise<RealtimeActor | null>;
}

export interface SocketIoMemoryGateway extends RealtimeGateway {
  close(): Promise<void>;
}

function room(topicId: string, params: Readonly<Record<string, unknown>>): string {
  return `k-nex:${createHash("sha256").update(topicId).update("\0").update(canonicalJson(params)).digest("base64url")}`;
}

function request(value: unknown): { params: unknown; topicId: string } {
  if (typeof value !== "object" || value === null || Object.keys(value).sort().join("\0") !== "params\0topicId" ||
    !("topicId" in value) || typeof value.topicId !== "string" || !("params" in value)) {
    throw new TypeError("Invalid realtime subscription request.");
  }
  return { topicId: value.topicId, params: value.params };
}

function parse(topic: RealtimeTopicDefinition, value: unknown): Readonly<Record<string, unknown>> {
  const params = topic.parseParams(value);
  canonicalJson(params);
  return params;
}

function actor(value: RealtimeActor | null): RealtimeActor | null {
  if (!value) return null;
  const parsed = DurableEventActorSchema.safeParse({ id: value.id, type: value.type });
  return parsed.success ? Object.freeze({ id: parsed.data.id, type: parsed.data.type }) : null;
}

export function createSocketIoMemoryGateway(options: SocketIoMemoryGatewayOptions): SocketIoMemoryGateway {
  const io = new Server(options.httpServer, { serveClient: false });

  io.on("connection", (socket) => {
    const authenticatedActor = Promise.resolve()
      .then(() => options.authenticate(Object.freeze({ ...socket.handshake.auth })))
      .then(actor)
      .catch(() => null);

    socket.on(SUBSCRIBE, async (value: unknown, acknowledge: (result: SubscriptionResult) => void) => {
      if (typeof acknowledge !== "function") return;
      const currentActor = await authenticatedActor;
      if (!currentActor) {
        acknowledge(Object.freeze({ ok: false, code: "AUTHENTICATION_REQUIRED" }));
        return;
      }
      try {
        const subscription = request(value);
        const topic = options.topics.get(subscription.topicId);
        if (!topic) {
          acknowledge(Object.freeze({ ok: false, code: "TOPIC_NOT_FOUND" }));
          return;
        }
        const params = parse(topic, subscription.params);
        if (!await topic.authorize({ actor: currentActor, params })) {
          acknowledge(Object.freeze({ ok: false, code: "FORBIDDEN" }));
          return;
        }
        await socket.join(room(topic.id, params));
        acknowledge(Object.freeze({ ok: true }));
      } catch {
        acknowledge(Object.freeze({ ok: false, code: "INVALID_SUBSCRIPTION" }));
      }
    });

    socket.on(UNSUBSCRIBE, async (value: unknown, acknowledge: (result: SubscriptionResult) => void) => {
      if (typeof acknowledge !== "function") return;
      try {
        const subscription = request(value);
        const topic = options.topics.get(subscription.topicId);
        if (!topic) {
          acknowledge(Object.freeze({ ok: false, code: "TOPIC_NOT_FOUND" }));
          return;
        }
        const params = parse(topic, subscription.params);
        await socket.leave(room(topic.id, params));
        acknowledge(Object.freeze({ ok: true }));
      } catch {
        acknowledge(Object.freeze({ ok: false, code: "INVALID_SUBSCRIPTION" }));
      }
    });
  });

  return Object.freeze({
    mode: "memory" as const,
    topology: "single-process" as const,
    async publish(topicId: string, paramsValue: unknown, eventValue: unknown): Promise<void> {
      const topic = options.topics.get(topicId);
      if (!topic) throw new Error(`Realtime topic ${topicId} is not registered.`);
      const params = parse(topic, paramsValue);
      const event = topic.parseEvent(eventValue);
      io.to(room(topic.id, params)).emit(EVENT, Object.freeze({ topicId, event }));
    },
    close(): Promise<void> {
      return new Promise((resolve) => io.close(() => resolve()));
    }
  });
}
