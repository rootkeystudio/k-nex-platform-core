# Permissions, Events, Actions, and Jobs

## Purpose

These systems allow independently developed plugins, customer extensions, UI surfaces, workers, and infrastructure providers to cooperate without hard-coded customer roles or direct implementation coupling.

```text
permissions and record policy
  control who can request/observe behavior

commands and UI actions
  request authoritative behavior and may fail

queries and UI data sources
  return authorized projections

domain events
  communicate completed facts

jobs and workflows
  execute durable/retryable/scheduled work

audit
  records security/business accountability
```

They share actor, correlation, ownership, schema, versioning, idempotency, and observability conventions but remain different concepts.

# Permissions and authorization

## Permission keys

Plugins register capability-oriented permission keys:

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
budget.approve

ui.layouts.edit
ui.layouts.publish
ui.layouts.personalize
ui.themes.edit
ui.themes.publish

system.plugins.configure
system.roles.manage
system.audit.read
```

A permission key describes an action on a capability. It does not describe a customer role.

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
ui.themes.publish
```

## Permission definition

```ts
export interface PermissionDefinition {
  key: string
  description: string
  pluginId: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  surfaces?: readonly ('workspace' | 'cms' | 'public' | 'driver' | 'system')[]
  audit?: 'none' | 'success' | 'success-and-denial'
}
```

The registry rejects duplicate keys with conflicting ownership or semantics and includes permission ownership in generated release inventory.

## Roles belong to the customer application

Modules/plugins define permissions; the customer application composes organization-specific roles:

```ts
export const roles = defineRoles({
  dispatcher: [
    'logistics.shipments.read',
    'logistics.shipments.assign',
    'logistics.tracking.read',
    'ui.layouts.personalize',
  ],
  operationsManager: [
    'logistics.shipments.read',
    'logistics.shipments.assign',
    'logistics.tracking.read',
    'ui.layouts.edit',
    'ui.layouts.publish',
  ],
  contentEditor: [
    'cms.pages.read',
    'cms.pages.create',
    'ui.themes.edit',
  ],
  contentPublisher: [
    'cms.pages.read',
    'cms.pages.publish',
    'ui.themes.publish',
  ],
})
```

Another customer can use the same plugins with different roles, names, and organizational scopes.

## Permission versus record policy

Possessing a permission is necessary but can be insufficient. Record policy can also consider:

- branch/team membership;
- ownership;
- assigned driver;
- company/account relationship;
- workflow/document state;
- locale/content scope;
- public/signed-session scope;
- role/layout/theme publication scope;
- explicit customer extension policy.

```ts
export async function canReadShipment(input: {
  actor: ActorContext
  shipment: ShipmentAccessProjection
}): Promise<boolean> {
  if (!input.actor.permissions.has('logistics.shipments.read')) {
    return false
  }

  return input.actor.branchIds?.includes(input.shipment.branchId) ?? false
}
```

The same domain access service should be adapted from:

```text
Payload collection/global access
HTTP endpoints and commands
UI data sources and actions
workspace/public/driver routes
jobs where initiating actor matters
WebSocket subscription authorization
file/media access
exports and reports
```

Client-side hiding is not an authorization boundary.

## Actor types

```ts
export interface ActorContext {
  id: string
  type:
    | 'user'
    | 'driver'
    | 'service'
    | 'public-session'
    | 'system-job'
  permissions: ReadonlySet<string>
  teamIds?: readonly string[]
  branchIds?: readonly string[]
  sessionId?: string
  impersonatorId?: string
  correlationId: string
}
```

Do not treat all actors as ordinary admin-panel users. Driver, service, public-session, and system-job identities must remain narrowly scoped.

## High-risk actions

Critical permissions can require additional controls:

```text
explicit confirmation
step-up authentication
four-eyes approval
reason field
immutable audit
restricted service/role assignment
rate limits
idempotency
```

Examples:

```text
system.roles.manage
system.plugins.configure
ui.themes.publish
ui.layouts.publish
cms.pages.publish
inventory.stock.adjust
budget.approve
plugin/data purge
```

# Commands, queries, UI actions, and data sources

## Command

A command requests a state-changing business behavior and may fail because of authorization, validation, conflict, or domain rules.

```text
AssignShipment
ConsumeIngredients
PublishPage
ApproveBudget
AdjustStock
```

Authoritative business logic lives in domain/application services rather than a UI component or Payload hook alone.

## Query

A query returns a server-authorized projection without changing business state.

