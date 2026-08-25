# Domain Blueprints

## Purpose

These blueprints identify likely module boundaries, capabilities, UI contributions, data ownership, and business invariants for the first logistics and restaurant proofs of concept.

They are not final database schemas or complete product specifications. Their purpose is to test whether the K-Nex platform can support materially different customer products through explicit plugins rather than customer-specific core forks.

## Blueprint rules

- Keep domain language explicit; do not create a generic “business record” module.
- Modules own domain invariants and public contracts.
- Replaceable infrastructure is consumed through capabilities/providers.
- Cross-domain optional behavior uses public contracts, events, UI actions/data sources, or integration plugins.
- Modules may provide style-agnostic UI contributions, but customer themes and overrides own final appearance.
- Public CMS blocks use explicit public projections/actions rather than internal workspace records.
- High-frequency/specialized workloads can use provider contracts outside ordinary Payload CRUD.
- Customer-specific policy begins as a customer extension.

# Logistics blueprint

## Product surfaces

A logistics customer can include:

```text
public
  marketing CMS
  shipment lookup/tracking projection
  contact/lead forms

workspace
  shipments
  dispatch
  drivers/vehicles
  operations dashboard
  customer/account context

 driver
  assigned tasks
  route/stops
  status commands
  proof of delivery
  optional location updates

system
  users/roles
  integrations
  module/runtime settings
  health/audit
```

## Plugin and capability graph

```text
module.cms                         module.crm
    │                                  │
    │ optional public/integration      │ optional integration
    └────────────────┐        ┌────────┘
                     ▼        ▼
               module.logistics-core
                   ▲      ▲      ▲
                   │      │      │
          module.dispatch │ module.driver
                          │      │
               module.live-tracking
                          │      │
                          └──┬───┘
                             ▼
                    realtime.gateway@1
                             ▲
              ┌──────────────┴──────────────┐
              │                             │
provider.realtime-websocket-local  provider.realtime-websocket-redis
```

Other potential capabilities:

```text
storage.objects
notifications.sender
maps.routing
geocoding.service
tracking.current-position-store
tracking.position-history-store
```

## Initial dependency table

| Plugin | Required | Optional |
|---|---|---|
| `module.logistics-core` | core/platform | CRM integration, notifications |
| `module.logistics-dispatch` | logistics core | realtime gateway, maps/routing, CRM integration |
| `module.logistics-driver` | logistics core, realtime gateway | dispatch, notifications, object storage |
| `module.logistics-live-tracking` | logistics core | realtime gateway depending on mode, maps, specialized stores |
| `module.logistics-public-tracking` | logistics core | live tracking, CMS, realtime gateway |
| `integration.crm-logistics` | CRM, logistics core | — |

The POC keeps driver → realtime as a required capability. Dispatch can operate without realtime in a degraded refresh/polling mode if explicitly supported. Live tracking requires realtime only when realtime projection is enabled.

## `module.logistics-core`

### Responsibilities

Own stable logistics concepts and contracts:

```text
shipment
parcel/package
origin and destination
route and stop
driver identity/reference
vehicle
branch/operational unit
assignment contract
delivery attempt
proof of delivery reference
shipment status history
public tracking session/projection identity
```

It does not own:

```text
dispatch board interaction
assignment optimization strategy
high-frequency GPS ingestion/storage
customer pricing policy
CRM internals
final customer UI/theme
```

### Domain services/commands

```text
CreateShipment
ChangeShipmentStatus
RecordDeliveryAttempt
CompleteDelivery
CreatePublicTrackingSession
```

### Queries/projections

```text
GetShipment
ListShipments
GetShipmentTimeline
GetPublicTrackingProjection
```

### Events

```text
logistics.shipment.created
logistics.shipment.status-changed
logistics.shipment.delivered
logistics.delivery-attempt.failed
logistics.assignment.created
logistics.assignment.cancelled
```

Event payloads are versioned and exclude unnecessary internal/customer data.

### Permissions

```text
logistics.shipments.read
logistics.shipments.create
logistics.shipments.update
logistics.shipments.assign
logistics.delivery-attempts.record
logistics.proof-of-delivery.read
logistics.proof-of-delivery.create
logistics.tracking.read
```

Customer applications compose dispatcher, branch manager, support, or driver-supervisor roles from these permissions.

### UI contributions

Potential fixed screens:

```text
shipment list
shipment record/detail
vehicle/driver management
```

Potential composable blocks:

```text
logistics.shipment-status-summary
logistics.delayed-shipments
logistics.delivery-performance
logistics.recent-deliveries
logistics.public-tracking-form
logistics.public-delivery-timeline
```

