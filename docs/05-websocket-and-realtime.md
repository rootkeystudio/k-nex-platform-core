# WebSocket and Realtime Capability

## Purpose

K-Nex models realtime delivery as a versioned infrastructure capability rather than domain logic or a mandatory core subsystem.

Domain modules such as driver operations, dispatch, live tracking, notifications, or collaborative dashboards consume stable contracts such as:

```text
realtime.gateway
realtime.connections
realtime.subscriptions
realtime.presence (optional)
```

Concrete provider plugins own WebSocket hosting, connection state, fan-out, scaling adapters, protocol limits, and operational health.

```text
module.logistics-driver
          │ requires realtime.gateway@^1
          ▼
provider.realtime-websocket-local
          or
provider.realtime-websocket-redis
```

The driver module does not import a WebSocket server or Redis client.

## Why realtime is not core

Not every customer application needs realtime. Keeping it behind provider capabilities provides:

- smaller applications when realtime is unnecessary;
- explicit dependencies from modules that require it;
- replacement of local with distributed infrastructure without changing domain code;
- independent package versioning and deployment requirements;
- test fakes and alternate implementations;
- clear delivery/operational semantics rather than a hidden global socket.

Core supplies service/capability registration and actor/access foundations. A provider supplies the implementation.

## Plugin identities

Initial provider packages:

```text
plugin ID: provider.realtime-websocket-local
package:   @k-nex/provider-websocket
mode:      local/single-process

plugin ID: provider.realtime-websocket-redis
package:   @k-nex/provider-websocket-redis
mode:      distributed/multi-instance
```

The packages can later be reorganized while stable plugin/capability IDs remain unchanged.

Example static manifest:

```json
{
  "$schema": "https://schemas.k-nex.dev/plugin/v1.json",
  "apiVersion": 1,
  "id": "provider.realtime-websocket-local",
  "kind": "provider",
  "displayName": "Local WebSocket Realtime",
  "version": "1.2.1",
  "package": "@k-nex/provider-websocket",
  "compatibility": {
    "core": ">=1.4.0 <2.0.0",
    "node": ">=22.0.0"
  },
  "provides": [
    {
      "capability": "realtime.gateway",
      "version": "1.0.0"
    },
    {
      "capability": "realtime.connections",
      "version": "1.0.0"
    },
    {
      "capability": "realtime.subscriptions",
      "version": "1.0.0"
    }
  ],
  "surfaces": ["workspace", "driver", "public"],
  "data": {
    "ownsPersistentData": false
  }
}
```

Distributed provider example additionally requires Redis environment/infrastructure and can provide:

```text
realtime.distributed@1
realtime.presence@1
```

## Consumer declarations

Driver module:

```json
{
  "id": "module.logistics-driver",
  "requires": [
    {
      "plugin": "module.logistics-core",
      "version": "^1.8.0"
    },
    {
      "capability": "realtime.gateway",
      "version": "^1.0.0",
      "reason": "Driver task and assignment changes require realtime delivery."
    }
  ],
  "optional": [
    {
      "plugin": "module.logistics-dispatch",
      "version": "^1.5.0"
    }
  ]
}
```

Live tracking can make realtime conditional on a build-time feature/profile:

```ts
liveTrackingModule({
  publicTracking: true,
  realtimeProjection: true,
})
```

When `realtimeProjection` is enabled, the module requires `realtime.gateway`. A polling-only configuration can remain valid without it if the module explicitly supports that mode.

## Service contracts

```ts
export interface RealtimePrincipal {
  actorId: string
  actorType: 'user' | 'driver' | 'service' | 'public-session'
  permissions: ReadonlySet<string>
  sessionId: string
  applicationId: string
  correlationId: string
}

export interface RealtimeChannel<TParams = unknown> {
  type: string
  params: TParams
}

export interface PublishOptions {
  excludeConnectionIds?: readonly string[]
  requireAcknowledgement?: boolean
  idempotencyKey?: string
  messageClass?:
    | 'ephemeral'
    | 'invalidation'
    | 'notification'
    | 'acknowledged'
}

export interface PublishResult {
  acceptedConnections: number
  droppedConnections: number
  messageId: string
}

export interface RealtimeGateway {
  publish<TMessage>(
    channel: RealtimeChannel,
    message: RealtimeMessage<TMessage>,
    options?: PublishOptions,
  ): Promise<PublishResult>
}

export interface RealtimeAuthorizer<TParams = unknown> {
  canSubscribe(input: {
    principal: RealtimePrincipal
    channel: RealtimeChannel<TParams>
  }): Promise<boolean>

  canPublish?(input: {
    principal: RealtimePrincipal
    channel: RealtimeChannel<TParams>
  }): Promise<boolean>
}
```

