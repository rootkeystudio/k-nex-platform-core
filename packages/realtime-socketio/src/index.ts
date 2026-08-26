import { createHash } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { canonicalJson, DurableEventActorSchema } from "@k-nex/contracts";
import type { RealtimeActor, RealtimeGateway, RealtimeTopicDefinition, RealtimeTopicRegistry } from "@k-nex/runtime";
import { Server, type Socket } from "socket.io";

const SUBSCRIBE = "k-nex:subscribe";
const UNSUBSCRIBE = "k-nex:unsubscribe";
const EVENT = "k-nex:event";

type SubscriptionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "AUTHENTICATION_REQUIRED" | "FORBIDDEN" | "INVALID_SUBSCRIPTION" | "LIMIT_EXCEEDED" | "RATE_LIMITED" | "TOPIC_NOT_FOUND" }>;

export interface SocketIoMemorySecurityOptions {
  readonly acknowledgementTimeoutMs: number;
  readonly allowedOrigins: readonly string[];
  readonly allowedTransports: readonly ("polling" | "websocket")[];
  readonly maxBufferedMessagesPerConnection: number;
  readonly maxConnections: number;
  readonly maxRequestBytes: number;
  readonly maxSubscriptionRequestsPerMinute: number;
  readonly maxSubscriptionsPerConnection: number;
}

export interface SocketIoMemoryGatewayOptions {
  readonly httpServer: HttpServer;
  readonly security: SocketIoMemorySecurityOptions;
  readonly topics: RealtimeTopicRegistry;
  authenticate(credentials: Readonly<Record<string, unknown>>): Promise<RealtimeActor | null>;
  isActorActive(actor: RealtimeActor): Promise<boolean>;
}

export interface SocketIoMemoryGatewayHealth {
  readonly authenticationDenied: number;
  readonly coalesced: number;
  readonly connections: number;
  readonly connectionDenied: number;
  readonly oversized: number;
  readonly published: number;
  readonly rateLimited: number;
  readonly slowConsumerDisconnects: number;
  readonly subscriptionDenied: number;
  readonly subscriptions: number;
}

export interface SocketIoMemoryGateway extends RealtimeGateway {
  close(): Promise<void>;
  health(): SocketIoMemoryGatewayHealth;
  revalidate(): Promise<void>;
}

interface Subscription {
  readonly params: Readonly<Record<string, unknown>>;
  readonly topic: RealtimeTopicDefinition;
}

interface Session {
  readonly actor: RealtimeActor;
  pendingAcknowledgements: number;
  readonly socket: Socket;
  readonly subscriptions: Map<string, Subscription>;
}

interface Publication {
  readonly message: Readonly<{ event: unknown; topicId: string }>;
  readonly room: string;
}

function positiveInteger(value: number, name: string, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
  return value;
}