```text
ListContacts
GetDispatchBoard
GetPublicTrackingProjection
GetBudgetVariance
```

Queries should return purpose-specific DTOs rather than unrestricted internal documents.

## UI action

A registered UI action is a client-safe descriptor and server handler around a command or narrow operation.

```ts
export const assignShipmentAction = defineUiAction({
  id: 'logistics.shipment.assign',
  pluginId: 'module.logistics-dispatch',
  surfaces: ['workspace'],
  permission: 'logistics.shipments.assign',
  input: assignShipmentInputSchema,
  output: assignmentResultSchema,
  risk: 'high',
  idempotency: 'required',
})
```

Server handler:

```ts
registerActionHandler({
  actionId: 'logistics.shipment.assign',
  handle: async ({ input, actor, services, idempotencyKey }) => {
    return services.dispatchCommands.assignShipment({
      input,
      actor,
      idempotencyKey,
    })
  },
})
```

Stored builder documents can reference action IDs and schema-validated parameters only. They cannot name arbitrary endpoints, functions, imports, SQL, or credentials.

## UI data source

```ts
export const pipelineSummaryDataSource = defineUiDataSource({
  id: 'crm.pipeline.summary',
  pluginId: 'module.crm',
  surfaces: ['workspace'],
  permission: 'crm.opportunities.read',
  input: pipelineSummaryInputSchema,
  output: pipelineSummaryProjectionSchema,
  cache: {
    classification: 'actor-scoped',
    maximumAgeSeconds: 30,
  },
})
```

Data-source requirements:

- server-side permission and record policy;
- validated bounded input;
- explicit output projection/schema;
- audience/surface classification;
- PII/sensitivity metadata;
- cache policy that cannot cross authorization boundaries;
- pagination/row/size limits;
- stable ownership/versioning.

## Public actions and data sources

Public CMS blocks use deliberately registered public contracts:

```text
crm.public-lead.submit
logistics.public-tracking.lookup
restaurant.public-menu
restaurant.reservation.request
```

Public contracts require:

```text
narrow schemas/projections
rate limiting and abuse/spam controls
consent/privacy policy
no authenticated workspace authority
signed short-lived sessions where needed
safe caching
idempotency for repeat form/device submissions where appropriate
```

An authenticated editor preview does not make an internal data source safe for public publication.

# Domain events

## Purpose

Events communicate completed facts between modules and integrations:

```text
logistics.shipment.created
logistics.assignment.created
logistics.shipment.delivered
inventory.stock-level-breached
budget.threshold-exceeded
cms.page.published
ui.theme-profile.published
ui.workspace-layout.published
crm.opportunity.won
```

An event name is normally past tense because the fact has already occurred.

## Event envelope

```ts
export interface DomainEvent<TPayload = unknown> {
  id: string
  type: string
  schemaVersion: number
  occurredAt: string
  applicationId: string
  pluginId: string
  actor?: {
    id: string
    type: string
    impersonatorId?: string
  }
  correlationId: string
  causationId?: string
  idempotencyKey?: string
  payload: TPayload
}
```

Event payloads must not contain secrets or unnecessary sensitive/internal documents.

## Ownership

The plugin that owns the fact owns the event contract.

- Logistics owns `logistics.shipment.delivered`.
- CRM may subscribe but cannot redefine the payload.
- UI/theme manager owns publication facts for its records.
- Customer extensions may subscribe through public contracts.
- Integration plugins own mapping/projection state between modules.

## Event compatibility

- Additive optional fields can remain in one schema version if consumers tolerate unknown fields.
- Removed, renamed, or semantically changed fields require a new schema version.
- Persisted events remain decodable for their retention period.
- Consumers declare supported types/schema versions.
- Deprecated versions include a transition/removal plan.
- Event package version and event schema version are separate.

## Delivery levels

The platform can support adapters with different guarantees:

1. **in-process:** simplest, one process/runtime;
2. **after-commit:** publish only after framework transaction commits;
3. **database/outbox:** event record committed with business transaction;
4. **broker-backed:** distributed transport/processing.

Domain modules consume an event-bus/outbox contract, not Redis, Kafka, or another concrete broker.

## Transactional rule

No externally visible fact before transaction commit.

```text
begin transaction
  enforce domain rules
  mutate state
  record outbox event
commit
  process/publish event
```

POC may use a measured after-commit mechanism. Critical production integrations should use transactional outbox or equivalent durability.

## Idempotency