A domain module consumes the service token/contract only.

## Domain-owned channel definitions

The transport provider must not understand shipment, driver, inventory, CRM, or budget policy. Domain modules register typed channel definitions and authorization callbacks.

```ts
export const shipmentChannel = defineRealtimeChannel({
  id: 'logistics.shipment',
  params: z.object({
    shipmentId: z.string(),
  }),
  authorize: async ({ actor, params, services }) => {
    return services.logisticsAccess.canReadShipment({
      actor,
      shipmentId: params.shipmentId,
    })
  },
})
```

Client input never becomes a trusted arbitrary channel string. The runtime parses and validates against registered channel factories.

Conceptual internal names:

```text
application:{appId}:user:{userId}
application:{appId}:driver:{driverId}
application:{appId}:shipment:{shipmentId}
application:{appId}:dispatch-board:{branchId}
application:{appId}:public-tracking:{sessionId}
```

Each customer is independently deployed, but application ID namespacing improves diagnostics and prevents accidental reuse in shared managed infrastructure.

## Message envelope

```ts
export interface RealtimeMessage<TPayload = unknown> {
  id: string
  type: string
  schemaVersion: number
  occurredAt: string
  applicationId: string
  correlationId: string
  causationId?: string
  payload: TPayload
}
```

Messages are public client contracts when consumed by browser/mobile versions. Breaking payload semantics require a new schema version/message contract.

Do not include secrets, unrestricted internal documents, or data outside the channel's authorized projection.

## Connection lifecycle

The provider owns:

1. HTTP upgrade/transport handshake.
2. Origin and authentication validation.
3. Principal adaptation.
4. Connection registration.
5. Heartbeats and stale connection cleanup.
6. Subscription request validation and authorization.
7. Connection/subscription/message rate limits.
8. Serialization, schema, and maximum-size enforcement.
9. Optional acknowledgement and retry behavior.
10. Graceful drain/reconnect hints during deployment.
11. Metrics, tracing, and health checks.
12. Provider initialization/disposal.

The provider does not own domain mutations or domain record policy.

## Authentication strategies

Supported actor strategies can include:

- authenticated Payload/user session;
- short-lived scoped driver token;
- service-to-service token;
- signed public tracking session;
- future device-specific credentials.

A public tracking token must authorize one narrow public projection/session. It never grants internal shipment, customer, route, or wildcard channel access.

Driver tokens should be short-lived/revocable and bound to driver/device/session context as required.

## Authorization

Authorization happens for every subscription, not only at handshake.

```ts
realtime.registerChannel({
  definition: shipmentChannel,
  authorize: async ({ principal, params, services }) => {
    return services.logisticsAccess.canReadShipment({
      actor: principal,
      shipmentId: params.shipmentId,
    })
  },
})
```

Permission visibility in the UI is not sufficient. The same domain access service should support:

```text
HTTP/action data access
Payload access control
workspace UI data sources
jobs where actor context is relevant
WebSocket subscriptions
```

Authorization decisions can be re-evaluated after role/assignment/session changes. Long-lived subscriptions must not retain access forever after revocation.

## Server-to-client first

V1 uses realtime primarily for server-to-client updates:

```text
state committed
  → event/outbox/after-commit subscriber
  → provider publishes invalidation/projection
  → client fetches or updates authoritative state
```

Business mutations use authenticated HTTP/action/command endpoints initially.

A general client-to-server WebSocket command protocol is a separate future design requiring:

- command registry;
- schemas;
- permission/record policy;
- idempotency;
- transaction/result/error semantics;
- rate limiting and replay protection.

## Transaction boundary

Never publish an externally visible state change before its database transaction commits.

