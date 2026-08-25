# Permissions, Events, Actions, and Jobs

## Actors and authorization

Actor types include user, driver, service, public-session, system-job, and impersonated user. Actor context carries only required claims plus correlation/impersonation metadata.

Modules define capability-oriented permission keys; customer applications compose roles. A permission is necessary but may be insufficient: domain record policy can consider branch, team, ownership, assignment, organization, workflow state, locale, or public-session scope.

The same policy service is adapted to Payload access, data sources/actions, files/exports, jobs, and realtime subscriptions.

## Commands, queries, sources, and actions

```text
command       asks authoritative behavior and may fail
query/source  returns an authorized bounded projection
action        client-safe registered operation around a command
```

Server handlers revalidate input, authorization, transaction, idempotency, rate limits, and audit. Builder documents reference stable IDs and validated parameters only.

External HTTP failures use RFC 9457 Problem Details; unauthorized resource existence and internal policy/stack details are not disclosed.

## Capability-scoped services

Handlers and jobs do not receive a universal mutable service container. Composition supplies only services declared by the owning plugin’s resolved dependencies.

```ts
interface AssignShipmentServices {
  logistics: LogisticsDomainService
  outbox: OutboxWriter
  audit: AuditWriter
}
```

Runtime token lookup outside the allowlist fails.

## Event classes

### Ephemeral hint

Presence/typing/optional live hint. Loss is acceptable.

### Reconstructible invalidation

Signals that a projection may be stale. After-commit publication is allowed only with revision/watermark, reconnect resync, and bounded revalidation.

### Durable integration

External synchronization or notification intent that must survive process failure. Transactional outbox is mandatory.

### Durable workflow

Correctness-relevant projection/workflow continuation. Transactional outbox or equivalent atomic durable queue is mandatory.

## Event envelope

```ts
interface DomainEvent<T> {
  id: string
  type: string
  schemaVersion: number
  messageClass: 'durable-integration' | 'durable-workflow'
  occurredAt: string
  applicationId: string
  pluginId: string
  actor?: { id: string; type: string; impersonatorId?: string }
  correlationId: string
  causationId?: string
  idempotencyKey?: string
  payload: T
}
```

No secrets or unnecessary internal documents.

## Transactional outbox

```text
begin transaction
  authorize and enforce domain invariants
  mutate authoritative state
  insert outbox record with event schema/version
commit
worker claims outbox record
  invokes idempotent subscribers
  records attempts/checkpoint/dead-letter state
  emits reconstructible realtime invalidation where needed
```

A crash after commit cannot erase durable intent. Duplicate delivery is expected and tested.

## Jobs

Jobs are schema-versioned, owned, bounded, observable, and capability-scoped.

```ts
interface JobDefinition<T> {
  id: string
  pluginId: string
  inputSchemaVersion: number
  queue: string
  retries: { maximumAttempts: number; backoff: 'fixed' | 'exponential' }
  timeoutMs?: number
  idempotency: 'required' | 'recommended' | 'none'
  handler(input: T, context: ScopedJobContext): Promise<void>
}
```

Long migrations/imports use batch cursors, checkpoints, bounded transactions, pause/resume/cancel policy, and readiness completion markers.

Payload Jobs Queue is the first adapter behind these conventions. A different queue is justified only by measured reliability/scale needs.

## Audit

Audit records who requested/performed what, on which resource/scope, with what outcome/reason/approval, release/context, and correlation. Audit is not the same as a domain event.

High-risk operations include role/permission change, impersonation, content/layout/theme publication, shipment assignment, stock adjustment, budget approval, plugin configuration, purge, and migration execution.

Secrets, session tokens, raw credentials, and unnecessary sensitive payloads are never audited.

## Required failure tests

- UI manipulation cannot bypass source/action policy.
- System job cannot resolve undeclared services.
- rollback emits no durable event or invalidation.
- commit then crash preserves outbox intent.
- duplicate event does not duplicate external effect.
- permission revocation invalidates cache/subscription scope.
- public action/source cannot inherit workspace authority.
- high-risk denial/success produces safe audit evidence.