Subscribers producing durable/external effects must be retry-safe.

Techniques:

```text
event processing ledger keyed by event ID
unique idempotency key
upsert by projection natural key
compare-and-set transition
provider idempotency token
outbox delivery attempt state
```

Idempotency scope and retention must be documented.

## Commands versus events

Do not use events as disguised synchronous commands.

```text
command: AssignShipment
result: success or domain error
fact: logistics.assignment.created
```

A module requiring an immediate result calls a service/command handler. An event subscriber reacts after the fact and should tolerate retry/delay.

# Jobs and workflows

## Purpose

Jobs handle work that is:

- slow;
- retryable;
- scheduled;
- externally integrated;
- resource-intensive;
- resumable;
- not required to block the current request.

Examples:

```text
send notification
generate PDF/export
sync ERP/CRM/email provider
import records
rebuild projection/search index
process event outbox
migrate UI documents/theme profiles in batches
expire public tracking sessions
purge old location history
recompute recipe costs/budget variance
```

## Job definition

```ts
export interface JobDefinition<TInput = unknown> {
  id: string
  pluginId: string
  inputSchemaVersion: number
  queue: string
  retries: {
    maximumAttempts: number
    backoff: 'fixed' | 'exponential'
  }
  timeoutMs?: number
  idempotency: 'required' | 'recommended' | 'none'
  risk?: 'low' | 'medium' | 'high' | 'critical'
  handler(input: TInput, context: JobContext): Promise<void>
}
```

Registration rejects duplicate job IDs and records owning plugin/version in inventory.

## Job context

```ts
export interface JobContext {
  applicationId: string
  jobId: string
  attempt: number
  actor?: ActorContext
  correlationId: string
  causationId?: string
  services: ServiceContainer
  signal: AbortSignal
  checkpoint: JobCheckpointApi
  logger: StructuredLogger
}
```

Background/system actors receive only the service permissions necessary for the job. A job must not automatically run as an unrestricted superuser.

## Queue conventions

Use workload/capability names, not customer names:

```text
default
notifications
integrations
imports
media
outbox
tracking-ingestion
tracking-retention
ui-migrations
maintenance
```

A customer deployment maps logical queues to one or several worker processes.

## Payload Jobs Queue

Payload Jobs Queue is the provisional first adapter for task/workflow/queue scheduling. K-Nex wraps it with:

```text
plugin ownership and ID conventions
input schema versions
actor/correlation propagation
idempotency conventions
queue/process inventory
health/readiness/metrics
compatibility and migration metadata
```

## Hook rule

Payload hooks can validate, maintain persistence-local invariants, record events, or enqueue jobs. They should not perform long unreliable external work inside ordinary requests when an immediate result is unnecessary.

Bad:

```text
afterChange → call ERP for 20 seconds → hold request/transaction
```

Preferred:

```text
afterChange/after-commit → enqueue integration job → return
worker → call ERP → retry/idempotency/audit
```

## Workflow rule

Use a durable workflow when several ordered steps must resume safely after failure.

Example delivery-completion flow:

```text
1. validate proof of delivery
2. commit/finalize shipment state
3. generate receipt
4. notify customer
5. sync external ERP
```

The authoritative database transition and optional downstream effects remain clearly separated. A notification/ERP outage must not revert a genuinely completed delivery unless domain policy explicitly requires atomic external confirmation.

## Long-running migrations/backfills

Large data/UI/theme migrations should be resumable jobs rather than one unbounded transaction.

Requirements:

```text
batch size and cursor/checkpoint
idempotent transformation
progress and failure visibility
pause/resume/cancel policy
bounded transactions
schema/version preconditions
completion/readiness marker
```

Publishing migrated theme/layout/content remains a deliberate separate action where visual/business review is needed.

# Audit

## Audit versus event

Domain event:

```text
machine-consumable fact for other behavior/projections
```

Audit record:

```text
security/business accountability about who did what, when, from where, and with what outcome
```

One does not automatically replace the other.

## Audit fields

```text
application/release ID
actor and impersonator context
action and owning plugin
resource type/ID
scope (customer/role/user/branch)
outcome and denial/error category
previous/new state summary where safe
reason/approval reference for high-risk actions
timestamp
request/correlation/causation IDs
source IP/device metadata where lawful/appropriate
```

Never write secrets, session tokens, raw credentials, or unnecessary sensitive payloads to audit.

## Audit-worthy platform operations

