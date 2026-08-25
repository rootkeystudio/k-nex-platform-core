# Permissions, Events, and Jobs

These three systems allow independently developed modules to cooperate without hard-coded customer roles or direct implementation coupling.

## Permissions

### Permission keys

Modules register capability-oriented permission keys:

```text
cms.pages.read
cms.pages.create
cms.pages.publish

crm.contacts.read
crm.contacts.write
crm.opportunities.manage

logistics.shipments.read
logistics.shipments.assign
logistics.tracking.read
logistics.proof-of-delivery.create

restaurant.menu.manage
restaurant.inventory.adjust
restaurant.budget.approve
```

Permission keys should describe an action on a capability. They should not describe a customer role.

Bad:

```text
manager
restaurant-admin
acme-dispatcher
```

Good:

```text
logistics.shipments.assign
restaurant.inventory.adjust
```

### Roles belong to the customer application

A customer repository composes roles from registered permissions:

```ts
export const roles = defineRoles({
  dispatcher: [
    'logistics.shipments.read',
    'logistics.shipments.assign',
    'logistics.tracking.read',
  ],
  driverSupervisor: [
    'logistics.shipments.read',
    'logistics.tracking.read',
    'logistics.proof-of-delivery.read',
  ],
})
```

Another customer can use the same modules with different roles.

### Permission definition

```ts
export interface PermissionDefinition {
  key: string
  description: string
  moduleId: string
  risk?: 'low' | 'medium' | 'high' | 'critical'
}
```

The registry rejects duplicate keys with different ownership or semantics.

### Access policy

Permission possession is only one part of authorization. Record-level policy may also consider:

- branch or team membership;
- ownership;
- assigned driver;
- organization relationship;
- document state;
- public/session scope;
- explicit customer extension policy.

Example:

```ts
export async function canReadShipment(input: {
  actor: ActorContext
  shipment: ShipmentAccessProjection
}): Promise<boolean> {
  if (!input.actor.permissions.has('logistics.shipments.read')) {
    return false
  }

  return input.actor.branchIds.includes(input.shipment.branchId)
}
```

Use the same domain access service from HTTP endpoints, Payload access controls, jobs, and WebSocket subscription authorization.

## Domain events

### Purpose

Events communicate completed facts between modules:

```text
logistics.shipment.created
logistics.assignment.created
logistics.shipment.delivered
inventory.stock-low
budget.threshold-exceeded
cms.page.published
crm.opportunity.won
```

An event name should be past tense because the fact has already occurred.

### Event envelope

```ts
export interface DomainEvent<TPayload = unknown> {
  id: string
  type: string
  schemaVersion: number
  occurredAt: string
  applicationId: string
  actor?: {
    id: string
    type: string
  }
  correlationId: string
  causationId?: string
  idempotencyKey?: string
  payload: TPayload
}
```

### Ownership

The module that owns the fact owns the event contract.

- Logistics owns `logistics.shipment.delivered`.
- CRM may subscribe, but cannot redefine its payload.
- Customer extensions may subscribe through public contracts.

### Event compatibility

- Additive payload changes can remain in the same schema version when consumers tolerate unknown fields.
- Renamed, removed, or semantically changed fields require a new schema version.
- Persisted events must remain decodable for their retention period.
- Consumers should explicitly declare supported versions.

### Delivery levels

The platform can support increasingly durable adapters:

1. **in-process:** simplest, only within one running process;
2. **database/outbox:** event record committed with business transaction;
3. **broker-backed:** distributed processing through a message broker.

Domain modules consume the event bus contract and should not depend directly on Redis, Kafka, or another broker.

### Transactional rule

A fact should not be externally observed before its transaction commits.

Preferred flow:

```text
begin transaction
  mutate aggregate/data
  record outbox event
commit transaction
publish/process outbox
```

For a first POC, an after-commit mechanism may be acceptable. Before using events for critical integrations, delivery and retry guarantees must be explicit.

### Idempotency

Every subscriber that causes an external or durable side effect must be safe to retry.

Common techniques:

- event ID processing table;
- unique idempotency key;
- upsert on a natural projection key;
- compare-and-set state transition;
- provider-level idempotency token.

## Commands versus events

A command asks for behavior and may fail:

```text
AssignShipment
ConsumeIngredients
PublishPage
ApproveBudget
```

An event states that behavior completed:

```text
ShipmentAssigned
IngredientsConsumed
PagePublished
BudgetApproved
```

Do not use events as disguised synchronous commands. A module needing an immediate result should call a service contract or command handler.

## Jobs and workflows

### Purpose

Jobs handle work that is:

- slow;
- retryable;
- scheduled;
- externally integrated;
- resource intensive;
- not required to block the current request.

Examples:

- send notification;
- generate a PDF;
- sync with an ERP;
- import CRM contacts;
- rebuild a search projection;
- evaluate low-stock rules;
- expire public tracking sessions;
- delete old location history;
- process an event outbox.

### Job definition

```ts
export interface JobDefinition<TInput = unknown> {
  id: string
  moduleId: string
  inputSchemaVersion: number
  queue: string
  retries: {
    maximumAttempts: number
    backoff: 'fixed' | 'exponential'
  }
  timeoutMs?: number
  idempotency?: 'required' | 'recommended' | 'none'
  handler(input: TInput, context: JobContext): Promise<void>
}
```

### Queue conventions

Use capability or workload names, not customer names:

```text
default
notifications
integrations
imports
media
tracking-retention
outbox
```

A customer deployment can map these logical queues to one or several worker processes.

### Payload Jobs Queue

Payload's Jobs Queue is the default first implementation candidate for task/workflow registration and dedicated workers. K-Nex should wrap it with module ownership, naming, tracing, and idempotency conventions.

### Hook rule

A Payload hook may validate, maintain an invariant, record an event, or enqueue work. It should not perform an unreliable slow external operation inside the request when the result is not required immediately.

Instead of:

```text
afterChange → call ERP for 20 seconds → block request
```

prefer:

```text
afterChange → enqueue integration job → return
worker → call ERP → retry/idempotency/audit
```

### Workflow rule

Use a workflow when several durable steps must execute in order and resume safely after failure.

Example delivery completion workflow:

```text
1. validate proof of delivery
2. finalize shipment status
3. generate delivery receipt
4. notify customer
5. sync external ERP
```

The database state transition should remain clearly separated from optional downstream effects.

## Audit

Security-sensitive or business-critical operations create audit records:

- actor and impersonation context;
- action;
- resource type and ID;
- previous/new state summary where appropriate;
- timestamp;
- request/correlation ID;
- module and application version;
- source IP/device metadata where legally appropriate.

Audit records are not a substitute for domain events, and domain events are not automatically a sufficient audit log.

## Cross-system example

```text
Dispatcher calls AssignShipment command
  → access policy checks `logistics.shipments.assign`
  → assignment transaction commits
  → `logistics.assignment.created` event recorded
  → driver projection subscriber creates task
  → realtime subscriber publishes driver update
  → notification subscriber queues push notification
  → audit record captures assignment action
```

Every step uses a documented contract. Logistics does not import WebSocket internals or a concrete notification vendor.

## Required tests

- A role without a permission cannot reach the action through API, admin, job, or WebSocket.
- Record-level scope remains enforced after permission grant.
- Duplicate event delivery does not duplicate side effects.
- Failed jobs retry according to policy and preserve correlation data.
- A transaction rollback produces no externally visible event.
- Module removal cannot leave orphaned registered jobs/subscribers unnoticed.
- Event schema compatibility is tested with stored fixtures.
- Audit recording failures follow a deliberate fail-open or fail-closed policy per action risk.