Public blocks use public-safe data/actions. Workspace blocks require authenticated permissions.

## `module.logistics-dispatch`

### Responsibilities

- assignment commands;
- dispatch queues/projections;
- manual and strategy-based assignment contracts;
- vehicle/driver availability and capacity checks;
- route/stop assignment planning;
- reassignment/cancellation;
- conflicts and operational warnings;
- dispatch-specific events and audit;
- optional realtime invalidation.

### Configuration

```ts
dispatchModule({
  assignmentMode: 'manual',
  allowMultiVehicleRoutes: false,
  enforceVehicleCapacity: true,
  realtimeBoardUpdates: true,
})
```

A customer-specific algorithm is a registered strategy/provider or local extension, not `isAcmeCargo` logic.

### Domain commands

```text
AssignShipment
ReassignShipment
CancelAssignment
AssignRoute
ConfirmDispatchPlan
```

### Fixed operational screen

The dispatch board is initially a module-owned operational screen, not an arbitrary builder document. It can expose controlled extension slots:

```text
header metrics
shipment card secondary information
assignment detail side panel
map overlay layers
record actions
```

This protects complex drag/drop transaction behavior, keyboard interactions, conflict handling, and audit semantics.

### Composable blocks

```text
logistics.unassigned-shipments
logistics.available-drivers
logistics.available-vehicles
logistics.dispatch-load-summary
logistics.dispatch-alerts
```

These can appear in workspace dashboards through the shared builder profile.

### Realtime

When enabled, dispatch uses `realtime.gateway` for invalidation/projections after commit. The board can refetch authoritative state; WebSocket is not the only source of assignment truth.

## `module.logistics-driver`

### Responsibilities

The backend module owns contracts used by a driver PWA/native app:

```text
driver authentication/session adapter
device registration
assigned task projection
task acknowledgement
pickup/delivery status commands
proof-of-delivery/photo/signature upload contracts
offline mutation idempotency
push notification token registration
realtime channel definitions and authorization
client SDK/contracts
```

The final driver application belongs in the customer repository, for example `apps/driver/`.

### Required capabilities

```text
module.logistics-core
realtime.gateway@1
```

Potential optional capabilities:

```text
storage.objects
notifications.sender
maps.routing
logistics.dispatch
```

### Driver flow

```text
assignment transaction commits
  → logistics.assignment.created
  → persistent driver task projection
  → realtime invalidation to authorized driver
  → driver fetches authoritative task
  → driver sends idempotent status command
  → committed change updates workspace/realtime projections
```

### UI/client contributions

The module can export style-agnostic driver UI/controller pieces:

```text
useDriverTasks
useTaskDetail
useProofOfDelivery
DriverTaskList
TaskStatusActions
ProofOfDeliveryCapture contract
```

The customer driver app chooses PWA/native implementation and final theme/layout.

## `module.logistics-live-tracking`

### Responsibilities

- authenticated location ingestion contract;
- current-position abstraction;
- optional position history abstraction;
- retention/precision/privacy policy;
- map/tracking projections;
- throttling/coalescing;
- public tracking integration;
- workspace realtime block metadata;
- location-related audit/observability.

### Data separation

Ordinary Payload/Postgres business records:

```text
shipment
route
vehicle
driver
assignment
delivery status
public tracking session
tracking policy/configuration
```

Specialized high-frequency path:

```text
current position store
position history store
geospatial/route queries
retention/partitioning
throttled realtime projections
```

Provider contracts:

```ts
export interface CurrentPositionStore {
  set(position: VehiclePosition): Promise<void>
  get(vehicleId: string): Promise<VehiclePosition | null>
  list(query: CurrentPositionQuery): Promise<VehiclePosition[]>
}

export interface PositionHistoryStore {
  append(position: VehiclePosition): Promise<void>
  list(query: PositionHistoryQuery): Promise<VehiclePosition[]>
  purgeBefore(input: PurgePositionHistoryInput): Promise<PurgeResult>
}
```

Small customers can use Postgres/PostGIS. Larger customers can select Redis for current position and partitioned Postgres/PostGIS or another reviewed provider for history.

### UI blocks

```text
logistics.live-map
logistics.vehicle-status-map
logistics.tracking-health
logistics.public-live-tracking
```

Blocks declare their audience and data/realtime policies. Public tracking receives a narrowed, possibly reduced-precision projection.

## `module.logistics-public-tracking`

This can remain part of live tracking initially or become a separate module when behavior grows.

Responsibilities:

```text
public tracking token/session
public-safe shipment projection
lookup/rate-limit/abuse policy
public tracking route/action/data source
optional realtime public channel
cache/expiry/privacy rules
```