function security(value: SocketIoMemorySecurityOptions): SocketIoMemorySecurityOptions {
  const origins = [...new Set(value.allowedOrigins.map((origin) => new URL(origin).origin))];
  if (origins.length === 0) throw new RangeError("allowedOrigins must not be empty.");
  const transports = [...new Set(value.allowedTransports)];
  if (transports.length === 0 || transports.some((transport) => transport !== "polling" && transport !== "websocket")) {
    throw new RangeError("allowedTransports must contain polling or websocket.");
  }
  return Object.freeze({
    acknowledgementTimeoutMs: positiveInteger(value.acknowledgementTimeoutMs, "acknowledgementTimeoutMs", 60_000),
    allowedOrigins: Object.freeze(origins),
    allowedTransports: Object.freeze(transports),
    maxBufferedMessagesPerConnection: positiveInteger(value.maxBufferedMessagesPerConnection, "maxBufferedMessagesPerConnection", 10_000),
    maxConnections: positiveInteger(value.maxConnections, "maxConnections"),
    maxRequestBytes: positiveInteger(value.maxRequestBytes, "maxRequestBytes", 1_000_000),
    maxSubscriptionRequestsPerMinute: positiveInteger(value.maxSubscriptionRequestsPerMinute, "maxSubscriptionRequestsPerMinute", 100_000),
    maxSubscriptionsPerConnection: positiveInteger(value.maxSubscriptionsPerConnection, "maxSubscriptionsPerConnection", 10_000)
  });
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

function byteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

export function createSocketIoMemoryGateway(options: SocketIoMemoryGatewayOptions): SocketIoMemoryGateway {
  const limits = security(options.security);
  const counters = {
    authenticationDenied: 0,
    coalesced: 0,
    connectionDenied: 0,
    oversized: 0,
    published: 0,
    rateLimited: 0,
    slowConsumerDisconnects: 0,
    subscriptionDenied: 0
  };
  let connections = 0;
  let flushScheduled = false;
  const sessions = new Map<string, Session>();
  const publications = new Map<string, Publication>();
  const io = new Server(options.httpServer, {
    serveClient: false,
    transports: [...limits.allowedTransports],
    allowRequest(requestValue, callback) {
      const origin = requestValue.headers.origin;
      callback(null, typeof origin === "string" && limits.allowedOrigins.includes(origin));
    }
  });

  const flush = (): void => {
    flushScheduled = false;
    const pending = [...publications.values()];
    publications.clear();
    for (const publication of pending) {
      for (const session of sessions.values()) {
        if (!session.subscriptions.has(publication.room)) continue;
        if (session.pendingAcknowledgements >= limits.maxBufferedMessagesPerConnection) {
          counters.slowConsumerDisconnects += 1;
          session.socket.disconnect(true);
          continue;
        }
        session.pendingAcknowledgements += 1;
        counters.published += 1;
        session.socket.timeout(limits.acknowledgementTimeoutMs).emit(EVENT, publication.message, (error: Error | null) => {
          session.pendingAcknowledgements = Math.max(0, session.pendingAcknowledgements - 1);
          if (error && session.socket.connected) {
            counters.slowConsumerDisconnects += 1;
            session.socket.disconnect(true);
          }
        });
      }
    }
  };

  io.on("connection", (socket) => {
    connections += 1;
    socket.once("disconnect", () => {
      connections = Math.max(0, connections - 1);
      sessions.delete(socket.id);
    });
    if (connections > limits.maxConnections) {
      counters.connectionDenied += 1;
      socket.disconnect(true);
      return;
    }
    let requestCount = 0;
    let requestWindowStartedAt = Date.now();
    const authenticatedSession = Promise.resolve()
      .then(() => options.authenticate(Object.freeze({ ...socket.handshake.auth })))
      .then(actor)
      .then((authenticatedActor): Session | null => {
        if (!authenticatedActor) {
          counters.authenticationDenied += 1;
          return null;
        }
        const session = { actor: authenticatedActor, pendingAcknowledgements: 0, socket, subscriptions: new Map() };
        sessions.set(socket.id, session);
        return session;
      })
      .catch(() => {
        counters.authenticationDenied += 1;
        return null;
      });

    const consumeRequest = (value: unknown): SubscriptionResult | null => {
      const now = Date.now();
      if (now - requestWindowStartedAt >= 60_000) {
        requestWindowStartedAt = now;
        requestCount = 0;
      }
      requestCount += 1;
      if (requestCount > limits.maxSubscriptionRequestsPerMinute) {
        counters.rateLimited += 1;
        return Object.freeze({ ok: false, code: "RATE_LIMITED" });
      }
      try {
        if (byteLength(value) > limits.maxRequestBytes) {
          counters.oversized += 1;
          return Object.freeze({ ok: false, code: "LIMIT_EXCEEDED" });
        }
      } catch {
        return Object.freeze({ ok: false, code: "INVALID_SUBSCRIPTION" });
      }
      return null;
    };

    socket.on(SUBSCRIBE, async (value: unknown, acknowledge: (result: SubscriptionResult) => void) => {
      if (typeof acknowledge !== "function") return;
      const rejected = consumeRequest(value);
      if (rejected) {
        acknowledge(rejected);
        return;
      }
      const session = await authenticatedSession;
      if (!session) {
        acknowledge(Object.freeze({ ok: false, code: "AUTHENTICATION_REQUIRED" }));
        return;
      }
      try {
        const subscription = request(value);
        const topic = options.topics.get(subscription.topicId);
        if (!topic) {
          counters.subscriptionDenied += 1;
          acknowledge(Object.freeze({ ok: false, code: "TOPIC_NOT_FOUND" }));
          return;
        }
        const params = parse(topic, subscription.params);
        const roomId = room(topic.id, params);
        if (!session.subscriptions.has(roomId) && session.subscriptions.size >= limits.maxSubscriptionsPerConnection) {
          counters.subscriptionDenied += 1;
          acknowledge(Object.freeze({ ok: false, code: "LIMIT_EXCEEDED" }));
          return;
        }
        if (!await topic.authorize({ actor: session.actor, params })) {
          counters.subscriptionDenied += 1;
          acknowledge(Object.freeze({ ok: false, code: "FORBIDDEN" }));
          return;
        }
        await socket.join(roomId);
        session.subscriptions.set(roomId, { topic, params });
        acknowledge(Object.freeze({ ok: true }));
      } catch {
        counters.subscriptionDenied += 1;
        acknowledge(Object.freeze({ ok: false, code: "INVALID_SUBSCRIPTION" }));
      }
    });

    socket.on(UNSUBSCRIBE, async (value: unknown, acknowledge: (result: SubscriptionResult) => void) => {
      if (typeof acknowledge !== "function") return;
      const rejected = consumeRequest(value);
      if (rejected) {
        acknowledge(rejected);
        return;
      }
      const session = await authenticatedSession;
      if (!session) {
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
        const roomId = room(topic.id, parse(topic, subscription.params));
        await socket.leave(roomId);
        session.subscriptions.delete(roomId);
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
      const message = Object.freeze({ topicId, event });
      if (byteLength(message) > limits.maxRequestBytes) {
        counters.oversized += 1;
        throw new RangeError("Realtime message exceeds maxRequestBytes.");
      }
      const roomId = room(topic.id, params);
      if (publications.has(roomId)) counters.coalesced += 1;
      publications.set(roomId, { room: roomId, message });
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    },
    health(): SocketIoMemoryGatewayHealth {
      return Object.freeze({
        ...counters,
        connections,
        subscriptions: [...sessions.values()].reduce((total, session) => total + session.subscriptions.size, 0)
      });
    },
    async revalidate(): Promise<void> {
      for (const session of [...sessions.values()]) {
        let active = false;
        try {
          active = await options.isActorActive(session.actor);
        } catch {
          active = false;
        }
        if (!active) {
          counters.authenticationDenied += 1;
          session.socket.disconnect(true);
          continue;
        }
        for (const [roomId, subscription] of session.subscriptions) {
          let allowed = false;
          try {
            allowed = await subscription.topic.authorize({ actor: session.actor, params: subscription.params });
          } catch {
            allowed = false;
          }
          if (!allowed) {
            counters.subscriptionDenied += 1;
            await session.socket.leave(roomId);
            session.subscriptions.delete(roomId);
          }
        }
      }
    },
    close(): Promise<void> {
      return new Promise((resolve) => io.close(() => resolve()));
    }
  });
}