Preferred production flow:

```text
begin transaction
  mutate domain state
  write outbox/domain event
commit
  process event/outbox
  publish realtime message
```

POC can use a reliable framework after-commit mechanism if measured and documented. Critical production integrations should use a transactional outbox or equivalent durability.

## Delivery semantics

Realtime is not automatically guaranteed delivery. Define semantics by message class.

### Ephemeral

Examples:

```text
presence
typing indicator
high-frequency position hint
```

Latest value wins; missed messages need no replay.

### Invalidation

Example:

```text
logistics.assignment.changed
crm.pipeline.changed
inventory.stock-summary.changed
```

Client receives an invalidation and refetches authorized authoritative data.

### Notification

A user-visible hint that can be reconstructed from persistent notification/task state.

### Acknowledged

Used sparingly when delivery receipt matters. Even then, durable business truth exists outside the socket and reconnect can recover state.

Critical workflow completion is never stored only in a WebSocket queue.

## Backpressure and limits

Provider configuration:

```ts
websocketProvider({
  limits: {
    maximumConnectionsPerActor: 5,
    maximumSubscriptionsPerConnection: 100,
    maximumMessageBytes: 64_000,
    maximumPublishesPerSecondPerConnection: 20,
    outboundBufferBytes: 1_000_000,
  },
  overflow: {
    strategy: 'disconnect-slow-consumer',
  },
})
```

Potential policies:

- coalesce repeated invalidations;
- latest-value wins for position/presence;
- reject oversized messages;
- disconnect slow consumers after bounded buffering;
- avoid broadcasting unbounded query results;
- publish IDs/projections and let clients refetch.

## Local provider

Suitable for development, staging, and small single-instance deployments.

```text
in-process connection registry
direct fan-out
no Redis requirement
simpler deployment
connections lost/reconnect during process restart
not suitable for multiple independent web instances without routing constraints
```

Example manifest/config:

```json
{
  "providers": {
    "realtime.gateway": {
      "plugin": "provider.realtime-websocket-local",
      "package": "@k-nex/provider-websocket",
      "version": "1.2.1",
      "options": {
        "adapter": "local"
      }
    }
  }
}
```

## Distributed provider

Suitable for horizontal/multi-instance deployments.

```text
Redis or equivalent pub/sub/backplane
distributed publication
optional distributed presence/connection metadata
rolling deploy support
additional infrastructure/health/credentials
```

Example:

```json
{
  "providers": {
    "realtime.gateway": {
      "plugin": "provider.realtime-websocket-redis",
      "package": "@k-nex/provider-websocket-redis",
      "version": "1.0.0",
      "options": {
        "urlEnvironmentVariable": "REDIS_URL"
      }
    }
  }
}
```

The CLI reports Redis/Docker/deployment implications during replacement. Consumer modules remain unchanged.

## Hosting topology

Possible V1 topology:

```text
ingress / reverse proxy
    ├── HTTP application
    └── WebSocket upgrade endpoint

single web process
    └── local provider
```

Larger topology:

```text
ingress
    ├── web instance A
    ├── web instance B
    └── optional dedicated gateway instances
              │
              ▼
           Redis/backplane
```

Exact Payload/Next.js/deployment-provider hosting constraints are provisional and must be measured in the POC.

Operations must define:

- proxy upgrade/timeouts;
- sticky-session need by adapter;
- graceful connection drain;
- reconnect/backoff;
- origin policy;
- TLS;
- connection limits;
- Redis/backplane readiness;
- deployment overlap behavior.

## UI builder/runtime integration

Workspace blocks can declare realtime metadata through K-Nex UI contracts:

```ts
export const liveFleetMapBlock = defineUiBlock({
  id: 'logistics.live-map',
  surfaces: ['workspace'],
  permission: 'logistics.tracking.read',
  requiresCapabilities: ['realtime.gateway'],
  dataSource: 'logistics.fleet.current',
  realtime: {
    channelFactory: 'logistics.fleet.channel',
    messageTypes: ['logistics.vehicle-position.changed'],
    strategy: 'invalidate-and-refetch',
  },
})
```

