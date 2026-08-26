import type { DurableEventEnvelope } from "@k-nex/contracts";
import type { RealtimeGateway } from "@k-nex/runtime";

import type { OutboxSubscriber } from "./outbox-processor.js";

export interface RealtimeRelayProjection {
  readonly event: unknown;
  readonly params: unknown;
  readonly topicId: string;
}

export interface OutboxRealtimeRelayOptions {
  readonly gateway: Pick<RealtimeGateway, "publish">;
  project(event: DurableEventEnvelope): RealtimeRelayProjection | null;
}

export function createOutboxRealtimeRelay(options: OutboxRealtimeRelayOptions): OutboxSubscriber {
  if (typeof options.project !== "function") throw new TypeError("project must be a function.");
  return async ({ checkpoint, event, saveCheckpoint }) => {
    if (checkpoint?.realtimePublished === true) return;
    const projection = options.project(event);
    if (!projection) return;
    await options.gateway.publish(projection.topicId, projection.params, projection.event);
    await saveCheckpoint({ realtimePublished: true });
  };
}
