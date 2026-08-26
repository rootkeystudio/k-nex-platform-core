import { ResourceIdSchema } from "@k-nex/contracts";

export const REALTIME_GATEWAY_CAPABILITY = "realtime.gateway";

export interface RealtimeActor {
  readonly id: string;
  readonly type: string;
}

export interface RealtimeSubscriptionContext<TParams extends Readonly<Record<string, unknown>>> {
  readonly actor: RealtimeActor;
  readonly params: TParams;
}

export interface RealtimeTopicDefinition<
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  TEvent = unknown
> {
  readonly id: string;
  authorize(context: RealtimeSubscriptionContext<TParams>): boolean | Promise<boolean>;
  parseEvent(value: unknown): TEvent;
  parseParams(value: unknown): TParams;
}

export interface RealtimeTopicRegistry {
  readonly definitions: readonly RealtimeTopicDefinition[];
  get(id: string): RealtimeTopicDefinition | undefined;
}

export interface RealtimeGateway {
  readonly mode: "memory";
  readonly topology: "single-process";
  publish(topicId: string, params: unknown, event: unknown): Promise<void>;
}

export function defineRealtimeTopic<
  TParams extends Readonly<Record<string, unknown>>,
  TEvent
>(definition: RealtimeTopicDefinition<TParams, TEvent>): RealtimeTopicDefinition<TParams, TEvent> {
  ResourceIdSchema.parse(definition.id);
  if (typeof definition.authorize !== "function" || typeof definition.parseEvent !== "function" || typeof definition.parseParams !== "function") {
    throw new TypeError("Realtime topics require authorize, parseEvent, and parseParams functions.");
  }
  return Object.freeze({ ...definition });
}

export function createRealtimeTopicRegistry(definitions: readonly RealtimeTopicDefinition[]): RealtimeTopicRegistry {
  const topics = new Map<string, RealtimeTopicDefinition>();
  for (const definition of definitions) {
    const topic = defineRealtimeTopic(definition);
    if (topics.has(topic.id)) throw new Error(`Realtime topic ${topic.id} is already registered.`);
    topics.set(topic.id, topic);
  }
  const frozen = Object.freeze([...topics.values()]);
  return Object.freeze({
    definitions: frozen,
    get(id: string) {
      return topics.get(id);
    }
  });
}
