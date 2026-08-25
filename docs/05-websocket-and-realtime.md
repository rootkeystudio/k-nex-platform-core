# WebSocket and Realtime Module

## Purpose

`@k-nex/module-websocket` provides authenticated realtime transport as a reusable infrastructure module. It does not own logistics, driver, CRM, or restaurant business concepts.

Domain modules use a stable realtime contract. The WebSocket implementation owns connections, subscriptions, delivery, and scaling concerns.

## Why it is a module

Realtime infrastructure is not required by every customer application. Keeping it outside the core provides:

- smaller deployments for applications that do not need realtime behavior;
- independent versioning and operational dependencies;
- explicit requirements from modules such as driver or live tracking;
- the ability to change transport providers without changing domain logic.

## Module identity

Working manifest:

```ts
export const websocketModule = defineModule({
  manifest: {
    id: 'transport.websocket',
    version: '1.0.0',
    compatibility: {
      core: '^1.0.0',
    },
    provides: [
      'realtime.gateway',
      'realtime.connections',
      'realtime.subscriptions',
    ],
  },
})
```

## Required consumers

The first dependency graph is expected to include:

```text
logistics.core
      ▲
      │ required
    driver ───────── required ───────► transport.websocket
      │
      └──────── optional ────────────► logistics.dispatch

live-tracking ───── required/selected policy ─► transport.websocket
```

The driver backend requires:

- `logistics.core` for drivers, assignments, shipments, routes, and stops;
- `transport.websocket` for assignment updates, status updates, and realtime coordination.

Whether `live-tracking` strictly requires WebSocket or can fall back to polling should be decided during the POC. The initial product hypothesis is to require it when realtime public tracking is enabled.

## Public service contract

```ts
export interface RealtimePrincipal {
  actorId: string
  actorType: 'user' | 'driver' | 'service' | 'public-session'
  permissions: readonly string[]
  sessionId: string
}

export interface PublishOptions {
  excludeConnectionIds?: readonly string[]
  requireAcknowledgement?: boolean
  idempotencyKey?: string
}

export interface RealtimeGateway {
  publish<TMessage>(
    channel: RealtimeChannel,
    message: TMessage,
    options?: PublishOptions,
  ): Promise<PublishResult>
}

export interface RealtimeAuthorizer {
  canSubscribe(input: {
    principal: RealtimePrincipal
    channel: RealtimeChannel
  }): Promise<boolean>

  canPublish(input: {
    principal: RealtimePrincipal
    channel: RealtimeChannel
  }): Promise<boolean>
}
```

Domain modules should only consume the contract or service token. They should not import the underlying WebSocket server, Redis client, or connection store.

## Channel conventions

Channels must be typed, namespaced, and authorization-aware.

```text
customer:{appId}:user:{userId}
customer:{appId}:driver:{driverId}
customer:{appId}:shipment:{shipmentId}
customer:{appId}:dispatch-board:{branchId}
customer:{appId}:public-tracking:{trackingSessionId}
```

Even though each customer is independently deployed, including the application ID in internal channel metadata improves diagnostics and prevents accidental cross-environment reuse.

Raw arbitrary channel strings from clients should not be trusted. Domain modules should expose channel factories:

```ts
export const shipmentChannel = (shipmentId: ShipmentId) =>
  channel('logistics.shipment', { shipmentId })
```

## Message envelope

```ts
export interface RealtimeMessage<TPayload = unknown> {
  id: string
  type: string
  occurredAt: string
  correlationId?: string
  causationId?: string
  schemaVersion: number
  payload: TPayload
}
```

Message type and schema version are part of the public contract. Mobile and browser clients may temporarily run an older version during deployment, so consumers must handle compatible evolution.

## Connection lifecycle

The module should own:

1. handshake and authentication;
2. principal creation;
3. connection registration;
4. heartbeat and stale connection cleanup;
5. subscription authorization;
6. connection and channel rate limits;
7. message serialization and size limits;
8. acknowledgement and retry policy where enabled;
9. graceful shutdown and reconnect hints;
10. structured connection metrics.

## Authentication

Connection authentication can support separate strategies:

- authenticated Payload user session;
- short-lived driver access token;
- service-to-service token;
- signed, limited public tracking session.

A public tracking token must authorize only a specific tracking projection. It must never grant access to internal shipment records or reusable wildcard channels.

## Authorization

Subscription authorization belongs to the domain that owns the channel.

Example:

```ts
websocket.registerChannel({
  definition: shipmentRealtimeChannel,
  authorize: async ({ principal, params, services }) => {
    return services.logisticsAccess.canViewShipment({
      actor: principal,
      shipmentId: params.shipmentId,
    })
  },
})
```

The WebSocket module executes the policy but does not define shipment access rules.

## Transaction and event boundary

Do not publish realtime messages before the related database transaction commits.

Preferred flow:

```text
command
  → database transaction
  → domain event/outbox record
  → transaction commit
  → event subscriber/job
  → realtime gateway publish
```

This prevents clients from receiving a state change that is later rolled back.

For the first single-instance POC, an in-process after-commit publisher may be sufficient. Production reliability requirements should determine whether a transactional outbox is required.

## Runtime adapters

The module should support at least two operational modes.

### Local adapter

For a single application instance:

- in-memory connection registry;
- direct message fan-out;
- no Redis requirement;
- appropriate for development, staging, and small customer deployments.

### Distributed adapter

For multiple application or gateway instances:

- Redis or another pub/sub/backplane;
- distributed connection presence;
- consistent channel publication;
- horizontal scaling and rolling deployment support.

Draft configuration:

```ts
websocketModule({
  adapter:
    env.REDIS_URL
      ? redisRealtimeAdapter({ url: env.REDIS_URL })
      : localRealtimeAdapter(),
  limits: {
    maximumConnectionsPerActor: 5,
    maximumMessageBytes: 64_000,
    subscriptionsPerConnection: 100,
  },
})
```

## Backpressure and delivery

Realtime does not automatically mean guaranteed delivery.

The module must document delivery semantics per message class:

- ephemeral presence/position hint: latest value wins;
- UI invalidation: clients refetch authoritative state;
- assignment command: acknowledged and recoverable through API state;
- critical workflow event: persisted outside WebSocket and delivered through jobs/notifications.

WebSocket should not become the only source of truth. Reconnecting clients must be able to recover current state through an authenticated API.

## Driver workflow example

```text
1. Dispatcher assigns shipment to driver.
2. Dispatch service commits assignment.
3. `logistics.assignment.created` is published.
4. Driver integration subscriber projects a driver task.
5. Realtime gateway sends `driver.task.assigned` to the driver's channel.
6. Driver app acknowledges receipt and fetches authoritative task details.
7. Driver app sends status mutations through authenticated HTTP/API commands.
8. Committed status changes produce realtime board updates.
```

Client-to-server business mutations should use explicit commands/endpoints unless a WebSocket command protocol is deliberately designed and validated. The first POC should use WebSocket primarily for server-to-client updates.

## Live location considerations

High-frequency GPS data needs a separate ingestion and storage strategy from ordinary Payload CRUD.

Potential architecture:

```text
driver device
  → authenticated location endpoint
  → validation and rate limiting
  → current-position store
  → optional history store
  → throttled realtime projection
```

The realtime channel should send a controlled projection, not every unfiltered device event. Server-side throttling, coalescing, and precision rules protect cost, privacy, and client performance.

## Observability

Required metrics and logs:

- active connections by principal type;
- subscriptions by channel type;
- connection attempts and authentication failures;
- authorization denials;
- message count and bytes;
- publish latency and fan-out size;
- dropped or rate-limited messages;
- reconnect frequency;
- adapter/backplane health.

## POC acceptance criteria

- Driver module fails composition when WebSocket module is missing.
- An authenticated driver can subscribe only to its own channel.
- A dispatcher update reaches the expected driver connection.
- A second driver cannot subscribe to the first driver's task channel.
- Reconnect recovers state from API even if a message was missed.
- Local adapter works without Redis.
- Distributed adapter can be introduced without changing driver domain code.
- Publish occurs only after transaction success.
- Connection and message limits are testable.