```text
role/permission changes
plugin runtime setting changes
theme/layout/CMS publication and rollback
integration credential rotation metadata (not value)
impersonation start/end
assignment/stock adjustment/budget approval
module purge/destructive migration
public tracking/session administration
```

Each high-risk action defines fail-open/fail-closed audit behavior deliberately.

# Cross-system examples

## Logistics assignment

```text
Dispatcher calls logistics.shipment.assign UI action
  → action input/idempotency validated
  → permission + branch/record policy checked
  → AssignShipment command executes transaction
  → logistics.assignment.created recorded after commit/outbox
  → driver task projection subscriber updates persistent state
  → realtime subscriber publishes driver invalidation
  → notification subscriber queues push notification
  → audit records successful assignment
```

Logistics does not import WebSocket or notification vendor internals.

## Theme publication

```text
Administrator calls ui.theme-profile.publish
  → permission ui.themes.publish
  → theme ID verified in generated registry
  → token/schema/accessibility validation
  → transaction selects exactly one published profile for surface
  → ui.theme-profile.published event
  → cache invalidation job/event subscriber
  → audit records revision and publisher
```

## CMS publication

```text
Editor calls cms.page.publish
  → permission and locale/page policy
  → builder document/block/action/data-source validation
  → public theme availability validation
  → page + builder revision publish transaction
  → cms.page.published event
  → public cache invalidation/static regeneration job
  → audit publication
```

## Inventory consumption

```text
Order/integration requests ConsumeIngredients with idempotency key
  → permission/service policy and unit conversion validated
  → stock movement ledger transaction
  → inventory.movement-recorded event
  → low-stock projection evaluation job
  → optional inventory-budget integration subscriber
  → workspace data source reflects current authorized projection
```

# Ownership and collision rules

Registries reject duplicate/conflicting:

```text
permission keys
event types/schema ownership
command/action IDs
data-source IDs
job/workflow IDs
queue declarations where semantics conflict
audit action IDs
```

Diagnostics identify both owning plugins and public contract/version ranges.

A customer extension uses a namespaced stable ID and follows the same rules.

# Versioning

Version independently when persisted or externally consumed:

```text
package/plugin version
capability/service contract version
permission semantics (normally stable key; breaking meaning needs new key)
event schema version
action input/output schema version
data-source input/output schema version
job input schema version
workflow step/state version
```

Do not silently change the meaning of a stable ID.

# Security and privacy

- Server authorizes every action/query/subscription regardless of client metadata.
- Public actions/data sources use separate narrow contracts.
- Job/event payloads exclude secrets and unnecessary sensitive fields.
- Cached query/data-source results remain actor/scope aware.
- High-risk actions have confirmation/audit/idempotency/approval controls as needed.
- Event/job retries cannot duplicate external effects.
- Impersonation is explicit and audited.
- Runtime theme/layout documents cannot introduce arbitrary actions/functions.
- Provider credentials remain in secret stores/environment, not events/jobs/layouts.

See [Security and Trust Boundaries](./20-security-and-trust-boundaries.md).

# Required tests

## Permissions and actions

- A role without permission cannot reach behavior through route, Payload admin, UI action/data source, job trigger, file access, or WebSocket.
- Record-level branch/team/driver/public-session scope remains enforced after permission grant.
- Modifying browser block/action metadata does not bypass server policy.
- High-risk permission/impersonation changes produce audit records.

## Events

- Transaction rollback produces no externally visible event/realtime message.
- Duplicate event delivery does not duplicate side effects.
- Stored event fixture remains decodable by supported consumers.
- Unsupported schema versions fail/quarantine visibly.
- Event payload contains no registered secret-classified fields.

## Jobs/workflows

- Failed jobs retry according to declared policy and preserve correlation context.
- Idempotency prevents duplicate provider/domain effect.
- Long-running backfill resumes from checkpoint.
- Worker with least-privileged context cannot access unrelated domain data.
- Plugin disable/uninstall cannot leave registered schedules/subscribers/jobs unnoticed.

## UI/theme/CMS integration

- Layout/theme/CMS publication requires the correct scoped permission.
- Public CMS contract cannot invoke authenticated workspace source/action.
- Theme/layout migration job creates validated draft and does not silently publish.
- Orphan block/readiness reporting includes owning plugin and affected revisions.

## Audit

- Audit recording follows explicit fail-open/fail-closed policy per risk.
- Secrets/tokens are redacted.
- Correlation links action, transaction, event, job, realtime, and audit records without copying sensitive payloads.
