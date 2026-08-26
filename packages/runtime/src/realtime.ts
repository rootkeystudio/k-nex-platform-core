import { RealtimeEventClassSchema, ResourceIdSchema, type RealtimeEventClass } from "@k-nex/contracts";

export const REALTIME_GATEWAY_CAPABILITY = "realtime.gateway";

export interface RealtimeActor {
  readonly id: string;
  readonly type: string;
}

export interface RealtimeSubscriptionContext<TParams extends Readonly<Record<string, unknown>>> {
  readonly actor: RealtimeActor;
  readonly deadlineAt: number;
  readonly params: TParams;
  readonly signal: AbortSignal;
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
  publish(input: RealtimePublishInput): Promise<RealtimePublishResult>;
}

export interface RealtimeChannelRef {
  readonly params: unknown;
  readonly topicId: string;
}

export interface RealtimePublishInput {
  readonly channel: RealtimeChannelRef;
  readonly correlationId: string;
  readonly message: unknown;
  readonly messageClass: RealtimeEventClass;
}

export interface RealtimePublishResult {
  readonly accepted: true;
}

export function parseRealtimePublishInput(input: RealtimePublishInput): RealtimePublishInput {
  if (typeof input !== "object" || input === null || Object.keys(input).sort().join("\0") !== "channel\0correlationId\0message\0messageClass") {
    throw new TypeError("Realtime publication must use the classified gateway envelope.");
  }
  if (typeof input.channel !== "object" || input.channel === null ||
    Object.keys(input.channel).sort().join("\0") !== "params\0topicId" || typeof input.channel.topicId !== "string") {
    throw new TypeError("Realtime publication channel is invalid.");
  }
  ResourceIdSchema.parse(input.channel.topicId);
  RealtimeEventClassSchema.parse(input.messageClass);
  if (typeof input.correlationId !== "string" || input.correlationId.length < 1 || input.correlationId.length > 128 || /[\u0000-\u001F\u007F-\u009F]/u.test(input.correlationId)) {
    throw new TypeError("Realtime publication correlationId is invalid.");
  }
  return Object.freeze({
    channel: Object.freeze({ topicId: input.channel.topicId, params: input.channel.params }),
    correlationId: input.correlationId,
    message: input.message,
    messageClass: input.messageClass
  });
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
