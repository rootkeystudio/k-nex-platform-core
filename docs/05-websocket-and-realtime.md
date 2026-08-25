# Realtime Capability

## Purpose

K-Nex models realtime delivery as a replaceable infrastructure capability. Domain modules depend on `realtime.gateway`; they do not import Socket.IO, Redis, or raw WebSocket types.

Initial implementation:

```text
plugin ID: provider.realtime.socketio
package:   @k-nex/provider-realtime-socketio
capability: realtime.gateway@1
```

Provider options select a supported topology:

```text
adapter: memory   single compatible process
adapter: redis    distributed web/worker/gateway topology
```

## Service boundary

```ts
interface RealtimeGateway {
  publish<T>(input: {
    channel: RegisteredChannelRef
    message: RealtimeMessage<T>
    messageClass: 'ephemeral-hint' | 'reconstructible-invalidation'
    correlationId: string
  }): Promise<PublishResult>
}
```

Durable integration/workflow truth is not accepted through this ephemeral API. It starts from a transactional outbox record and may later produce a realtime hint.

Modules register typed channel factories and subscription authorization. Clients never invent raw channel strings.

## Connection and subscription security

Every connection and subscription enforces:

```text
origin and transport policy
authenticated/revocable actor or narrow public session
validated channel parameters
surface/audience policy
permission and domain record policy
connection/subscription/message/rate/size limits
session/permission reauthorization
```

Opening a connection grants no wildcard authority.

## Source invalidation

Ordinary Metric, DataTable, and chart blocks use:

```text
domain mutation commits
  → reconstructible invalidation recorded/published
  → authorized client marks matching source query stale
  → authenticated source endpoint refetch
  → source/contract validation
  → rerender
```

Invalidation messages carry source/topic identity and a non-sensitive revision/watermark. They normally do not carry full business records.

## Convergence

Pub/Sub delivery can be lost. Every query client must converge through:

- authoritative initial fetch;
- source/snapshot revision or watermark;
- reconnect resync and refetch when recovery is uncertain;
- workspace window-focus revalidation;
- bounded periodic revalidation according to source freshness;
- permission/subscription reauthorization;
- cache invalidation when a newer server revision is observed.

A connected client cannot remain indefinitely stale because one message disappeared.

## Topology rules

### Memory adapter

Supported only when one process owns:

```text
all live socket connections
all domain mutations that directly publish invalidations
all after-commit publication paths
```

A separate worker cannot publish into another process's memory. If an application has separate worker publication paths, choose Redis/backplane or a Postgres outbox relay consumed by the socket-owning process.

`k-nex doctor` validates process topology and refuses an incompatible memory configuration.

### Redis adapter

Used for multiple web instances, separate workers/gateways, rolling deployment, and distributed publication. Deployment validates Redis credentials, namespace isolation, adapter health, backpressure, connection draining, and reconnect behavior.

Consumer modules remain unchanged.

## Durable events versus realtime hints

```text
ephemeral-hint
  presence/typing/high-frequency optional hint; loss acceptable

reconstructible-invalidation
  source may be stale; loss tolerated only with convergence

durable-integration
  external intent; transactional outbox mandatory

durable-workflow
  correctness-relevant continuation; transactional outbox mandatory
```

A realtime provider cannot downgrade a durable event definition.

## High-frequency live projections

Vehicle positions or import progress can use:

```text
authenticated bounded snapshot
+ typed incremental stream
+ source-owned reducer/version
+ backpressure/coalescing
+ reconnect/resync
```

High-frequency location ingestion and history storage are separate domain/provider concerns. They are not ordinary Payload document writes by default.

## Operational requirements

- TLS and proxy upgrade/timeouts;
- graceful drain and bounded termination;
- maximum connections/subscriptions/message bytes/buffer;
- coalescing repeated invalidations;
- disconnecting slow consumers;
- metrics for auth denials, fan-out, drops, reconnects, and backplane health;
- no secrets or unnecessary personal data in messages/logs.

## POC evidence

Gate 3 must inject commit crash, duplicate delivery, worker-to-web publication, lost Pub/Sub, permission revocation, slow consumer, and rolling deployment failures. Until that gate passes, the provider remains design-only.