It never serializes internal shipment documents, customer contracts, driver personal data, or precise history beyond approved policy.

## CRM integration

CRM should remain independent. A reusable integration plugin can relate:

```text
CRM contact/company/account
  ↔ logistics customer/account reference
CRM activity timeline
  ← shipment created/delivered/failed events
CRM opportunity won
  → optional logistics onboarding workflow
```

The integration uses public services/events and owns mapping data. Logistics does not read CRM private tables.

## Cargo builder and theme composition

### Public CMS profile

Available blocks can include:

```text
content.hero
content.features
logistics.public-tracking-form
logistics.public-delivery-timeline
crm.public-lead-form
customer-specific cargo blocks
```

### Workspace profile

Available blocks can include:

```text
logistics.unassigned-shipments
logistics.delayed-shipments
logistics.live-map
logistics.delivery-performance
core.activity-feed
```

### Themes

Example:

```text
admin: theme.minimal
public: theme.neobrutalism
```

The same module blocks consume semantic primitives and theme tokens rather than cargo-specific hard-coded styles.

## Logistics invariants to test

- A shipment cannot be assigned to an unauthorized driver/branch.
- Assignment changes are transactional and audited.
- Capacity/state conflicts fail before assignment commit.
- Driver offline retries are idempotent.
- Realtime publication occurs only after commit.
- Driver B cannot access Driver A tasks/channels.
- Public tracking token exposes only approved projection and expires.
- Delivered shipment cannot move backward without correction workflow.
- Proof-of-delivery assets enforce shipment/actor access.
- Location precision/retention policies are enforced.
- Missing realtime provider fails composition when driver is installed.
- Public CMS blocks cannot bind internal logistics workspace data.

# Restaurant blueprint

## Product surfaces

```text
public
  restaurant website
  QR menu
  branch/menu availability
  reservation/contact actions

workspace
  menu/content management
  inventory
  recipe costing
  budget/report dashboards

system
  users/roles
  integrations
  theme/plugin/runtime settings
```

## Plugin graph

```text
                    module.cms
                        │
                        ▼
              module.restaurant-qr-menu
                        ▲
                        │
              module.restaurant-core
                  ▲           ▲
                  │           │
     module.restaurant-inventory
                  ▲           │
                  │           ▼
       module.recipe-costing  module.budgeting
                  │           ▲
                  └──── optional integration ────┘
```

Potential integrations/providers:

```text
integration.inventory-budgeting
notifications.sender
storage.objects
builder.engine
theme.runtime
```

## Initial dependency table

| Plugin | Required | Optional |
|---|---|---|
| `module.restaurant-core` | core/platform | CMS, CRM integration |
| `module.restaurant-qr-menu` | restaurant core | CMS, localization |
| `module.restaurant-inventory` | restaurant core | notifications, purchasing integration |
| `module.restaurant-recipe-costing` | restaurant core, inventory | budgeting |
| `module.budgeting` | core/platform | restaurant core, inventory integration |
| `integration.inventory-budgeting` | inventory, budgeting | — |

## `module.restaurant-core`

### Responsibilities

```text
branch/location
service hours
menu context
product/dish identity
menu category
allergens and dietary attributes
availability context
tax/service configuration references
```

It does not own final menu card design, customer imagery, brand typography, stock ledger, or budget approval.

### Events

```text
restaurant.menu-item.created
restaurant.menu-item.availability-changed
restaurant.branch.service-hours-changed
```

### UI contributions

Fixed workspace screens:

```text
branches
menu items/categories
availability management
```

Composable/public blocks:

```text
restaurant.menu-category
restaurant.featured-dishes
restaurant.branch-selector
restaurant.allergen-legend
restaurant.opening-hours
restaurant.menu-availability-summary
```

## `module.restaurant-qr-menu`

### Responsibilities

- QR target/route contract;
- public branch/locale menu projection;
- category ordering;
- price/sold-out availability;
- cache/publication invalidation;
- public analytics extension points;
- public-safe data-source/block registrations;
- optional CMS page integration.

Customer repository owns:

```text
menu visual design through theme/overrides
brand imagery and fonts
public route composition
QR artwork/assets
customer-specific marketing blocks
```

Public projection excludes internal cost, supplier, stock ledger, and budget data.

## `module.restaurant-inventory`

Inventory uses an auditable movement ledger rather than ad hoc mutable quantities.

### Concepts

```text
stock item/ingredient
unit of measure
warehouse/location
stock movement
purchase receipt
consumption
waste
adjustment
transfer
supplier reference
minimum-stock rule
```

Movement types:

```text
purchase
consumption
waste
adjustment-in
adjustment-out
transfer-in
transfer-out
```