The builder stores registered IDs/parameters, not raw channels or socket URLs. The UI runtime authorizes/fetches through server contracts.

Public CMS tracking blocks use separate public-session channels/projections when enabled.

## Driver workflow example

```text
1. Dispatcher calls AssignShipment command.
2. Domain access and invariants pass.
3. Assignment transaction commits.
4. logistics.assignment.created is recorded.
5. Driver task projection/subscriber updates persistent task state.
6. Realtime gateway sends driver.task.changed/invalidation to driver channel.
7. Driver client acknowledges transport receipt if configured.
8. Driver fetches authoritative task through authenticated API.
9. Driver sends accept/status command through authenticated action/HTTP API.
10. Committed update invalidates dispatcher/dashboard projections.
```

Missing the realtime message does not lose the assignment; reconnecting clients fetch current task state.

## Live location considerations

High-frequency GPS data should not automatically become ordinary Payload document writes.

Potential path:

```text
driver device
  → authenticated/rate-limited location ingestion
  → schema/precision/plausibility validation
  → current-position provider
  → optional partitioned/PostGIS history provider
  → throttled/coalesced public/workspace projection
  → realtime gateway
```

Provider contracts:

```ts
interface CurrentPositionStore {
  set(position: VehiclePosition): Promise<void>
  get(vehicleId: string): Promise<VehiclePosition | null>
}

interface PositionHistoryStore {
  append(position: VehiclePosition): Promise<void>
  list(query: PositionHistoryQuery): Promise<VehiclePosition[]>
}
```

Privacy/retention/precision and public projection rules belong to the live-tracking domain module/customer configuration, not the generic realtime provider.

## Runtime configuration

Build-time selection:

```text
which realtime provider package
local versus distributed adapter
hosting/process topology
required infrastructure
```

Runtime/provider settings can include bounded limits and policies if they do not require import/schema changes:

```text
connection limit
heartbeat interval
public session duration
selected throttling values
```

Secrets remain environment/secret-manager values, never runtime admin plaintext or application manifest values.

## Observability

Required signals:

```text
active connections by actor type
connection attempts/auth failures
subscription requests/denials
subscriptions by channel type
messages and bytes published
fan-out size and publish latency
dropped/coalesced/rate-limited messages
slow consumer disconnects
reconnect frequency
provider/backplane health
message schema/version errors
```

Logs carry application/release/provider/channel-type/correlation metadata without leaking tokens or sensitive payloads.

## Security requirements

- validate origin and authentication during handshake;
- validate every subscription and channel parameters;
- use domain access services;
- enforce connection/subscription/message/rate limits;
- isolate signed public sessions;
- avoid sensitive wildcard channels;
- validate message schemas;
- publish only after commit;
- do not place secrets in messages/logs;
- support session/token revocation and bounded lifetime;
- recover authoritative state through API;
- use TLS and deployment-specific proxy controls.

See [Security and Trust Boundaries](./20-security-and-trust-boundaries.md).

## Provider replacement lifecycle

Replacing local with Redis-backed provider:

```text
1. Add/select distributed provider in k-nex.app.json.
2. Resolver verifies realtime.gateway compatibility.
3. CLI reports REDIS_URL and infrastructure/process changes.
4. Generate registries and deployment files.
5. Run provider contract/integration tests.
6. Verify proxy/drain/reconnect behavior in staging.
7. Deploy customer application.
8. Confirm inventory/health identifies the new provider.
9. Remove old provider package after no active dependency remains.
```

No driver/logistics domain code changes are expected.

## POC acceptance criteria

- Driver composition fails clearly when no compatible `realtime.gateway` provider exists.
- Duplicate single realtime providers fail resolution.
- Local provider works without Redis in one application instance.
- Domain module registers typed channel/policy without provider imports.
- Authenticated driver subscribes only to its own authorized channels.
- Another driver/public session cannot access internal task channels.
- Committed assignment reaches the expected client.
- Rolled-back transaction publishes nothing.
- Reconnect recovers state through API after missed message.
- UI realtime block uses registered channel/data-source metadata.
- Replacing local with distributed provider changes no driver domain code.
- Graceful deployment/reconnect behavior is measured on the intended hosting stack.
- Message/connection limits and security metrics are testable.