Current quantity can be calculated or maintained as a transactionally safe projection. Movement records remain the audit source.

### Domain service

```ts
await inventory.consumeIngredients({
  source: { type: 'order', id: orderId },
  locationId,
  lines,
  idempotencyKey,
  actor,
})
```

### Permissions

```text
restaurant.inventory.read
restaurant.inventory.receive
restaurant.inventory.consume
restaurant.inventory.adjust
restaurant.inventory.transfer
restaurant.inventory.waste.record
```

### Operational screens and blocks

Fixed screens:

```text
stock ledger
purchase receipt
adjustment/transfer workflow
ingredient detail
```

Composable blocks:

```text
inventory.low-stock
inventory.stock-value-summary
inventory.recent-waste
inventory.movements-by-location
```

A stock adjustment remains a controlled action/screen, not a freeform builder mutation.

## `module.restaurant-recipe-costing`

Potential responsibilities:

```text
recipe
recipe ingredient and unit conversion
yield/portion
cost snapshot
cost recalculation
margin projection
```

It consumes inventory item/unit/cost contracts. It should not read inventory private tables.

Events:

```text
recipe.cost-recalculated
recipe.margin-threshold-crossed
```

Blocks:

```text
restaurant.recipe-cost-summary
restaurant.margin-warning
```

## `module.budgeting`

Potential concepts:

```text
budget
budget period
branch/cost center
allocation
expense/revenue target
actual projection
variance
threshold
approval/period close/correction
```

Commands:

```text
CreateBudget
AllocateBudget
RecordAdjustment
ApproveBudget
CloseBudgetPeriod
CorrectClosedPeriod
```

Events:

```text
budget.approved
budget.threshold-exceeded
budget.period-closed
```

Permissions:

```text
budget.read
budget.manage
budget.approve
budget.period.close
budget.correct
```

Operational approval/closing screens remain controlled. Dashboard blocks can show variance, spend, alerts, and trends.

## Inventory–budget integration

Substantial optional behavior belongs in:

```text
integration.inventory-budgeting
```

It can subscribe to:

```text
inventory.movement-recorded
inventory.waste-recorded
purchase.received
```

and update/rebuild authorized budgeting projections. Neither module reads the other's private tables.

## Restaurant builder and theme composition

### Public CMS profile

```text
content.hero
restaurant.menu-category
restaurant.featured-dishes
restaurant.branch-selector
restaurant.allergen-legend
customer chef/story/reservation blocks
```

### Workspace profile

```text
inventory.low-stock
inventory.recent-waste
budget.variance
restaurant.menu-availability-summary
```

### Themes

Example:

```text
admin: theme.minimal
public: theme.glassmorphism or customer restaurant theme
```

Cargo blocks are absent because their plugins are not installed.

## Restaurant invariants to test

- Every stock mutation creates an auditable movement.
- Repeated order/external events do not double-consume stock.
- Unit conversions are explicit and versioned.
- Branch users see only authorized stock/budget data.
- Public menu contains no internal cost/stock/budget fields.
- Sold-out/availability changes safely invalidate public projections.
- Closed budget periods require correction workflow for mutation.
- Approval permissions and record scope are enforced server-side.
- Removing inventory detects recipe/budget integration dependencies.
- CMS/public blocks cannot bind internal inventory or budget data.

# Horizontal capabilities across blueprints

## CMS

Owns content/page/media/navigation/publication behavior, independent of vertical rules.

## CRM

Owns contacts, companies, opportunities, and activities. Vertical relationships use integration contracts/plugins.

## Builder

One engine-independent block/layout architecture serves CMS and workspace profiles. Puck is the provisional first adapter.

## Themes

Installed theme packages and runtime profiles render the same style-agnostic module UI differently per customer and per admin/public surface.

## Realtime

Provider capability only. Domain modules own channel definitions, data projections, and authorization.

## Notifications

Provider/channel capabilities can deliver driver assignments, tracking status, low-stock warnings, and budget alerts.

## Files/media

Object-storage capability supports CMS images, proof of delivery, documents, and uploads while domain modules own classification/access policy.

## Permissions/events/jobs

Shared contracts allow modules to cooperate without hard-coded customer roles or synchronous provider coupling.

# Cross-blueprint POC proof

The architecture is validated only when:

- both customer apps are generated from manifests through the CLI;
- both consume the same core/CMS/UI/builder packages;
- plugin graphs, migrations, themes, and deployments are independent;
- logistics module UI never appears in restaurant product and vice versa;
- the same style-agnostic foundation block renders under materially different themes;
- public/workspace data boundaries hold;
- one customer upgrades without forcing the other;
- customer-specific extensions remain local and do not enter shared core.
